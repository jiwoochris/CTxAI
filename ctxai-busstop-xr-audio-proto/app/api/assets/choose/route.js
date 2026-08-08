// 샘플 중 하나를 "지금 쓰는 것"으로 정하기 — 팀이 두 톤을 올려놓고 고를 때 씀.
//
//   POST /api/assets/choose   { slotId, variantId }

import { chooseVariant, readRecords, listPresets } from "../../../../lib/store";
import { buildStatus } from "../../../../lib/manifestBuild";
import { SLOT_BY_ID } from "../../../../lib/assetSpec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  const { slotId, variantId } = body || {};
  if (!SLOT_BY_ID[slotId]) {
    return Response.json({ ok: false, error: "모르는 칸입니다" }, { status: 400 });
  }
  if (!variantId) {
    return Response.json({ ok: false, error: "variantId 가 필요합니다" }, { status: 400 });
  }

  try {
    await chooseVariant(slotId, variantId);
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }

  const [records, presets] = await Promise.all([readRecords(), listPresets()]);
  return Response.json({ ok: true, status: buildStatus(records, presets) });
}
