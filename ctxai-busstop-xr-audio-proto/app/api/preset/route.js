// 조명 프리셋 수신 — PlayCanvas 에디터의 북마크릿이 여기로 보냅니다.
//
//   POST /api/preset     프리셋 저장 (아트가 「저장」 누르면 자동)
//   GET  /api/preset     저장된 프리셋 목록
//   GET  /api/preset?name=lp_H   한 장 (에디터 「불러오기」가 씀)
//
// 에디터 페이지(playcanvas.com)에서 부르므로 CORS 를 열어 둡니다.
// 조명 값에는 민감한 것이 없고, 내부 URL 을 아는 사람만 씁니다.

import { putPreset, listPresets } from "../../../lib/store";
import { PRESETS } from "../../../lib/assetSpec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req) {
  const name = new URL(req.url).searchParams.get("name");
  const all = await listPresets();

  if (name) {
    if (!all[name]) {
      return Response.json({ ok: false, error: `${name} 은 아직 저장되지 않았습니다` },
        { status: 404, headers: CORS });
    }
    return Response.json({ ok: true, preset: all[name] }, { headers: CORS });
  }

  return Response.json({
    ok: true,
    presets: PRESETS.map((p) => ({
      name: p.name,
      label: p.label,
      saved: !!all[p.name],
      receivedAt: all[p.name]?.receivedAt ?? null,
      lightCount: all[p.name]?.lights?.length ?? null,
    })),
  }, { headers: CORS });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ ok: false, error: "JSON 을 읽지 못했습니다" },
      { status: 400, headers: CORS });
  }

  const name = body?.name;
  if (!PRESETS.some((p) => p.name === name)) {
    return Response.json({
      ok: false,
      error: `프리셋 이름이 다섯 개 중 하나여야 합니다: ${PRESETS.map((p) => p.name).join(", ")}`,
    }, { status: 400, headers: CORS });
  }
  if (!Array.isArray(body.lights) || !body.lights.length) {
    return Response.json({
      ok: false,
      error: "조명이 하나도 없습니다. 에디터에서 조명이 인식되는지 확인해 주세요",
    }, { status: 400, headers: CORS });
  }

  const saved = await putPreset(name, body);
  return Response.json({
    ok: true,
    name,
    lights: saved.lights.length,
    receivedAt: saved.receivedAt,
  }, { headers: CORS });
}
