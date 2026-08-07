// manifest.json — 생성물. 사람이 편집하지 않습니다.
//
//   GET /api/manifest              런타임과 개발이 읽는 형태
//   GET /api/manifest?download=1   파일로 내려받기

import { readRecords, listPresets } from "../../../lib/store";
import { buildManifest } from "../../../lib/manifestBuild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const url = new URL(req.url);
  const [records, presets] = await Promise.all([readRecords(), listPresets()]);

  const manifest = buildManifest(records, presets, {
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
    emotionTagsWork: process.env.V3_EMOTION_TAGS === "1" ? true
      : process.env.V3_EMOTION_TAGS === "0" ? false : null,
  });

  const body = JSON.stringify(manifest, null, 2);
  if (url.searchParams.get("download")) {
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="manifest.json"',
      },
    });
  }
  return new Response(body, { headers: { "Content-Type": "application/json" } });
}
