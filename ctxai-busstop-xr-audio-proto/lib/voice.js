// 실제 음성 대화 — 마이크(STT) + 음성 출력(TTS)
//
// 브라우저 내장 Web Speech API 를 쓴다. API 키·서버·비용이 전혀 없고,
// 한국어(ko-KR)를 지원한다. 프로토타입 단계에서 "관객이 실제로 말을 거는가"를
// 검증하는 데는 이것으로 충분하다.
//
// ─── 반드시 알아야 할 제약 ───────────────────────────────────
//
// 1) SpeechRecognition 은 Chrome/Edge 전용이다. Firefox 미지원,
//    Safari 는 불안정. 전시에서는 Chrome 고정으로 운영해야 한다.
//
// 2) Chrome 의 STT 는 오디오를 구글 서버로 전송한다. 즉 오프라인에서
//    동작하지 않고, 관객 음성이 외부로 나간다. 전시에서는 녹음 고지와
//    동의 절차가 필요하다. (소개서에 개인정보 처리 항목이 없는 것과
//    직결되는 문제 — 실제 전시 전에 반드시 채워야 한다.)
//
// 3) speechSynthesis 의 출력은 Web Audio 그래프로 가져올 수 없다.
//    따라서 TTS 음성은 PannerNode 를 통과하지 못하고 = 공간 위치를 잃는다.
//    "옆자리 오른쪽 0.55m" 가 사라지고 그냥 정면 스테레오로 들린다.
//    이 프로젝트의 핵심 성공요인이 공간 음향이므로, 최종 구현에서는
//    반드시 오디오 버퍼를 반환하는 TTS(클라우드 TTS 또는 로컬 합성)를 쓰고
//    romanceAudio.speakBuffer() 로 charPanner 를 통과시켜야 한다.
//    → 지금 모드는 "말이 들리는 것"과 "위치가 있는 것" 중 전자를 택한 상태다.
//
// 4) 스피커로 재생하면 마이크가 캐릭터 목소리를 다시 듣고 STT 가
//    그것을 관객 발화로 오인한다. TTS 재생 중에는 인식을 멈춘다(게이팅).
//    실제 전시에서는 헤드폰 또는 AEC 로 해결해야 한다.

const KO = "ko-KR";

// 감정 태그 → 프로소디. 성우 연기의 대체물이라 거칠지만,
// 같은 문장이 감정에 따라 다르게 들리는 것은 확인할 수 있다.
const PROSODY = {
  방어: { rate: 1.08, pitch: 0.94 },
  경계: { rate: 1.04, pitch: 0.96 },
  상처: { rate: 0.92, pitch: 0.92 },
  닫힘: { rate: 0.88, pitch: 0.9 },
  위축: { rate: 0.9, pitch: 0.95 },
  물러섬: { rate: 0.92, pitch: 0.95 },
  "가벼운 웃음": { rate: 1.02, pitch: 1.1 },
  "소리 내어 웃음": { rate: 1.08, pitch: 1.14 },
  "옅은 미소": { rate: 0.96, pitch: 1.06 },
  "옅은 웃음": { rate: 0.96, pitch: 1.06 },
  "체념 섞인 웃음": { rate: 0.9, pitch: 1.0 },
  "쓸쓸한 웃음": { rate: 0.88, pitch: 0.98 },
  조심스러움: { rate: 0.9, pitch: 1.02 },
  머쓱함: { rate: 0.95, pitch: 1.04 },
  놀람: { rate: 1.06, pitch: 1.12 },
  의외: { rate: 1.0, pitch: 1.1 },
  안도: { rate: 0.88, pitch: 1.0 },
  체념: { rate: 0.88, pitch: 0.96 },
  씁쓸함: { rate: 0.88, pitch: 0.94 },
  담담함: { rate: 0.94, pitch: 0.98 },
  회피: { rate: 1.0, pitch: 0.98 },
  아쉬움: { rate: 0.9, pitch: 1.0 },
  이별: { rate: 0.86, pitch: 0.96 },
  혼잣말: { rate: 0.86, pitch: 0.94 },
  여유: { rate: 0.94, pitch: 1.02 },
  되묻기: { rate: 1.06, pitch: 1.08 },
  "화제 전환": { rate: 1.04, pitch: 1.06 },
  수용: { rate: 0.94, pitch: 0.99 },
  수긍: { rate: 0.94, pitch: 0.99 },
  "생각 중": { rate: 0.85, pitch: 0.95 },
  여운: { rate: 0.86, pitch: 0.97 },
  "주의 전환": { rate: 1.08, pitch: 1.06 },
  "조심스러운 고백": { rate: 0.88, pitch: 1.0 },
  "농담으로 회피": { rate: 1.04, pitch: 1.08 },
};

