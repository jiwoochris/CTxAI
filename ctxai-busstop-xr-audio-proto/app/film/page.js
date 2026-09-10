"use client";

// /film — 반응형 실시간 VR 영화 (2026-09-10).
//
// /story-vr(관찰 11초 → 판정 1회 → 고정 장면)와 달리, 여기서는 체험 내내
// 연출 상태(lib/directionState.js)가 갱신되고, 그 상태가 매 프레임 장면 전체
// (하늘·태양·안개·가로등·도로 반사·옆사람의 거리와 시선·대사 간격·BGM)를 움직인다.
//
// 폐루프
//   헤드셋/카메라 포즈 ──┐
//   웹캠 얼굴(선택)  ──┼─→ 연출 상태 {R,H,C} ─→ 매핑표 ─→ 렌더·연기·소리
//                       └────────────── 관객이 그걸 보고 다시 반응 ──┘
//
// 이산으로 남는 것: "누가 앉는가"(R/H/C 세 인물 중 하나, 판정 시점 t≈58s에 확정)와
// 대사 46줄의 텍스트. 나머지는 전부 연속이고 착석 뒤에도 계속 움직인다.
//
// 인프라: Supabase·Vercel·ElevenLabs 없이 동작한다. 오디오는 public/reactive/audio
// (scripts/pull-assets.mjs 로 받은 로컬 파일)에서만 읽는다.
//
// URL 옵션: ?speed=2 (영화 시간 배속) · ?cam=0 (웹캠 채널 끄기) · ?hud=0 (HUD 숨김) · ?rig=0 (리깅 캐릭터 끄기)
//           ?pool=1 (대사 풀 모드 — 원문 46줄 대신 상태에 따라 보조 장르 변주를 줄마다 고른다. 목소리는 OpenRouter 합성)

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { XR, createXRStore, useXR } from "@react-three/xr";
import { Euler, MathUtils } from "three";
import ReactiveStage from "@/components/ReactiveStage";
import { createDirectionState, rank } from "@/lib/directionState";
import { createHeadPoseSensor } from "@/lib/headPoseSense";
import { deriveBgmGains, TRIGGERS } from "@/lib/directionMap";
import { CUES, T, evalActors } from "@/lib/filmTimeline";
import { DIALOGUE_V2_LINES, DIALOGUE_V2_GENRE_LABEL } from "@/lib/dialogueV2Lines";
import { observe, judgeFromBehavior } from "@/lib/behaviorSense";
import { loadDialoguePool, pickPoolLine, poolCoverage } from "@/lib/dialoguePool";
import s from "../story/story.module.css";
import f from "./film.module.css";

const xrStore = createXRStore();
const AUDIO_BASE = "/reactive/audio";
const CANVAS_CAMERA = { position: [0, 1.15, 0.35], fov: 60 };
const GENRE_META = {
  R: { accent: "#f2a7c0", label: "로맨스" },
  H: { accent: "#8fae95", label: "공포" },
  C: { accent: "#e0a86a", label: "블랙코미디" },
};
const CAM_WINDOW_MS = 8000;
const EVENT_LABEL = { poster: "포스터", cafeBell: "우비 인물", truckSplash: "물보라", frog: "개구리", cat: "고양이", catScream: "비명" };

// URL 옵션은 마운트 뒤에 읽는다 — 서버 렌더와 첫 클라이언트 렌더가 같아야 하이드레이션 오류가 없다.
function useQuery() {
  const [q, setQ] = useState({});
  useEffect(() => { setQ(Object.fromEntries(new URLSearchParams(window.location.search).entries())); }, []);
  return q;
}

