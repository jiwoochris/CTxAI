// 할 일 목록 — /todo 페이지가 씁니다.
//
//   GET    /api/tasks             전체 목록 (처음엔 스크립트 v1.1로 씨딩됨)
//   POST   /api/tasks             새 할 일 추가 { role, label, detail? }
//   PATCH  /api/tasks             완료 체크 등 수정 { id, ...patch }
//   DELETE /api/tasks?id=...      지우기

import { listTasks, addTask, updateTask, removeTask } from "../../../lib/store";
import { SCRIPT_ROLE_ORDER } from "../../../lib/scriptTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, tasks: await listTasks() });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ ok: false, error: "JSON 을 읽지 못했습니다" }, { status: 400 });
  }

  const role = body?.role;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!SCRIPT_ROLE_ORDER.includes(role)) {
    return Response.json({
      ok: false, error: `역할은 ${SCRIPT_ROLE_ORDER.join(" / ")} 중 하나여야 합니다`,
    }, { status: 400 });
  }
  if (!label) {
    return Response.json({ ok: false, error: "할 일 제목이 없습니다" }, { status: 400 });
  }

  const task = await addTask({ role, label, detail: body?.detail?.trim?.() || "" });
  return Response.json({ ok: true, task, tasks: await listTasks() });
}

export async function PATCH(req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ ok: false, error: "JSON 을 읽지 못했습니다" }, { status: 400 });
  }

  const { id, ...patch } = body || {};
  if (!id) return Response.json({ ok: false, error: "id 가 없습니다" }, { status: 400 });

  const task = await updateTask(id, patch);
  if (!task) return Response.json({ ok: false, error: "그 할 일을 못 찾았습니다" }, { status: 404 });
  return Response.json({ ok: true, task });
}

export async function DELETE(req) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id 가 없습니다" }, { status: 400 });

  await removeTask(id);
  return Response.json({ ok: true });
}
