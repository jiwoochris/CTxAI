"use client";

// v2 — 연속 블렌딩 버전 (2026-08-22).
// /story(v1, 이산 선택)와 나란히 존재하는 별도 실험 버전이다 — 기존 v1을
// 아는 사람이 갑자기 다른 동작을 보고 헷갈리지 않도록 주소를 분리했다.
// 방향 전환 근거: Bus/규격/구현_리스크와_지원_필요사항.md §3,
// Bus/규격/기술_발전_방향.md, Bus/규격/방향전환_업무재분장.md
//
// 정류장_스크립트_v1.1.md §2 "관객에게 특별한 요구하지 않는다", v2.md §1-6
// "AI는 지금까지의 반응을 종합하여 장르를 판정한다"를 그대로 구현한다.
//   1) GATE    — 카메라·마이크 권한만 받는다 (장르 선택 아님)
//   2) OBSERVE — 웹캠 행동 관찰(behaviorSense) + Q1 음성 질문·답변 녹음
//               (확신도 낮으면 재질문 1회 — vo.reprompt/filler/inhale)
//   3) JUDGE   — 행동·텍스트·음성 세 채널을 가중합한다
//                (Bus/규격/판정_기준.md — 행동 50% · 텍스트 30% · 음성 20%)
//   4) REVEAL  — 연속 배합 벡터를 그대로 재생에 반영한다. 주도 장르 그림·
//                대사를 기본으로 하고, 보조 장르가 있으면 조명 틴트
//                오버레이 + 콜백 대사 한 줄을 얹는다. BGM은 실제 두 트랙을
//                배합 비율대로 겹쳐 튼다.
//
// 판정 메커니즘은 이 화면에 노출하지 않는다 — 증명용 실시간 대시보드는 /judge-v2.

import { useEffect, useRef, useState } from "react";
import { DIALOGUE_V2_LINES, DIALOGUE_V2_GENRE_LABEL, DIALOGUE_V2_SLOT_ID } from "@/lib/dialogueV2Lines";
import { observe, judgeFromBehavior, fuseChannels, confidenceOf } from "@/lib/behaviorSense";
import { scoresFromMoodApi } from "@/lib/textKeywords";
import { analyzeProsody } from "@/lib/voiceProsody";
import { startBgmBlend, stopBgmBlend } from "@/lib/bgmBlend";
import s from "../story/story.module.css";

const GENRE_META = {
  R: { image: "/story/romance.jpg", accent: "#f2a7c0" },
  H: { image: "/story/horror.jpg", accent: "#8fae95" },
  C: { image: "/story/comedy.jpg", accent: "#e0a86a" },
};
const DEFAULT_IMAGE = "/story/default.jpg";
const DEFAULT_ACCENT = "#cfd8e3";
const OBSERVE_MS = 11000;
const LOW_CONFIDENCE_TH = 0.35; // 이 밑이면 재질문 (§4-4, 엔트로피 기반)

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

export default function StoryV2Page() {
  const [phase, setPhase] = useState("gate"); // gate | observe | judge | reveal
  const [fused, setFused] = useState(null); // { scores, dominant, secondary, confidence, reason }

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

  // Q1 질문 → 답변 녹음 → 확신도 낮으면 재질문 1회 (원안의 "신뢰도 기반 대화 관리")
  async function runVoiceFlow(audioTrack) {
    await playClip(q1Ref.current);
    let out = await scoreVoiceBlob(await recordFor(audioTrack, 5000));
    const conf = out.textScores ? confidenceOf(out.textScores) : 0;

    if (!out.textScores || conf < LOW_CONFIDENCE_TH) {
      await playClip(filler1Ref.current);
      await playClip(inhaleRef.current, 1500);
      await playClip(repromptRef.current);
      const retryOut = await scoreVoiceBlob(await recordFor(audioTrack, 4000));
      if (retryOut.textScores) out = retryOut; // 답을 더 들었으면 교체, 아니면 원래 값으로 진행
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
  const bgImage = dominant ? GENRE_META[dominant].image : DEFAULT_IMAGE;
  const secondaryAccent = secondary ? GENRE_META[secondary].accent : null;
  const lineAccent = line?.flavor && secondaryAccent ? secondaryAccent : accent;

  return (
    <div className={s.stage} style={{ "--accent": accent }}>
      <div className={s.bgLayer}>
        <img key={bgImage} src={bgImage} alt="" className={s.bgImg} />
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
        <span className={s.dim}>v2 · 연속 블렌딩 (실험적) · <a href="/story" style={{ color: "inherit" }}>v1 보기</a></span>
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
            <p className={s.introEyebrow}>정류장 · 프로토타입 데모 (v2)</p>
            <h1 className={s.introTitle}>정류장 벤치에 앉아 주세요</h1>
            <p className={s.introSub}>
              카메라와 마이크로 잠시 당신을 관찰합니다. 장르는 고르는 것이 아니라
              정해지는 것입니다 — 아무 말도, 아무 것도 하지 않아도 괜찮습니다.
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
