"use client";

// story-vr — 웹 VR 버전 (2026-08-25).
// /story(v1, 이산 선택) · /story-v2(v2, 연속 블렌딩·웹캠 전용)와 나란히 존재하는
// 별도 실험 버전이다. 관찰·판정·대사·BGM 로직은 story-v2와 완전히 같고,
// 렌더링만 3D로 바꿨다 — /whitebox에서 만든 파노라마+조명+GLB 파이프라인
// (components/AudienceStage.jsx)을 그대로 쓴다.
//
// GATE에서 "VR로 시작" / "웹캠으로 시작" 둘 중 하나를 고른다 — 헤드셋이 있으면
// 머리 포즈(v2.md §5가 원래 정의한 정식 경로)로, 없으면 기존 웹캠 얼굴 인식으로
// 관찰한다. 둘 다 같은 fuseChannels()를 거치므로 판정 로직은 하나다.
//
// WebXR 몰입 세션 안에서는 일반 HTML(자막바)이 안 보인다 — 캔버스만 렌더링되는
// 브라우저의 근본 제약이라 우회할 수 없다. 그래서 대사는 오디오로 재생하고,
// 자막바는 헤드셋 없이 보는 사람(플랫 뷰)을 위한 보너스로만 유지한다.

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { XR, createXRStore } from "@react-three/xr";
import { DIALOGUE_V2_LINES, DIALOGUE_V2_GENRE_LABEL, DIALOGUE_V2_SLOT_ID } from "@/lib/dialogueV2Lines";
import { observe, judgeFromBehavior, judgeFromHeadPose, fuseChannels, confidenceOf } from "@/lib/behaviorSense";
import { scoresFromMoodApi } from "@/lib/textKeywords";
import { analyzeProsody } from "@/lib/voiceProsody";
import { startBgmBlend, stopBgmBlend } from "@/lib/bgmBlend";
import { blendPresets } from "@/lib/lightingBlend";
import AudienceStage from "@/components/AudienceStage";
import HeadPoseTelemetry from "@/components/HeadPoseTelemetry";
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
const POSE_THRESHOLD_DEG = 12;

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

async function fetchPreset(name) {
  try {
    const res = await fetch(`/api/preset?name=${name}`);
    const data = await res.json();
    return data.ok ? data.preset : null;
  } catch {
    return null;
  }
}

