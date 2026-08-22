// 목소리 → 4장르 점수 — OpenRouter 하나로 STT + LLM 처리
//
// Bus/test_pipeline.sh 에서 검증된 구조 그대로: OPENROUTER_API_KEY 하나로
// Whisper 전사와 Claude Haiku 채점을 모두 처리한다. 별도 OpenAI/Anthropic
// 키 발급 없이 바로 동작한다.
//
// 키가 없으면 503 + configured:false 를 돌려준다.

const WHISPER_MODEL = "openai/whisper-1";
const SCORE_MODEL = "anthropic/claude-haiku-4.5";
const GENRES = ["horror", "romance", "comedy", "fantasy"];

// Whisper 는 파일명 확장자로 컨테이너 포맷을 판단한다 — 실제 바이트와
// 확장자가 어긋나면(예: m4a 파일에 .webm 이름) 400 으로 거부된다.
//
// 원래 파일명에 알아볼 수 있는 확장자가 있으면 그걸 그대로 씁니다 — curl 이나
// 일반 파일 업로드는 Content-Type 을 "application/octet-stream" 으로 보낼 때가
// 많아서, MIME 타입만 보면 전부 webm 으로 잘못 떨어집니다 (실사용 버그로 발견됨).
// MediaRecorder 로 녹음한 진짜 브라우저 업로드는 파일명이 없거나 확장자가
// 없을 수 있으니, 그때만 MIME 타입 매핑으로 넘어갑니다.
const KNOWN_EXTS = new Set(["webm", "ogg", "m4a", "mp3", "wav", "mp4", "aac", "flac"]);

function extensionFor(filename, mimeType) {
  const fromName = (filename || "").split(".").pop()?.toLowerCase();
  if (fromName && KNOWN_EXTS.has(fromName)) return fromName;

  const type = (mimeType || "").split(";")[0].trim().toLowerCase();
  const map = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  };
  return map[type] || "webm";
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

export async function POST(req) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { configured: false, error: "OPENROUTER_API_KEY 가 설정되지 않았습니다. .env.local 에 추가하세요." },
      { status: 503 }
    );
  }

  let form;
  try {
    form = await req.formData();
  } catch (e) {
    return Response.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!audio || typeof audio === "string") {
    return Response.json({ error: "audio 파일이 필요합니다" }, { status: 400 });
  }

  const startedAt = Date.now();

  // 1. STT — Whisper
  let transcript;
  try {
    const sttForm = new FormData();
    sttForm.append("file", audio, `clip.${extensionFor(audio.name, audio.type)}`);
    sttForm.append("model", WHISPER_MODEL);

    const sttRes = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: sttForm,
    });
    if (!sttRes.ok) {
      const detail = await sttRes.text().catch(() => "");
      return Response.json(
        { ok: false, reason: `stt_${sttRes.status}`, detail: detail.slice(0, 300) },
        { status: 200 }
      );
    }
    const sttJson = await sttRes.json();
    transcript = (sttJson.text || "").trim();
  } catch (e) {
    return Response.json({ ok: false, reason: "stt_network" }, { status: 200 });
  }

  if (!transcript) {
    return Response.json({ ok: false, reason: "empty_transcript" }, { status: 200 });
  }

  // 2. 채점 — Claude Haiku, 4항목 점수 + 근거 한 줄을 JSON으로
  // (reason 필드: 정류장 판정 대시보드에서 "왜 이렇게 봤는지"를 그대로 보여주기 위함 —
  // Bus/규격/판정_기준.md §3 갱신, 키워드 사전 대신 이 근거를 씀)
  const prompt = `다음 발화를 공포/로맨스/코미디/판타지 4가지 점수(0~1)로 평가해서 JSON만 출력해. 키는 반드시 horror, romance, comedy, fantasy, reason 다섯 개만 사용하고("reason"은 왜 이렇게 채점했는지 한국어 한 문장), 마크다운이나 설명 없이 순수 JSON 텍스트만 출력해.\n발화: ${transcript}`;

  let scores;
  let scoreReason = null;
  try {
    const llmRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SCORE_MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!llmRes.ok) {
      const detail = await llmRes.text().catch(() => "");
      return Response.json(
        { ok: false, reason: `llm_${llmRes.status}`, detail: detail.slice(0, 300), transcript },
        { status: 200 }
      );
    }
    const llmJson = await llmRes.json();
    const content = llmJson.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content);
    if (!parsed) {
      return Response.json({ ok: false, reason: "score_parse_failed", transcript }, { status: 200 });
    }
    scores = {};
    for (const g of GENRES) scores[g] = clamp01(parsed[g]);
    scoreReason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : null;
  } catch (e) {
    return Response.json({ ok: false, reason: "llm_network", transcript }, { status: 200 });
  }

  return Response.json({
    ok: true,
    transcript,
    scores,
    scoreReason,
    meta: { latencyMs: Date.now() - startedAt },
  });
}
