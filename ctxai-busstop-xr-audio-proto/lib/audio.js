// 오디오 합성 유틸 — 실제 음원 미확보 상태의 "테스트 음원" 대체용.
// PannerNode(HRTF)로 실제 좌/우/전/후 방향 지각을 근사한다 (단순 StereoPanner보다 실제 스펙에 가까움).
// 실제 제작 단계(Reaper/Ableton 녹음 + Unity Resonance/Steam Audio)로 교체될 placeholder.

let ctxSingleton = null;

export function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!ctxSingleton) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctxSingleton = new Ctx();
  }
  if (ctxSingleton.state === "suspended") {
    ctxSingleton.resume();
  }
  return ctxSingleton;
}

function noiseBuffer(ctx, duration) {
  const size = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function makePanner(ctx, { x = 0, y = 0, z = 0 } = {}) {
  const panner = ctx.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 1;
  panner.maxDistance = 20;
  panner.rolloffFactor = 1;
  if (panner.positionX) {
    panner.positionX.setValueAtTime(x, ctx.currentTime);
    panner.positionY.setValueAtTime(y, ctx.currentTime);
    panner.positionZ.setValueAtTime(z, ctx.currentTime);
  } else {
    // Safari 구버전 폴백
    panner.setPosition(x, y, z);
  }
  return panner;
}

// 좌표계: 리스너 기준 forward = -Z, up = +Y, right = +X
// side whisper: 왼쪽 근접
export function sideWhisper(ctx) {
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 2.2);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1600;
  bp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  [0.3, 0.55, 0.9, 1.2, 1.5, 1.9, 2.2].forEach((t, i) => {
    g.gain.linearRampToValueAtTime(i % 2 === 0 ? 0.6 : 0.1, now + t);
  });
  g.gain.linearRampToValueAtTime(0, now + 2.2);
  const panner = makePanner(ctx, { x: -0.6, y: 0, z: 0 });
  src.connect(bp);
  bp.connect(g);
  g.connect(panner);
  panner.connect(ctx.destination);
  src.start(now);
  src.stop(now + 2.2);
}

// glass behind: 후면 유리 너머, 먹먹하게 감쇠
export function glassBehind(ctx) {
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 2.5);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, now);
  g.gain.linearRampToValueAtTime(0.15, now + 2.5);
  const panner = makePanner(ctx, { x: 0, y: 0, z: 2.2 });
  src.connect(lp);
  lp.connect(g);
  g.connect(panner);
  panner.connect(ctx.destination);
  src.start(now);
  src.stop(now + 2.5);
}

// head whisper: 150~165도 근접(거의 뒤, 살짝 왼쪽)
export function headWhisper(ctx) {
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 1.6);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2200;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.7, now + 0.15);
  g.gain.linearRampToValueAtTime(0, now + 1.5);
  const panner = makePanner(ctx, { x: -0.35, y: 0, z: 1.6 });
  src.connect(bp);
  bp.connect(g);
  g.connect(panner);
  panner.connect(ctx.destination);
  src.start(now);
  src.stop(now + 1.6);
}

// car pass: 왼쪽 → 오른쪽 이동 (+ 도플러 근사)
export function carPass(ctx) {
  const now = ctx.currentTime;
  const dur = 3.2;
  const o = ctx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(85, now);
  o.frequency.linearRampToValueAtTime(115, now + dur / 2);
  o.frequency.linearRampToValueAtTime(80, now + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, now);
  const panner = makePanner(ctx, { x: -4, y: 0, z: 0.5 });
  if (panner.positionX) {
    panner.positionX.setValueAtTime(-4, now);
    panner.positionX.linearRampToValueAtTime(4, now + dur);
  }
  o.connect(lp);
  lp.connect(g);
  g.connect(panner);
  panner.connect(ctx.destination);
  o.start(now);
  o.stop(now + dur);
}

