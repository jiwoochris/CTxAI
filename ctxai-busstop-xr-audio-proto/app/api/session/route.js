// 세션 기록 저장 — /film 종료 시 연출 상태 궤적·사건·헤드 포즈 채점을 로컬 파일로 남긴다.
//
// 파일럿(10~20명)에서 "시스템 판정 vs 본인이 느낀 장르" 일치율을 내려면 회차마다
// JSON이 자동으로 쌓여야 한다. 관객이 종료 카드에서 내려받기를 누르는 데 의존하지 않는다.
// 저장소는 Supabase가 아니라 프로젝트 안 data/sessions/ (gitignore). 전시 PC 로컬 실행 전제.
//
//   POST /api/session  { ...exportSession() 결과, selfReport?: "R"|"H"|"C" }
//   GET  /api/session  → 저장된 파일 목록과 요약(마지막 배합·앉은 인물·자기보고)

import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "data", "sessions");

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "잘못된 요청 본문" }, { status: 400 }); }
  if (!body || !Array.isArray(body.trajectory)) return Response.json({ ok: false, error: "trajectory 가 필요합니다" }, { status: 400 });

  await fs.mkdir(DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${stamp}_${(body.dominant || "x")}`;
  const file = path.join(DIR, `${id}.json`);
  await fs.writeFile(file, JSON.stringify({ id, savedAt: new Date().toISOString(), ...body }, null, 2));
  return Response.json({ ok: true, id });
}

export async function GET(req) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    // 경로 탈출 방지 — 파일명 문자만 허용
    if (!/^[\w\-]+$/.test(id)) return Response.json({ ok: false, error: "bad id" }, { status: 400 });
    try {
      const j = JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), "utf8"));
      return Response.json({ ok: true, session: j });
    } catch { return Response.json({ ok: false, error: "not found" }, { status: 404 }); }
  }
  let names = [];
  try { names = (await fs.readdir(DIR)).filter((n) => n.endsWith(".json")).sort(); } catch { /* 아직 없음 */ }
  const items = [];
  for (const n of names.slice(-200)) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(DIR, n), "utf8"));
      items.push({
        id: j.id, savedAt: j.savedAt, dominant: j.dominant ?? null, selfReport: j.selfReport ?? null,
        final: j.final?.current ?? null, settled: j.final?.settled ?? null, confidence: j.final?.confidence ?? null,
        durationSec: j.trajectory?.length ? j.trajectory[j.trajectory.length - 1].t : null,
      });
    } catch { /* 깨진 파일은 건너뜀 */ }
  }
  const withReport = items.filter((i) => i.selfReport && i.dominant);
  const agree = withReport.filter((i) => i.selfReport === i.dominant).length;
  return Response.json({ ok: true, count: items.length, agreement: withReport.length ? { n: withReport.length, agree, rate: agree / withReport.length } : null, items });
}
