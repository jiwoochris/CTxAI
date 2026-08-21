// V2 대사 오디오 — 팀 전체가 들을 수 있게.
//
//   GET  /api/vo2         46줄 목록 + 올라와 있는지 여부
//   POST /api/vo2         파일 하나 올리기 (multipart: genre, seq, file)
//
// /api/assets 와 같은 저장소(store.js)를 쓰지만, 대사양식_v2.csv 기반의
// 46개 고정 슬롯이라 assetSpec.js의 큰 SLOTS 표에는 넣지 않았습니다 —
// 8월 시연 체크리스트와는 다른 목록입니다.

import { addVariant, readRecords } from "../../../lib/store";
import { DIALOGUE_V2_LINES, DIALOGUE_V2_SLOT_ID } from "../../../lib/dialogueV2Lines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const records = await readRecords();
  const lines = DIALOGUE_V2_LINES.map((l) => ({
    ...l,
    slotId: DIALOGUE_V2_SLOT_ID(l.genre, l.seq),
    hasAudio: !!records[DIALOGUE_V2_SLOT_ID(l.genre, l.seq)]?.variants?.length,
  }));
  return Response.json({ lines });
}

export async function POST(req) {
  let form;
  try {
    form = await req.formData();
  } catch (e) {
    return Response.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  const genre = form.get("genre");
  const seq = form.get("seq");
  const file = form.get("file");

  const line = DIALOGUE_V2_LINES.find((l) => l.genre === genre && l.seq === seq);
  if (!line) {
    return Response.json({ ok: false, error: `모르는 대사입니다: ${genre} ${seq}` }, { status: 400 });
  }
  if (!file || typeof file === "string") {
    return Response.json({ ok: false, error: "파일이 없습니다" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const slotId = DIALOGUE_V2_SLOT_ID(genre, seq);
  await addVariant(slotId, line.file, bytes, {});

  return Response.json({ ok: true, slotId });
}
