// 경계형 즉흥연기 엔진 — 소개서 v0.3 §11 구현
//
// "대화는 '분기 대본'보다 '상태'로 관리한다."
// 관객이 할 수 있는 말을 전부 예상하는 대신, 현재 장면과 캐릭터의 상태를
// 숫자와 단계로 들고 있다가, 지금 상태에서 말할 수 있는 범위 안에서만 응답한다.
//
// 이 파일은 플랫폼 독립적이다. WebXR 로 가든 네이티브 Android XR 로 가든
// 그대로 이식된다. 프로토타입에서 가장 오래 남는 자산.
//
// 현재 응답 생성은 규칙 기반 변주 뱅크(romanceScript.RULES)를 쓴다.
// 실제 LLM 을 붙이는 자리는 generateReply() 한 곳이며, 시그니처를 유지하면
// 나머지 상태 관리는 손대지 않아도 된다.

import {
  RULES,
  BRIDGE_LINES,
  REVEAL_GATES,
  REVEAL_FREEZE_SEC,
  TOTAL_SEC,
  stageAt,
  stageIndex,
} from "./romanceScript";

// ─────────────────────────────────────────────────────────────
// last_user_intent — 관객의 최근 반응 분류
// 실제 구현에서는 STT 결과를 소형 분류기나 LLM 으로 넘긴다.
// 여기서는 한국어 표층 패턴만으로 근사한다. 프로토타입 목적상
// "관객이 말을 거는가 / 5분이 성립하는가" 검증에는 충분하다.
// ─────────────────────────────────────────────────────────────

const PATTERNS = [
  ["aggression", /짜증|됐어|됐고|꺼져|시끄|닥쳐|귀찮|무슨 상관|상관없|이상한 사람|왜 그런 걸/],
  ["refusal", /싫어|싫은|말하고 싶지|관심\s*없|하지\s*마|그만|아뇨|아니요|별로|됐습니다/],
  ["joke", /ㅋㅋ|ㅎㅎ|농담|웃기|웃겨|드립|풉/],
  [
    "confession",
    /(저도|나도|제가|저는|나는|사실).*(힘들|외로|그랬|울|헤어|이별|떠나|그만|처음|모르)|힘들었어|외로웠|헤어졌|이별했|퇴사|그만뒀/,
  ],
  ["empathy", /그렇겠|그랬겠|맞아|그러네|이해|괜찮아|힘들었|고생|안타|안됐|위로|토닥/],
  ["advice", /해봐|해보세요|하세요|하는\s*게|좋을\s*것|좋겠어|추천|타보|가보/],
  ["question", /[?？]|까요|나요|인가요|어디|왜|뭐|무슨|언제|누구|어떻게|얼마|맞아요|있어요$/],
];

export function classifyIntent(raw) {
  const text = (raw || "").trim();
  if (!text) return "silence";
  // 의미를 담기 어려운 길이 — 되묻기 대상
  if (text.replace(/[^가-힣a-zA-Z0-9]/g, "").length < 2) return "unknown";

  for (const [intent, re] of PATTERNS) {
    if (re.test(text)) return intent;
  }
  // 분류되지 않았지만 문장 형태는 갖춘 발화 = 관심 표명으로 본다
  return text.length >= 4 ? "interest" : "unknown";
}

export const INTENT_LABEL = {
  interest: "관심",
  question: "질문",
  advice: "조언",
  joke: "농담",
  refusal: "거절",
  aggression: "공격",
  confession: "자기 고백",
  empathy: "공감",
  silence: "침묵",
  unknown: "불명확",
  idle: "(인물 주도)",
};

// ─────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────

export function initialState() {
  return {
    sceneState: "seated",
    trust: 20, //  0~100 · 관심·배려·자기 경험 공유로 상승, 캐묻기·공격으로 하락
    revealLevel: 0, //  0~3 · 지금까지 공개해도 되는 정보 단계
    tension: 10, //  0~100 · 로맨스 트랙에서는 정서적 압력
    timeRemaining: TOTAL_SEC,
    lastUserIntent: null,
    lastUtterance: "",
    turn: 0,
    questionStreak: 0, // 연속 캐묻기 — 신뢰도를 깎는다
    unknownStreak: 0,
    firedOnce: {},
    usedLines: {},
    revealFrozen: false,
  };
}

