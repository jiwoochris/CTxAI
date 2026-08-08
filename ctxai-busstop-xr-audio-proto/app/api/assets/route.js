// 에셋 업로드 · 현황
//
//   GET  /api/assets            현황판이 쓰는 요약
//   POST /api/assets            파일 하나 올리기 (multipart)
//
// 측정(LUFS·삼각형 수 등)은 브라우저가 하고 measure 필드로 함께 보냅니다.
// 서버는 규칙 판정과 저장만 합니다.

import { addVariant, readRecords, listPresets, removeAsset, removeVariant } from "../../../lib/store";
import { buildStatus } from "../../../lib/manifestBuild";
import { SLOT_BY_ID, KIND_EXT, extOf } from "../../../lib/assetSpec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [records, presets] = await Promise.all([readRecords(), listPresets()]);
  return Response.json(buildStatus(records, presets));
}

export async function POST(req) {
  let form;
  try {
    form = await req.formData();
  } catch (e) {
    return Response.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  const file = form.get("file");
  const slotId = form.get("slotId");

  if (!file || typeof file === "string") {
    return Response.json({ ok: false, error: "파일이 없습니다" }, { status: 400 });
  }
  const slot = SLOT_BY_ID[slotId];
  if (!slot) {
    return Response.json({ ok: false, error: `모르는 칸입니다: ${slotId}` }, { status: 400 });
  }

  // 확장자 — 여기서 막습니다. 나머지 규격 위반은 경고로 올라갑니다.
  const ext = extOf(file.name);
  const allowed = KIND_EXT[slot.kind] ?? [];
  if (!allowed.includes(ext)) {
    return Response.json({
      ok: false,
      error: `${slot.label} 은(는) ${allowed.join(" 또는 ")} 여야 합니다. 올리신 것: ${ext || "확장자 없음"}`,
    }, { status: 400 });
  }

  let measure = null;
  const raw = form.get("measure");
  if (typeof raw === "string" && raw) {
    try { measure = JSON.parse(raw); } catch (e) {}
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const note = typeof form.get("note") === "string" && form.get("note") ? form.get("note") : undefined;
  const record = await addVariant(slot.id, file.name, bytes, { measure, note });

  const [records, presets] = await Promise.all([readRecords(), listPresets()]);
  return Response.json({ ok: true, record, status: buildStatus(records, presets) });
}

// DELETE /api/assets?slotId=...              슬롯째로 지움 (후보 전부)
// DELETE /api/assets?slotId=...&variantId=... 후보 하나만 지움
export async function DELETE(req) {
  const params = new URL(req.url).searchParams;
  const slotId = params.get("slotId");
  const variantId = params.get("variantId");
  if (!SLOT_BY_ID[slotId]) {
    return Response.json({ ok: false, error: "모르는 칸입니다" }, { status: 400 });
  }
  if (variantId) await removeVariant(slotId, variantId);
  else await removeAsset(slotId);
  const [records, presets] = await Promise.all([readRecords(), listPresets()]);
  return Response.json({ ok: true, status: buildStatus(records, presets) });
}