// bus approach: 정면에서 점점 가까워짐 (저주파→타이어→브레이크→도어)
export function busApproach(ctx) {
  const now = ctx.currentTime;

  const rumble = ctx.createOscillator();
  rumble.type = "sine";
  rumble.frequency.value = 48;
  const rg = ctx.createGain();
  rg.gain.setValueAtTime(0, now);
  rg.gain.linearRampToValueAtTime(0.55, now + 1.6);
  rg.gain.linearRampToValueAtTime(0.25, now + 2.4);
  const rp = makePanner(ctx, { x: 0, y: 0, z: -8 });
  if (rp.positionZ) rp.positionZ.linearRampToValueAtTime(-2, now + 2.4);
  rumble.connect(rg);
  rg.connect(rp);
  rp.connect(ctx.destination);
  rumble.start(now);
  rumble.stop(now + 2.6);

  const tire = ctx.createBufferSource();
  tire.buffer = noiseBuffer(ctx, 2.0);
  const tf = ctx.createBiquadFilter();
  tf.type = "bandpass";
  tf.frequency.value = 900;
  tf.Q.value = 0.6;
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0, now + 0.8);
  tg.gain.linearRampToValueAtTime(0.3, now + 1.8);
  tg.gain.linearRampToValueAtTime(0.08, now + 2.6);
  const tp = makePanner(ctx, { x: 0, y: 0, z: -4 });
  if (tp.positionZ) tp.positionZ.linearRampToValueAtTime(-1.5, now + 2.6);
  tire.connect(tf);
  tf.connect(tg);
  tg.connect(tp);
  tp.connect(ctx.destination);
  tire.start(now + 0.8);
  tire.stop(now + 2.8);

  const brake = ctx.createOscillator();
  brake.type = "sawtooth";
  brake.frequency.setValueAtTime(2600, now + 2.4);
  brake.frequency.linearRampToValueAtTime(2100, now + 2.9);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0, now + 2.4);
  bg.gain.linearRampToValueAtTime(0.12, now + 2.5);
  bg.gain.linearRampToValueAtTime(0, now + 2.95);
  const bp2 = makePanner(ctx, { x: 0, y: 0, z: -1.2 });
  brake.connect(bg);
  bg.connect(bp2);
  bp2.connect(ctx.destination);
  brake.start(now + 2.4);
  brake.stop(now + 3.0);

  const door = ctx.createBufferSource();
  door.buffer = noiseBuffer(ctx, 0.6);
  const dhp = ctx.createBiquadFilter();
  dhp.type = "highpass";
  dhp.frequency.value = 3000;
  const dg = ctx.createGain();
  dg.gain.setValueAtTime(0.4, now + 3.0);
  dg.gain.linearRampToValueAtTime(0, now + 3.5);
  const dp = makePanner(ctx, { x: 0, y: 0, z: -1 });
  door.connect(dhp);
  dhp.connect(dg);
  dg.connect(dp);
  dp.connect(ctx.destination);
  door.start(now + 3.0);
  door.stop(now + 3.6);
}

// 환경 앰비언스: 방향성 없는 배경 (분리된 버스)
let ambSources = [];
export function ambience(ctx) {
  ambSources.forEach((s) => {
    try {
      s.stop();
    } catch (e) {}
  });
  ambSources = [];
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 3.5);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 700;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.12, now);
  g.gain.linearRampToValueAtTime(0.05, now + 3.5);
  src.connect(lp);
  lp.connect(g);
  g.connect(ctx.destination);
  src.start(now);
  src.stop(now + 3.5);
  ambSources.push(src);
}

// 미확정 트랙(스릴러/코미디/로맨스/멜로)용 무드 프리뷰 톤
export function moodPreview(ctx, freqs = [220, 277, 330]) {
  const now = ctx.currentTime;
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = i === 0 ? "sine" : "triangle";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.08, now + 0.4);
    g.gain.linearRampToValueAtTime(0, now + 2.6);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(now);
    o.stop(now + 2.7);
  });
}

export const players = {
  sideWhisper,
  glassBehind,
  headWhisper,
  carPass,
  busApproach,
  ambience,
};
