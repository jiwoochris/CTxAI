"use client";

// 편집·사운드 증명용 애니메틱 — 그림은 회색 카드, 목소리는 기존 시스템 TTS.
// RomanceSlice(5분 인터랙티브 상태머신)와 달리 이건 85초 선형 재생이고
// 관객 입력이 없다. "편집 리듬 + 공간음향만으로 감정이 생기는가"만 본다.
//
// 시간 점프(8·12·16번 샷)는 디졸브 없이 블랙 프레임 하드컷으로 처리한다.
// 그림 없이도 "시간이 지났다"는 걸 편집만으로 전달하는지가 이 프로토타입의
// 핵심 가설이다.

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./AnimaticStage.module.css";
import { SHOTS, TOTAL_SEC, shotAt, shotStartTimes } from "@/lib/shotList";
import { createRomanceAudio } from "@/lib/romanceAudio";
import { createVoice, voiceSupport } from "@/lib/voice";

function mmss(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = (s % 60).toFixed(1);
  return `${String(m).padStart(2, "0")}:${r.padStart(4, "0")}`;
}

const BADGE_CLASS = {
  WS: "badgeWS",
  MS: "badgeMS",
  CU: "badgeCU",
  OTS: "badgeOTS",
  INSERT: "badgeINSERT",
};

export default function AnimaticStage({ onClose }) {
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [shotIdx, setShotIdx] = useState(-1);
  const [subtitle, setSubtitle] = useState(null);
  const [useRealVoice, setUseRealVoice] = useState(true);

  const audioRef = useRef(null);
  const voiceRef = useRef(null);
  const elapsedRef = useRef(0);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const firedRef = useRef(-1);
  const startsRef = useRef(shotStartTimes());
  const subKeyRef = useRef(0);

  const support = voiceSupport();

  const dispose = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    audioRef.current?.dispose();
    audioRef.current = null;
    voiceRef.current?.dispose();
    voiceRef.current = null;
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      dispose();
    };
  }, [dispose]);

  const fireShot = useCallback(
    (idx) => {
      const shot = SHOTS[idx];
      if (!shot) return;
      const audio = audioRef.current;
      const voice = voiceRef.current;

      if (shot.cue && audio) {
        if (shot.cue === "busDoor") audio.busDoor();
        else audio.cues[shot.cue]?.();
      }

      if (shot.line) {
        subKeyRef.current += 1;
        setSubtitle({ text: shot.line.text, key: subKeyRef.current });
        if (useRealVoice && voice) {
          voice.speak(shot.line.text, shot.line.emotion);
        } else {
          audio?.speak(shot.line.text, { warm: 0.5 });
        }
      } else {
        setSubtitle(null);
      }
    },
    [useRealVoice]
  );

  const tick = useCallback(
    (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      elapsedRef.current += dt;
      const t = elapsedRef.current;
      setElapsed(t);

      const { index } = shotAt(t);
      if (index !== firedRef.current) {
        firedRef.current = index;
        setShotIdx(index);
        fireShot(index);
      }

      if (t >= TOTAL_SEC) {
        setEnded(true);
        audioRef.current?.stopAmbience();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [fireShot]
  );

  function start() {
    audioRef.current = createRomanceAudio();
    if (support.stt || support.tts) voiceRef.current = createVoice();
    elapsedRef.current = 0;
    lastTsRef.current = 0;
    firedRef.current = -1;
    setStarted(true);
    setEnded(false);
    rafRef.current = requestAnimationFrame(tick);
  }

  function replay() {
    dispose();
    audioRef.current = createRomanceAudio();
    if (support.stt || support.tts) voiceRef.current = createVoice();
    elapsedRef.current = 0;
    lastTsRef.current = 0;
    firedRef.current = -1;
    setEnded(false);
    setSubtitle(null);
    rafRef.current = requestAnimationFrame(tick);
  }

  const shot = shotIdx >= 0 ? SHOTS[shotIdx] : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.topBar}>
        <span style={{ color: "#666", fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace" }}>
          애니메틱 · 편집+사운드 증명용 · 85초
        </span>
        <div className={styles.spacer} />
        <button
          className={`${styles.toggle} ${useRealVoice ? styles.toggleOn : ""}`}
          onClick={() => setUseRealVoice((v) => !v)}
          title="유나(시스템 TTS) vs 합성 보이스"
          disabled={started}
        >
          {useRealVoice ? "유나 TTS" : "합성 보이스"}
        </button>
        <button className={styles.closeBtn} onClick={onClose}>
          닫기 ✕
        </button>
      </div>

      <div className={styles.progress}>
        <div
          className={styles.progressFill}
          style={{ width: `${Math.min(100, (elapsed / TOTAL_SEC) * 100)}%` }}
        />
        {startsRef.current.map((t, i) => (
          <div key={i} className={styles.progressTick} style={{ left: `${(t / TOTAL_SEC) * 100}%` }} />
        ))}
      </div>

      <div className={styles.stage}>
        {shot && (
          <div
            key={shot.id}
            className={`${styles.card} ${shot.type === "BLACK" ? styles.black : ""} ${
              shot.type === "WHITEOUT" ? styles.whiteout : ""
            }`}
          >
            {shot.type !== "BLACK" && shot.type !== "WHITEOUT" && (
              <>
                <span className={styles.shotNo}>SHOT {shot.id.toString().padStart(2, "0")}</span>
                <span className={styles.timecode}>{mmss(elapsed)}</span>
                <div className={`${styles.badge} ${styles[BADGE_CLASS[shot.type]] || ""}`}>{shot.type}</div>
                <div className={styles.label}>{shot.label}</div>
              </>
            )}
          </div>
        )}

        <div className={styles.subs}>
          {subtitle?.text && (
            <div key={subtitle.key} className={styles.subLine}>
              {subtitle.text}
            </div>
          )}
        </div>

        {!started && (
          <div className={styles.overlay}>
            <h2>애니메틱 · 85초 편집 프루프</h2>
            <p>
              그림은 회색 카드, 목소리는 유나 TTS 그대로 둡니다. <b>편집 리듬과 공간음향만으로</b> 감정이
              생기는지 확인하는 비인터랙티브 컷입니다.
              <br />
              <br />
              🎧 헤드폰 착용 권장. 재생하면 끝까지 자동으로 흐릅니다.
            </p>
            <button className={styles.bigBtn} onClick={start}>
              재생
            </button>
          </div>
        )}

        {ended && (
          <div className={styles.overlay}>
            <h2>끝</h2>
            <p>20개 컷, 85초. 편집과 사운드만으로 어떤 느낌이었는지가 이 프로토타입이 묻는 질문입니다.</p>
            <button className={styles.bigBtn} onClick={replay}>
              다시 보기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