// 캔버스 안에서 도는 디렉터 — 카메라 포즈를 센서에 넣고, 상태를 tick 하고, 타임라인을 밀고, 큐를 쏜다.
function FilmDirector({ directionRef, sensorRef, actorsRef, filmRef, onCue, speed }) {
  const session = useXR((xr) => xr.session);
  const euler = useMemo(() => new Euler(), []);
  useFrame((state, dt) => {
    const d = directionRef.current;
    const film = filmRef.current;
    if (!d || !film.running) return;
    if (!film.fired) film.fired = new Set();
    const clamped = Math.min(dt, 0.1);
    d.tick(clamped);

    // 카메라 포즈 → 헤드 포즈 센서. 오른쪽 = +yaw. 뒤로 물러남(z+)은 헤드셋 세션에서만 의미가 있다.
    euler.setFromQuaternion(state.camera.quaternion, "YXZ");
    const yaw = -MathUtils.radToDeg(euler.y);
    const pitch = MathUtils.radToDeg(euler.x);
    const z = session ? state.camera.position.z : 0;
    sensorRef.current?.update(yaw, pitch, z, clamped);

    // 영화 시간
    film.t += clamped * speed;
    for (const cue of CUES) {
      if (film.t >= cue.t && !film.fired.has(cue.name)) {
        film.fired.add(cue.name);
        onCue(cue);
      }
    }

    const actors = evalActors(film.t, { dominant: film.dominant, npcDistance: film.npcDistance, busAt: film.busAt });
    actorsRef.current = actors;

    // 옆사람이 앉아 있으면 그 방향을 센서에 알려 "사람에 대한 관심"을 잰다
    if (actors.npc?.visible && actors.npc.seated) {
      const dx = actors.npc.x - state.camera.position.x;
      const dz = actors.npc.z - state.camera.position.z;
      sensorRef.current?.setNpcAzimuth(MathUtils.radToDeg(Math.atan2(dx, -dz)));
    } else sensorRef.current?.setNpcAzimuth(null);

    if (film.onFrame) film.onFrame(film.t, actors);
  });

  return null;
}

function TrajectoryChart({ trajectory, events }) {
  const W = 660, H = 170, PAD = 8;
  if (!trajectory?.length) return null;
  const tMax = trajectory[trajectory.length - 1].t || 1;
  const x = (t) => PAD + (t / tMax) * (W - PAD * 2);
  const y = (v) => H - PAD - v * (H - PAD * 2);
  const path = (g) => trajectory.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[g]).toFixed(1)}`).join(" ");
  const marks = (events || []).filter((e) => e.kind === "event" && e.name === "event:start");
  return (
    <svg className={f.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {marks.map((m, i) => (
        <g key={i}>
          <line x1={x(m.t)} x2={x(m.t)} y1={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
          {/* 사건이 초반 1분에 몰려 있어 라벨을 위아래로 번갈아 놓는다 */}
          <text x={x(m.t) + 3} y={PAD + 10 + (i % 3) * 11} fill="rgba(255,255,255,0.45)" fontSize="9">{m.detail?.name}</text>
        </g>
      ))}
      <path d={path("R")} fill="none" stroke={GENRE_META.R.accent} strokeWidth="2" />
      <path d={path("H")} fill="none" stroke={GENRE_META.H.accent} strokeWidth="2" />
      <path d={path("C")} fill="none" stroke={GENRE_META.C.accent} strokeWidth="2" />
      <path d={trajectory.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.settled).toFixed(1)}`).join(" ")} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" strokeDasharray="4 3" />
    </svg>
  );
}

