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

// 같은 배경 원화 1장을 샷 타입별로 다르게 잘라 "다른 카메라 앵글"처럼 보이게 한다.
// 프리비즈에서 흔히 쓰는 방식 — 그림을 늘리는 대신 크롭·줌으로 컷을 만든다.
// plate.png 구도: 카페·꽃집·서점은 왼쪽, 벤치·유리·노선표가 있는 정류장은
// 오른쪽 — 그래서 인물·관객이 있는 컷(OTS/MS/CU)일수록 오른쪽으로 크롭한다.
const FRAME_BY_TYPE = {
  WS: { position: "center 45%", size: "cover" },
  OTS: { position: "74% 60%", size: "120%" },
  MS: { position: "82% 64%", size: "155%" },
  CU: { position: "90% 58%", size: "230%" },
  INSERT: { position: "20% 40%", size: "200%" },
};

const VOICE_MODES = [
  { id: "system", label: "유나 TTS" },
  { id: "eleven", label: "ElevenLabs" },
  { id: "synth", label: "합성 보이스" },
];

export default function AnimaticStage({ onClose }) {
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [shotIdx, setShotIdx] = useState(-1);
  const [subtitle, setSubtitle] = useState(null);
  // ElevenLabs 는 무료 플랜에서 API 합성이 막혀 있어(계정 등급 문제, 코드 문제 아님)
  // 기본값을 유나로 둔다. 나중에 유료 전환하면 상단 토글로 바로 켤 수 있다.
  const [voiceMode, setVoiceMode] = useState("system");
  const [voiceNote, setVoiceNote] = useState(null);

  const audioRef = useRef(null);
  const voiceRef = useRef(null);
  const elapsedRef = useRef(0);
  const rafRef = useRef(null); // setInterval id (이름은 유지, 이전 rAF 흔적)
  const firedRef = useRef(-1);
  const startsRef = useRef(shotStartTimes());
  const subKeyRef = useRef(0);
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;

  const support = voiceSupport();

  /** ElevenLabs 로 발화 — 실패하면 유나 TTS 로 조용히 폴백한다 (타임라인은 안 멈춘다). */
  const speakEleven = useCallback(async (text, emotion) => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, emotion }),
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        return { ok: false, reason: data.reason || data.error || "unknown" };
      }
      const buf = await res.arrayBuffer();
      await audioRef.current?.speakBuffer(buf);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "network" };
    }
  }, []);

  const dispose = useCallback(() => {
    if (rafRef.current) window.clearInterval(rafRef.current);
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
        const mode = voiceModeRef.current;

        if (mode === "eleven") {
          setVoiceNote(null);
          speakEleven(shot.line.text, shot.line.emotion).then((r) => {
            if (!r.ok) {
              const short = r.reason === "configured:false" || /API_KEY/.test(r.reason) ? "키 없음" : r.reason;
              setVoiceNote(`ElevenLabs 실패(${short}) → 유나로 대체`);
              voice?.speak(shot.line.text, shot.line.emotion);
            }
          });
        } else if (mode === "system" && voice) {
          voice.speak(shot.line.text, shot.line.emotion);
        } else {
          audio?.speak(shot.line.text, { warm: 0.5 });
        }
      } else {
        setSubtitle(null);
      }
    },
    [speakEleven]
  );

  // setInterval 기반 — requestAnimationFrame 은 자동화된/백그라운드 브라우저
  // 컨텍스트에서 스로틀되어 멈출 수 있다 (실제로 이 환경에서 재현됨).
  // RomanceSlice 가 이미 setInterval 로 검증했으므로 같은 패턴을 쓴다.
  const tick = useCallback(() => {
    elapsedRef.current += 0.1;
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
      if (rafRef.current) window.clearInterval(rafRef.current);
    }
  }, [fireShot]);

  function start() {
    audioRef.current = createRomanceAudio();
    if (support.stt || support.tts) voiceRef.current = createVoice();
    elapsedRef.current = 0;
    firedRef.current = -1;
    setStarted(true);
    setEnded(false);
    if (rafRef.current) window.clearInterval(rafRef.current);
    rafRef.current = window.setInterval(tick, 100);
  }

  function replay() {
    dispose();
    audioRef.current = createRomanceAudio();
    if (support.stt || support.tts) voiceRef.current = createVoice();
    elapsedRef.current = 0;
    firedRef.current = -1;
    setEnded(false);
    setSubtitle(null);
    rafRef.current = window.setInterval(tick, 100);
  }

  const shot = shotIdx >= 0 ? SHOTS[shotIdx] : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.topBar}>
        <span style={{ color: "#666", fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace" }}>
          애니메틱 · 편집+사운드 증명용 · 85초
        </span>
        {voiceNote && <span className={styles.voiceNote}>{voiceNote}</span>}
        <div className={styles.spacer} />
        {VOICE_MODES.map((m) => (
          <button
            key={m.id}
            className={`${styles.toggle} ${voiceMode === m.id ? styles.toggleOn : ""}`}
            onClick={() => setVoiceMode(m.id)}
            disabled={started}
            title={
              m.id === "eleven"
                ? "실제 감정표현 TTS — API 키 필요, 없으면 유나로 자동 대체"
                : m.id === "system"
                ? "브라우저 시스템 음성 (유나)"
                : "Web Audio 포먼트 합성(가짜 보이스)"
            }
          >
            {m.label}
          </button>
        ))}
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
            style={
              shot.type !== "BLACK" && shot.type !== "WHITEOUT"
                ? {
                    backgroundPosition: FRAME_BY_TYPE[shot.type]?.position,
                    backgroundSize: FRAME_BY_TYPE[shot.type]?.size,
                  }
                : undefined
            }
          >
            {shot.type !== "BLACK" && shot.type !== "WHITEOUT" && (
              <>
                <div className={styles.scrim} />
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
