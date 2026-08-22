// 음성/톤 채널 — RMS·영교차율 자체 계산 대신, 실제 오디오를 이해하는
// 멀티모달 모델(OpenRouter, 이미 쓰는 키)에게 "내용 말고 톤만 봐 달라"고
// 직접 물어본다. 근거: Bus/규격/판정_기준.md §3 (2026-08-22 갱신).
//
//   POST /api/voicetone   multipart: audio (wav)

const TONE_MODEL = "google/gemini-2.5-flash";

function extractJson(text) {
  const cleaned = (text || "").replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function clamp01(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export async function POST(req) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ configured: false, error: "OPENROUTER_API_KEY 가 설정되지 않았습니다." }, { status: 503 });
  }

  let form;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!audio || typeof audio === "string") {
    return Response.json({ ok: false, reason: "no_audio" }, { status: 400 });
  }

  const bytes = Buffer.from(await audio.arrayBuffer());
  const base64 = bytes.toString("base64");

  const prompt =
    "다음 음성을 들어봐. 무슨 말을 했는지 내용은 무시하고, 목소리 톤·에너지·떨림·속도만 보고 " +
    "공포/로맨스/코미디 세 가지 점수(0~1)를 매겨. 키는 반드시 horror, romance, comedy 세 개만 쓰고, " +
    "마크다운이나 설명 없이 순수 JSON 텍스트만 출력해.";

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TONE_MODEL,
        max_tokens: 150,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "input_audio", input_audio: { data: base64, format: "wav" } },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json({ ok: false, reason: `model_${res.status}`, detail: detail.slice(0, 300) }, { status: 200 });
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content);
    if (!parsed) {
      return Response.json({ ok: false, reason: "parse_failed" }, { status: 200 });
    }

    return Response.json({
      ok: true,
      scores: { horror: clamp01(parsed.horror), romance: clamp01(parsed.romance), comedy: clamp01(parsed.comedy) },
    });
  } catch (e) {
    return Response.json({ ok: false, reason: "network" }, { status: 200 });
  }
}