export default function FilmPage() {
  const q = useQuery();
  const speed = Math.max(0.25, Math.min(6, Number(q.speed) || 1));
  const useCam = q.cam !== "0";
  const showHud = q.hud !== "0";
  const useRig = q.rig !== "0"; // ?rig=0 이면 리깅 캐릭터 대신 캡슐 실루엣
  const usePool = q.pool === "1"; // 대사 풀 모드 (lib/dialoguePool.js)
  // ?bias=H (또는 H:1.5) — 시작 시 그 장르 증거를 미리 넣어 배합을 기울인다. 발표·QA용:
  // 같은 장면을 강제 배합으로 비교해 볼 때 쓴다. 실제 관객 세션에서는 쓰지 않는다.
  const bias = useMemo(() => { const [g, w] = String(q.bias || "").split(":"); return ["R", "H", "C"].includes(g) ? { g, w: Number(w) || 1.2 } : null; }, [q.bias]);
  const poolRef = useRef(null);
  useEffect(() => { if (usePool) loadDialoguePool().then((p) => { poolRef.current = p; }); }, [usePool]);

  const [phase, setPhase] = useState("gate"); // gate | intro | scene | bus | end
  const [hud, setHud] = useState(null);
  const [caption, setCaption] = useState("");
  const [line, setLine] = useState(null);
  const [dominant, setDominant] = useState(null);
  const [xrError, setXrError] = useState("");
  const [session, setSession] = useState(null);
  const [camStatus, setCamStatus] = useState("off");

  const directionRef = useRef(null);
  const sensorRef = useRef(null);
  const actorsRef = useRef({});
  const paramsRef = useRef(null);
  const filmRef = useRef({ running: false, t: 0, dominant: null, npcDistance: 0.9, busAt: null, onFrame: null });
  const audioRef = useRef(new Map());
  const bgmRef = useRef({});
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const abortRef = useRef({ aborted: false });

  function audio(name) {
    let a = audioRef.current.get(name);
    if (!a) {
      a = new Audio(`${AUDIO_BASE}/${name}`);
      a.preload = "auto";
      audioRef.current.set(name, a);
    }
    return a;
  }
  function playSfx(key, { volume = 0.8, loop = false } = {}) {
    const a = audio(`sfx_${key}.mp3`);
    a.loop = loop; a.volume = volume; a.currentTime = 0;
    a.play().catch(() => {});
    return a;
  }
  function playFile(name, volume = 1) {
    return new Promise((resolve) => {
      const a = audio(name);
      a.loop = false; a.volume = volume; a.currentTime = 0;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      a.onended = finish; a.onerror = finish;
      a.play().catch(finish);
      setTimeout(finish, 15000);
    });
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // BGM 3트랙 — 항상 재생, 게인만 상태를 따른다
  function ensureBgm() {
    for (const g of ["H", "R", "C"]) {
      if (!bgmRef.current[g]) {
        const a = new Audio(`${AUDIO_BASE}/bgm_${g}.wav`);
        a.loop = true; a.volume = 0;
        bgmRef.current[g] = a;
      }
      bgmRef.current[g].play().catch(() => {});
    }
  }
  function stopBgm() { for (const a of Object.values(bgmRef.current)) { a.pause(); } }

  // HUD 갱신 + BGM 게인 — 250ms마다
  useEffect(() => {
    if (phase === "gate") return;
    const id = setInterval(() => {
      const d = directionRef.current;
      if (!d) return;
      const snap = d.snapshot();
      const gains = deriveBgmGains(snap.current, snap.settled);
      for (const g of ["H", "R", "C"]) { const a = bgmRef.current[g]; if (a) a.volume += (gains[g] - a.volume) * 0.35; }
      const film = filmRef.current;
      // 착석 뒤 옆사람의 거리는 상태가 정한다 (요청서 v5.0 §2.7: 0.5~1.4m)
      film.npcDistance = paramsRef.current?.npcDistance ?? 0.9;
      setHud({ ...snap, t: film.t, params: paramsRef.current, lastEvidence: d.st.lastEvidence, camStatus, events: sensorRef.current?.report?.().events || [] });
    }, 250);
    return () => clearInterval(id);
  }, [phase, camStatus]);

  // 웹캠 채널 — 8초 창을 반복. 얼굴이 대부분 안 잡히면(헤드셋 착용 등) 그 창은 버린다.
  async function camLoop() {
    const video = videoRef.current;
    while (!abortRef.current.aborted && video && directionRef.current) {
      const obs = await observe(video, CAM_WINDOW_MS, null);
      if (abortRef.current.aborted) break;
      if (!obs.ok) { setCamStatus("model-fail"); break; }
      const m = obs.metrics;
      if ((m.lostTrackingSec || 0) > (CAM_WINDOW_MS / 1000) * 0.6) { setCamStatus("no-face"); continue; }
      setCamStatus("on");
      const r = judgeFromBehavior(m);
      directionRef.current.pushEvidence(r.scores, 0.5, "webcam", r.reason);
    }
  }

  async function start() {
    abortRef.current = { aborted: false };
    const d = createDirectionState({ followRate: 0.6, decayHalfLifeSec: 90, settleMass: 2.5 });
    directionRef.current = d;
    sensorRef.current = createHeadPoseSensor({ push: d.pushEvidence, mark: d.markEvent });
    paramsRef.current = null;
    filmRef.current = { running: true, t: 0, dominant: null, npcDistance: 0.9, busAt: null, onFrame: null };
    setDominant(null); setLine(null); setCaption("");
    if (bias) d.pushEvidence({ [bias.g]: 1 }, bias.w, "bias", `?bias=${bias.g}`);
    d.setPhase("intro");
    setPhase("intro");
    ensureBgm();

    if (useCam) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setCamStatus("starting");
        camLoop();
      } catch { setCamStatus("denied"); }
    }
  }

  function onCue(cue) {
    const d = directionRef.current;
    const film = filmRef.current;
    if (!d) return;
    if (cue.sfx) playSfx(cue.sfx, { volume: cue.volume ?? 0.8, loop: !!cue.loop });
    if (cue.slot) playFile(`${cue.slot}.mp3`, cue.volume ?? 1);
    if (cue.sense) sensorRef.current?.beginEvent(cue.name, cue.sense.azimuth, cue.sense.dur / speed, { kind: cue.sense.kind });
    d.markEvent("cue", cue.name);

    if (cue.name === "judge") {
      // 이산 결정 하나 — 누가 앉는가. 그 뒤로도 상태는 계속 흐른다.
      const { dominant: dom } = rank(d.st.current);
      film.dominant = dom;
      setDominant(dom);
      d.setPhase("judged");
      setCaption("");
    }
    if (cue.name === "announce") setCaption("272번 버스는 5분 후 도착 예정입니다");
    if (cue.name === "npcWalk") {
      setCaption("");
      if (film.dominant === "C") { playSfx("15", { volume: 0.6 }); }
      if (film.dominant === "R") { playSfx("04", { volume: 0.5 }); }
      if (film.dominant === "H") { playSfx("06", { volume: 0.35 }); }
    }
    if (cue.name === "npcSeated") { playSfx(film.dominant === "C" ? "16" : "05", { volume: 0.6 }); }
    if (cue.name === "scene") { d.setPhase("scene"); setPhase("scene"); runScene(); }
  }

  // 캐릭터 장면 — 대사는 이산(고정 46줄)이지만 간격·크기·보조 장르 콜백은 상태를 따른다.
  async function runScene() {
    const d = directionRef.current;
    const film = filmRef.current;
    const dom = film.dominant || "R";
    const base = DIALOGUE_V2_LINES.filter((l) => l.genre === dom);
    let insertedCallback = false;

    const pool = usePool ? poolRef.current : null;
    const poolOk = !!pool?.ok && poolCoverage(pool, dom).base === base.length;

    for (let i = 0; i < base.length; i++) {
      if (abortRef.current.aborted) return;
      const p = paramsRef.current || {};
      const { secondary, secondaryWeight } = rank(d.st.current);

      if (poolOk) {
        // 풀 모드: 이 줄을 재생하기 직전의 상태로 원문/보조 장르 변주를 고른다 (근접 매칭).
        const l = base[i];
        const pick = pickPoolLine(pool, dom, l.seq, d.st.current);
        if (pick) {
          d.markEvent("line", { seq: l.seq, secondary: pick.secondary, weight: Math.round(pick.weight * 100) / 100 });
          setLine({ ...l, text: pick.text, tinted: pick.secondary, index: i, total: base.length });
          await playFile(pick.file.replace(`${AUDIO_BASE}/`, ""), Math.min(1, p.npcVolume ?? 1));
          await wait(((paramsRef.current?.npcSilence ?? 1.2) * 1000) / speed);
          continue;
        }
      }

      // 보조 장르 콜백 — 비중이 임계값을 넘는 순간 한 번, 그 장르의 첫 줄을 끼워 넣는다
      if (!insertedCallback && i >= 2 && secondary !== dom && secondaryWeight >= TRIGGERS.secondaryCallback.above) {
        const cb = DIALOGUE_V2_LINES.find((l) => l.genre === secondary && l.seq === "01");
        if (cb) {
          insertedCallback = true;
          d.markEvent("callback", { genre: secondary, weight: secondaryWeight });
          setLine({ ...cb, flavor: true, index: i, total: base.length });
          await playFile(cb.file, Math.min(1, (p.npcVolume ?? 1) * 0.9));
          await wait(((p.npcSilence ?? 1.2) * 1000) / speed);
        }
      }
      const l = base[i];
      setLine({ ...l, index: i, total: base.length });
      await playFile(l.file, Math.min(1, p.npcVolume ?? 1));
      const gap = (paramsRef.current?.npcSilence ?? 1.2) * 1000;
      await wait(gap / speed);
    }
    if (abortRef.current.aborted) return;
    setLine(null);
    film.busAt = film.t;
    d.setPhase("bus");
    setPhase("bus");
    playSfx("07", { volume: 0.7 });
    setCaption("272");
    // 문 열림 → 인물 퇴장 → 버스 출발 → 암전 (filmTimeline의 busAt 기준 오프셋)
    await wait((7.2 * 1000) / speed); playSfx("08", { volume: 0.5 }); setCaption("");
    await wait((14 * 1000) / speed);
    d.setPhase("end");
    setPhase("end");
    film.running = false;
    stopBgm();
    audioRef.current.get("sfx_01.mp3")?.pause();
  }

  async function enterVr() {
    setXrError("");
    try {
      const sess = await xrStore.enterVR();
      setSession(sess || true);
    } catch { setXrError("VR 진입에 실패했습니다 — 헤드셋 연결과 브라우저의 WebXR 지원을 확인해 주세요."); }
  }

  function reset() {
    abortRef.current.aborted = true;
    filmRef.current.running = false;
    stopBgm();
    for (const a of audioRef.current.values()) { a.pause(); }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setPhase("gate"); setHud(null); setLine(null); setCaption(""); setDominant(null); setCamStatus("off");
  }

  function sessionData(extra = {}) {
    const d = directionRef.current;
    if (!d) return null;
    return d.exportSession({ dominant: filmRef.current.dominant, speed, headPose: sensorRef.current?.report?.(), ...extra });
  }

  // 종료 시 자동 저장 (data/sessions/, Supabase 아님). 실패해도 체험은 영향 없다.
  const [savedId, setSavedId] = useState(null);
  const [selfReport, setSelfReport] = useState(null);
  async function saveSession(extra = {}) {
    const data = sessionData(extra);
    if (!data) return;
    try {
      const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const j = await r.json();
      if (j?.ok) setSavedId(j.id);
    } catch { /* 로컬 저장 실패는 무시 */ }
  }
  useEffect(() => { if (phase === "end") { setSelfReport(null); saveSession(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [phase]);

  function downloadSession() {
    const data = sessionData({ selfReport });
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `busstop-session-${Date.now()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  useEffect(() => () => { abortRef.current.aborted = true; stopBgm(); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const accent = dominant ? GENRE_META[dominant].accent : "#cfd8e3";
  const lineAccent = line?.flavor ? GENRE_META[line.genre].accent : accent;
  const snap = hud;
  const trig = snap?.params?.triggers || {};

  return (
    <div className={s.stage} style={{ "--accent": accent }}>
      <div className={s.bgLayer}>
        <Canvas shadows>
          <PerspectiveCamera makeDefault position={CANVAS_CAMERA.position} fov={CANVAS_CAMERA.fov} />
          <XR store={xrStore}>
            <ReactiveStage directionRef={directionRef} actorsRef={actorsRef} dominant={dominant} paramsOut={paramsRef} useRig={useRig} rigTest={q.rigtest === "1"} />
            <FilmDirector directionRef={directionRef} sensorRef={sensorRef} actorsRef={actorsRef} filmRef={filmRef} onCue={onCue} speed={speed} />
          </XR>
          <OrbitControls target={[0, 1.15, -4]} enableZoom={false} enablePan={false} enableDamping dampingFactor={0.08} rotateSpeed={0.5} />
        </Canvas>
        <div className={s.vignette} />
      </div>

      <video ref={videoRef} muted playsInline className={s.hiddenVideo} />

      <div className={s.topBar}>
        <a className={s.homeLink} href="/">← 대시보드</a>
        <span className={s.dim}>반응형 실시간 영화 · 폐루프 연출 상태 · <a href="/story-vr" style={{ color: "inherit" }}>이전 버전(1회 판정)</a></span>
        <div className={s.genreChip}>
          <button className={s.resetBtn} onClick={enterVr}>🥽 Enter VR</button>
          {phase !== "gate" && (
            <>
              {dominant && <><span className={s.genreDot} />{DIALOGUE_V2_GENRE_LABEL[dominant]}</>}
              <button className={s.resetBtn} onClick={reset}>⟲ 처음으로</button>
            </>
          )}
        </div>
      </div>

      {xrError && <p className={s.introSub} style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", zIndex: 6 }}>{xrError}</p>}

      {showHud && snap && phase !== "gate" && phase !== "end" && (
        <div className={f.hud} style={{ "--accent": accent }}>
          <p className={f.hudTitle}><span>연출 상태</span><span>{snap.phase} · {Math.floor(snap.t / 60)}:{String(Math.floor(snap.t % 60)).padStart(2, "0")}</span></p>
          {["R", "H", "C"].map((g) => (
            <div key={g} className={f.bar}>
              <span>{GENRE_META[g].label}</span>
              <div className={f.barTrack}><div className={f.barFill} style={{ width: `${Math.round(snap.current[g] * 100)}%`, background: GENRE_META[g].accent }} /></div>
              <span style={{ textAlign: "right" }}>{Math.round(snap.current[g] * 100)}%</span>
            </div>
          ))}
          <div className={f.hudMeta}>
            <span>정착 <b>{Math.round(snap.settled * 100)}%</b></span>
            <span>확신 <b>{Math.round(snap.confidence * 100)}%</b></span>
            <span>웹캠 <b>{camStatus}</b></span>
            <span>거리 <b>{snap.params ? snap.params.npcDistance.toFixed(2) : "-"}m</b></span>
            <span>시선 <b>{snap.params ? Math.round(snap.params.npcGaze * 100) : "-"}%</b></span>
            <span>침묵 <b>{snap.params ? snap.params.npcSilence.toFixed(1) : "-"}s</b></span>
          </div>
          <div className={f.hudTrig}>
            <span className={`${f.trig} ${trig.lampEarlyOn ? f.trigOn : ""}`}>가로등 점등</span>
            <span className={`${f.trig} ${trig.sunBreak ? f.trigOn : ""}`}>구름 갈라짐</span>
            <span className={`${f.trig} ${trig.flatLight ? f.trigOn : ""}`}>그림자 소멸</span>
          </div>
          {snap.lastEvidence && (
            <div className={f.lastEv}>↳ {snap.lastEvidence.source} {snap.lastEvidence.note ? `· ${snap.lastEvidence.note}` : ""}</div>
          )}
          {snap.events?.length > 0 && (
            <div className={f.evList}>
              {snap.events.map((e) => {
                const top = ["R", "H", "C"].sort((a, b) => e[b] - e[a])[0];
                return (
                  <div key={e.name} className={f.evRow}>
                    <span>{EVENT_LABEL[e.name] || e.name}</span>
                    <span className={s.dim}>{e.feats.looked ? `봤음 ${e.feats.lookSec.toFixed(1)}s` : "안 봄"}{e.feats.recheck ? " · 재확인" : ""}{e.feats.retreat > 0.03 ? " · 물러남" : ""}</span>
                    <span style={{ color: GENRE_META[top].accent }}>{GENRE_META[top].label} {Math.round(e[top] * 100)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {phase === "gate" && (
        <div className={s.intro}>
          <div className={s.introCard}>
            <p className={s.introEyebrow}>정류장 · 반응형 실시간 영화</p>
            <h1 className={s.introTitle}>정류장 벤치에 앉아 주세요</h1>
            <p className={s.introSub}>
              고르는 것은 없습니다. 당신이 어디를 보고 어떻게 움직이는지가 하늘과 빛, 옆에 앉는 사람을
              바꿉니다. 헤드셋이 있으면 위 "Enter VR"로 들어가고, 없으면 드래그로 둘러보세요.
              {useCam ? " 웹캠은 몸의 반응을 보태는 보조 채널입니다." : ""}
            </p>
            <button className={s.choiceBtn} onClick={start} style={{ justifyContent: "center" }}>
              <span>시작하기{speed !== 1 ? ` (${speed}배속)` : ""}</span>
            </button>
          </div>
        </div>
      )}

      {caption && (
        <div className={f.caption}><span className={f.captionText}>{caption}</span></div>
      )}

      {phase === "scene" && line && (
        <div className={s.subtitleBar} style={{ "--accent": lineAccent }}>
          <div className={s.subtitleInner}>
            <div className={s.progressTrack}>
              <div className={s.progressFill} style={{ width: `${((line.index + 1) / line.total) * 100}%` }} />
            </div>
            <div className={s.seqRow}>
              <span className={s.seqBadge}>{line.genre}-{line.seq}</span>
              <span>{line.index + 1} / {line.total}줄</span>
              {line.flavor && <span className={s.dim}>· 배합 콜백 ({DIALOGUE_V2_GENRE_LABEL[line.genre]})</span>}
              {line.tinted && <span className={s.dim}>· {DIALOGUE_V2_GENRE_LABEL[line.tinted]} 변주</span>}
            </div>
            <p className={s.lineText}>{line.text}</p>
          </div>
        </div>
      )}

      {phase === "end" && (
        <div className={s.intro}>
          <div className={f.endCard}>
            <h2 className={f.endTitle}>오늘의 정류장은 이렇게 흘렀습니다</h2>
            <p className={f.endSub}>
              옆에 앉은 사람: <b style={{ color: accent }}>{dominant ? GENRE_META[dominant].label : "-"}</b> ·
              마지막 배합 {snap ? ["R", "H", "C"].map((g) => `${GENRE_META[g].label} ${Math.round(snap.current[g] * 100)}%`).join(" · ") : ""}
            </p>
            <TrajectoryChart trajectory={directionRef.current?.st.trajectory} events={directionRef.current?.st.events} />
            <div className={f.legend}>
              {["R", "H", "C"].map((g) => <span key={g}><i style={{ background: GENRE_META[g].accent }} />{GENRE_META[g].label}</span>)}
              <span><i style={{ background: "rgba(255,255,255,0.35)" }} />정착도</span>
            </div>
            {/* 파일럿용 자기보고 — "당신이 느낀 정류장은?" 시스템 판정과의 일치율 재료 */}
            <div className={f.legend} style={{ justifyContent: "center", alignItems: "center", gap: 8 }}>
              <span>당신이 느낀 정류장은?</span>
              {["R", "H", "C"].map((g) => (
                <button
                  key={g}
                  className={f.endBtn}
                  style={{ padding: "5px 12px", borderColor: selfReport === g ? GENRE_META[g].accent : undefined, color: selfReport === g ? GENRE_META[g].accent : undefined }}
                  onClick={() => { setSelfReport(g); saveSession({ selfReport: g }); }}
                >{GENRE_META[g].label}</button>
              ))}
              {savedId && <span className={s.dim} style={{ fontSize: 11 }}>· 저장됨</span>}
            </div>
            <div className={f.endActions}>
              <button className={`${f.endBtn} ${f.endBtnMain}`} onClick={() => { reset(); setTimeout(start, 50); }}>다시 앉기</button>
              <button className={f.endBtn} onClick={downloadSession}>세션 기록 내려받기 (JSON)</button>
              <button className={f.endBtn} onClick={reset}>처음으로</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
