"use client";

// 로맨스 트랙 5분 수직 슬라이스 — 반나절 프로토타입
//
// 목적은 "관객이 실제로 말을 거는가 / 5분 감정 곡선이 성립하는가"를
// HMD·3D·성우 없이 가장 싸게 확인하는 것. (Tier 0)
// 헤드폰 착용 전제. HMD 없이도 §10 의 방향·거리·이동은 그대로 검증된다.
//
// 우측 HUD 는 소개서 §11 의 6개 상태값이 실제로 도는 것을 보여준다.
// 이 상태머신은 WebXR / 네이티브 어느 쪽으로 가도 그대로 이식된다.

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./RomanceSlice.module.css";
import {
  CUES,
  NONVERBAL_BEATS,
  REVEAL_FREEZE_SEC,
  REVEAL_GATES,
  STAGES,
  TOTAL_SEC,
  stageAt,
  stageIndex,
} from "@/lib/romanceScript";
import { INTENT_LABEL, classifyIntent, initialState, step, tick } from "@/lib/dialogueEngine";
import { createRomanceAudio } from "@/lib/romanceAudio";
import { createVoice, diagnose, explainError, sttEnvironment, voiceSupport } from "@/lib/voice";
import CinematicStage from "./CinematicStage";

const LATENCIES = [
  { ms: 300, label: "0.3s", note: "이상적" },
  { ms: 1200, label: "1.2s", note: "목표 상한" },
  { ms: 2600, label: "2.6s", note: "폴백 발동" },
];

const QUICK = [
  "저도 처음이에요.",
  "울었어요?",
  "어디 가세요?",
  "그랬겠네요. 힘들었겠어요.",
  "그건 좀 캐묻는 거 아닌가요?",
];

