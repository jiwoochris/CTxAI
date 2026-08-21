// V2 대사 오디오 파일 내려주기 — /vo 페이지의 <audio> 가 씁니다.
//
//   GET /api/vo2/file/vo2.R.01

import { getAsset, mimeFor } from "../../../../../lib/store";
import { DIALOGUE_V2_LINES, DIALOGUE_V2_SLOT_ID } from "../../../../../lib/dialogueV2Lines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const slotId = params.id;
  const known = DIALOGUE_V2_LINES.some((l) => DIALOGUE_V2_SLOT_ID(l.genre, l.seq) === slotId);
  if (!known) {
    return Response.json({ error: "모르는 대사입니다" }, { status: 404 });
  }

  const asset = await getAsset(slotId);
  if (!asset) {
    return Response.json({ error: "아직 올라오지 않았습니다" }, { status: 404 });
  }

  return new Response(asset.bytes, {
    headers: {
      "Content-Type": mimeFor(asset.filename),
      "Content-Length": String(asset.bytes.length),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
