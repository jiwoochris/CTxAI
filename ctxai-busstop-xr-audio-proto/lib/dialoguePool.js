// 대사 풀 근접 매칭 — scripts/gen-dialogue-pool.mjs 가 만든 변주 중 지금 연출 상태에
// 가장 가까운 것을 고른다. 대사 텍스트는 "70% A문장 + 30% B문장"처럼 섞을 수 없으므로
// (구현_리스크와_지원_필요사항.md §4-1), 배합 지점마다 미리 써 둔 변주를 고르는 방식이
// 실시간 LLM 없이 대사가 상태를 따르게 하는 유일한 길이다.
//
// 풀 구조: 인물 G(앉은 사람)의 각 줄마다 base(원문) + 보조 장르별 변주 S∈{나머지 둘}.
// 선택 규칙: 보조 장르 비중 w2 가 TINT_THRESHOLD 이상이면 그 장르의 변주, 아니면 원문.
// 한 줄 한 줄 재생 직전에 판단하므로, 장면 중간에 관객 반응이 바뀌면 다음 줄부터 어법이 바뀐다.

export const POOL_URL = "/reactive/audio/pool/manifest.json";
export const TINT_THRESHOLD = 0.3;

let cache = null;

export async function loadDialoguePool() {
  if (cache) return cache;
  try {
    const r = await fetch(POOL_URL, { cache: "no-store" });
    if (!r.ok) return (cache = { ok: false, lines: [] });
    const j = await r.json();
    cache = { ok: true, voices: j.voices || {}, lines: j.lines || [] };
  } catch {
    cache = { ok: false, lines: [] };
  }
  return cache;
}

/**
 * @param {object} pool   loadDialoguePool() 결과
 * @param {string} genre  앉은 인물 R/H/C
 * @param {string} seq    대사 순번 "01"…
 * @param {{R:number,H:number,C:number}} scores 현재 연출 상태
 * @returns {{file:string, text:string, secondary:string|null, weight:number}|null}
 */
export function pickPoolLine(pool, genre, seq, scores) {
  if (!pool?.ok) return null;
  const others = ["R", "H", "C"].filter((g) => g !== genre);
  const [s2, w2] = others.map((g) => [g, scores?.[g] || 0]).sort((a, b) => b[1] - a[1])[0];
  const want = w2 >= TINT_THRESHOLD ? s2 : "base";
  const hit = pool.lines.find((l) => l.genre === genre && l.seq === seq && l.secondary === want)
    || pool.lines.find((l) => l.genre === genre && l.seq === seq && l.secondary === "base");
  if (!hit) return null;
  return { file: `/reactive/audio/pool/${hit.file}`, text: hit.text, secondary: hit.secondary === "base" ? null : hit.secondary, weight: w2 };
}

export function poolCoverage(pool, genre) {
  if (!pool?.ok) return { base: 0, tinted: 0 };
  const mine = pool.lines.filter((l) => l.genre === genre);
  return { base: mine.filter((l) => l.secondary === "base").length, tinted: mine.filter((l) => l.secondary !== "base").length };
}
