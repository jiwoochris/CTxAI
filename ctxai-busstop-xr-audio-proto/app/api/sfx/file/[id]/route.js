// 환경 SFX 파일 내려주기 — /sfx 페이지의 <audio> 가 씁니다.
//
//   GET /api/sfx/file/sfx.01

import { getAsset, mimeFor } from "../../../../../lib/store";
import { SFX_CANDIDATES, SFX_SLOT_ID } from "../../../../../lib/sfxCandidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const slotId = params.id;
  const known = SFX_CANDIDATES.some((c) => SFX_SLOT_ID(c.key) === slotId);
  if (!known) {
    return Response.json({ error: "모르는 SFX 입니다" }, { status: 404 });
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