const TRUST_BY_INTENT = {
  empathy: 8,
  confession: 10,
  interest: 4,
  question: 2,
  joke: 3,
  advice: 2,
  refusal: -6,
  aggression: -14,
  silence: -1,
  unknown: 0,
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 공개 단계 게이트 — 단계·신뢰도·경과시간을 모두 만족해야 열린다.
function nextRevealLevel(state, elapsed) {
  if (elapsed >= REVEAL_FREEZE_SEC) return state.revealLevel; // 버스 접근 후 동결
  let level = state.revealLevel;
  for (const gate of REVEAL_GATES) {
    if (gate.level !== level + 1) continue;
    const stageOk = stageIndex(state.sceneState) >= stageIndex(gate.minStage);
    if (stageOk && state.trust >= gate.minTrust && elapsed >= gate.minSec) {
      level = gate.level;
    }
  }
  return level;
}

// 로맨스 트랙의 tension 은 긴장이 아니라 정서적 압력이다.
// 공개 단계가 올라가고 남은 시간이 줄어들수록 커진다.
function computeTension(state, elapsed) {
  const byReveal = state.revealLevel * 18;
  const byTime = elapsed >= REVEAL_FREEZE_SEC ? 28 : Math.floor((elapsed / TOTAL_SEC) * 20);
  const byTrust = Math.floor(state.trust / 10);
  return clamp(10 + byReveal + byTime + byTrust, 0, 100);
}

// ─────────────────────────────────────────────────────────────
// 규칙 매칭
// ─────────────────────────────────────────────────────────────

function matches(rule, state, intent) {
  if (rule.once && state.firedOnce[rule.id]) return false;
  const stageOk = rule.stage.includes("*") || rule.stage.includes(state.sceneState);
  if (!stageOk) return false;
  const intentOk = rule.intent.includes("*") || rule.intent.includes(intent);
  if (!intentOk) return false;
  if (rule.when && !rule.when(state)) return false;
  return true;
}

function pickLine(rule, state) {
  if (typeof rule.pick === "function") {
    return clamp(rule.pick(state), 0, rule.lines.length - 1);
  }
  // 같은 회차에 같은 대사를 반복하지 않는다.
  // 다 소진하면 처음부터 돌지만, 직전 대사는 연속으로 다시 나오지 않게 제외한다.
  const all = rule.lines.map((_, i) => i);
  const used = state.usedLines[rule.id] || [];
  const last = used.length ? used[used.length - 1] : -1;
  let pool = all.filter((i) => !used.includes(i));
  if (!pool.length) pool = all.length > 1 ? all.filter((i) => i !== last) : all;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 응답 생성. 실제 LLM 을 붙일 자리.
 *
 * 프로덕션에서는 여기서 (state, intent, utterance) 를 프롬프트로 직렬화해
 * 모델에 넘기고, 1~2문장 대사 + 감정·시선·자세 태그를 받는다.
 * 모델이 반환한 대사는 반드시 아래 두 조건으로 검증한 뒤 채택한다:
 *   1) revealLevel 이 허용하는 정보만 담고 있는가
 *   2) elapsed >= REVEAL_FREEZE_SEC 이후에 새 주제를 열지 않는가
 * 검증 실패 시 BRIDGE_LINES 로 대체한다. (소개서 §11 "AI 가 바꾸면 안 되는 것")
 */
function generateReply(state, intent) {
  const candidates = RULES.filter((r) => matches(r, state, intent));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const rule = candidates[0];
  const idx = pickLine(rule, state);
  return { rule, lineIndex: idx, line: rule.lines[idx] };
}

/**
 * 한 턴 진행.
 *
 * @param state    현재 상태
 * @param utterance 관객 발화 (빈 문자열이면 침묵)
 * @param elapsed  체험 시작 후 경과 초
 * @param opts     { offline: boolean }     — 네트워크·AI 실패 시뮬레이션
 *                 { forceIntent: string }  — 인물이 먼저 말을 거는 구간용.
 *                   'idle' 을 넘기면 intent 별 규칙은 건너뛰고 stage 의
 *                   '*' 규칙(첫 대화·버스 접근 등 필수 사건)만 매칭된다.
 *                 { llmLine: object }      — LLM 이 생성·검증을 통과한 대사.
 *                   주어지면 규칙 뱅크 대신 이것을 채택한다.
 * @returns { state, response }
 */
