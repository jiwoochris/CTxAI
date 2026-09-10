// 감정 표현 TTS — OpenRouter 오디오 출력 모델 (2026-09-10, ElevenLabs에서 전환)
//
// 프로젝트 방침이 "외부 API는 OpenRouter 하나로"라서 ElevenLabs 직접 호출을 뺐다.
// 이미 만들어 둔 46줄 대사·안내방송(public/reactive/audio)은 그대로 쓰고, 이 라우트는
// 새 문장(LLM 실시간 대사, 사전 생성 풀 등)을 음성으로 바꿀 때 쓴다.
//
// 실측(2026-09-10): OpenRouter에서 오디오를 출력하는 모델은 openai/gpt-audio·gpt-audio-mini.
// 오디오 출력은 stream:true 가 필수이고, 스트리밍일 때 포맷은 pcm16(24kHz 모노)만 된다.
// 그래서 SSE 조각을 모아 PCM을 WAV로 감싸 돌려준다. 클라이언트의 decodeAudioData는
// WAV를 그대로 받으므로 lib/romanceAudio.js speakBuffer() 경로(옆자리 공간화)가 유지된다.
//
// 키가 없으면 503 을 돌려주고, 호출자는 브라우저 TTS로 폴백한다.

const MODEL = process.env.OPENROUTER_TTS_MODEL || "openai/gpt-audio-mini";
const VOICE = process.env.OPENROUTER_TTS_VOICE || "sage";
const SAMPLE_RATE = 24000;
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// 소개서 §11 감정 태그 → 낭독 지시문. 모델에 "문장을 바꾸지 말라"를 강하게 준다 —
// 오디오 모델은 지시가 느슨하면 대사를 덧붙이는 경향이 있다(실측).
function styleFor(emotion = "") {
  if (/방어|경계|상처|놀람|의외|이별|되묻기/.test(emotion)) return "약간 떨리고 조심스러운 목소리로, 말끝이 흔들리게";
  if (/웃음|미소|안도|여유|고백/.test(emotion)) return "따뜻하고 부드럽게, 살짝 웃음기가 배어나게";
  if (/닫힘|위축|물러섬|회피|담담|혼잣말/.test(emotion)) return "낮고 담담하게, 감정을 드러내지 않고 혼잣말처럼";
  return "자연스럽고 차분하게";
}

function wavHeader(pcmBytes) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0); b.writeUInt32LE(36 + pcmBytes, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SAMPLE_RATE, 24); b.writeUInt32LE(SAMPLE_RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(pcmBytes, 40);
  return b;
}

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

  const { text, emotion } = body || {};
  if (!text || typeof text !== "string") {
    return Response.json({ error: "text 가 필요합니다" }, { status: 400 });
  }

  try {
    const upstream = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/drew25927/CTxAI",
        "X-Title": "busstop-tts",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        modalities: ["text", "audio"],
        audio: { voice: VOICE, format: "pcm16" },
        messages: [
          {
            role: "system",
            content:
              "당신은 한국어 성우입니다. 사용자가 준 문장을 한 글자도 바꾸지 않고, 덧붙이지 않고, 지시된 어조로 정확히 한 번만 낭독합니다. 문장 앞뒤에 어떤 말도 하지 않습니다.",
          },
          { role: "user", content: `어조: ${styleFor(emotion)}\n낭독할 문장: ${text}` },
        ],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return Response.json({ ok: false, reason: `openrouter_${upstream.status}`, detail: detail.slice(0, 300) }, { status: 200 });
    }

    // SSE 를 읽어 audio.data(base64) 조각을 모은다.
    const chunks = [];
    let transcript = "";
    let buffer = "";
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.error) return Response.json({ ok: false, reason: "provider", detail: String(evt.error.message || "").slice(0, 300) }, { status: 200 });
        for (const ch of evt.choices || []) {
          const a = ch.delta?.audio;
          if (!a) continue;
          if (a.data) chunks.push(Buffer.from(a.data, "base64"));
          if (a.transcript) transcript += a.transcript;
        }
      }
    }

    const pcm = Buffer.concat(chunks);
    if (!pcm.length) return Response.json({ ok: false, reason: "no_audio" }, { status: 200 });

    return new Response(Buffer.concat([wavHeader(pcm.length), pcm]), {
      headers: {
        "content-type": "audio/wav",
        "x-tts-model": MODEL,
        "x-tts-transcript": encodeURIComponent(transcript.slice(0, 200)),
      },
    });
  } catch (err) {
    return Response.json({ ok: false, reason: "network" }, { status: 200 });
  }
}
