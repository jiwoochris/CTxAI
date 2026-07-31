// 편집·사운드 증명용 컷 리스트 — "그림·목소리는 그대로 두고, 편집 리듬과
// 사운드만으로 감정이 생기는가"를 검증하는 85초 시퀀스.
//
// RomanceSlice(5분 인터랙티브)와는 목적이 다르다. 이건 비인터랙티브 선형
// 재생이고, 상태머신 없이 정해진 컷을 정해진 타이밍에 그대로 재생한다.
// 그림은 회색 카드(샷 타입·설명)로 대체하고, 목소리는 기존 시스템 TTS(유나),
// 사운드는 기존 romanceAudio.js 의 절차적 신스를 그대로 재사용한다.
//
// 8·12·16번 뒤에 오는 블랙 프레임(0.3초)이 핵심 장치다. 디졸브 없이
// 하드컷으로 시간을 점프시켜, 그림 없이도 "시간이 지났다"를 전달한다.

export const SHOTS = [
  {
    id: 1,
    type: "WS",
    label: "정류장 전경, 비 갠 저녁",
    dur: 4.0,
    cue: "ambience",
  },
  {
    id: 2,
    type: "INSERT",
    label: "젖은 아스팔트 반사",
    dur: 1.5,
    cue: "carPass",
  },
  {
    id: 3,
    type: "OTS",
    label: "빈 옆자리 — 정적",
    dur: 3.0,
  },
  {
    id: 4,
    type: "MS",
    label: "인물이 들어와 앉는다",
    dur: 2.5,
    cue: "benchSit",
  },
  {
    id: 5,
    type: "CU",
    label: "인물 옆얼굴, 침묵 유지",
    dur: 2.0,
  },
  {
    id: 6,
    type: "OTS",
    label: "고개를 돌려 첫 대사",
    dur: 3.5,
    line: { text: "이 버스… 원래 이렇게 자주 늦어요?", emotion: "조심스러움" },
  },
  {
    id: 7,
    type: "INSERT",
    label: "전광판 반복 문구",
    dur: 1.5,
  },
  { id: 8, type: "BLACK", label: "시간 점프", dur: 0.3 },
  {
    id: 9,
    type: "INSERT",
    label: "카페 창에 처음 불빛",
    dur: 2.0,
    cue: "cafeBell",
  },
  {
    id: 10,
    type: "CU",
    label: "인물 옅은 웃음",
    dur: 2.5,
    line: { text: "그럼 둘 다 잘못 온 걸 수도 있겠네요.", emotion: "가벼운 웃음" },
  },
  {
    id: 11,
    type: "MS",
    label: "침묵을 견디는 인물",
    dur: 3.0,
    line: { text: "…비 그친 다음이 제일 조용하죠.", emotion: "혼잣말" },
  },
  { id: 12, type: "BLACK", label: "시간 점프", dur: 0.3 },
  {
    id: 13,
    type: "INSERT",
    label: "카페 문이 열리고 음악이 새어나온다",
    dur: 2.0,
    cue: "cafeOpen",
  },
  {
    id: 14,
    type: "OTS",
    label: "인물이 조금 다가와 앉는다",
    dur: 3.0,
  },
  {
    id: 15,
    type: "CU",
    label: "조심스러운 고백",
    dur: 2.5,
    line: { text: "이 얘기, 아무한테도 안 했었는데.", emotion: "옅은 웃음" },
  },
  { id: 16, type: "BLACK", label: "시간 점프", dur: 0.3 },
  {
    id: 17,
    type: "WS",
    label: "먼 헤드라이트가 나타난다",
    dur: 3.0,
    cue: "busApproach",
  },
  {
    id: 18,
    type: "OTS",
    label: "버스가 다가온다 — 정적이 흐른다",
    dur: 4.0,
  },
  {
    id: 19,
    type: "INSERT",
    label: "공압문이 열리고 빛이 쏟아진다",
    dur: 2.0,
    cue: "busDoor",
    line: { text: "먼저 가요. 다음 버스는 안 늦었으면 좋겠네요.", emotion: "이별" },
  },
  { id: 20, type: "WHITEOUT", label: "", dur: 2.5 },
];

export const TOTAL_SEC = SHOTS.reduce((s, sh) => s + sh.dur, 0);

export function shotAt(sec) {
  let acc = 0;
  for (const s of SHOTS) {
    if (sec < acc + s.dur) return { shot: s, elapsedInShot: sec - acc, index: SHOTS.indexOf(s) };
    acc += s.dur;
  }
  return { shot: SHOTS[SHOTS.length - 1], elapsedInShot: 0, index: SHOTS.length - 1 };
}

export function shotStartTimes() {
  const starts = [];
  let acc = 0;
  for (const s of SHOTS) {
    starts.push(acc);
    acc += s.dur;
  }
  return starts;
}
