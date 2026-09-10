// 인물 대사 생성 API — OpenRouter (2026-09-10 전환)
//
// 소개서 §11 의 generateReply() 자리를 실제 LLM 으로 채운다.
// 상태 관리는 그대로 lib/dialogueEngine.js 가 하고, 이 라우트는 "지금 상태에서
// 말할 수 있는 한 줄"만 만들어 돌려준다. 즉 AI 는 시나리오를 대체하지 않고
// 시나리오와 관객 사이를 잇는다.
//
// 2026-09-10: Anthropic SDK 직접 호출을 OpenRouter 채팅 완성 API로 바꿨다.
// 프로젝트 방침이 "외부 API는 OpenRouter 하나로"이고, /api/mood·/api/voicetone 이
// 이미 같은 키를 쓰기 때문이다. 구조화 출력은 response_format(json_schema)로 유지한다.
//
// 키가 없으면 503 + configured:false 를 돌려주고, 클라이언트는 규칙 뱅크로
// 정상 동작한다. 키 없이도 프로토타입 전체가 돌아가야 한다.

import {
  REPLY_SCHEMA,
  SYSTEM_PROMPT,
  buildTurnMessage,
  validateReply,
} from "@/lib/dialoguePrompt";

// 관객 발화 종료 → 발성 시작까지 1.2초가 목표 상한이라 가장 빠른 모델을 쓴다.
// 품질이 더 필요하면 OPENROUTER_DIALOGUE_MODEL 로 바꾼다 (예: anthropic/claude-sonnet-5).
const MODEL = process.env.OPENROUTER_DIALOGUE_MODEL || "anthropic/claude-haiku-4.5";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(req) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { configured: false, error: "OPENROUTER_API_KEY 가 설정되지 않았습니다. .env.local 에 추가하세요." },
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
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const turn of history.slice(-12)) {
    if (!turn?.text) continue;
    messages.push({ role: turn.who === "char" ? "assistant" : "user", content: turn.text });
  }
  messages.push({
    role: "user",
    content: buildTurnMessage({ state, utterance, intent, elapsed, stageId, timeRemaining }),
  });

  const startedAt = Date.now();

  try {
    const upstream = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/drew25927/CTxAI",
        "X-Title": "busstop-dialogue",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 400, // 1~2문장 대사 + 태그. 의도적으로 짧은 출력이라 낮게 잡는다.
        temperature: 0.8,
        response_format: {
          type: "json_schema",
          json_schema: { name: "reply", strict: true, schema: REPLY_SCHEMA },
        },
      }),
    });

    if (!upstream.ok) {
      const reason = upstream.status === 429 ? "rate_limit" : upstream.status === 401 ? "auth" : `api_${upstream.status}`;
      return Response.json({ ok: false, reason }, { status: 200 });
    }

    const data = await upstream.json();
    const choice = data?.choices?.[0];
    if (!choice) return Response.json({ ok: false, reason: "빈 응답" }, { status: 200 });
    if (choice.finish_reason === "length") return Response.json({ ok: false, reason: "max_tokens" }, { status: 200 });
    if (choice.finish_reason === "content_filter") return Response.json({ ok: false, reason: "refusal" }, { status: 200 });

    const text = typeof choice.message?.content === "string"
      ? choice.message.content
      : (choice.message?.content || []).map((p) => p.text || "").join("");

    let reply;
    try {
      reply = JSON.parse(text);
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
        model: data.model || MODEL,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        cacheRead: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWrite: data.usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
        cost: data.usage?.cost ?? null,
      },
    });
  } catch (err) {
    // 실패는 전부 폴백으로 흘린다 — 5분 타임라인은 멈추지 않아야 한다.
    return Response.json({ ok: false, reason: "network" }, { status: 200 });
  }
}