export function step(state, utterance, elapsed, opts = {}) {
  const stage = stageAt(elapsed);
  let intent = opts.forceIntent || classifyIntent(utterance);

  // 되묻기는 한 번만. 두 번 연속 실패하면 침묵으로 처리한다.
  let unknownStreak = intent === "unknown" ? state.unknownStreak + 1 : 0;
  if (intent === "unknown" && unknownStreak >= 2) intent = "silence";

  // 연속 캐묻기는 신뢰도를 깎는다 — 소개서 §11 "캐묻기·공격적 발화로 낮아짐"
  const questionStreak = intent === "question" ? state.questionStreak + 1 : 0;
  const nagPenalty = questionStreak >= 3 ? -6 : 0;

  let next = {
    ...state,
    sceneState: stage.id,
    lastUserIntent: intent,
    lastUtterance: utterance || "",
    turn: state.turn + 1,
    questionStreak,
    unknownStreak,
    timeRemaining: Math.max(0, TOTAL_SEC - Math.floor(elapsed)),
  };

  next.trust = clamp(next.trust + (TRUST_BY_INTENT[intent] ?? 0) + nagPenalty, 0, 100);

  // 오프라인이면 브리지 대사로 전환하되, 상태 갱신과 타임라인은 계속 돈다.
  let response;
  if (opts.llmLine) {
    // LLM 이 생성한 대사. 이미 app/api/dialogue 에서 공개 단계·동결 검증을
    // 통과한 것만 여기까지 온다. 상태 갱신 규칙은 규칙 뱅크와 동일하게 적용된다.
    response = { ...opts.llmLine, source: "llm", ruleId: "llm.generated", fixed: false };
    next.trust = clamp(next.trust + (opts.llmLine.trust || 0), 0, 100);
  } else if (opts.offline) {
    const line = BRIDGE_LINES[state.turn % BRIDGE_LINES.length];
    response = { ...line, source: "bridge", ruleId: "fallback.bridge", fixed: true };
  } else {
    const gen = generateReply(next, intent);
    if (!gen) {
      const line = BRIDGE_LINES[state.turn % BRIDGE_LINES.length];
      response = { ...line, source: "bridge", ruleId: "fallback.no_match", fixed: true };
    } else {
      response = {
        ...gen.line,
        source: gen.rule.fixed ? "recorded" : "generated",
        ruleId: gen.rule.id,
        fixed: !!gen.rule.fixed,
      };
      next.trust = clamp(next.trust + (gen.line.trust || 0), 0, 100);
      if (gen.rule.once) next.firedOnce = { ...next.firedOnce, [gen.rule.id]: true };
      const prevUsed = next.usedLines[gen.rule.id] || [];
      // 한 바퀴 다 돌면 이력을 비우고 직전 대사만 남긴다 (연속 반복 방지 + 무한 증가 방지)
      const nextUsed =
        prevUsed.length + 1 >= gen.rule.lines.length ? [gen.lineIndex] : [...prevUsed, gen.lineIndex];
      next.usedLines = { ...next.usedLines, [gen.rule.id]: nextUsed };
    }
  }

  next.revealLevel = nextRevealLevel(next, elapsed);
  next.revealFrozen = elapsed >= REVEAL_FREEZE_SEC;
  next.tension = computeTension(next, elapsed);

  return { state: next, response };
}

/** 타임라인만 진행 (관객 발화 없이 단계·시간·압력만 갱신) */
export function tick(state, elapsed) {
  const stage = stageAt(elapsed);
  const next = {
    ...state,
    sceneState: stage.id,
    timeRemaining: Math.max(0, TOTAL_SEC - Math.floor(elapsed)),
    revealFrozen: elapsed >= REVEAL_FREEZE_SEC,
  };
  next.revealLevel = nextRevealLevel(next, elapsed);
  next.tension = computeTension(next, elapsed);
  return next;
}
