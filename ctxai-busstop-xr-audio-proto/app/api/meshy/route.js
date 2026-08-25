// 이미지→3D(Meshy) 작업 생성·조회 — 서버 전용.
//
//   POST /api/meshy   { imageUrl }              공개 URL/데이터 URI로 생성
//        또는          { imagePath }             Bus/ArtWork_Final 안의 로컬 파일로 생성(테스트용)
//   GET  /api/meshy?id=...                       상태 폴링
//
// 키가 없으면 503 + configured:false — 팀이 MESHY_API_KEY를 .env.local에
// 넣기 전까지는 이 라우트가 조용히 대기 상태임을 알려준다.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createImageTo3DTask, getImageTo3DTask, isMeshyConfigured } from "../../../lib/meshy";

// 로컬 파일 테스트 경로 — Bus/ArtWork_Final 밖은 절대 못 읽게 막는다(경로 조작 방지).
const ARTWORK_ROOT = path.resolve(process.cwd(), "..", "Bus", "ArtWork_Final");

const EXT_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

async function imagePathToDataUrl(imagePath) {
  const resolved = path.resolve(ARTWORK_ROOT, imagePath);
  if (!resolved.startsWith(ARTWORK_ROOT + path.sep)) {
    throw new Error("imagePath 가 허용된 폴더 밖입니다");
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = EXT_MIME[ext];
  if (!mime) throw new Error(`지원하지 않는 이미지 형식: ${ext}`);
  const buf = await fs.readFile(resolved);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function POST(req) {
  if (!isMeshyConfigured()) {
    return Response.json({ ok: false, configured: false, error: "MESHY_API_KEY 가 설정되지 않았습니다." }, { status: 503 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON 을 읽지 못했습니다" }, { status: 400 });
  }

  try {
    const imageUrl = body.imageUrl || (body.imagePath ? await imagePathToDataUrl(body.imagePath) : null);
    if (!imageUrl) {
      return Response.json({ ok: false, error: "imageUrl 또는 imagePath 가 필요합니다" }, { status: 400 });
    }
    const id = await createImageTo3DTask({
      imageUrl,
      aiModel: body.aiModel,
      modelType: body.modelType,
      targetPolycount: body.targetPolycount,
      texturePrompt: body.texturePrompt,
    });
    return Response.json({ ok: true, id });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}

export async function GET(req) {
  if (!isMeshyConfigured()) {
    return Response.json({ ok: false, configured: false, error: "MESHY_API_KEY 가 설정되지 않았습니다." }, { status: 503 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id 쿼리가 필요합니다" }, { status: 400 });

  try {
    const task = await getImageTo3DTask(id);
    return Response.json({ ok: true, task });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}
