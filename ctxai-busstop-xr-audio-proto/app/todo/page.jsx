"use client";

// 할 일 목록 — 정류장_스크립트 v1.1을 정리한 초안으로 시작하고,
// 팀 누구나 새 할 일을 추가·완료 체크·삭제할 수 있습니다.
// 저장은 /api/tasks (Supabase의 tasks.json) — 대시보드(app/page.js)와는 별도 페이지입니다.

import { useEffect, useState } from "react";
import {
  SCRIPT_ROLE_ORDER, SCRIPT_DOC_SLUG, SCRIPT_DOC_LABEL, SCRIPT_V2_DOC_SLUG, SCRIPT_V2_DOC_LABEL,
} from "../../lib/scriptTasks";
import s from "./todo.module.css";

export default function TodoPage() {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState("");
  const [role, setRole] = useState(SCRIPT_ROLE_ORDER[0]);
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = () => {
    fetch("/api/tasks", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTasks(j.tasks ?? []))
      .catch(() => setError("불러오지 못했습니다"));
  };

  useEffect(load, []);

  async function toggle(task) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, done: !task.done }),
      });
    } catch (e) {
      load(); // 실패하면 서버 상태로 되돌린다
    }
  }

  async function remove(task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await fetch(`/api/tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
    } catch (e) {
      load();
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, label: label.trim(), detail: detail.trim() }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error || "추가하지 못했습니다"); return; }
      setTasks(json.tasks);
      setLabel("");
      setDetail("");
    } catch (e) {
      setError("추가하지 못했습니다 — 서버 연결을 확인해 주세요");
    } finally {
      setAdding(false);
    }
  }

  const groups = tasks
    ? SCRIPT_ROLE_ORDER.map((r) => [r, tasks.filter((t) => t.role === r && !t.done)]).filter(([, l]) => l.length > 0)
    : [];
  const doneGroups = tasks
    ? SCRIPT_ROLE_ORDER.map((r) => [r, tasks.filter((t) => t.role === r && t.done)]).filter(([, l]) => l.length > 0)
    : [];
  const doneCount = tasks?.filter((t) => t.done).length ?? 0;

  return (
    <main className={s.wrap}>
      <header className={s.head}>
        <div>
          <h1>할 일</h1>
          <p className={s.dim}>
            {SCRIPT_DOC_LABEL}을 정리한 초안으로 시작했습니다 — 필요하면 아래에서 자유롭게 추가하세요.
            {" "}<a href={`/guide?doc=${SCRIPT_DOC_SLUG}`}>v1.1 보기 →</a>
            {" · "}<a href={`/guide?doc=${SCRIPT_V2_DOC_SLUG}`}>{SCRIPT_V2_DOC_LABEL} 보기 →</a>
          </p>
        </div>
        {tasks && <div className={s.count}><b>{doneCount}</b><span>/{tasks.length} 완료</span></div>}
      </header>

      <form className={s.addForm} onSubmit={submit}>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {SCRIPT_ROLE_ORDER.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input
          className={s.labelInput}
          placeholder="할 일 제목"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className={s.detailInput}
          placeholder="설명 (선택)"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
        <button type="submit" disabled={adding || !label.trim()}>+ 추가</button>
      </form>

      {error && <p className={s.err}>{error}</p>}
      {!tasks && !error && <p className={s.dim}>불러오는 중…</p>}

      {groups.map(([r, list]) => (
        <section key={r} className={s.section}>
          <h2>{r} <span className={s.dim}>{list.length}개 남음</span></h2>
          <ul className={s.list}>
            {list.map((t) => (
              <li key={t.id} className={s.item}>
                <button className={s.check} onClick={() => toggle(t)} aria-label="완료 표시">☐</button>
                <div className={s.itemText}>
                  <b>{t.label}</b>
                  {t.detail && <small>{t.detail}</small>}
                </div>
                <button className={s.del} onClick={() => remove(t)} aria-label="삭제">✕</button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {tasks && (
        <details className={s.doneSection} open={groups.length === 0}>
          <summary>완료된 할 일 <span className={s.dim}>{doneCount}개</span></summary>
          {doneGroups.length === 0 && <p className={s.dim}>아직 없습니다.</p>}
          {doneGroups.map(([r, list]) => (
            <section key={r} className={s.section}>
              <h2>{r} <span className={s.dim}>{list.length}개 완료</span></h2>
              <ul className={s.list}>
                {list.map((t) => (
                  <li key={t.id} className={s.itemDone}>
                    <button className={s.check} onClick={() => toggle(t)} aria-label="완료 취소">☑</button>
                    <div className={s.itemText}>
                      <b>{t.label}</b>
                      {t.detail && <small>{t.detail}</small>}
                    </div>
                    <button className={s.del} onClick={() => remove(t)} aria-label="삭제">✕</button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      )}

      <footer className={s.foot}>
        <a href="/">← 대시보드</a>
      </footer>
    </main>
  );
}