export default function StoryVrPage() {
  const [phase, setPhase] = useState("gate"); // gate | observe | judge | reveal
  const [mode, setMode] = useState(null); // vr | webcam
  const [fused, setFused] = useState(null);
  const [xrError, setXrError] = useState("");

  const [statuses, setStatuses] = useState({});
  const [neutralLighting, setNeutralLighting] = useState(null);
  const [revealLighting, setRevealLighting] = useState(null);

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
  const poseAccumRef = useRef(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  // 3D 씬에 필요한 자산 상태(파노라마·구조물 등)와 기본(중립) 조명을 미리 받아 둔다 —
  // /whitebox의 같은 패턴. 에셋이 아직 없어도 AudienceStage가 와이어프레임으로 대신한다.
  useEffect(() => {
    fetch("/api/manifest")
      .then((r) => r.json())
      .then((m) => {
        const map = {};
        for (const item of m.models?.structure ?? []) map[`structure.${item.id}`] = item;
        if (m.models?.sign?.model) map["sign.model"] = m.models.sign.model;
        if (m.models?.background?.panorama) map["bg.panorama"] = m.models.background.panorama;
        setStatuses(map);
      })
      .catch(() => setStatuses({}));
    fetchPreset("lp_neutral").then(setNeutralLighting);
  }, []);

  async function startWebcam() {
    setMode("webcam");
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
    runObservation("webcam");
  }

  async function startVr() {
    setMode("vr");
    setXrError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (e) {
      // 마이크 거부 — 음성 채널 없이 진행.
    }
    setPhase("observe");
    try {
      await xrStore.enterVR();
    } catch (e) {
      setXrError("VR 진입에 실패했습니다 — 헤드셋 연결과 브라우저의 WebXR 지원을 확인해 주세요. 화면으로 계속 진행합니다.");
    }
    runObservation("vr");
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

  // Q1 질문 → 답변 녹음 → 확신도 낮으면 재질문 1회 — story-v2와 동일, 모드 무관.
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

  async function runObservation(activeMode) {
    const audioTrack = streamRef.current?.getAudioTracks?.()[0];
    const voicePromise = audioTrack
      ? runVoiceFlow(audioTrack)
      : Promise.resolve({ textScores: null, voiceScores: null });

    // 행동 채널 — VR이면 머리 포즈, 아니면 기존 웹캠 얼굴 인식. 입력만 다르고
    // 둘 다 같은 fuseChannels()로 들어간다.
    const behaviorPromise = activeMode === "vr"
      ? new Promise((resolve) => {
          poseAccumRef.current = null;
          setTimeout(() => resolve(judgeFromHeadPose(poseAccumRef.current, OBSERVE_MS)), OBSERVE_MS);
        })
      : videoRef.current
        ? observe(videoRef.current, OBSERVE_MS, null).then((obs) => judgeFromBehavior(obs.ok ? obs.metrics : null))
        : Promise.resolve(judgeFromBehavior(null));

    const [behaviorResult, voiceOut] = await Promise.all([behaviorPromise, voicePromise]);
    const result = fuseChannels({
      behaviorScores: behaviorResult.scores,
      textScores: voiceOut.textScores,
      voiceScores: voiceOut.voiceScores,
    });

    setPhase("judge");
    if (announceRef.current) { announceRef.current.currentTime = 0; announceRef.current.play().catch(() => {}); }
    setTimeout(() => reveal(result), 2600);
  }

  async function reveal(result) {
    setFused(result);
    setIndex(0);
    setFinished(false);

    const dom = result.dominant;
    const sec = result.secondary;
    const [presetA, presetB] = await Promise.all([
      fetchPreset(`lp_${dom}`),
      sec ? fetchPreset(`lp_${sec}`) : Promise.resolve(null),
    ]);
    setRevealLighting(
      sec && presetB ? blendPresets(presetA, presetB, result.scores[dom], result.scores[sec]) : (presetA ?? neutralLighting)
    );

    setPhase("reveal");
    startBgmBlend({ H: bgmRefs.H.current, R: bgmRefs.R.current, C: bgmRefs.C.current }, result.scores);
  }

  function reset() {
    stopBgmBlend({ H: bgmRefs.H.current, R: bgmRefs.R.current, C: bgmRefs.C.current });
    lineRef.current?.pause();
    setPhase("gate");
    setMode(null);
    setFused(null);
    setRevealLighting(null);
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
  const currentLighting = phase === "reveal" ? revealLighting : neutralLighting;

  return (
    <div className={s.stage} style={{ "--accent": accent }}>
      <div className={s.bgLayer}>
        <Canvas camera={CANVAS_CAMERA} shadows>
          <XR store={xrStore}>
            <AudienceStage statuses={statuses} lighting={currentLighting} />
            {phase === "observe" && mode === "vr" && (
              <HeadPoseTelemetry
                thresholdDeg={POSE_THRESHOLD_DEG}
                resetSignal={0}
                onSample={(sample) => { poseAccumRef.current = sample; }}
              />
            )}
          </XR>
        </Canvas>
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
        <span className={s.dim}>VR · 연속 블렌딩 (실험적) · <a href="/story-v2" style={{ color: "inherit" }}>웹캠 버전 보기</a></span>
        {phase === "reveal" && (
          <div className={s.genreChip}>
            <span className={s.genreDot} />
            {DIALOGUE_V2_GENRE_LABEL[dominant]}
            {secondary && <span className={s.dim}> + {DIALOGUE_V2_GENRE_LABEL[secondary]} {Math.round(secondaryWeight * 100)}%</span>}
            <button className={s.resetBtn} onClick={reset}>⟲ 처음으로</button>
          </div>
        )}
      </div>

      {phase === "gate" && (
        <div className={s.intro}>
          <div className={s.introCard}>
            <p className={s.introEyebrow}>정류장 · 프로토타입 데모 (웹 VR)</p>
            <h1 className={s.introTitle}>정류장 벤치에 앉아 주세요</h1>
            <p className={s.introSub}>
              헤드셋이 있으면 VR로, 없으면 웹캠으로 — 어느 쪽이든 잠시 당신을 관찰합니다.
              장르는 고르는 것이 아니라 정해지는 것입니다.
            </p>
            <div className={s.choices}>
              <button className={s.choiceBtn} onClick={startVr}>
                <span>🥽 VR로 시작<small>헤드셋 착용 — 머리 움직임으로 관찰합니다</small></span>
                <span className={s.choiceArrow}>→</span>
              </button>
              <button className={s.choiceBtn} onClick={startWebcam}>
                <span>💻 웹캠으로 시작<small>헤드셋 없이 — 얼굴 표정으로 관찰합니다</small></span>
                <span className={s.choiceArrow}>→</span>
              </button>
            </div>
            {xrError && <p className={s.introSub}>{xrError}</p>}
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
