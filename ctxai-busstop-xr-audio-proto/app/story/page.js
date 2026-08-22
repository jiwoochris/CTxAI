"use client";

// v1 — 이산 선택 버전 (원래 버전). 연속 블렌딩으로 바꾼 실험 버전은 /story-v2.
// 방향 전환 근거: Bus/규격/구현_리스크와_지원_필요사항.md §3.
//
// 발표용 프로토타입 — 관객이 장르를 고르지 않는다.
//
// 정류장_스크립트_v1.1.md §2 "관객에게 특별한 요구하지 않는다", v2.md §1-6
// "AI는 지금까지의 반응을 종합하여 장르를 판정한다"를 그대로 구현한다.
//   1) GATE    — 카메라·마이크 권한만 받는다 (장르 선택 아님)
//   2) OBSERVE — 웹캠 행동 관찰(behaviorSense) + Q1 음성 질문·답변 녹음
//   3) JUDGE   — 행동·텍스트·음성 세 채널을 가중합해 장르를 정한다
//                (Bus/규격/판정_기준.md — 행동 50% · 텍스트 30% · 음성 20%)
//   4) REVEAL  — 정해진 장르 하나의 실제 완성 자산(그림·BGM·대사 46줄)을 재생
//
// 판정 메커니즘은 이 화면에 노출하지 않는다 — 증명용 실시간 대시보드는 /judge.

import { useEffect, useRef, useState } from "react";
import { DIALOGUE_V2_LINES, DIALOGUE_V2_GENRE_LABEL, DIALOGUE_V2_SLOT_ID } from "@/lib/dialogueV2Lines";
import { observe, judgeFromBehavior, fuseChannels } from "@/lib/behaviorSense";
import { scoresFromMoodApi } from "@/lib/textKeywords";
import { analyzeProsody } from "@/lib/voiceProsody";
import s from "./story.module.css";

const GENRE_META = {
  R: { image: "/story/romance.jpg", accent: "#f2a7c0" },
  H: { image: "/story/horror.jpg", accent: "#8fae95" },
  C: { image: "/story/comedy.jpg", accent: "#e0a86a" },
};
const DEFAULT_IMAGE = "/story/default.jpg";
const DEFAULT_ACCENT = "#cfd8e3";
const OBSERVE_MS = 11000;

export default function StoryPage() {
  const [phase, setPhase] = useState("gate"); // gate | observe | judge | reveal
  const [genre, setGenre] = useState(null);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);

  const videoRef = useRef(null);
  const bgmRef = useRef(null);
  const lineRef = useRef(null);
  const q1Ref = useRef(null);
  const announceRef = useRef(null);
  const streamRef = useRef(null);
  const fadeTimer = useRef(null);

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

  function recordVoiceBlob(audioTrack) {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (q1Ref.current) { q1Ref.current.currentTime = 0; q1Ref.current.play().catch(() => {}); }
      }, 1500);
      setTimeout(() => {
        try {
          const rec = new MediaRecorder(new MediaStream([audioTrack]));
          const chunks = [];
          rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          rec.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
          rec.start();
          setTimeout(() => rec.stop(), 5000);
        } catch {
          resolve(null);
        }
      }, 4500);
    });
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

    const textScores = scoresFromMoodApi(moodResult?.scores);

    return { textScores, voiceScores: prosodyResult?.scores || null };
  }

  async function runObservation() {
    const audioTrack = streamRef.current?.getAudioTracks?.()[0];

    const voicePromise = audioTrack
      ? recordVoiceBlob(audioTrack).then(scoreVoiceBlob)
      : Promise.resolve({ textScores: null, voiceScores: null });

    const behaviorPromise = videoRef.current
      ? observe(videoRef.current, OBSERVE_MS, null)
      : Promise.resolve({ ok: false });

    const [behaviorObs, voiceOut] = await Promise.all([behaviorPromise, voicePromise]);

    const behaviorResult = judgeFromBehavior(behaviorObs.ok ? behaviorObs.metrics : null);
    const final = fuseChannels({
      behaviorScores: behaviorResult.scores,
      textScores: voiceOut.textScores,
      voiceScores: voiceOut.voiceScores,
    });

    setPhase("judge");
    if (announceRef.current) { announceRef.current.currentTime = 0; announceRef.current.play().catch(() => {}); }
    setTimeout(() => reveal(final.dominant), 2600);
  }

  function reveal(g) {
    setGenre(g);
    setIndex(0);
    setFinished(false);
    setPhase("reveal");
    if (bgmRef.current) {
      bgmRef.current.src = `/api/assets/file/bgm.${g}`;
      bgmRef.current.loop = true;
      bgmRef.current.play().then(() => fadeIn(bgmRef.current)).catch(() => {});
    }
  }

  function fadeIn(audio, target = 0.32, ms = 1200) {
    clearInterval(fadeTimer.current);
    audio.volume = 0;
    const steps = 24;
    let i = 0;
    fadeTimer.current = setInterval(() => {
      i++;
      audio.volume = Math.min(target, (target * i) / steps);
      if (i >= steps) clearInterval(fadeTimer.current);
    }, ms / steps);
  }

  function reset() {
    clearInterval(fadeTimer.current);
    bgmRef.current?.pause();
    lineRef.current?.pause();
    setPhase("gate");
    setGenre(null);
    setIndex(0);
    setPlaying(false);
    setFinished(false);
  }

  const lines = genre ? DIALOGUE_V2_LINES.filter((l) => l.genre === genre) : [];
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

  const accent = genre ? GENRE_META[genre].accent : DEFAULT_ACCENT;
  const bgImage = genre ? GENRE_META[genre].image : DEFAULT_IMAGE;

  return (
    <div className={s.stage} style={{ "--accent": accent }}>
      <div className={s.bgLayer}>
        <img key={bgImage} src={bgImage} alt="" className={s.bgImg} />
        <div className={s.vignette} />
      </div>

      <video ref={videoRef} muted playsInline className={s.hiddenVideo} />
      <audio ref={bgmRef} />
      <audio ref={lineRef} onEnded={goNext} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
      <audio ref={q1Ref} src="/api/assets/file/vo.q1" />
      <audio ref={announceRef} src="/api/assets/file/vo.announce" />

      <div className={s.topBar}>
        <a className={s.homeLink} href="/">← 대시보드</a>
        <span className={s.dim}>v1 · 이산 선택 · <a href="/story-v2" style={{ color: "inherit" }}>v2(연속 블렌딩) 보기</a></span>
        {phase === "reveal" && (
          <div className={s.genreChip}>
            <span className={s.genreDot} />
            {DIALOGUE_V2_GENRE_LABEL[genre]}
            <button className={s.resetBtn} onClick={reset}>⟲ 처음으로</button>
          </div>
        )}
      </div>

      {phase === "gate" && (
        <div className={s.intro}>
          <div className={s.introCard}>
            <p className={s.introEyebrow}>정류장 · 프로토타입 데모</p>
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
        <div className={s.subtitleBar}>
          <div className={s.subtitleInner}>
            <div className={s.progressTrack}>
              <div className={s.progressFill} style={{ width: `${((index + 1) / lines.length) * 100}%` }} />
            </div>
            <div className={s.seqRow}>
              <span className={s.seqBadge}>{genre}-{line.seq}</span>
              <span>{index + 1} / {lines.length}줄</span>
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
