// 환경 SFX 후보 — 팀 전체가 들을 수 있게.
//
//   GET  /api/sfx         17개 후보 목록 + 올라와 있는지 여부
//   POST /api/sfx         파일 하나 올리기 (multipart: key, file)

import { addVariant, readRecords } from "../../../lib/store";
import { SFX_CANDIDATES, SFX_SLOT_ID } from "../../../lib/sfxCandidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const records = await readRecords();
  const items = SFX_CANDIDATES.map((c) => ({
    ...c,
    slotId: SFX_SLOT_ID(c.key),
    hasAudio: !!records[SFX_SLOT_ID(c.key)]?.variants?.length,
  }));
  return Response.json({ items });
}

export async function POST(req) {
  let form;
  try {
    form = await req.formData();
  } catch (e) {
    return Response.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  const key = form.get("key");
  const file = form.get("file");

  const item = SFX_CANDIDATES.find((c) => c.key === key);
  if (!item) {
    return Response.json({ ok: false, error: `모르는 SFX 입니다: ${key}` }, { status: 400 });
  }
  if (!file || typeof file === "string") {
    return Response.json({ ok: false, error: "파일이 없습니다" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const slotId = SFX_SLOT_ID(key);
  await addVariant(slotId, item.file, bytes, {});

  return Response.json({ ok: true, slotId });
}
