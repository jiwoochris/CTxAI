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
// URL 옵션: ?speed=2 (영화 시간 배속) · ?cam=0 (웹캠 채널 끄기) · ?hud=0 (HUD 숨김) · ?rig=0 (리깅 캐릭터 끄기) · ?fx=0 (후처리·도로 반사 끄기)
//           ?gaze=0 (데스크톱 자동 시선 끄기) · ?auto=1 (게이트 없이 자동 시작)
//           ?pool=1 (대사 풀 모드 — 원문 46줄 대신 상태에 따라 보조 장르 변주를 줄마다 고른다. 목소리는 OpenRouter 합성)
//           ?scene=240 (캐릭터 장면 목표 길이 초 — 대사 사이 침묵을 늘려 안내방송의 "5분 후 도착"에 가깝게. 기본 0 = 자연 길이)
//           ?voice=1 (음성 채널 — 안내방송 뒤 "당신은 무엇을 기다리고 있습니까?"를 묻고 답을 STT·톤 분석해 증거로 넣고,
//                     답에서 뽑은 명사를 정류장 이름 표지판에 쓴다. 요청서 v5.0 §2.6) · ?voicefake=romance (마이크 대신 샘플 파일)

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { XR, createXRStore, useXR } from "@react-three/xr";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Euler, MathUtils, Vector3 } from "three";
import ReactiveStage from "@/components/ReactiveStage";
import { createDirectionState, rank } from "@/lib/directionState";
import { createHeadPoseSensor } from "@/lib/headPoseSense";
import { deriveBgmGains, TRIGGERS } from "@/lib/directionMap";
import { CUES, evalActors } from "@/lib/filmTimeline";
import { DIALOGUE_V2_LINES, DIALOGUE_V2_GENRE_LABEL } from "@/lib/dialogueV2Lines";
import { observe, judgeFromBehavior } from "@/lib/behaviorSense";
import { loadDialoguePool, pickPoolLine, poolCoverage } from "@/lib/dialoguePool";
import { beatOf, gazeFor, playsLine, playedCount, beatsTotalSec, answerWatchStart, answerWatchUpdate, answerWatchResult } from "@/lib/dialogueBeats";
import { scoresFromMoodApi } from "@/lib/textKeywords";
import { analyzeProsody } from "@/lib/voiceProsody";
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
function FilmDirector({ directionRef, sensorRef, actorsRef, filmRef, onCue, speed, debugBus = false, debugTruck = false }) {
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
    let yaw = -MathUtils.radToDeg(euler.y);
    let pitch = MathUtils.radToDeg(euler.x);
    if (film.autoGaze && film.autoGazeHold) { yaw = film.autoGazeHold.yaw; pitch = film.autoGazeHold.pitch; }
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

    const actors = evalActors(film.t, { dominant: film.dominant, npcDistance: film.npcDistance, busAt: film.busAt, leaveAt: film.leaveAt });
    if (debugBus) actors.bus = { visible: true, x: -1.2, z: -4.75, stopped: true, doorOpen: true, headlight: 0.6 }; // ?bus=1 — 정차한 버스를 바로 본다 (디자인 점검용)
    if (debugTruck) actors.truck = { visible: true, x: 1.0, z: -4.6 }; // ?truck=1 — 트럭을 물웅덩이 앞에 세운다
    actorsRef.current = actors;

    // 옆사람이 앉아 있으면 그 방향을 센서에 알려 "사람에 대한 관심"을 잰다
    if (actors.npc?.visible && actors.npc.seated && !film.autoGaze) {
      const dx = actors.npc.x - state.camera.position.x;
      const dz = actors.npc.z - state.camera.position.z;
      sensorRef.current?.setNpcAzimuth(MathUtils.radToDeg(Math.atan2(dx, -dz)));
    } else sensorRef.current?.setNpcAzimuth(null);

    // 질문 뒤 기다리는 동안 — 머리 자세의 폭(끄덕임·가로젓기·돌림)을 잰다. 자동 시선 중엔 held 값이라 응답이 생기지 않는다.
    if (film.listen) {
      let npcAz = null;
      if (actors.npc?.visible && actors.npc.seated) npcAz = MathUtils.radToDeg(Math.atan2(actors.npc.x - state.camera.position.x, -(actors.npc.z - state.camera.position.z)));
      if (!film.watch) film.watch = answerWatchStart(yaw, pitch, npcAz); else answerWatchUpdate(film.watch, yaw, pitch);
    }

    if (film.onFrame) film.onFrame(film.t, actors);
  });

  return null;
}

