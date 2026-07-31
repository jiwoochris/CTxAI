// 로맨스 트랙 5분 슬라이스 — "작가·감독이 고정하는 것"
// 소개서 v0.3 §8(로맨스 무대), §11(경계형 즉흥연기) 기준.
//
// 이 파일에는 사람이 고정하는 것만 담는다: 절대 타임라인, 필수 사건,
// 공개 가능한 정보의 순서, 버스 도착 시점, 마지막 엔딩.
// 관객 반응에 따른 변주 로직은 dialogueEngine.js 를 참고.
//
// 캐릭터는 의도적으로 이름·성별을 정하지 않았다. 소개서가 "각 장르의 구체적
// 캐릭터와 줄거리는 팀 논의를 통해 결정"(OPEN)으로 남겨둔 항목이므로,
// 프로토타입 단계에서 캐스팅을 선점하지 않는다. 한국어 존댓말은 성별
// 표지 없이 5분 대화가 성립하므로 그대로 검증 가능하다.

export const TOTAL_SEC = 300; // 5분

// ─────────────────────────────────────────────────────────────
// 절대 타임라인 — 관객이 무엇을 하든 이 순서와 시점은 바뀌지 않는다.
// ─────────────────────────────────────────────────────────────
export const STAGES = [
  {
    id: "seated",
    label: "착석",
    at: 0,
    note: "비가 갠 교외 저녁. 젖은 도로와 맞은편 상점의 생활음만 있다.",
  },
  {
    id: "first_presence",
    label: "첫 기척",
    at: 12,
    note: "옆자리에 누가 앉는다. 벤치 눌림 → 옷 마찰 → 숨. 아직 말은 없다.",
  },
  {
    id: "first_talk",
    label: "첫 대화",
    at: 26,
    note: "인물이 먼저 말을 건다. (고정 녹음 구간)",
  },
  {
    id: "rapport",
    label: "관계 형성",
    at: 70,
    note: "일상 대화. 관객의 반응에 따라 신뢰도가 움직인다.",
  },
  {
    id: "reveal",
    label: "정보 공개",
    at: 140,
    note: "오늘 무슨 일이 있었다는 기색이 드러난다. 공개 단계가 열린다.",
  },
  {
    id: "genre_event",
    label: "장르 사건",
    at: 210,
    note: "맞은편 카페 문이 열리고 음악이 새어나온다. 인물이 관객 쪽으로 조금 다가와 앉는다.",
  },
  {
    id: "bus_approach",
    label: "버스 접근",
    at: 260,
    note: "새 비밀을 열지 않는다. 모든 대화가 이별로 수렴한다.",
  },
  {
    id: "return",
    label: "현실 귀환",
    at: 290,
    note: "버스가 정차하고 앞문이 열린다. 가상세계가 종료된다.",
  },
];

// 공개 단계 — 대화가 자연스럽더라도 예정된 시점 전에는 핵심 비밀을 말하지 않는다.
export const REVEAL_GATES = [
  { level: 1, minStage: "reveal", minTrust: 35, minSec: 140, desc: "오늘 무슨 일이 있었음 · 목적지 미정" },
  { level: 2, minStage: "reveal", minTrust: 55, minSec: 175, desc: "관계를 끝내고 떠나는 중임을 일부 암시" },
  { level: 3, minStage: "genre_event", minTrust: 70, minSec: 210, desc: "떠나는 이유를 한 문장만 — 끝까지 말하지는 않음" },
];

// 버스 접근 이후에는 공개 단계가 동결된다. (소개서 §11 예시 표의 마지막 행)
export const REVEAL_FREEZE_SEC = 260;

// ─────────────────────────────────────────────────────────────
// 사운드 큐 — 소개서 §10 "반드시 구현해야 할 사운드 장면" 중
// 로맨스 트랙에 해당하는 것들.
// ─────────────────────────────────────────────────────────────
export const CUES = [
  { at: 0, id: "ambience", desc: "젖은 도로 · 맞은편 생활음 (환경 앰비언트)" },
  { at: 6, id: "carPass", desc: "차량 좌→우 통과" },
  { at: 12, id: "benchSit", desc: "옆자리 벤치 눌림 → 옷 마찰 → 숨 (오른쪽 0.55m)" },
  { at: 48, id: "cafeBell", desc: "맞은편 카페 문 종 (전방 좌측, 12m)" },
  { at: 96, id: "carPass", desc: "차량 좌→우 통과" },
  { at: 150, id: "rainDrip", desc: "정류장 처마의 물방울 (머리 위 후방)" },
  { at: 210, id: "cafeOpen", desc: "카페 문 열림 + 음악 누출 / 인물이 0.55m → 0.42m 로 이동" },
  { at: 244, id: "carPass", desc: "차량 좌→우 통과" },
  { at: 262, id: "busApproach", desc: "먼 저주파 → 타이어 → 브레이크 → 공압문" },
];

