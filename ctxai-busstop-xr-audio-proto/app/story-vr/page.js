"use client";

// story-vr — 웹 VR 버전 (2026-08-25).
// /story(v1, 이산 선택) · /story-v2(v2, 연속 블렌딩·웹캠 전용)와 나란히 존재하는
// 별도 실험 버전이다. 관찰·판정·대사·BGM 로직은 story-v2와 완전히 같다 — 다른 건
// 배경이 평면 이미지 태그가 아니라 3D 캔버스 안의 화면이라는 것뿐이다.
//
// 핵심 요구사항: "헤드셋이 없어도 VR 화면은 보여야 한다." 그래서 관찰 방식으로
// VR/웹캠을 먼저 고르게 하지 않는다 — 시작하기 한 번이면 누구나 이 3D 화면을
// 보고, 그 안에서 기존과 같은 웹캠 관찰이 돈다. 실제 헤드셋이 있는 사람은 상단의
// "Enter VR" 버튼으로 아무 때나 몰입 모드로 들어갈 수 있다(/whitebox와 같은 패턴) —
// 이건 관찰 방식을 바꾸는 게 아니라 보는 방식만 바꾸는 보너스다.
//
// 배경은 평면 그림이 아니라 진짜 3D 지오메트리다 — components/BlockoutStage.jsx.
// GLB 3D 모델은 아직 하나도 없고(아트 진행 0/8) 유료 이미지→3D API(Meshy 등)는
// 결제 전이라, 그 사이 단계로 코드로 직접 만든 그레이박스(회색조 도형)를 쓴다.
// 평면 이미지 한 장과 달리 실제 입체·깊이가 있어서 헤드셋에서 고개를 돌리면
// 진짜로 다른 면이 보인다. 나중에 실제 3D 에셋이 생기면 AudienceStage.jsx(GLB
// 파이프라인)로 자리를 바꾸면 된다. 머리 포즈 기반 판정(lib/behaviorSense.js의
// judgeFromHeadPose)은 나중에 헤드셋 전용 관찰 경로를 붙일 때를 위해 만들어
// 두었지만, 지금 이 화면은 아직 쓰지 않는다.
//
// WebXR 몰입 세션 안에서는 일반 HTML(자막바)이 안 보인다 — 캔버스만 렌더링되는
// 브라우저의 근본 제약이라 우회할 수 없다. 그래서 대사는 오디오로 재생하고,
// 자막바는 헤드셋 없이 보는 사람을 위한 화면이기도 하다.

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { XR, createXRStore } from "@react-three/xr";
import { DIALOGUE_V2_LINES, DIALOGUE_V2_GENRE_LABEL, DIALOGUE_V2_SLOT_ID } from "@/lib/dialogueV2Lines";
import { observe, judgeFromBehavior, fuseChannels, confidenceOf } from "@/lib/behaviorSense";
import { scoresFromMoodApi } from "@/lib/textKeywords";
import { analyzeProsody } from "@/lib/voiceProsody";
import { startBgmBlend, stopBgmBlend } from "@/lib/bgmBlend";
import BlockoutStage from "@/components/BlockoutStage";
import s from "../story/story.module.css";

const xrStore = createXRStore();
// 관객 눈높이(앉은 자세 Y=1.15m, 명명규칙.md §3) 기준 — 벤치에 앉은 시점.
// 안정된 참조로 고정 — 매 렌더 새 객체를 주면 Canvas가 렌더러를 불필요하게 재구성한다.
const CANVAS_CAMERA = { position: [0, 1.15, 0.35], fov: 60 };

const GENRE_META = {
  R: { accent: "#f2a7c0" },
  H: { accent: "#8fae95" },
  C: { accent: "#e0a86a" },
};
const DEFAULT_ACCENT = "#cfd8e3";
const OBSERVE_MS = 11000;
const LOW_CONFIDENCE_TH = 0.35;

function buildLines(dominant, secondary) {
  const base = DIALOGUE_V2_LINES.filter((l) => l.genre === dominant);
  if (!secondary) return base;
  const flavor = DIALOGUE_V2_LINES.find((l) => l.genre === secondary && l.seq === "01");
  if (!flavor) return base;
  const insertAt = Math.min(2, base.length);
  return [...base.slice(0, insertAt), { ...flavor, flavor: true }, ...base.slice(insertAt)];
}

function playClip(el, fallbackMs = 3500) {
  return new Promise((resolve) => {
    if (!el) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    el.currentTime = 0;
    el.onended = finish;
    el.play().catch(finish);
    setTimeout(finish, fallbackMs);
  });
}

function recordFor(audioTrack, ms) {
  return new Promise((resolve) => {
    try {
      const rec = new MediaRecorder(new MediaStream([audioTrack]));
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
      rec.start();
      setTimeout(() => rec.stop(), ms);
    } catch {
      resolve(null);
    }
  });
}