// 데스크톱 자동 시선 — 헤드셋에서는 관객이 직접 고개를 돌리지만, 화면 데모에서는 아무도 드래그하지 않으면
// 옆사람이 앉은 뒤 카메라가 옆사람 쪽(오른쪽 약 60°)으로 천천히 돌아가고, 버스가 오면 정면으로 돌아온다.
// 드래그하면 8초 동안 손을 뗀다. 자동으로 도는 동안은 "사람에 대한 관심" 측정을 끈다(film.autoGaze).
const AUTO_GAZE_NPC = 1.1, AUTO_GAZE_BUS = 0.22, AUTO_GAZE_PITCH = -0.1; // 63° 오른쪽·약간 아래 — 옆사람이 화면 오른쪽 1/3 에 오고 도로가 남는다 (77° 는 얼굴이 화면을 채웠다)
function DesktopGaze({ controlsRef, actorsRef, filmRef }) {
  const session = useXR((xr) => xr.session);
  const manualUntil = useRef(0);
  const dir = useMemo(() => new Vector3(), []);
  // OrbitControls 는 이 컴포넌트보다 뒤에 마운트되므로(형제, JSX 순서) 마운트 효과에서는 ref 가 비어 있다 —
  // 첫 프레임에 한 번 붙이고, 언마운트 때 뗀다.
  const attached = useRef(null);
  const onStart = useMemo(() => () => { manualUntil.current = performance.now() + 8000; }, []);
  useEffect(() => () => { attached.current?.removeEventListener("start", onStart); attached.current = null; }, [onStart]);
  useFrame((state, dt) => {
    const film = filmRef.current; const c = controlsRef.current;
    if (c && attached.current !== c) { attached.current?.removeEventListener("start", onStart); c.addEventListener("start", onStart); attached.current = c; }
    if (session || !c || !film.running) { film.autoGaze = false; return; }
    const actors = actorsRef.current;
    const tune = (typeof window !== "undefined" && window.__gaze) || {}; // 점검용 덮어쓰기 {npc, bus, pitch} (rad)
    let target = null, targetPitch = 0;
    if (film.busAt != null) target = tune.bus ?? AUTO_GAZE_BUS;
    else if (actors?.npc?.visible && actors.npc.seated) { target = tune.npc ?? AUTO_GAZE_NPC; targetPitch = tune.pitch ?? AUTO_GAZE_PITCH; }
    if (target == null || performance.now() < manualUntil.current) { film.autoGaze = false; film.autoGazeHold = null; return; }
    // 현재 방위(오른쪽 +)·앙각을 카메라→타깃 벡터에서 읽어 목표 방위로 완만히 보간한다
    dir.copy(c.target).sub(state.camera.position);
    const r = dir.length() || 0.01;
    const yaw = Math.atan2(dir.x, -dir.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y / r)));
    if (!film.autoGaze) film.autoGazeHold = { yaw: MathUtils.radToDeg(yaw), pitch: MathUtils.radToDeg(pitch) }; // 센서엔 이 값이 계속 들어간다
    film.autoGaze = true;
    const ny = yaw + (target - yaw) * Math.min(1, dt * 0.9);
    const np = pitch + (targetPitch - pitch) * Math.min(1, dt * 0.9);
    dir.set(Math.sin(ny) * Math.cos(np), Math.sin(np), -Math.cos(ny) * Math.cos(np)).multiplyScalar(r);
    state.camera.position.copy(c.target).sub(dir);
  });
  return null;
}

