// 오디오 측정 — 브라우저 전용.
//
// 사운드가 손으로 재던 값(integrated LUFS · 트루 피크 · 길이)을
// 업로드하는 순간 브라우저가 대신 잽니다. 서버에 ffmpeg 을 두지 않아도 됩니다.
//
// LUFS 는 ITU-R BS.1770-4 를 따릅니다 — K-가중 → 400ms 블록(75% 겹침)
// → 절대 게이트(−70 LUFS) → 상대 게이트(−10 LU).
//
// ⚠️ 트루 피크는 4배 오버샘플 근사입니다. 규격서의 폴리페이즈 FIR 이 아니라
//    Catmull-Rom 보간이라 실제보다 0.1~0.3 dB 낮게 나올 수 있습니다.
//    D7 이 「목표로만 두고 못 맞춰도 그대로」라 이 정밀도로 충분합니다.

const RATE = 48000; // BS.1770 계수가 48kHz 기준이라 여기로 맞춰 리샘플한다

// K-가중 — BS.1770-4 표 1·2 (48kHz)
const SHELF = {
  b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
  a: [1.0, -1.69065929318241, 0.73248077421585],
};
const HPF = {
  b: [1.0, -2.0, 1.0],
  a: [1.0, -1.99004745483398, 0.99007225036621],
};

const BLOCK_SEC = 0.4;
const STEP_SEC = 0.1;
const ABS_GATE = -70.0;
const REL_GATE = -10.0;

function dbfs(x) {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

/** 48kHz 로 리샘플하면서 K-가중을 건 버퍼를 만든다. */
async function kWeighted(buffer) {
  const frames = Math.ceil((buffer.duration || 0) * RATE);
  if (!frames) return null;

  const ctx = new OfflineAudioContext(buffer.numberOfChannels, frames, RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const shelf = ctx.createIIRFilter(SHELF.b, SHELF.a);
  const hpf = ctx.createIIRFilter(HPF.b, HPF.a);

  src.connect(shelf).connect(hpf).connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/** 게이팅까지 적용한 integrated loudness. */
function integratedLoudness(weighted) {
  const chans = [];
  for (let c = 0; c < weighted.numberOfChannels; c++) chans.push(weighted.getChannelData(c));

  const blockLen = Math.round(BLOCK_SEC * RATE);
  const stepLen = Math.round(STEP_SEC * RATE);
  if (chans[0].length < blockLen) return null; // 400ms 보다 짧으면 잴 수 없다

  // 블록별 평균제곱 합 (채널 가중은 모노·스테레오 모두 1.0)
  const blocks = [];
  for (let start = 0; start + blockLen <= chans[0].length; start += stepLen) {
    let sum = 0;
    for (const d of chans) {
      let s = 0;
      for (let i = start; i < start + blockLen; i++) s += d[i] * d[i];
      sum += s / blockLen;
    }
    blocks.push({ z: sum, l: -0.691 + 10 * Math.log10(sum || 1e-20) });
  }
  if (!blocks.length) return null;

  // 절대 게이트
  const pass1 = blocks.filter((b) => b.l > ABS_GATE);
  if (!pass1.length) return null;

  // 상대 게이트 — 통과한 블록들의 평균에서 10 LU 아래
  const meanZ1 = pass1.reduce((s, b) => s + b.z, 0) / pass1.length;
  const relative = -0.691 + 10 * Math.log10(meanZ1 || 1e-20) + REL_GATE;

  const pass2 = pass1.filter((b) => b.l > relative);
  const use = pass2.length ? pass2 : pass1;
  const meanZ2 = use.reduce((s, b) => s + b.z, 0) / use.length;

  return -0.691 + 10 * Math.log10(meanZ2 || 1e-20);
}

/** 4배 오버샘플 근사 트루 피크 (Catmull-Rom). */
function truePeak(buffer) {
  let peak = 0;
  let samplePeak = 0;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > samplePeak) samplePeak = a;

      const p0 = d[i - 1] ?? d[i];
      const p1 = d[i];
      const p2 = d[i + 1] ?? d[i];
      const p3 = d[i + 2] ?? p2;
      for (let k = 1; k < 4; k++) {
        const t = k / 4;
        const v = 0.5 * (
          2 * p1 +
          (-p0 + p2) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
        );
        const av = Math.abs(v);
        if (av > peak) peak = av;
      }
    }
  }
  return { truePeakDb: dbfs(Math.max(peak, samplePeak)), samplePeakDb: dbfs(samplePeak) };
}

/** 루프 이음새 — 시작과 끝 20ms 의 차이. 크면 「툭」 하는 소리가 납니다. */
function loopSeam(buffer) {
  const n = Math.min(Math.round(0.02 * buffer.sampleRate), Math.floor(buffer.length / 4));
  if (n < 8) return null;
  let head = 0, tail = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      head += d[i] * d[i];
      tail += d[d.length - n + i] * d[d.length - n + i];
    }
  }
  const h = Math.sqrt(head / (n * buffer.numberOfChannels));
  const t = Math.sqrt(tail / (n * buffer.numberOfChannels));
  return { headRmsDb: dbfs(h), tailRmsDb: dbfs(t), gapDb: Math.abs(dbfs(h) - dbfs(t)) };
}

/**
 * 파일 하나를 측정한다. 실패해도 던지지 않고 error 를 담아 돌려준다 —
 * 측정이 안 된다고 업로드가 막히면 안 되기 때문입니다.
 */
export async function measureAudio(file) {
  const out = { kind: "audio" };
  try {
    const bytes = await file.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    ctx.close();

    out.durationSec = Math.round(buffer.duration * 1000) / 1000;
    out.sampleRate = buffer.sampleRate;
    out.channels = buffer.numberOfChannels;

    const tp = truePeak(buffer);
    out.truePeakDb = Math.round(tp.truePeakDb * 10) / 10;
    out.samplePeakDb = Math.round(tp.samplePeakDb * 10) / 10;
    out.truePeakApprox = true;

    const seam = loopSeam(buffer);
    if (seam) out.loopSeamGapDb = Math.round(seam.gapDb * 10) / 10;

    const weighted = await kWeighted(buffer);
    const lufs = weighted ? integratedLoudness(weighted) : null;
    out.lufsIntegrated = lufs === null ? null : Math.round(lufs * 10) / 10;
  } catch (e) {
    out.error = e?.message || String(e);
  }
  return out;
}
