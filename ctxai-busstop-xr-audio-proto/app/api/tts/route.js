// 실제 감정표현 TTS — ElevenLabs
//
// 브라우저 speechSynthesis(유나)는 시스템 음성이라 표현력이 얕고,
// Web Audio 그래프를 통과하지 못해 공간 위치도 잃는다(RomanceSlice 참고).
// ElevenLabs 는 (a) 감정이 실리는 실제 음성이고 (b) 오디오 버퍼를 돌려주므로
// lib/romanceAudio.js 의 speakBuffer() 를 그대로 통과시켜 옆자리 위치(오른쪽
// 0.42~0.55m)를 유지한 채로 재생할 수 있다. 이 라우트가 그 다리 역할이다.
//
// 키가 없으면 503 을 돌려주고, 호출자는 유나 TTS로 폴백한다.

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // 기본값(Rachel) — 한국어는 eleven_multilingual_v2 모델이 처리
const MODEL_ID = "eleven_multilingual_v2";

// 소개서 §11 감정 태그 → ElevenLabs voice_settings 근사 매핑.
// ElevenLabs 는 감정을 직접 지정하는 파라미터가 없어 stability/style 로 흉내낸다.
// stability 낮음 = 표현이 더 요동침(감정적), style 높음 = 과장 증가.
function emotionToSettings(emotion = "") {
  const shaky = /방어|경계|상처|놀람|의외|이별|되묻기/.test(emotion);
  const warm = /웃음|미소|안도|여유|고백/.test(emotion);
  const flat = /닫힘|위축|물러섬|회피|담담|혼잣말/.test(emotion);

  if (shaky) return { stability: 0.28, similarity_boost: 0.8, style: 0.55, use_speaker_boost: true };
  if (warm) return { stability: 0.45, similarity_boost: 0.85, style: 0.4, use_speaker_boost: true };
  if (flat) return { stability: 0.65, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true };
  return { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true };
}

export async function POST(req) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { configured: false, error: "ELEVENLABS_API_KEY 가 설정되지 않았습니다. .env.local 에 추가하세요." },
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
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: emotionToSettings(emotion),
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return Response.json(
        { ok: false, reason: `elevenlabs_${upstream.status}`, detail: detail.slice(0, 300) },
        { status: 200 }
      );
    }

    // 오디오를 그대로 스트리밍 반환 — 클라이언트가 decodeAudioData 로 받아
    // charPanner(오른쪽 근접)를 통과시킨다. 공간 위치가 유지되는 이유가 이것이다.
    return new Response(upstream.body, {
      headers: { "content-type": "audio/mpeg" },
    });
  } catch (err) {
    return Response.json({ ok: false, reason: "network" }, { status: 200 });
  }
}