// XR 세션 여부를 페이지 상태로 올린다 — 헤드셋에서는 도로 반사(장면을 한 번 더 그림)도 꺼서 프레임을 지킨다.
function XRProbe({ onChange }) {
  const session = useXR((xr) => xr.session);
  useEffect(() => { onChange(!!session); }, [session, onChange]);
  return null;
}

// 후처리 — 블룸·비네트·ACES 톤매핑. WebXR 세션 중에는 컴포저가 스테레오 렌더와 충돌하므로 끈다.
function Effects({ enabled }) {
  const session = useXR((xr) => xr.session);
  if (!enabled || session) return null;
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      <Bloom luminanceThreshold={0.92} luminanceSmoothing={0.2} intensity={0.35} mipmapBlur />
      <Vignette eskil={false} offset={0.18} darkness={0.6} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
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
          <text x={x(m.t) + 3} y={PAD + 10 + (i % 3) * 11} fill="rgba(255,255,255,0.45)" fontSize="9">{EVENT_LABEL[m.detail?.name] || m.detail?.name}</text>
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
  const voiceFake = q.voicefake || null; // public/samples/<name>.m4a 를 마이크 대신 쓴다 (점검용)
  // 장면 목표 길이(초). 대사 오디오는 합쳐 1~1.5분이라 "5분 후 도착"을 채우려면 침묵을 늘려야 한다.
  // 침묵은 상태가 정한 값(npcSilence)을 하한으로 두고, 남는 시간을 줄 사이에 고르게 나눈다.
  const sceneTarget = Math.max(0, Number(q.scene) || 0);
  const fx = q.fx !== "0"; // ?fx=0 이면 후처리·도로 반사 끄기 (성능 점검용)
  const forceAnswer = q.answer === "1"; // ?answer=1 — 모든 질문을 "답함"으로 처리 (QA: 데스크톱에선 고개 응답이 생기지 않아 답함 갈래를 들을 수 없다)
  const [xrActive, setXrActive] = useState(false);
  // ?auto=1 — 마운트 직후 자동 시작 (관찰·리허설용. 브라우저 자동재생 정책에 따라 소리가 막힐 수 있다)
  const autoStart = q.auto === "1";
  useEffect(() => { if (autoStart && phase === "gate") { const id = setTimeout(() => start(), 1500); return () => clearTimeout(id); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [autoStart]);
  const useVoice = q.voice === "1" || !!voiceFake;
  const [signText, setSignText] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("off");
  const micRef = useRef(null);
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
  const [camStatus, setCamStatus] = useState("off");

  const directionRef = useRef(null);
  const sensorRef = useRef(null);
  const actorsRef = useRef({});
  const paramsRef = useRef(null);
  const filmRef = useRef({ running: false, t: 0, dominant: null, npcDistance: 0.9, busAt: null, onFrame: null });
  const controlsRef = useRef(null);
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
    const token = abortRef.current; // 이 회차의 중단 토큰 — reset 뒤 새 회차가 시작돼도 옛 루프는 여기서 멈춘다
    while (!token.aborted && video && directionRef.current) {
      const obs = await observe(video, CAM_WINDOW_MS, null);
      if (token.aborted) break;
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
    const d = createDirectionState({ followRate: 0.6, decayHalfLifeSec: 150, settleMass: 2.5 });
    directionRef.current = d;
    sensorRef.current = createHeadPoseSensor({ push: d.pushEvidence, mark: d.markEvent });
    paramsRef.current = null;
    filmRef.current = { running: true, t: 0, dominant: null, npcDistance: 0.9, busAt: null, onFrame: null };
    setDominant(null); setLine(null); setCaption("");
    if (bias) d.pushEvidence({ [bias.g]: 1 }, bias.w, "bias", `?bias=${bias.g}`);
    d.setPhase("intro");
    setPhase("intro");
    ensureBgm();

    setSignText("");
    if (useVoice && !voiceFake) {
      try {
        micRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setVoiceStatus("ready");
      } catch { setVoiceStatus("denied"); }
    } else if (voiceFake) setVoiceStatus("fake");

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
    if (cue.sense) sensorRef.current?.beginEvent(cue.name, cue.sense.azimuth, cue.sense.dur / speed, { kind: cue.sense.kind, tail: 4 / speed });
    d.markEvent("cue", cue.name);

    if (cue.name === "judge") {
      // 이산 결정 하나 — 누가 앉는가. 그 뒤로도 상태는 계속 흐른다.
      const { dominant: dom } = rank(d.st.current);
      film.dominant = dom;
      setDominant(dom);
      d.setPhase("judged");
      setCaption("");
    }
    if (cue.name === "announce") {
      setCaption("272번 버스는 5분 후 도착 예정입니다");
      if (useVoice) setTimeout(() => runVoiceFlow(), 3200);
    }
    if (cue.name === "npcWalk") {
      setCaption("");
      if (film.dominant === "C") { playSfx("15", { volume: 0.6 }); }
      if (film.dominant === "R") { playSfx("04", { volume: 0.5 }); }
      if (film.dominant === "H") { playSfx("06", { volume: 0.35 }); }
    }
    if (cue.name === "npcSeated") { playSfx(film.dominant === "C" ? "16" : "05", { volume: 0.6 }); }
    if (cue.name === "scene") { d.setPhase("scene"); setPhase("scene"); runScene(); }
  }

  // ---- 음성 채널 ----
  function recordFor(ms) {
    return new Promise((resolve) => {
      const track = micRef.current?.getAudioTracks?.()[0];
      if (!track) return resolve(null);
      try {
        const rec = new MediaRecorder(new MediaStream([track]));
        const chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
        rec.start();
        setTimeout(() => rec.stop(), ms);
      } catch { resolve(null); }
    });
  }
  async function captureAnswer(ms) {
    if (voiceFake) {
      try { return await (await fetch(`/samples/${encodeURIComponent(voiceFake)}.m4a`)).blob(); } catch { return null; }
    }
    return recordFor(ms);
  }
  async function scoreBlob(blob) {
    if (!blob) return { textScores: null, voiceScores: null, transcript: "", noun: "" };
    const [mood, prosody] = await Promise.all([
      (async () => {
        try {
          const form = new FormData();
          form.append("audio", blob, voiceFake ? "clip.m4a" : "clip.webm");
          const res = await fetch("/api/mood", { method: "POST", body: form });
          const data = await res.json();
          return data?.ok ? data : null;
        } catch { return null; }
      })(),
      analyzeProsody(blob).catch(() => null),
    ]);
    return { textScores: scoresFromMoodApi(mood?.scores), voiceScores: prosody?.scores || null, transcript: mood?.transcript || "", noun: mood?.noun || "" };
  }
  // 안내방송 뒤: Q1 → 답변(5초) → 애매하면 되묻기 1회 → 텍스트 0.9·톤 0.5 무게로 증거 → 표지판.
  // 타임라인과 나란히 돈다 — 옆사람이 걸어오는 동안 세계가 묻고, 관객이 답하면 앉은 뒤의 장면이 그 답을 반영한다.
  async function runVoiceFlow() {
    const d = directionRef.current;
    const token = abortRef.current;
    if (!d || token.aborted) return;
    setVoiceStatus("asking");
    await playFile("vo_q1.mp3", 1);
    setVoiceStatus("listening");
    let out = await scoreBlob(await captureAnswer(5000));
    if (!out.textScores && !token.aborted) {
      setVoiceStatus("reprompt");
      await playFile("vo_filler1.mp3", 0.9);
      await playFile("sfx_inhale.mp3", 0.8);
      await playFile("vo_reprompt.mp3", 1);
      setVoiceStatus("listening");
      out = await scoreBlob(await captureAnswer(4000));
    }
    if (token.aborted) return;
    if (out.textScores) d.pushEvidence(out.textScores, 0.9, "voice:text", out.transcript.slice(0, 40));
    if (out.voiceScores) d.pushEvidence(out.voiceScores, 0.5, "voice:tone");
    if (out.noun) { setSignText(`${out.noun} 앞`); d.markEvent("sign", out.noun); }
    d.markEvent("voice", { transcript: out.transcript, noun: out.noun });
    setVoiceStatus(out.textScores ? "done" : "silent");
  }

  // 캐릭터 장면 — 대사는 CSV 순서 그대로 튼다. 줄마다 붙은 비트(lib/dialogueBeats.js)가 누구에게 말하는지·앞뒤 쉼·
  // 질문 뒤 기다림·"답함/안답함" 갈래를 정한다. 관객의 답은 고개(끄덕임·가로젓기·돌림)로만 받는다 — 마이크 없음.
  // 마지막 말(atBus)은 272 가 정차하고 문이 열린 뒤에 한다.
  async function runScene() {
    const d = directionRef.current;
    const film = filmRef.current;
    const token = abortRef.current;
    const dom = film.dominant || "R";
    const base = DIALOGUE_V2_LINES.filter((l) => l.genre === dom);
    let insertedCallback = false;

    const pool = usePool ? poolRef.current : null;
    const poolOk = !!pool?.ok && poolCoverage(pool, dom).base === base.length;
    // ?scene= 목표 길이: (목표 − 대사 오디오 추정 합 − 비트 쉼 합) / 줄 수 만큼을 각 줄 뒤 침묵에 더한다.
    const extraGap = sceneTarget > 0 ? Math.max(0, (sceneTarget - base.length * 3.5 - beatsTotalSec(base)) / base.length) : 0;
    const gapMs = (p) => ((Math.max(p?.npcSilence ?? 1.2, 0) + extraGap) * 1000) / speed;
    const sec = (s) => wait((s * 1000) / speed);
    // 영화 시간 기준 대기 — 버스 안무(filmTimeline)는 film.t 를 따르므로, fps 가 낮아 film.t 가 벽시계보다 느리게 갈 때도 어긋나지 않게
    const waitFilm = async (s) => { const t0 = film.t; while (!token.aborted && film.t - t0 < s) await wait(40); };
    const total = playedCount(base);
    let answered = false, played = 0, busStarted = false;

    // 272 도착 — 버스가 커브를 돌아 들어와 정면(앞문 x≈1.2)에 서기까지 7.2초, 그 다음 문
    const arriveBus = async () => {
      busStarted = true;
      film.lineGaze = null;
      film.busAt = film.t;
      d.setPhase("bus");
      setPhase("bus");
      playSfx("07", { volume: 0.7 });
      setCaption("272");
      await waitFilm(7.2); if (token.aborted) return;
      playSfx("08", { volume: 0.5 }); setCaption("");
    };

    for (let i = 0; i < base.length; i++) {
      if (token.aborted) return;
      const l = base[i];
      const b = beatOf(l);
      if (!playsLine(b, answered)) { d.markEvent("skip", { seq: l.seq, branch: b.branch }); continue; } // 갈래 중 하나만
      if (b.atBus) { await arriveBus(); if (token.aborted) return; }
      if (b.before) await sec(b.before);
      if (token.aborted) return;
      const p = paramsRef.current || {};
      const { secondary, secondaryWeight } = rank(d.st.current);

      // 보조 장르 콜백 — 비중이 임계값을 넘는 순간 한 번, 그 장르의 첫 줄을 끼워 넣는다 (마지막 말 앞에는 넣지 않는다)
      if (!insertedCallback && i >= 2 && !b.atBus && secondary !== dom && secondaryWeight >= TRIGGERS.secondaryCallback.above) {
        const cb = DIALOGUE_V2_LINES.find((x) => x.genre === secondary && x.seq === "01");
        if (cb) {
          insertedCallback = true;
          d.markEvent("callback", { genre: secondary, weight: secondaryWeight });
          film.lineGaze = 0.5;
          setLine({ ...cb, flavor: true, index: played, total });
          await playFile(cb.file, Math.min(1, (p.npcVolume ?? 1) * 0.9));
          await wait(gapMs(p));
        }
      }

      // 이 줄 — 풀 모드면 재생 직전 상태로 원문/보조 장르 변주를 고른다 (근접 매칭)
      let text = l.text, file = l.file, tinted = null;
      if (poolOk) {
        const pick = pickPoolLine(pool, dom, l.seq, d.st.current);
        if (pick) {
          text = pick.text; file = pick.file.replace(`${AUDIO_BASE}/`, ""); tinted = pick.secondary;
          d.markEvent("line", { seq: l.seq, secondary: pick.secondary, weight: Math.round(pick.weight * 100) / 100 });
        }
      }
      film.lineGaze = gazeFor(b);
      setLine({ ...l, text, tinted, to: b.to, index: played, total });
      played++;
      await playFile(file, Math.min(1, (p.npcVolume ?? 1) * (b.vol ?? 1)));
      if (token.aborted) return;

      if (b.to === "ask") {
        // 관객을 보며 기다린다 — FilmDirector 가 이 동안 머리 자세 폭을 잰다
        film.watch = null; film.listen = true;
        await sec(b.wait ?? 2.5);
        const r = answerWatchResult(film.watch);
        film.listen = false; film.watch = null;
        answered = forceAnswer || r.answered;
        d.markEvent("ask", { seq: l.seq, answered, how: forceAnswer ? "forced" : r.how });
      }
      if (b.after) await sec(b.after);
      if (!b.atBus) await wait(gapMs(paramsRef.current));
    }
    if (token.aborted) return;
    if (!busStarted) await arriveBus();
    if (token.aborted) return;
    setLine(null);
    film.lineGaze = null;
    // 마지막 말이 끝난 뒤 → 버스 출발(기본 busAt+16, 말이 더 길었으면 1초 뒤) → 암전(출발 +3~+7). 인물 퇴장은 busAt+8 부터 (filmTimeline)
    film.leaveAt = Math.max(film.t + 1.0, film.busAt + 16);
    await waitFilm(Math.max(2, film.leaveAt + 7.2 - film.t));
    if (token.aborted) return;
    d.setPhase("end");
    setPhase("end");
    film.running = false;
    stopBgm();
    audioRef.current.get("sfx_01.mp3")?.pause();
  }

  async function enterVr() {
    setXrError("");
    try {
      await xrStore.enterVR();
    } catch { setXrError("VR 진입에 실패했습니다 — 헤드셋 연결과 브라우저의 WebXR 지원을 확인해 주세요."); }
  }

  function reset() {
    abortRef.current.aborted = true;
    filmRef.current.running = false;
    stopBgm();
    for (const a of audioRef.current.values()) { a.pause(); }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
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
        <Canvas shadows="soft" gl={{ antialias: true }}>
          <PerspectiveCamera makeDefault position={CANVAS_CAMERA.position} fov={CANVAS_CAMERA.fov} />
          <XR store={xrStore}>
            <ReactiveStage directionRef={directionRef} actorsRef={actorsRef} dominant={dominant} paramsOut={paramsRef} cueRef={filmRef} useRig={useRig} rigTest={q.rigtest === "1"} signText={signText} reflect={fx && !xrActive} benchYaw={Number(q.benchyaw) || 0} />
            <XRProbe onChange={setXrActive} />
            <Effects enabled={fx} />
            <FilmDirector directionRef={directionRef} sensorRef={sensorRef} actorsRef={actorsRef} filmRef={filmRef} onCue={onCue} speed={speed} debugBus={q.bus === "1"} debugTruck={q.truck === "1"} />
            {q.gaze !== "0" && <DesktopGaze controlsRef={controlsRef} actorsRef={actorsRef} filmRef={filmRef} />}
          </XR>
          {/* 드래그 = 제자리에서 고개 돌리기. 타깃을 카메라 바로 앞 1cm 에 두면 궤도 회전이 머리 회전처럼 된다
              (타깃이 멀면 카메라가 반대편으로 돌아가 도로 한가운데서 정류장을 보게 된다). */}
          <OrbitControls ref={controlsRef} target={[0, 1.15, 0.34]} enableZoom={false} enablePan={false} enableDamping dampingFactor={0.08} rotateSpeed={-0.35} />
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
            {useVoice && <span>음성 <b>{voiceStatus}</b></span>}
            {signText && <span>표지판 <b>{signText}</b></span>}
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

      {(phase === "scene" || phase === "bus") && line && (
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
