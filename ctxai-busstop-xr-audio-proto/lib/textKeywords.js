// 텍스트 채널 — 2026-08-22 갱신: 판정은 /api/mood(Claude Haiku 의미 분석)를
// 기본으로 쓴다. 처음엔 직접 만든 한국어 키워드 사전으로 점수를 매겼는데,
// 그 사전 자체가 말뭉치·연구 근거 없이 임의로 나열한 것이라는 지적을 받고
// 근거 있는 쪽(LLM이 문장 전체 의미로 판단 + 왜 그렇게 봤는지 reason까지 반환)
// 으로 바꿨다. 근거: Bus/규격/판정_기준.md §3.
//
// GENRE_KEYWORDS는 이제 점수를 만들지 않는다 — 디버그 화면에서 전사문 중
// "장르와 관련 있어 보이는 단어"를 눈에 띄게 표시만 하는 참고용이다.

export const GENRE_KEYWORDS = {
  H: ["무서", "소름", "이상", "수상", "섬뜩", "찜찜", "오싹", "귀신", "불안", "긴장"],
  R: ["좋", "설레", "기대", "예쁘", "다행", "따뜻", "편안", "반가", "행복", "사랑"],
  C: ["웃기", "황당", "헐", "어이없", "빡치", "어처구니", "실없", "웃겨"],
};

// 참고용 하이라이트만 — 판정에는 안 쓴다.
export function highlightKeywords(transcript) {
  const matched = { R: [], H: [], C: [] };
  if (!transcript) return matched;
  for (const [genre, words] of Object.entries(GENRE_KEYWORDS)) {
    for (const w of words) if (transcript.includes(w)) matched[genre].push(w);
  }
  return matched;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// /api/mood(4장르 의미 분석) 결과를 텍스트 채널의 점수로 쓴다.
// 판타지는 드롭됐으므로 나머지 세 장르로 재정규화한다.
export function scoresFromMoodApi(moodScores) {
  if (!moodScores) return null;
  const horror = moodScores.horror || 0;
  const romance = moodScores.romance || 0;
  const comedy = moodScores.comedy || 0;
  const sum = horror + romance + comedy;
  if (sum <= 0) return null;
  return { R: clamp01(romance / sum), H: clamp01(horror / sum), C: clamp01(comedy / sum) };
}