function mmss(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function RomanceSlice({ onClose }) {
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [state, setState] = useState(initialState);
  const [log, setLog] = useState([]);
  const [cueLog, setCueLog] = useState([]);
  const [beat, setBeat] = useState(null);
  const [awaiting, setAwaiting] = useState(false);
  const [input, setInput] = useState("");
  const [offline, setOffline] = useState(false);
  const [latency, setLatency] = useState(1200);
  const [speed, setSpeed] = useState(1);
  const [yaw, setYaw] = useState(0);
  const [charOn, setCharOn] = useState(false);
  const [charX, setCharX] = useState(58);
  const [speaking, setSpeaking] = useState(false);
  const [busIn, setBusIn] = useState(false);
  const [doorOpen, setDoorOpen] = useState(false);
  const [cafeOpen, setCafeOpen] = useState(false);
  const [white, setWhite] = useState(false);
  const [posture, setPosture] = useState(null);
  const [subtitle, setSubtitle] = useState(null);
  const [cinema, setCinema] = useState(true);

  // 실제 LLM 대사 생성
  const [llmOn, setLlmOn] = useState(false);
  const [llmMeta, setLlmMeta] = useState(null);
  const [llmNote, setLlmNote] = useState(null);

  // 실제 음성 대화 — 마이크(STT)와 목소리 출력(TTS)는 서로 다른 기능이라
  // 별개 토글로 둔다. 마이크가 막힌 환경(Electron 내장 창 등)에서도
  // 목소리 출력만은 항상 켤 수 있어야 한다 — speechSynthesis 는 마이크 권한과 무관하다.
  const [ttsOn, setTtsOn] = useState(true); // 기본으로 켜둔다 — 이게 실제 "목소리"다
  const [voiceOn, setVoiceOn] = useState(false);
  const [interim, setInterim] = useState("");
  const [measured, setMeasured] = useState(null); // 실측 지연(ms)
  const [voiceErr, setVoiceErr] = useState(null);
  const [support, setSupport] = useState({ stt: false, tts: false });
  const [sttEnv, setSttEnv] = useState({ ok: true });
  const [diag, setDiag] = useState(null);

  const audioRef = useRef(null);
  const elapsedRef = useRef(0);
  const cueIdxRef = useRef(0);
  const stageRef = useRef(null);
  const tickSecRef = useRef(-1);
  const stateRef = useRef(state);
  const lastInputAtRef = useRef(0);
  const awaitingRef = useRef(false);
  const startedRef = useRef(false);
  const endedRef = useRef(false);
  const offlineRef = useRef(false);
  const latencyRef = useRef(1200);
  const speedRef = useRef(1);
  const timersRef = useRef([]);
  const logEndRef = useRef(null);
  const speakTimerRef = useRef(null);
  const voiceRef = useRef(null);
  const ttsOnRef = useRef(true);
  const voiceOnRef = useRef(false);
  const speechEndAtRef = useRef(null);
  const llmOnRef = useRef(false);
  const logRef = useRef([]);
  const subKeyRef = useRef(0);

  stateRef.current = state;
  offlineRef.current = offline;
  latencyRef.current = latency;
  speedRef.current = speed;
  endedRef.current = ended;
  voiceOnRef.current = voiceOn;
  ttsOnRef.current = ttsOn;
  llmOnRef.current = llmOn;
  logRef.current = log;

  const later = useCallback((ms, fn) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  const pushLog = useCallback((entry) => {
    setLog((l) => [...l.slice(-120), entry]);
    // 시네마 모드의 자막은 로그가 아니라 이 한 줄만 보여준다.
    if (entry.who === "char" || entry.who === "user") {
      subKeyRef.current += 1;
      setSubtitle({ who: entry.who, text: entry.text, key: subKeyRef.current });
    }
  }, []);

  /** 대사 한 줄을 LLM 에게 요청한다. 실패하면 null → 규칙 뱅크로 폴백. */
  const fetchLine = useCallback(async (utterance, intent, stageId) => {
    try {
      const res = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state: stateRef.current,
          utterance,
          intent,
          elapsed: elapsedRef.current,
          stageId,
          history: logRef.current
            .filter((l) => l.who === "char" || l.who === "user")
            .map((l) => ({ who: l.who, text: l.text })),
        }),
      });
      const data = await res.json();
      if (data.configured === false) return { ok: false, reason: "키 미설정", stop: true };
      if (!data.ok) return { ok: false, reason: data.reason };
      setLlmMeta(data.meta);
      return { ok: true, line: data.line };
    } catch (e) {
      return { ok: false, reason: "요청 실패" };
    }
  }, []);

  useEffect(() => {
    // scrollIntoView 는 fixed 오버레이 안에서 바깥 문서를 스크롤해버린다.
    // 로그 컨테이너를 직접 내린다.
    const el = logEndRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, beat]);

  useEffect(() => {
    // 체험 중에는 뒤쪽 페이지가 스크롤되지 않게 잠근다.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      audioRef.current?.dispose();
      audioRef.current = null;
      voiceRef.current?.dispose();
      voiceRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioRef.current?.setListenerYaw((yaw * Math.PI) / 180);
  }, [yaw]);

  const speakNow = useCallback((response) => {
    const audio = audioRef.current;
    const voice = voiceRef.current;
    clearTimeout(speakTimerRef.current);
    setSpeaking(true);

    if (ttsOnRef.current && voice) {
      // 실제 한국어 TTS. speechSynthesis 는 Web Audio 를 통과하지 못해
      // 목소리의 공간 위치를 잃는다. 위치감이 완전히 사라지지 않도록
      // 숨소리만 charPanner(오른쪽 근접)로 함께 낸다.
      audio?.breath(0);
      voice
        .speak(response.text, response.emotion, (startedAt) => {
          if (speechEndAtRef.current != null) {
            setMeasured(Math.round(startedAt - speechEndAtRef.current));
            speechEndAtRef.current = null;
          }
        })
        .then(({ spoken }) => {
          setSpeaking(false);
          // 지시문만 있는 줄((고개를 끄덕인다) 등)은 말하지 않고 기척만 남긴다
          if (!spoken) audio?.breath(0);
        });
      return;
    }

    if (!audio) return setSpeaking(false);
    const dur = audio.speak(response.text, { warm: stateRef.current.trust / 100 });
    speakTimerRef.current = window.setTimeout(() => setSpeaking(false), dur * 1000 + 120);
  }, []);

  // ── 한 턴 ──────────────────────────────────────────────────
  const submit = useCallback(
    (raw, opts = {}) => {
      if (!startedRef.current || endedRef.current) return;
      if (awaitingRef.current && !opts.force) return;

      const utt = (raw || "").trim();
      const charLed = !!opts.forceIntent;
      lastInputAtRef.current = elapsedRef.current;
      awaitingRef.current = true;
      setAwaiting(true);
      setInput("");

      if (!charLed) {
        pushLog(utt ? { who: "user", text: utt } : { who: "sys", text: "관객 침묵 (9초)" });
      }

      // 음성 모드에서는 STT·TTS 지연이 실제로 발생하므로 인위적 지연을 넣지 않는다.
      const lat = charLed ? 240 : voiceOnRef.current ? 0 : latencyRef.current;
      const useBridge = offlineRef.current || lat >= 2500;

      // 200ms 이내: 말보다 비언어 연기가 먼저 나온다 (§11)
      later(180, () => {
        if (endedRef.current) return;
        setBeat(NONVERBAL_BEATS[Math.floor(Math.random() * NONVERBAL_BEATS.length)]);
        audioRef.current?.breath(0);
      });

      if (!charLed && lat >= 2500) {
        later(2500, () =>
          pushLog({
            who: "sys",
            text: "응답 지연 2.5초 초과 → 사전 녹음 브리지 대사로 전환 (5분 타이머·필수 사건은 로컬에서 계속 실행)",
          })
        );
      }

      const commit = (llmLine) => {
        if (endedRef.current) return;
        setBeat(null);
        const { state: ns, response } = step(stateRef.current, utt, elapsedRef.current, {
          offline: useBridge,
          forceIntent: opts.forceIntent,
          llmLine,
        });
        stateRef.current = ns;
        setState(ns);
        pushLog({ who: "char", text: response.text, meta: response });
        setPosture(response.posture);
        speakNow(response);
        awaitingRef.current = false;
        setAwaiting(false);
      };

      // 인물이 먼저 말을 거는 필수 사건(첫 대화·이별)은 작가가 고정한 구간이므로
      // LLM 을 타지 않는다. 관객 발화에 대한 응답만 LLM 이 변주한다.
      if (llmOnRef.current && !useBridge && !charLed) {
        const askedAt = performance.now();
        fetchLine(utt, classifyIntent(utt), stageAt(elapsedRef.current).id).then((r) => {
          if (endedRef.current) return;
          if (r.ok) {
            setLlmNote(null);
            commit(r.line);
          } else {
            // 실패는 조용히 규칙 뱅크로 넘긴다 — 타임라인은 멈추지 않는다.
            setLlmNote(r.reason);
            if (r.stop) setLlmOn(false);
            pushLog({ who: "sys", text: `LLM 대사 폐기 (${r.reason}) → 규칙 뱅크로 대체` });
            commit(null);
          }
          if (speechEndAtRef.current == null) {
            setMeasured(Math.round(performance.now() - askedAt));
          }
        });
      } else {
        later(lat, () => commit(null));
      }
    },
    [later, pushLog, speakNow, fetchLine]
  );

  const charInitiates = useCallback(() => submit("", { forceIntent: "idle", force: true }), [submit]);

  // ── 실제 음성 대화 ────────────────────────────────────────
  useEffect(() => {
    setSupport(voiceSupport());
    setSttEnv(sttEnvironment());
  }, []);

  async function runDiagnose() {
    setDiag(await diagnose());
  }

  /**
   * 음성 엔진 객체를 준비한다. TTS(목소리 출력)와 STT(마이크)가 이 객체 하나를
   * 공유하지만, 켜고 끄는 것은 서로 독립이다 — 마이크가 막힌 환경에서도
   * speechSynthesis 는 정상 동작하므로 TTS 만 켜는 것이 항상 가능해야 한다.
   */
  function ensureVoiceObj() {
    if (voiceRef.current) return voiceRef.current;
    const v = createVoice();
    if (!v) return null;
    v.on("onFinal", (text) => {
      setInterim("");
      submit(text);
    });
    v.on("onInterim", setInterim);
    v.on("onSpeechEnd", () => {
      speechEndAtRef.current = performance.now();
    });
    v.on("onError", setVoiceErr);
    // 권한 거부 등으로 엔진이 스스로 멈추면 UI 도 따라 꺼져야 한다.
    // (이걸 연결하지 않으면 버튼은 "켜짐"인데 실제로는 안 듣는 상태가 된다)
    v.on("onListeningChange", (on) => {
      setVoiceOn(on);
      if (!on) setInterim("");
    });
    voiceRef.current = v;
    return v;
  }

  function toggleTts() {
    ensureVoiceObj(); // 마이크 권한 없이도 생성된다 — TTS 는 STT 와 무관
    setTtsOn((v) => !v);
  }

  async function toggleVoice() {
    // 이 환경에서 STT 가 애초에 불가능하면 클릭 시점에 이유를 보여준다.
    if (!voiceOn && !sttEnv.ok) {
      setVoiceErr(sttEnv.reason);
      runDiagnose();
      return;
    }
    if (!ensureVoiceObj()) return;
    if (voiceOn) {
      voiceRef.current.stopListening(); // onListeningChange(false) 로 UI 동기화
      voiceRef.current.cancel();
    } else {
      // 마이크 권한 프롬프트는 이 클릭(사용자 제스처) 안에서 떠야 한다.
      setVoiceErr(null);
      const ok = await voiceRef.current.startListening();
      if (!ok) runDiagnose(); // 실패하면 원인을 바로 뽑아 보여준다
    }
  }

  // ── 사운드 큐 ──────────────────────────────────────────────
  const fireCue = useCallback((cue) => {
    const audio = audioRef.current;
    setCueLog((l) => [...l.slice(-40), `${mmss(cue.at)}  ${cue.desc}`]);
    if (!audio) return;
    if (cue.id === "benchSit") {
      setCharOn(true);
      audio.cues.benchSit();
    } else if (cue.id === "cafeOpen") {
      audio.cues.cafeOpen();
      audio.moveCharacter(0.42, 0.06); // 인물이 조금 다가와 앉는다
      setCharX(67);
      setCafeOpen(true);
      later(6500, () => setCafeOpen(false)); // 문이 다시 닫힌다
    } else if (cue.id === "busApproach") {
      audio.cues.busApproach();
      setBusIn(true);
    } else {
      audio.cues[cue.id]?.();
    }
  }, [later]);

  // ── 메인 루프 ──────────────────────────────────────────────
  useEffect(() => {
    if (!started || ended) return;
    const iv = window.setInterval(() => {
      elapsedRef.current += 0.1 * speedRef.current;
      const t = elapsedRef.current;
      setElapsed(t);

      while (cueIdxRef.current < CUES.length && t >= CUES[cueIdxRef.current].at) {
        fireCue(CUES[cueIdxRef.current++]);
      }

      const st = stageAt(t);
      if (st.id !== stageRef.current) {
        stageRef.current = st.id;
        pushLog({ who: "sys", text: `${st.label} · ${st.note}` });
        tickSecRef.current = Math.floor(t);
        setState((s) => tick(s, t));
        // 인물이 먼저 말을 거는 필수 사건들
        if (st.id === "first_talk" || st.id === "bus_approach") {
          later(600, charInitiates);
        }
        if (st.id === "return") {
          later(400, charInitiates);
          later(2600, () => {
            audioRef.current?.busDoor();
            setDoorOpen(true);
          });
          later(3800, () => setWhite(true));
          later(6000, () => {
            setEnded(true);
            endedRef.current = true;
            audioRef.current?.stopAmbience();
            voiceRef.current?.stopListening();
            setVoiceOn(false);
            setInterim("");
          });
        }
      } else if (Math.floor(t) !== tickSecRef.current) {
        // 상태 갱신은 초 단위로만 — 100ms 마다 새 상태를 만들면 turn 중 갱신과 경쟁한다.
        tickSecRef.current = Math.floor(t);
        setState((s) => tick(s, t));
      }

      // 침묵도 입력이다 — 9초 무발화면 침묵 턴으로 처리한다
      if (
        !awaitingRef.current &&
        stageIndex(stageRef.current) >= stageIndex("first_talk") &&
        stageIndex(stageRef.current) < stageIndex("return") &&
        t - lastInputAtRef.current > 9
      ) {
        submit("");
      }
    }, 100);
    return () => window.clearInterval(iv);
  }, [started, ended, fireCue, pushLog, later, charInitiates, submit]);

  // ── 시작 / 구간 점프 ──────────────────────────────────────
  function start() {
    audioRef.current = createRomanceAudio();
    audioRef.current?.cues.ambience();
    audioRef.current?.setListenerYaw(0);
    // 목소리 출력은 기본으로 켜져 있으므로, 마이크 권한 없이도 여기서
    // 음성 엔진을 미리 준비해둔다 — speechSynthesis 는 사용자 제스처(이 클릭)
    // 안에서 초기화하는 편이 일부 브라우저에서 더 안정적이다.
    if (ttsOnRef.current) ensureVoiceObj();
    elapsedRef.current = 0;
    cueIdxRef.current = 0;
    stageRef.current = null;
    lastInputAtRef.current = 0;
    startedRef.current = true;
    setStarted(true);
  }

  function jumpTo(stage) {
    const t = stage.at + 0.5;
    elapsedRef.current = t;
    setElapsed(t);
    cueIdxRef.current = CUES.findIndex((c) => c.at > t);
    if (cueIdxRef.current < 0) cueIdxRef.current = CUES.length;
    stageRef.current = null;
    tickSecRef.current = -1;
    lastInputAtRef.current = t;
    if (stageIndex(stage.id) >= stageIndex("first_presence")) setCharOn(true);
    if (stageIndex(stage.id) >= stageIndex("genre_event")) {
      audioRef.current?.moveCharacter(0.42, 0.06);
      setCharX(67);
    }
    setState((s) => tick(s, t));
    setCueLog((l) => [...l, `— ${stage.label} 구간으로 점프 (데모용) —`]);
  }

  function nudgeTrust(d) {
    setState((s) => {
      const ns = { ...s, trust: Math.max(0, Math.min(100, s.trust + d)) };
      stateRef.current = ns;
      return tick(ns, elapsedRef.current);
    });
  }

  const stage = stageAt(elapsed);
  const stageIdx = stageIndex(stage.id);
  const canTalk = stageIdx >= stageIndex("first_presence") && !ended;
  const nextGate = REVEAL_GATES.find((g) => g.level === state.revealLevel + 1);

  return (
    <div className={styles.wrap}>
      {/* ── 상단 바 ── */}
      <div className={styles.topBar}>
        <span className={styles.clock}>{mmss(elapsed)}</span>
        <span style={{ color: "#56617a", fontSize: 11 }}>/ {mmss(TOTAL_SEC)}</span>
        <span className={styles.stageChip}>{stage.label}</span>

        <div className={styles.spacer} />

        <div className={styles.yaw}>
          고개 {yaw > 0 ? `→${yaw}°` : yaw < 0 ? `←${-yaw}°` : "정면"}
          <input
            type="range"
            min={-90}
            max={90}
            step={5}
            value={yaw}
            onChange={(e) => setYaw(Number(e.target.value))}
          />
        </div>

        <button
          className={`${styles.toggle} ${ttsOn ? styles.toggleOn : ""}`}
          onClick={toggleTts}
          title={
            support.tts
              ? "캐릭터 대사를 한국어 음성(TTS)으로 들려줍니다. 마이크와 무관하게 항상 켤 수 있습니다."
              : "이 브라우저는 음성 합성을 지원하지 않습니다."
          }
        >
          {ttsOn ? "🔊 목소리 켜짐" : "🔇 목소리 꺼짐"}
        </button>

        <button
          className={`${styles.toggle} ${voiceOn ? styles.toggleMic : ""} ${
            !sttEnv.ok ? styles.toggleWarn : ""
          }`}
          onClick={toggleVoice}
          disabled={!started || ended}
          title={
            sttEnv.ok
              ? "실제 마이크로 말합니다 (Chrome 전용). 목소리 출력과는 별개입니다."
              : explainError(sttEnv.reason).fix
          }
        >
          {voiceOn ? "🎤 마이크 켜짐" : sttEnv.ok ? "🎤 마이크" : "🎤 마이크 ⚠"}
        </button>

        {voiceOn && measured != null && (
          <span
            className={styles.measured}
            title="관객 발화 종료 → 캐릭터 발성 시작까지의 실측 시간 (STT+TTS, LLM 미포함)"
          >
            실측 {(measured / 1000).toFixed(2)}s
          </span>
        )}

        <button
          className={`${styles.toggle} ${cinema ? styles.toggleOn : ""}`}
          onClick={() => setCinema((v) => !v)}
          title="시네마 모드 — 프레임만 보여주고 로그·HUD 를 숨깁니다"
        >
          {cinema ? "🎬 씬" : "🎬 연출"}
        </button>

        <button
          className={`${styles.toggle} ${llmOn ? styles.toggleLlm : ""}`}
          onClick={() => {
            setLlmOn((v) => !v);
            setLlmNote(null);
          }}
          title="실제 LLM(Claude)이 대사를 즉흥 생성합니다. 끄면 규칙 뱅크를 씁니다."
        >
          {llmOn ? "✦ AI 대사 켜짐" : "✦ AI 대사"}
        </button>

        {llmOn && llmMeta && (
          <span
            className={styles.measured}
            title={`모델 ${llmMeta.model} · 입력 ${llmMeta.inputTokens} · 출력 ${llmMeta.outputTokens} · 캐시읽기 ${llmMeta.cacheRead}`}
          >
            {(llmMeta.latencyMs / 1000).toFixed(2)}s
            {llmMeta.cacheRead > 0 ? " ⚡캐시" : ""}
          </span>
        )}

        <button
          className={`${styles.toggle} ${offline ? styles.toggleOn : ""}`}
          onClick={() => setOffline((v) => !v)}
          title="네트워크·AI 응답 실패 시뮬레이션"
        >
          {offline ? "● 오프라인" : "○ 온라인"}
        </button>

        {LATENCIES.map((l) => (
          <button
            key={l.ms}
            className={`${styles.toggle} ${!voiceOn && latency === l.ms ? styles.toggleOn : ""}`}
            onClick={() => setLatency(l.ms)}
            disabled={voiceOn}
            title={
              voiceOn
                ? "음성 대화 모드에서는 실제 STT·TTS 지연이 측정됩니다"
                : `응답 지연 ${l.label} — ${l.note}`
            }
          >
            {l.label}
          </button>
        ))}

        {[1, 3].map((s) => (
          <button
            key={s}
            className={`${styles.toggle} ${speed === s ? styles.toggleOn : ""}`}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}

        <button className={styles.toggle} onClick={onClose}>
          닫기 ✕
        </button>
      </div>

      {/* ── 무대 — 영화 프레임 ── */}
      <div className={`${styles.stage} ${cinema ? styles.stageCinema : ""}`}>
        <CinematicStage
          stage={stage}
          elapsed={elapsed}
          charOn={charOn}
          charX={charX}
          speaking={speaking}
          posture={posture}
          cafeOpen={cafeOpen}
          busIn={busIn}
          doorOpen={doorOpen}
          white={white}
          subtitle={subtitle}
          beat={beat}
          interim={interim}
        />

        {!started && (
          <div className={styles.overlay}>
            <h2>로맨스 트랙 · 5분 수직 슬라이스</h2>
            <p>
              🎧 <b>헤드폰을 착용하세요.</b> 옆자리 인물의 목소리는 오른쪽 0.55m, 카페는 전방 좌측 11m,
              차량은 좌→우로 지나갑니다. 화면을 보지 않고 소리만 들어도 됩니다.
              <br />
              <br />
              말을 걸어도 되고, 가만히 있어도 됩니다. 5분 뒤 버스가 옵니다.
              <br />
              <br />
              🔊 <b>목소리</b>는 기본으로 켜져 있어 캐릭터 대사가 한국어 음성으로 들립니다.
              {support.stt && (
                <>
                  {" "}
                  상단의 <b>🎤 마이크</b>를 켜면 타이핑 없이 실제로 말해서 대화할 수 있습니다.
                </>
              )}
            </p>
            <button className={styles.bigBtn} onClick={start}>
              앉기
            </button>
          </div>
        )}

        {ended && (
          <div className={styles.overlay}>
            <h2>버스 문이 열렸습니다</h2>
            <p>
              5분 종료 · 최종 신뢰도 {state.trust} · 공개 단계 {state.revealLevel} · 대화 {state.turn}턴
              <br />
              같은 시나리오가 다른 관계로 기억되는지 확인하려면 다시 앉아보세요.
            </p>
            <button className={styles.bigBtn} onClick={onClose}>
              나가기
            </button>
          </div>
        )}
      </div>

      {/* ── 본문 — 시네마 모드에서는 숨는다 ── */}
      <div className={`${styles.body} ${cinema ? styles.bodyHidden : ""}`}>
        <div className={styles.left}>
          <div className={styles.log}>
            {log.map((l, i) => {
              if (l.who === "sys") {
                return (
                  <div key={i} className={styles.sysLine}>
                    {l.text}
                  </div>
                );
              }
              if (l.who === "user") {
                return (
                  <div key={i} className={`${styles.line} ${styles.userLine}`}>
                    <div className={styles.userText}>{l.text}</div>
                  </div>
                );
              }
              const m = l.meta || {};
              const badge =
                m.source === "recorded"
                  ? [styles.srcRecorded, "고정 녹음"]
                  : m.source === "bridge"
                  ? [styles.srcBridge, "브리지"]
                  : [styles.srcGenerated, "실시간"];
              return (
                <div key={i} className={`${styles.line} ${styles.charLine}`}>
                  <div className={styles.charText}>{l.text}</div>
                  <div className={styles.tags}>
                    <span className={`${styles.srcBadge} ${badge[0]}`}>{badge[1]}</span>
                    {m.emotion} · 시선 {m.gaze} · {m.posture}
                    {m.trust ? ` · 신뢰 ${m.trust > 0 ? "+" : ""}${m.trust}` : ""}
                  </div>
                </div>
              );
            })}
            {beat && <div className={styles.beat}>({beat})</div>}
            {interim && (
              <div className={`${styles.line} ${styles.userLine}`}>
                <div className={`${styles.userText} ${styles.interim}`}>{interim}</div>
              </div>
            )}
            <div ref={logEndRef} />
          </div>

        </div>

        {/* ── HUD ── */}
        <div className={styles.hud}>
          <p className={styles.hudTitle}>상태값 · 소개서 §11</p>

          <div className={styles.hudBlock}>
            <div className={styles.kv}>
              <span className={styles.k}>scene_state</span>
              <span className={styles.v}>{stage.label}</span>
            </div>
            <div className={styles.kv}>
              <span className={styles.k}>last_user_intent</span>
              <span className={styles.v}>
                {state.lastUserIntent ? INTENT_LABEL[state.lastUserIntent] : "—"}
              </span>
            </div>
            <div className={styles.kv}>
              <span className={styles.k}>time_remaining</span>
              <span className={styles.v}>{mmss(state.timeRemaining)}</span>
            </div>
          </div>

          <div className={styles.hudBlock}>
            <div className={styles.kv}>
              <span className={styles.k}>trust</span>
              <span className={styles.v}>{state.trust}</span>
            </div>
            <div className={styles.meter}>
              <div
                className={styles.meterFill}
                style={{ width: `${state.trust}%`, background: "#e08a9a" }}
              />
            </div>

            <div className={styles.kv}>
              <span className={styles.k}>tension</span>
              <span className={styles.v}>{state.tension}</span>
            </div>
            <div className={styles.meter}>
              <div
                className={styles.meterFill}
                style={{ width: `${state.tension}%`, background: "#c98a53" }}
              />
            </div>

            <div className={styles.kv}>
              <span className={styles.k}>reveal_level</span>
              <span className={styles.v}>
                {state.revealLevel} / 3 {state.revealFrozen && <span className={styles.frozen}>· 동결</span>}
              </span>
            </div>
            <div className={styles.pips}>
              {[1, 2, 3].map((n) => (
                <div key={n} className={`${styles.pip} ${state.revealLevel >= n ? styles.pipOn : ""}`} />
              ))}
            </div>
            <div className={styles.gateNote}>
              {state.revealFrozen ? (
                <>
                  버스 접근({mmss(REVEAL_FREEZE_SEC)}) 이후 공개 단계 동결. 새 주제를 열지 않고 이별로
                  수렴합니다.
                </>
              ) : nextGate ? (
                <>
                  다음 단계 조건 — 단계 <b>{STAGES[stageIndex(nextGate.minStage)].label}</b> · 신뢰{" "}
                  <b>{nextGate.minTrust}</b> · {mmss(nextGate.minSec)} 경과
                  <br />
                  <span style={{ opacity: 0.75 }}>내용: {nextGate.desc}</span>
                </>
              ) : (
                <>모든 공개 단계가 열렸습니다.</>
              )}
            </div>
          </div>

          <div className={styles.hudBlock}>
            <p className={styles.hudTitle}>절대 타임라인</p>
            <div className={styles.timeline}>
              {STAGES.map((s, i) => (
                <div
                  key={s.id}
                  className={`${styles.tlRow} ${
                    i === stageIdx ? styles.now : i < stageIdx ? styles.done : ""
                  }`}
                >
                  <span className={styles.tlDot} />
                  {s.label}
                  <span className={styles.tlAt}>{mmss(s.at)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.hudBlock}>
            <p className={styles.hudTitle}>사운드 큐 (§10)</p>
            <div className={styles.cueFeed}>
              {cueLog.length ? cueLog.map((c, i) => <div key={i}>{c}</div>) : <div>—</div>}
            </div>
          </div>

          <div className={styles.hudBlock}>
            <p className={styles.hudTitle}>데모 조작</p>
            <div className={styles.chips}>
              <button className={styles.chip} disabled={!started} onClick={() => nudgeTrust(25)}>
                신뢰 +25
              </button>
              <button className={styles.chip} disabled={!started} onClick={() => nudgeTrust(-25)}>
                신뢰 −25
              </button>
            </div>
            <div className={styles.chips}>
              {STAGES.filter((s) => ["reveal", "genre_event", "bus_approach"].includes(s.id)).map((s) => (
                <button key={s.id} className={styles.chip} disabled={!started} onClick={() => jumpTo(s)}>
                  ⤼ {s.label}
                </button>
              ))}
            </div>
            <div className={styles.gateNote} style={{ marginTop: 6 }}>
              발표 중 특정 구간만 보여줄 때 사용합니다. 신뢰도 조정은 같은 질문이 신뢰도에 따라 어떻게
              다르게 착지하는지 즉시 비교하기 위한 데모용 강제 조작입니다.
            </div>
          </div>
        </div>
      </div>

      {/* ── 입력 — 시네마 모드에서도 남는다 ── */}
        <div className={styles.inputBar}>
          <div className={styles.chips}>
            {QUICK.map((q) => (
              <button
                key={q}
                className={styles.chip}
                disabled={!canTalk || awaiting}
                onClick={() => submit(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className={styles.row}
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) submit(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                !started
                  ? "아직 시작하지 않았습니다"
                  : ended
                  ? "버스 문이 열렸습니다 — 체험이 종료되었습니다"
                  : !canTalk
                  ? "아직 옆자리에 아무도 없습니다"
                  : awaiting
                  ? "인물이 반응하고 있습니다…"
                  : "아무 말이나 하세요 (STT 대체 입력)"
              }
              disabled={!canTalk || awaiting}
            />
            <button type="submit" disabled={!canTalk || awaiting || !input.trim()}>
              말하기
            </button>
          </form>
          <div className={styles.hint}>
            {voiceErr ? (
              <div className={styles.errBox}>
                <div className={styles.errHead}>
                  음성 인식 실패 · <code>{voiceErr}</code>
                </div>
                <div className={styles.errWhat}>{explainError(voiceErr).what}</div>
                <div className={styles.errFix}>{explainError(voiceErr).fix}</div>
                <div className={styles.errActions}>
                  <button className={styles.chip} onClick={runDiagnose}>
                    진단 다시 실행
                  </button>
                  <button className={styles.chip} onClick={() => setVoiceErr(null)}>
                    닫고 타이핑으로 계속
                  </button>
                </div>
                {diag && (
                  <div className={styles.diag}>
                    {Object.entries(diag).map(([k, v]) => (
                      <div key={k}>
                        <span className={styles.diagK}>{k}</span> {v}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : voiceOn ? (
              <>
                🎤 <b>듣고 있습니다.</b> 그냥 말하세요 — 타이핑할 필요 없습니다. 캐릭터가 말하는 동안에는
                마이크가 닫힙니다(자기 목소리를 받아쓰지 않도록). 9초간 아무 말도 없으면 <b>침묵</b>도
                하나의 의도로 처리됩니다.
                {ttsOn && (
                  <>
                    <br />
                    ⚠ 지금 목소리는 브라우저 TTS 라 <b>공간 위치를 잃습니다</b> — 오른쪽 0.42m 가 아니라
                    정면에서 들립니다. 숨소리만 원래 위치에 남습니다.
                  </>
                )}
              </>
            ) : sttEnv.ok ? (
              <>
                타이핑 대신 <b>🎤 마이크</b>를 켜면 실제로 말해서 대화할 수 있습니다. 9초간 아무 말도
                없으면 <b>침묵</b>도 하나의 의도로 처리됩니다.
                {!ttsOn && (
                  <>
                    {" "}
                    지금 <b>🔇 목소리가 꺼져 있어</b> 대사가 화면에만 뜨고 소리로는 안 들립니다 — 상단의{" "}
                    <b>🔊 목소리</b>를 켜세요.
                  </>
                )}
              </>
            ) : (
              <>
                ⚠ <b>이 창에서는 마이크(음성 인식)가 동작하지 않습니다.</b> {explainError(sttEnv.reason).what}{" "}
                타이핑으로는 모든 기능이 정상 동작하고, <b>목소리 출력은 이 창에서도 됩니다</b> — 한국어
                TTS 는 시스템 음성이라 브라우저와 무관합니다(상단 🔊 목소리 토글). 마이크까지 쓰려면 정식
                Chrome 에서 여세요 —{" "}
                <code className={styles.cmd}>open -a &quot;Google Chrome&quot; http://localhost:3000</code>
                {!ttsOn && (
                  <>
                    <br />
                    지금은 <b>🔇 목소리도 꺼져 있어</b> 대사가 소리로 안 나갑니다 — 상단의 <b>🔊 목소리</b>
                    를 먼저 켜세요.
                  </>
                )}
              </>
            )}
          </div>
        </div>
    </div>
  );
}
