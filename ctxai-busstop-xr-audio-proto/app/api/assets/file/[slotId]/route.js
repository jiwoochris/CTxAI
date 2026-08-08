// 올라온 파일 내려주기 — 런타임과 현황판 미리듣기가 씁니다.
//
//   GET /api/assets/file/<slotId>
//
// 버킷은 비공개입니다. 파일은 이 경로를 거쳐서만 나갑니다.

import { getAsset, mimeFor } from "../../../../../lib/store";
import { SLOT_BY_ID } from "../../../../../lib/assetSpec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const slotId = params.slotId;
  if (!SLOT_BY_ID[slotId]) {
    return Response.json({ error: "모르는 칸입니다" }, { status: 404 });
  }

  // ?variant=<id> 로 특정 후보를 지정하지 않으면 선택된 것을 준다.
  const variantId = new URL(req.url).searchParams.get("variant") || undefined;
  const asset = await getAsset(slotId, variantId);
  if (!asset) {
    return Response.json({ error: "아직 올라오지 않았습니다" }, { status: 404 });
  }

  return new Response(asset.bytes, {
    headers: {
      "Content-Type": mimeFor(asset.filename),
      "Content-Length": String(asset.bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