export default function StoryVrPage() {
  const [phase, setPhase] = useState("gate"); // gate | observe | judge | reveal
  const [fused, setFused] = useState(null);
  const [xrError, setXrError] = useState("");

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);

  const videoRef = useRef(null);
  const bgmRefs = { H: useRef(null), R: useRef(null), C: useRef(null) };
  const lineRef = useRef(null);
  const q1Ref = useRef(null);
  const filler1Ref = useRef(null);
  const inhaleRef = useRef(null);
  const repromptRef = useRef(null);
  const announceRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e) {
      // 권한 거부 — 그래도 진행한다. 신호 없이 로맨스 디폴트로 떨어진다.
    }
    setPhase("observe");
    runObservation();
  }

  async function enterVr() {
    setXrError("");
    try {
      await xrStore.enterVR();
    } catch (e) {
      setXrError("VR 진입에 실패했습니다 — 헤드셋 연결과 브라우저의 WebXR 지원을 확인해 주세요.");
    }
  }

  async function scoreVoiceBlob(blob) {
    if (!blob) return { textScores: null, voiceScores: null };
    const [moodResult, prosodyResult] = await Promise.all([
      (async () => {
        try {
          const form = new FormData();
          form.append("audio", blob, "clip.webm");
          const res = await fetch("/api/mood", { method: "POST", body: form });
          const data = await res.json();
          return data?.ok ? data : null;
        } catch { return null; }
      })(),
      analyzeProsody(blob),
    ]);
    return { textScores: scoresFromMoodApi(moodResult?.scores), voiceScores: prosodyResult?.scores || null };
  }

  // Q1 질문 → 답변 녹음 → 확신도 낮으면 재질문 1회 — story-v2와 동일.
  async function runVoiceFlow(audioTrack) {
    await playClip(q1Ref.current);
    let out = await scoreVoiceBlob(await recordFor(audioTrack, 5000));
    const conf = out.textScores ? confidenceOf(out.textScores) : 0;

    if (!out.textScores || conf < LOW_CONFIDENCE_TH) {
      await playClip(filler1Ref.current);
      await playClip(inhaleRef.current, 1500);
      await playClip(repromptRef.current);
      const retryOut = await scoreVoiceBlob(await recordFor(audioTrack, 4000));
      if (retryOut.textScores) out = retryOut;
    }
    return out;
  }

  async function runObservation() {
    const audioTrack = streamRef.current?.getAudioTracks?.()[0];
    const voicePromise = audioTrack
      ? runVoiceFlow(audioTrack)
      : Promise.resolve({ textScores: null, voiceScores: null });

    const behaviorPromise = videoRef.current
      ? observe(videoRef.current, OBSERVE_MS, null)
      : Promise.resolve({ ok: false });

    const [behaviorObs, voiceOut] = await Promise.all([behaviorPromise, voicePromise]);
    const behaviorResult = judgeFromBehavior(behaviorObs.ok ? behaviorObs.metrics : null);
    const result = fuseChannels({
      behaviorScores: behaviorResult.scores,
      textScores: voiceOut.textScores,
      voiceScores: voiceOut.voiceScores,
    });

    setPhase("judge");
    if (announceRef.current) { announceRef.current.currentTime = 0; announceRef.current.play().catch(() => {}); }
    setTimeout(() => reveal(result), 2600);
  }

  function reveal(result) {
    setFused(result);
    setIndex(0);
    setFinished(false);
    setPhase("reveal");
    startBgmBlend({ H: bgmRefs.H.current, R: bgmRefs.R.current, C: bgmRefs.C.current }, result.scores);
  }

  function reset() {
    stopBgmBlend({ H: bgmRefs.H.current, R: bgmRefs.R.current, C: bgmRefs.C.current });
    lineRef.current?.pause();
    setPhase("gate");
    setFused(null);
    setIndex(0);
    setPlaying(false);
    setFinished(false);
  }

  const dominant = fused?.dominant || null;
  const secondary = fused?.secondary || null;
  const secondaryWeight = secondary ? fused.scores[secondary] : 0;
  const lines = dominant ? buildLines(dominant, secondary) : [];
  const line = lines[index];

  useEffect(() => {
    if (phase !== "reveal" || !line || !lineRef.current) return;
    const slotId = DIALOGUE_V2_SLOT_ID(line.genre, line.seq);
    lineRef.current.src = `/api/vo2/file/${slotId}`;
    lineRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [phase, line]);

  function goNext() { if (index < lines.length - 1) setIndex((i) => i + 1); else setFinished(true); }
  function goPrev() { if (index > 0) { setFinished(false); setIndex((i) => i - 1); } }
  function togglePlay() {
    const a = lineRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  }

  const accent = dominant ? GENRE_META[dominant].accent : DEFAULT_ACCENT;
  const secondaryAccent = secondary ? GENRE_META[secondary].accent : null;
  const lineAccent = line?.flavor && secondaryAccent ? secondaryAccent : accent;

  return (
    <div className={s.stage} style={{ "--accent": accent }}>
      <div className={s.bgLayer}>
        <Canvas>
          <PerspectiveCamera makeDefault position={CANVAS_CAMERA.position} fov={CANVAS_CAMERA.fov} />
          <XR store={xrStore}>
            <BlockoutStage genre={dominant} />
          </XR>
          {/* 헤드셋 없이 보는 사람도 실제로 둘러볼 수 있게 — 이제는 진짜 지오메트리가
              사방에 있어서(도로·담장·유리벽·카페) 드래그해도 가짜가 아니라 실제로
              다른 게 보인다. 헤드셋 세션 중엔 머리 트래킹이 대신하므로 줌/이동 없이
              회전만 허용한다. */}
          <OrbitControls
            target={[0, 1.15, -4]}
            enableZoom={false}
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            rotateSpeed={0.5}
          />
        </Canvas>
        <p className={s.dim} style={{ position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center", pointerEvents: "none", zIndex: 3 }}>
          ↔ 드래그해서 둘러보기
        </p>
        {secondaryAccent && (
          <div
            className={s.tintOverlay}
            style={{ background: secondaryAccent, opacity: Math.min(0.35, secondaryWeight * 0.5) }}
          />
        )}
        <div className={s.vignette} />
      </div>

      <video ref={videoRef} muted playsInline className={s.hiddenVideo} />
      <audio ref={bgmRefs.H} />
      <audio ref={bgmRefs.R} />
      <audio ref={bgmRefs.C} />
      <audio ref={lineRef} onEnded={goNext} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
      <audio ref={q1Ref} src="/api/assets/file/vo.q1" />
      <audio ref={filler1Ref} src="/api/assets/file/vo.filler1" />
      <audio ref={inhaleRef} src="/api/assets/file/sfx.inhale" />
      <audio ref={repromptRef} src="/api/assets/file/vo.reprompt" />
      <audio ref={announceRef} src="/api/assets/file/vo.announce" />

      <div className={s.topBar}>
        <a className={s.homeLink} href="/">← 대시보드</a>
        <span className={s.dim}>
          웹 VR · 연속 블렌딩 (실험적) · <a href="/story-v2" style={{ color: "inherit" }}>웹캠 버전 보기</a>
        </span>
        <div className={s.genreChip}>
          <button className={s.resetBtn} onClick={enterVr}>🥽 Enter VR</button>
          {phase === "reveal" && (
            <>
              <span className={s.genreDot} />
              {DIALOGUE_V2_GENRE_LABEL[dominant]}
              {secondary && <span className={s.dim}> + {DIALOGUE_V2_GENRE_LABEL[secondary]} {Math.round(secondaryWeight * 100)}%</span>}
              <button className={s.resetBtn} onClick={reset}>⟲ 처음으로</button>
            </>
          )}
        </div>
      </div>

      {xrError && phase === "gate" && <p className={s.introSub} style={{ position: "absolute", top: 70, width: "100%", textAlign: "center" }}>{xrError}</p>}

      {phase === "gate" && (
        <div className={s.intro}>
          <div className={s.introCard}>
            <p className={s.introEyebrow}>정류장 · 프로토타입 데모 (웹 VR)</p>
            <h1 className={s.introTitle}>정류장 벤치에 앉아 주세요</h1>
            <p className={s.introSub}>
              카메라와 마이크로 잠시 당신을 관찰합니다. 장르는 고르는 것이 아니라
              정해지는 것입니다 — 헤드셋이 있다면 위 "Enter VR"로 언제든 몰입해서 볼 수 있습니다.
            </p>
            <button className={s.choiceBtn} onClick={start} style={{ justifyContent: "center" }}>
              <span>시작하기</span>
            </button>
          </div>
        </div>
      )}

      {phase === "observe" && (
        <div className={s.observeWrap}>
          <span className={s.observeDot} />
          <p className={s.observeText}>...</p>
        </div>
      )}

      {phase === "judge" && (
        <div className={s.observeWrap}>
          <p className={s.judgeText}>272번 버스는 5분 후 도착 예정입니다</p>
        </div>
      )}

      {phase === "reveal" && line && (
        <div className={s.subtitleBar} style={{ "--accent": lineAccent }}>
          <div className={s.subtitleInner}>
            <div className={s.progressTrack}>
              <div className={s.progressFill} style={{ width: `${((index + 1) / lines.length) * 100}%` }} />
            </div>
            <div className={s.seqRow}>
              <span className={s.seqBadge}>{line.genre}-{line.seq}</span>
              <span>{index + 1} / {lines.length}줄</span>
              {line.flavor && <span className={s.dim}>· 배합 콜백</span>}
            </div>
            <p className={s.lineText}>
              {finished ? <span className={s.done}>— 여기까지, 오늘의 정류장이었습니다 —</span> : line.text}
            </p>
            <div className={s.controls}>
              <button className={s.ctrlBtn} onClick={goPrev} disabled={index === 0}>◀</button>
              <button className={s.ctrlBtnMain} onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
              <button className={s.ctrlBtn} onClick={goNext} disabled={finished}>▶</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
