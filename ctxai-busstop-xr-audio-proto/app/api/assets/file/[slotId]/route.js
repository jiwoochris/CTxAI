// 올라온 파일 내려주기 — 런타임과 현황판 미리듣기가 씁니다.
//
//   GET /api/assets/file/<slotId>

import { promises as fs } from "node:fs";
import path from "node:path";
import { getAssetPath } from "../../../../../lib/store";
import { SLOT_BY_ID } from "../../../../../lib/assetSpec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME = {
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".csv": "text/csv; charset=utf-8",
};

export async function GET(req, { params }) {
  const slotId = params.slotId;
  if (!SLOT_BY_ID[slotId]) {
    return Response.json({ error: "모르는 칸입니다" }, { status: 404 });
  }

  const filePath = await getAssetPath(slotId);
  if (!filePath) {
    return Response.json({ error: "아직 올라오지 않았습니다" }, { status: 404 });
  }

  const bytes = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return new Response(bytes, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
