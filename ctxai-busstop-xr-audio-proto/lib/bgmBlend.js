"use client";

// 실제 완성된 BGM 3트랙(bgm.H/R/C)을 연속 벡터 비율대로 겹쳐 튼다.
// lib/moodMix.js는 /verify 페이지용 합성 플레이스홀더 트랙을 다루는 별개
// 도구라 건드리지 않는다 — 이건 진짜 프로덕션 오디오 파일 전용이다.
// "다 섞으면 색이 사라진다" 규칙(moodMix.js와 동일 철학)에 따라 상위 2개만
// 재생한다. 근거: Bus/규격/구현_리스크와_지원_필요사항.md §4-5(실제 트랙이라
// 완전한 연속 블렌딩은 음악 감독 검증 전 — 상위 2개로 제한해 위험을 줄인다).

const GENRES = ["H", "R", "C"];
const MAX_GAIN = 0.32;
const RAMP_MS = 900;

function topTwo(scores) {
  const entries = GENRES.map((g) => [g, scores?.[g] || 0]);
  entries.sort((a, b) => b[1] - a[1]);
  const kept = new Set(entries.slice(0, 2).map(([g]) => g));
  const out = {};
  entries.forEach(([g, v]) => { out[g] = kept.has(g) ? v : 0; });
  const sum = out.H + out.R + out.C || 1;
  GENRES.forEach((g) => { out[g] = out[g] / sum; });
  return out;
}

function rampVolume(audio, target, ms) {
  const start = audio.volume;
  const startedAt = performance.now();
  function step() {
    const t = Math.min(1, (performance.now() - startedAt) / ms);
    audio.volume = start + (target - start) * t;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// audioRefs: { H, R, C } — 각 장르의 <audio> 엘리먼트 ref.current
export function startBgmBlend(audioRefs, scores) {
  const applied = topTwo(scores);
  GENRES.forEach((g) => {
    const el = audioRefs[g];
    if (!el) return;
    if (!el.src) el.src = `/api/assets/file/bgm.${g}`;
    el.loop = true;
    if (applied[g] > 0 && el.paused) el.play().catch(() => {});
    rampVolume(el, applied[g] * MAX_GAIN, RAMP_MS);
  });
  return applied;
}

export function stopBgmBlend(audioRefs) {
  GENRES.forEach((g) => audioRefs[g]?.pause());
}