const DEFAULT_PROSODY = { rate: 0.96, pitch: 1.02 };

export function voiceSupport() {
  if (typeof window === "undefined") return { stt: false, tts: false };
  return {
    stt: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    tts: !!window.speechSynthesis,
  };
}

/**
 * STT 가 이 환경에서 애초에 가능한지 미리 판정한다.
 *
 * SpeechRecognition 객체가 "존재"하는 것과 "동작"하는 것은 다르다.
 * Electron·Chromium·Brave 빌드에는 구글 음성 서비스 키가 없어서,
 * 객체는 있지만 호출하면 network / service-not-allowed 로 실패한다.
 * 클릭한 뒤 실패하게 두지 말고 먼저 알려준다.
 */
export function sttEnvironment() {
  if (typeof navigator === "undefined") return { ok: false, reason: "unsupported" };
  const ua = navigator.userAgent || "";
  if (!voiceSupport().stt) return { ok: false, reason: "unsupported" };
  if (/Electron\//i.test(ua)) return { ok: false, reason: "electron" };
  if (navigator.brave) return { ok: false, reason: "chromium-nokey" };

  const brands = navigator.userAgentData?.brands?.map((b) => b.brand) || null;
  if (brands && !brands.some((b) => /Google Chrome|Microsoft Edge/i.test(b))) {
    return { ok: false, reason: "chromium-nokey" };
  }
  if (!brands && !/Chrome\/|Edg\//i.test(ua)) return { ok: false, reason: "unsupported" };
  return { ok: true };
}

// 오류 코드 → 사람이 읽고 바로 조치할 수 있는 설명.
// SpeechRecognition 의 오류 코드와 getUserMedia 의 예외 이름을 함께 다룬다.
export const VOICE_ERRORS = {
  "not-allowed": {
    what: "마이크 권한이 거부되었습니다.",
    fix: "가장 흔한 원인은 앱 내장 브라우저입니다 — 내장 미리보기 창은 마이크를 원천 차단합니다. 정식 Chrome 을 직접 열어 localhost:3000 으로 접속하세요. Chrome 인데도 났다면 주소창 자물쇠 → 마이크 → 허용, 그리고 macOS 시스템 설정 → 개인정보 보호 및 보안 → 마이크에서 Chrome 을 켜세요.",
  },
  NotAllowedError: {
    what: "마이크 권한이 거부되었습니다.",
    fix: "앱 내장 브라우저는 마이크가 차단됩니다. 정식 Chrome 에서 localhost:3000 을 여세요. Chrome 이라면 주소창 자물쇠 → 마이크 허용 + macOS 시스템 설정 → 개인정보 보호 및 보안 → 마이크에서 Chrome 허용.",
  },
  "service-not-allowed": {
    what: "브라우저가 음성 인식 서비스를 차단했습니다.",
    fix: "Chromium·Brave·Arc·Electron 등 구글 음성 API 키가 없는 빌드에서는 항상 실패합니다. 정식 Google Chrome 을 사용하세요.",
  },
  network: {
    what: "음성 인식 서버에 접속하지 못했습니다.",
    fix: "Chrome 의 STT 는 구글 서버를 경유하므로 인터넷이 필요합니다. 온라인인데도 계속 실패하면 Chromium 계열 브라우저(Brave·Arc·Chromium)일 가능성이 큽니다 — 정식 Google Chrome 에서 다시 시도하세요.",
  },
  "audio-capture": {
    what: "마이크에서 소리를 가져오지 못했습니다.",
    fix: "다른 앱(줌·회의·녹음)이 마이크를 점유하고 있는지 확인하고, 입력 장치가 올바르게 선택되어 있는지 보세요.",
  },
  NotFoundError: {
    what: "사용할 수 있는 마이크가 없습니다.",
    fix: "입력 장치가 연결되어 있는지 확인하세요.",
  },
  NotReadableError: {
    what: "마이크를 다른 앱이 사용 중입니다.",
    fix: "마이크를 쓰는 다른 앱을 종료하고 다시 시도하세요.",
  },
  insecure: {
    what: "보안 컨텍스트가 아닙니다.",
    fix: "음성 인식은 HTTPS 또는 localhost 에서만 동작합니다. http://localhost:3000 으로 접속하세요 (127.0.0.1 이나 LAN IP 는 안 됩니다).",
  },
  unsupported: {
    what: "이 브라우저는 음성 인식을 지원하지 않습니다.",
    fix: "Safari·Firefox 는 미지원입니다. Google Chrome 또는 Edge 를 사용하세요.",
  },
  electron: {
    what: "앱 내장 브라우저(Electron)에서는 음성 인식이 동작하지 않습니다.",
    fix: "내장 미리보기 창은 마이크가 차단되고, Electron 에는 구글 음성 서비스 키가 없어 인식 자체가 불가능합니다. 터미널에서 다음을 실행해 정식 Chrome 으로 여세요:  open -a \"Google Chrome\" http://localhost:3000",
  },
  "chromium-nokey": {
    what: "이 브라우저에는 구글 음성 서비스 키가 없습니다.",
    fix: "Brave·Arc·Chromium 등은 SpeechRecognition 객체는 있지만 호출하면 실패합니다. 정식 Google Chrome 에서 http://localhost:3000 을 여세요.",
  },
};

export function explainError(code) {
  return (
    VOICE_ERRORS[code] || {
      what: `알 수 없는 오류: ${code}`,
      fix: "정식 Google Chrome, http://localhost:3000, 온라인 상태를 확인하세요.",
    }
  );
}

/** 무엇이 막고 있는지 한 번에 확인한다. */
export async function diagnose() {
  const out = {
    브라우저: typeof navigator !== "undefined" ? navigator.userAgent : "-",
    "보안 컨텍스트": typeof window !== "undefined" ? String(window.isSecureContext) : "-",
    주소: typeof location !== "undefined" ? location.origin : "-",
    "SpeechRecognition 존재": String(voiceSupport().stt),
    "speechSynthesis 존재": String(voiceSupport().tts),
    온라인: typeof navigator !== "undefined" ? String(navigator.onLine) : "-",
  };

  // 정식 Chrome 여부 — Brave/Arc/Edge/Chromium 구분
  if (typeof navigator !== "undefined") {
    const brands = navigator.userAgentData?.brands?.map((b) => b.brand).join(", ");
    out["브라우저 브랜드"] = brands || "(미제공)";
    out["Brave 여부"] = String(!!navigator.brave);
  }

  try {
    const st = await navigator.permissions?.query({ name: "microphone" });
    out["마이크 권한 상태"] = st?.state || "(조회 불가)";
  } catch (e) {
    out["마이크 권한 상태"] = "(조회 불가)";
  }

  try {
    const devs = await navigator.mediaDevices?.enumerateDevices();
    const mics = (devs || []).filter((d) => d.kind === "audioinput");
    out["마이크 장치 수"] = String(mics.length);
  } catch (e) {
    out["마이크 장치 수"] = "(조회 불가)";
  }

  const ko = (typeof window !== "undefined" ? window.speechSynthesis?.getVoices() || [] : []).filter(
    (v) => v.lang?.toLowerCase().startsWith("ko")
  );
  out["한국어 TTS 음성"] = ko.length ? `${ko.length}개 (${ko[0].name})` : "0개";

  return out;
}

/** 한국어 음성을 고른다. 목록은 비동기로 채워지므로 대기가 필요하다. */
function pickKoreanVoice() {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const find = () => {
      const vs = synth.getVoices();
      if (!vs.length) return null;
      return (
        vs.find((v) => v.lang === KO && /yuna|유나/i.test(v.name)) ||
        vs.find((v) => v.lang === KO) ||
        vs.find((v) => v.lang?.startsWith("ko")) ||
        null
      );
    };
    const found = find();
    if (found) return resolve(found);
    let tries = 0;
    const iv = window.setInterval(() => {
      const v = find();
      if (v || ++tries > 20) {
        window.clearInterval(iv);
        resolve(v);
      }
    }, 150);
  });
}

