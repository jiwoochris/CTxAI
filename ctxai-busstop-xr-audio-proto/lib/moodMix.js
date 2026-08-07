// 3단계 — 점수 비율대로 배경음 4개를 섞는 믹서.
//
// Notion 설계 노트 §3 "함정 하나 — 전부 섞으면 색이 사라진다"의 사운드 버전.
// 4개 장르를 다 반영하면 탁한 회색이 되므로, 상위 2개 점수만 GainNode에
// 반영하고 나머지는 0으로 줄인다. 3D/조명보다 먼저 검증 가능한 항목이라
// lib/audio.js(방향성 이벤트음)와는 별도로 "장르별 연속 배경 루프 + 크로스페이드"만 다룬다.
//
// 실제 녹음/제작 음원이 없는 현재 단계라서 오실레이터로 합성한 placeholder 루프를 쓴다
// (README "현재 상태 / 알아둘 점"과 동일한 전제).

const GENRES = ["horror", "romance", "comedy", "fantasy"];
const VOICE_GAIN = 0.35; // 채널당 최대 게인 — 상위 2개가 동시에 켜져도 과하지 않게
const RAMP_SEC = 0.8; // 점수 변경 시 클릭 없이 부드럽게 크로스페이드

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

// 상위 2개만 남기고 나머지는 0으로 — "연출에는 상위 두 개만 반영한다" 규칙 그대로
function topTwoOnly(scores) {
  const entries = GENRES.map((g) => [g, clamp01(scores?.[g])]);
  entries.sort((a, b) => b[1] - a[1]);
  const kept = new Set(entries.slice(0, 2).map(([g]) => g));
  const out = {};
  entries.forEach(([g, v]) => {
    out[g] = kept.has(g) ? v : 0;
  });
  return out;
}

// 장르별 연속 루프. 전부 "오실레이터 + 트레몰로(LFO)"로 통일해 구조를 단순하게 유지하고,
// 파형/필터/트레몰로 속도로만 성격을 구분한다.
function makeDrone(ctx, genre) {
  const out = ctx.createGain();
  out.gain.value = 1;

  const timedNodes = []; // start()/stop() 호출이 필요한 노드(oscillator)

  function osc({ type, freq, detune = 0 }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    timedNodes.push(o);
    return o;
  }

  function tremolo(target, { rate, depth, base }) {
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = rate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = depth;
    target.gain.value = base;
    lfo.connect(lfoGain);
    lfoGain.connect(target.gain);
    timedNodes.push(lfo);
  }

  if (genre === "horror") {
    // 낮게 깔리는 웅웅거림 — 저역 두 개를 살짝 어긋나게 겹쳐 비트를 만든다
    const o1 = osc({ type: "sine", freq: 55 });
    const o2 = osc({ type: "sine", freq: 58 });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    const voiceGain = ctx.createGain();
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(voiceGain);
    tremolo(voiceGain, { rate: 0.12, depth: 0.15, base: 0.5 });
    voiceGain.connect(out);
  } else if (genre === "romance") {
    // 흐릿한 멜로디 — 3도 화음 + 저역통과로 부드럽게
    const o1 = osc({ type: "sine", freq: 220 });
    const o2 = osc({ type: "sine", freq: 277, detune: -6 });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1200;
    const voiceGain = ctx.createGain();
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(voiceGain);
    tremolo(voiceGain, { rate: 0.2, depth: 0.1, base: 0.55 });
    voiceGain.connect(out);
  } else if (genre === "comedy") {
    // 박자가 어긋난 경쾌한 반복 — 빠른 트레몰로 위에 느린 트레몰로를 겹쳐 박자를 흐트러뜨린다
    const o1 = osc({ type: "triangle", freq: 392 });
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500;
    bp.Q.value = 3;
    const voiceGain = ctx.createGain();
    o1.connect(bp);
    bp.connect(voiceGain);
    tremolo(voiceGain, { rate: 4.3, depth: 0.35, base: 0.45 });
    const secondaryGain = ctx.createGain();
    voiceGain.connect(secondaryGain);
    tremolo(secondaryGain, { rate: 0.9, depth: 0.25, base: 0.7 });
    secondaryGain.connect(out);
  } else if (genre === "fantasy") {
    // 울림이 긴 종소리 — 기본음 + 배음, 아주 느린 트레몰로로 서스테인을 흉내
    const o1 = osc({ type: "sine", freq: 660 });
    const o2 = osc({ type: "sine", freq: 1320, detune: 5 });
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 1.4;
    const voiceGain = ctx.createGain();
    o1.connect(bp);
    o2.connect(bp);
    bp.connect(voiceGain);
    tremolo(voiceGain, { rate: 0.08, depth: 0.2, base: 0.4 });
    voiceGain.connect(out);
  }

  return {
    out,
    start(when) {
      timedNodes.forEach((n) => n.start(when));
    },
    stop(when) {
      timedNodes.forEach((n) => {
        try {
          n.stop(when);
        } catch (e) {
          /* 이미 정지 */
        }
      });
    },
  };
}

/**
 * 장르 4개짜리 배경음 믹서를 만든다.
 * 오실레이터는 한 번 stop() 하면 재시작할 수 없으므로, stop() 이후 다시 켜려면
 * 호출자가 새 인스턴스를 만들어야 한다(컴포넌트 쪽에서 참조를 버리고 재생성).
 */
export function createMoodMixer(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const genreGains = {};
  const voices = {};

  GENRES.forEach((g) => {
    const genreGain = ctx.createGain();
    genreGain.gain.value = 0;
    genreGain.connect(master);
    genreGains[g] = genreGain;

    const voice = makeDrone(ctx, g);
    voice.out.connect(genreGain);
    voices[g] = voice;
  });

  let started = false;

  function start() {
    if (started) return;
    started = true;
    const now = ctx.currentTime;
    GENRES.forEach((g) => voices[g].start(now));
  }

  function stop() {
    if (!started) return;
    started = false;
    const now = ctx.currentTime;
    GENRES.forEach((g) => {
      genreGains[g].gain.cancelScheduledValues(now);
      genreGains[g].gain.setValueAtTime(0, now);
      voices[g].stop(now + 0.05);
    });
    master.disconnect();
  }

  /** 점수(0~1)를 받아 상위 2개만 게인에 반영한다. 적용된 점수를 반환한다. */
  function setScores(scores) {
    if (!started) return null;
    const applied = topTwoOnly(scores);
    const now = ctx.currentTime;
    GENRES.forEach((g) => {
      const target = applied[g] * VOICE_GAIN;
      const gainParam = genreGains[g].gain;
      gainParam.cancelScheduledValues(now);
      gainParam.setValueAtTime(gainParam.value, now);
      gainParam.linearRampToValueAtTime(target, now + RAMP_SEC);
    });
    return applied;
  }

  return { start, stop, setScores };
}

export const MOOD_GENRES = GENRES;