// ─────────────────────────────────────────────────────────────
// 응답 규칙 — AI 에게 열어두는 변주의 범위.
// 각 규칙은 (현재 단계 × 관객 의도 × 상태 조건) 에 매칭되고,
// lines 중 하나가 선택된다. 같은 회차에 같은 대사가 반복되지 않도록
// dialogueEngine 이 사용 이력을 관리한다.
//
// 대사에 붙는 태그는 소개서 §11 "AI 는 1~2문장의 짧은 대사와 함께
// 감정·시선·자세·소품 행동에 필요한 태그를 반환한다" 를 그대로 따른다.
// ─────────────────────────────────────────────────────────────

const L = (text, emotion, gaze, posture, trust = 0) => ({ text, emotion, gaze, posture, trust });

export const RULES = [
  // ── 첫 대화 (고정 녹음 구간) ────────────────────────────────
  {
    id: "first_talk.opening",
    stage: ["first_talk"],
    intent: ["*"],
    fixed: true, // 성우 고정 녹음 권장 구간
    priority: 100,
    once: true,
    lines: [L("이 버스… 원래 이렇게 자주 늦어요?", "조심스러움", "전광판", "무릎에 손", 0)],
  },

  // ── 소개서 §11 예시 표를 그대로 구현한 규칙들 ────────────────
  {
    id: "rapport.also_first_time",
    stage: ["first_talk", "rapport"],
    intent: ["confession", "empathy"],
    when: (s) => /처음|저도|나도|잘 모르|모르겠/.test(s.lastUtterance),
    priority: 90,
    once: true,
    lines: [L("그럼 둘 다 잘못 온 걸 수도 있겠네요.", "가벼운 웃음", "관객", "몸 살짝 돌림", 6)],
  },
  {
    id: "first_talk.silence",
    stage: ["first_talk"],
    intent: ["silence"],
    priority: 90,
    once: true,
    lines: [L("괜히 물었네요.", "머쓱함", "전광판으로 회피", "가방끈 만짐", 0)],
  },
  {
    id: "reveal.crying_noticed",
    stage: ["reveal", "genre_event"],
    intent: ["question", "empathy"],
    when: (s) => /울|눈|괜찮|무슨 일|힘든|슬퍼/.test(s.lastUtterance),
    priority: 95,
    // once 를 걸지 않는다. 대답을 피했으면 관객이 다시 물을 수 있고,
    // 그 사이 신뢰도가 올라갔다면 같은 질문이 다른 곳에 착지해야 한다.
    lines: [
      // 같은 질문이 신뢰도에 따라 완전히 다르게 착지한다.
      L("처음 본 사람한테 그런 걸 물어요?", "방어", "정면 도로", "몸 반대로 틀기", -4),
      L("티 나요? 오늘 좀 일이 있었어요.", "체념 섞인 웃음", "관객", "어깨 내려감", 8),
    ],
    pick: (s) => (s.trust >= 50 ? 1 : 0),
  },
  {
    id: "reveal.destination",
    stage: ["reveal", "genre_event"],
    intent: ["question"],
    when: (s) => /어디|목적지|가세요|가시는|어느/.test(s.lastUtterance),
    priority: 95,
    lines: [
      L("아직 안 정했어요.", "회피", "노선표", "표를 만지작", 0),
      L("일단 여기서 제일 멀리 가는 걸 타려고요.", "담담함", "먼 도로", "가방을 끌어안음", 4),
      L("돌아올 생각은 안 해봤어요. 그게 이상한가요?", "조심스러운 고백", "관객", "정면으로 앉음", 6),
    ],
    pick: (s) => Math.min(s.revealLevel, 2),
  },
  {
    id: "bus.converge",
    stage: ["bus_approach", "return"],
    intent: ["*"],
    priority: 99,
    lines: [
      L("버스 오네요. 이상하게 오늘은 금방 갔어요.", "아쉬움", "버스 방향", "일어날 준비", 0),
      L("이 얘기, 아무한테도 안 했었는데.", "옅은 웃음", "관객", "가방을 어깨에", 0),
      L("먼저 가요. 다음 버스는 안 늦었으면 좋겠네요.", "이별", "관객 → 버스", "일어섬", 0),
    ],
  },

  // ── 일반 변주 ──────────────────────────────────────────────
  {
    id: "any.empathy",
    stage: ["rapport", "reveal", "genre_event"],
    intent: ["empathy"],
    priority: 50,
    lines: [
      L("그렇게 말해주는 사람 오랜만이에요.", "놀람", "관객", "몸 기울임", 8),
      L("…네. 그런 것 같아요.", "안도", "발끝", "어깨 풀림", 6),
      L("듣고 있으니까 좀 낫네요.", "옅은 미소", "관객", "손 풀림", 7),
    ],
  },
  {
    id: "any.confession",
    stage: ["rapport", "reveal", "genre_event"],
    intent: ["confession"],
    priority: 55,
    lines: [
      L("그런 얘기를 저한테 해줘도 돼요?", "조심스러움", "관객", "몸 돌림", 10),
      L("비슷하네요, 우리.", "쓸쓸한 웃음", "정면 도로", "나란히 앉은 자세", 9),
    ],
  },
  {
    id: "any.question",
    stage: ["rapport", "reveal", "genre_event"],
    intent: ["question"],
    priority: 40,
    lines: [
      L("음… 왜 그런 게 궁금해요?", "경계", "관객", "가방 고쳐 안기", 2),
      L("그건 좀 긴 얘긴데, 버스가 늦으면 말해줄게요.", "여유", "전광판", "등을 기댐", 5),
      L("저보다 저쪽 꽃집이 더 재밌을 텐데요.", "농담으로 회피", "맞은편", "손으로 가리킴", 3),
    ],
  },
  {
    id: "any.joke",
    stage: ["rapport", "reveal", "genre_event"],
    intent: ["joke"],
    priority: 45,
    lines: [
      L("웃겨요, 진짜.", "소리 내어 웃음", "관객", "어깨 흔들림", 5),
      L("이런 데서 웃을 일이 생기다니.", "의외", "관객", "몸 기울임", 6),
    ],
  },
  {
    id: "any.advice",
    stage: ["rapport", "reveal", "genre_event"],
    intent: ["advice"],
    priority: 42,
    lines: [
      L("생각해볼게요. 지금은 그게 최선인 것 같고.", "수용", "발끝", "고개 끄덕", 3),
      L("그렇게 간단하면 여기 앉아 있지도 않았겠죠.", "씁쓸함", "정면 도로", "몸 굳음", -2),
    ],
  },
  {
    id: "any.refusal",
    stage: ["*"],
    intent: ["refusal"],
    priority: 60,
    lines: [
      L("네, 알겠어요. 조용히 있을게요.", "물러섬", "전광판", "몸 반대로 틀기", -6),
      L("…미안해요. 제가 말이 많았네요.", "위축", "발끝", "가방으로 벽 만듦", -4),
    ],
  },
  {
    id: "any.aggression",
    stage: ["*"],
    intent: ["aggression"],
    priority: 70,
    lines: [
      L("왜 그렇게까지 말해요?", "상처", "관객 직시", "몸 굳음", -14),
      L("…그만 할게요.", "닫힘", "정면 도로", "완전히 등돌림", -18),
    ],
  },
  {
    id: "any.silence",
    stage: ["rapport", "reveal", "genre_event"],
    intent: ["silence"],
    priority: 30,
    lines: [
      // 침묵은 실패가 아니라 연출이다. 거리를 유지하되 대화의 문은 닫지 않는다.
      L("(들숨) …비 그친 다음이 제일 조용하죠.", "혼잣말", "젖은 도로", "고개 젖힘", 0),
      L("아, 저 꽃집 아직 열었네요.", "화제 전환", "맞은편", "손으로 가리킴", 1),
      L("…불편하면 말 안 걸게요.", "조심스러움", "관객 흘끔", "몸 살짝 뺌", -1),
    ],
  },
  {
    id: "any.unknown",
    stage: ["*"],
    intent: ["unknown"],
    priority: 20,
    lines: [
      // 한 번만 자연스럽게 되묻고, 다시 실패하면 SILENCE 로 처리한다.
      L("네? 버스 소리에 못 들었어요.", "되묻기", "관객", "몸 기울임", 0),
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// 폴백 — 네트워크·AI 응답 실패 시 미리 녹음한 브리지 대사.
// 5분 타이머, 핵심 사건, 버스 접근과 엔딩은 로컬에서 계속 실행된다.
// ─────────────────────────────────────────────────────────────
export const BRIDGE_LINES = [
  L("(고개를 끄덕인다)", "수긍", "관객", "고개 끄덕", 0),
  L("…음.", "생각 중", "발끝", "손을 모음", 0),
  L("(들숨) 그렇구나.", "여운", "정면 도로", "어깨 내려감", 0),
  L("잠깐만요, 저 버스인가.", "주의 전환", "도로 좌측", "몸 앞으로", 0),
];

// 응답 지연 중 먼저 발생하는 비언어 연기 (200ms 이내)
export const NONVERBAL_BEATS = [
  "눈을 맞춘다",
  "짧게 들숨",
  "고개를 살짝 기울인다",
  "가방끈을 만진다",
  "입을 떼려다 멈춘다",
];

export function stageAt(sec) {
  let cur = STAGES[0];
  for (const s of STAGES) if (sec >= s.at) cur = s;
  return cur;
}

export function stageIndex(id) {
  return STAGES.findIndex((s) => s.id === id);
}