/**
 * 대사에서 지시문을 분리한다.
 * "(들숨) …비 그친 다음이 제일 조용하죠." → 말할 부분만 남긴다.
 * "(고개를 끄덕인다)" 처럼 전체가 지시문이면 말하지 않는다.
 */
export function splitDirection(text) {
  const spoken = text.replace(/\([^)]*\)/g, "").trim();
  return { spoken, silent: spoken.length === 0 };
}

export function createVoice() {
  if (typeof window === "undefined") return null;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;

  let rec = null;
  let koVoice = null;
  let wantListening = false; // 사용자가 마이크를 켜둔 상태인가
  let gated = false; // TTS 재생 중 인식 정지
  let restartTimer = null;

  const handlers = {
    onFinal: () => {},
    onInterim: () => {},
    onSpeechEnd: () => {},
    onError: () => {},
    onListeningChange: () => {},
  };

  if (synth) pickKoreanVoice().then((v) => (koVoice = v));

  function buildRecognizer() {
    if (!SR) return null;
    const r = new SR();
    r.lang = KO;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      if (gated) return; // 캐릭터가 말하는 중 — 자기 목소리를 받아쓰지 않는다
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = res[0]?.transcript || "";
        if (res.isFinal) {
          const clean = txt.trim();
          if (clean) handlers.onFinal(clean, res[0].confidence ?? null);
        } else {
          interim += txt;
        }
      }
      if (interim) handlers.onInterim(interim.trim());
    };

    // 발화가 끝난 시점 — 실측 지연의 기준점
    r.onspeechend = () => handlers.onSpeechEnd();

    r.onerror = (e) => {
      // no-speech / aborted 는 정상 흐름에서 계속 발생한다
      if (e.error === "no-speech" || e.error === "aborted") return;
      handlers.onError(e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantListening = false;
        handlers.onListeningChange(false);
      }
    };

    // Chrome 은 침묵이 이어지면 세션을 스스로 끝낸다 → 계속 다시 켠다
    r.onend = () => {
      if (!wantListening || gated) return;
      restartTimer = window.setTimeout(() => {
        try {
          r.start();
        } catch (err) {
          /* 이미 시작된 상태 — 무시 */
        }
      }, 250);
    };

    return r;
  }

  /**
   * 마이크 권한을 먼저 확실히 받는다.
   *
   * SpeechRecognition 만 호출하면 실패 원인이 전부 'not-allowed' 한 덩어리로
   * 뭉쳐 나와서 무엇이 문제인지 알 수 없다. getUserMedia 를 먼저 거치면
   * 권한 거부·장치 없음·다른 앱 점유가 각각 다른 예외로 구분된다.
   */
  async function ensureMic() {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return { ok: false, code: "insecure" };
    }
    if (!SR) return { ok: false, code: "unsupported" };
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, code: "not-allowed" };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // 권한 확인이 목적이므로 바로 놓아준다. SpeechRecognition 이 자체로 다시 잡는다.
      stream.getTracks().forEach((t) => t.stop());
      return { ok: true };
    } catch (err) {
      return { ok: false, code: err?.name || "not-allowed" };
    }
  }

  async function startListening() {
    const pre = await ensureMic();
    if (!pre.ok) {
      handlers.onError(pre.code);
      handlers.onListeningChange(false);
      return false;
    }
    if (!rec) rec = buildRecognizer();
    wantListening = true;
    try {
      rec.start();
    } catch (err) {
      /* 이미 동작 중 */
    }
    handlers.onListeningChange(true);
    return true;
  }

  function stopListening() {
    wantListening = false;
    window.clearTimeout(restartTimer);
    try {
      rec?.stop();
    } catch (err) {}
    handlers.onListeningChange(false);
  }

  /** TTS 재생 구간에는 마이크를 닫는다 (에코 → 자기 받아쓰기 방지) */
  function gate(on) {
    gated = on;
    if (!wantListening) return;
    if (on) {
      window.clearTimeout(restartTimer);
      try {
        rec?.stop();
      } catch (err) {}
    } else {
      restartTimer = window.setTimeout(() => {
        try {
          rec?.start();
        } catch (err) {}
      }, 300);
    }
  }

  /**
   * 대사를 말한다.
   * @returns Promise<{spoken:boolean, startedAt:number|null}>
   *   startedAt 은 실제 발성이 시작된 시각(performance.now) — 실측 지연 계산용
   */
  function speak(text, emotion, onStart) {
    return new Promise((resolve) => {
      if (!synth) return resolve({ spoken: false, startedAt: null });
      const { spoken, silent } = splitDirection(text);
      if (silent) return resolve({ spoken: false, startedAt: null });

      try {
        synth.cancel();
      } catch (err) {}

      const u = new SpeechSynthesisUtterance(spoken);
      u.lang = KO;
      if (koVoice) u.voice = koVoice;
      const p = PROSODY[emotion] || DEFAULT_PROSODY;
      u.rate = p.rate;
      u.pitch = p.pitch;
      u.volume = 1;

      let startedAt = null;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        gate(false);
        resolve({ spoken: true, startedAt });
      };

      u.onstart = () => {
        startedAt = performance.now();
        onStart?.(startedAt);
      };
      u.onend = done;
      u.onerror = done;

      gate(true);
      synth.speak(u);

      // Chrome 이 onend 를 흘리는 경우가 있어 안전장치를 둔다
      window.setTimeout(done, 2000 + spoken.length * 180);
    });
  }

  function cancel() {
    try {
      synth?.cancel();
    } catch (err) {}
    gate(false);
  }

  function dispose() {
    wantListening = false;
    window.clearTimeout(restartTimer);
    try {
      rec?.abort();
    } catch (err) {}
    cancel();
    rec = null;
  }

  return {
    support: voiceSupport(),
    on(name, fn) {
      if (name in handlers) handlers[name] = fn;
    },
    ensureMic,
    startListening,
    stopListening,
    speak,
    cancel,
    dispose,
    get voiceName() {
      return koVoice?.name || null;
    },
    get listening() {
      return wantListening;
    },
  };
}
