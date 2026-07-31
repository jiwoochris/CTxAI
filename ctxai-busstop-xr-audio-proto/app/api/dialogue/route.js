// 인물 대사 생성 API — Claude Messages API
//
// 소개서 §11 의 generateReply() 자리를 실제 LLM 으로 채운다.
// 상태 관리는 그대로 lib/dialogueEngine.js 가 하고, 이 라우트는 "지금 상태에서
// 말할 수 있는 한 줄"만 만들어 돌려준다. 즉 AI 는 시나리오를 대체하지 않고
// 시나리오와 관객 사이를 잇는다.
//
// 키가 없으면 503 + configured:false 를 돌려주고, 클라이언트는 규칙 뱅크로
// 정상 동작한다. 키 없이도 프로토타입 전체가 돌아가야 한다.

import Anthropic from "@anthropic-ai/sdk";
import {
  REPLY_SCHEMA,
  SYSTEM_PROMPT,
  buildTurnMessage,
  validateReply,
} from "@/lib/dialoguePrompt";

const MODEL = "claude-opus-5";

// 관객 발화 종료 → 발성 시작까지 1.2초가 목표 상한이므로 사고를 끈다.
//
// Claude Opus 5 는 thinking 이 기본으로 켜져 있어서, 끄려면 명시해야 한다.
// 또한 thinking 을 끄는 것은 effort 가 high 이하일 때만 허용되므로 low 를 함께 준다.
// (대사 한 줄에는 low 로 충분하다.)
//
// 트레이드오프: 사고를 끄면 응답에 내부 XML 태그가 새어나올 가능성이 생긴다.
// 그래서 (a) 구조화 출력로 모양을 고정하고, (b) 시스템 프롬프트에
// "내부용 XML 태그를 쓰지 말라"는 일반 지시를 넣고, (c) validateReply() 에서
// 태그가 섞인 응답을 폐기한다. 3중으로 막는다.
// 지연보다 품질이 중요한 용도로 바꾸려면 THINKING 을 adaptive 로 두면 된다.
const THINKING = { type: "disabled" };
const EFFORT = "low";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

export async function POST(req) {
  const anthropic = getClient();
  if (!anthropic) {
    return Response.json(
      {
        configured: false,
        error: "ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env.local 에 추가하세요.",
      },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const { state, utterance = "", intent = "unknown", elapsed = 0, stageId = "rapport", history = [] } = body || {};
  if (!state || typeof state.trust !== "number") {
    return Response.json({ error: "state 가 필요합니다" }, { status: 400 });
  }

  const timeRemaining = Math.max(0, Math.round(state.timeRemaining ?? 0));

  // 대화 맥락. 인물이 앞서 한 말을 기억해야 같은 얘기를 반복하지 않는다.
  // 최근 12턴으로 제한해 프롬프트가 무한히 자라지 않게 한다.
  const messages = [];
  for (const turn of history.slice(-12)) {
    if (!turn?.text) continue;
    messages.push({
      role: turn.who === "char" ? "assistant" : "user",
      content: turn.text,
    });
  }
  messages.push({
    role: "user",
    content: buildTurnMessage({ state, utterance, intent, elapsed, stageId, timeRemaining }),
  });

  const startedAt = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400, // 1~2문장 대사 + 태그. 의도적으로 짧은 출력이라 낮게 잡는다.
      thinking: THINKING,
      // 시스템 프롬프트는 매 턴 바이트 단위로 동일하므로 캐시에 적중한다.
      // 상태·시간·발화는 전부 messages 로 내려 캐시 접두사를 깨지 않는다.
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        effort: EFFORT,
        format: { type: "json_schema", schema: REPLY_SCHEMA },
      },
      messages,
    });

    // 안전 거부는 정상 200 으로 온다 — content 를 읽기 전에 확인해야 한다.
    if (response.stop_reason === "refusal") {
      return Response.json(
        { ok: false, reason: "refusal", category: response.stop_details?.category ?? null },
        { status: 200 }
      );
    }
    if (response.stop_reason === "max_tokens") {
      return Response.json({ ok: false, reason: "max_tokens" }, { status: 200 });
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) return Response.json({ ok: false, reason: "빈 응답" }, { status: 200 });

    let reply;
    try {
      reply = JSON.parse(textBlock.text);
    } catch (e) {
      return Response.json({ ok: false, reason: "JSON 파싱 실패" }, { status: 200 });
    }

    // 소개서 §11 "AI 가 바꾸면 안 되는 것" — 프롬프트가 아니라 코드로 강제한다.
    const verdict = validateReply(reply, { state, timeRemaining });
    if (!verdict.ok) {
      return Response.json({ ok: false, reason: `검증 실패: ${verdict.reason}` }, { status: 200 });
    }

    return Response.json({
      ok: true,
      line: {
        text: reply.text.trim(),
        emotion: reply.emotion,
        gaze: reply.gaze,
        posture: reply.posture,
        trust: reply.trust_delta,
      },
      meta: {
        latencyMs: Date.now() - startedAt,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      },
    });
  } catch (err) {
    // 실패는 전부 폴백으로 흘린다 — 5분 타임라인은 멈추지 않아야 한다.
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ ok: false, reason: "rate_limit" }, { status: 200 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json({ ok: false, reason: "auth" }, { status: 200 });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return Response.json({ ok: false, reason: "network" }, { status: 200 });
    }
    if (err instanceof Anthropic.APIError) {
      return Response.json({ ok: false, reason: `api_${err.status}` }, { status: 200 });
    }
    return Response.json({ ok: false, reason: "unknown" }, { status: 200 });
  }
}
