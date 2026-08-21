"use client";

// 팀 화면 — 파일을 끌어다 놓으면 끝.
//
// 규격 문서를 읽고 지키는 대신 여기가 봅니다.
// 매니페스트는 아무도 열지 않습니다 — 서버가 만듭니다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SLOTS, guessSlot, extOf, KIND_EXT } from "@/lib/assetSpec";
import { measureAudio } from "@/lib/measure/audio";
import { measureGlb } from "@/lib/measure/glb";
import { measureDialogue } from "@/lib/measure/dialogue";
import s from "./page.module.css";

const ROLES = ["전체", "아트", "사운드", "기획"];

function bytesLabel(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function TeamPage() {
  const [status, setStatus] = useState(null);
  const [taskSummary, setTaskSummary] = useState(null);
  const [role, setRole] = useState("전체");
  const [busy, setBusy] = useState([]);      // 처리 중인 파일 이름
  const [toasts, setToasts] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(null); // 칸을 못 고른 파일
  const inputRef = useRef(null);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/assets", { cache: "no-store" });
      setStatus(await r.json());
    } catch (e) {
      say("error", "서버에 연결하지 못했습니다");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/tasks", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const tasks = j.tasks ?? [];
        setTaskSummary({ done: tasks.filter((t) => t.done).length, total: tasks.length });
      })
      .catch(() => setTaskSummary(null));
  }, []);

  function say(kind, text) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
  }

  async function measureFor(slot, file) {
    if (slot.kind === "audio") return measureAudio(file);
    if (slot.kind === "model") return measureGlb(file, slot);
    if (slot.kind === "dialogue") return measureDialogue(await file.text());
    return null;
  }

  async function upload(slot, file) {
    setBusy((b) => [...b, file.name]);
    try {
      const ext = extOf(file.name);
      const allowed = KIND_EXT[slot.kind] ?? [];
      if (!allowed.includes(ext)) {
        say("error", `${slot.label} 은(는) ${allowed.join(" 또는 ")} 여야 합니다 — ${file.name}`);
        return;
      }

      // 이미 샘플이 있는 슬롯이면 새 파일은 덮어쓰지 않고 샘플로 추가됩니다 —
      // 팀이 두 개를 나란히 듣고 고를 수 있게. 뭐라고 부를지만 물어봅니다.
      const already = status?.rows.find((r) => r.id === slot.id)?.uploaded;
      let note;
      if (already) {
        note = window.prompt(
          `"${slot.label}" 에는 이미 올라온 게 있습니다. 기존 걸 덮지 않고 샘플로 추가합니다.\n이 샘플을 뭐라고 부를까요? (예: Robust, Natural — 비워도 됩니다)`,
          ""
        );
        if (note === null) return; // 취소
      }

      const measure = await measureFor(slot, file);

      const form = new FormData();
      form.append("file", file);
      form.append("slotId", slot.id);
      if (measure) form.append("measure", JSON.stringify(measure));
      if (note) form.append("note", note);

      const res = await fetch("/api/assets", { method: "POST", body: form });
      const json = await res.json();

      if (!json.ok) { say("error", json.error || "올리지 못했습니다"); return; }
      setStatus(json.status);

      const errors = (measure?.issues ?? []).filter((i) => i.severity === "error");
      if (errors.length) say("error", `${slot.label} — ${errors[0].msg}`);
      else say("ok", `${slot.label} 올라갔습니다`);
    } catch (e) {
      say("error", `${file.name} — ${e.message}`);
    } finally {
      setBusy((b) => b.filter((n) => n !== file.name));
    }
  }

  async function chooseVariant(slotId, variantId) {
    try {
      const res = await fetch("/api/assets/choose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, variantId }),
      });
      const json = await res.json();
      if (!json.ok) { say("error", json.error || "선택하지 못했습니다"); return; }
      setStatus(json.status);
      say("ok", "선택 반영했습니다");
    } catch (e) {
      say("error", e.message);
    }
  }

  async function deleteVariant(slotId, variantId) {
    try {
      const res = await fetch(
        `/api/assets?slotId=${encodeURIComponent(slotId)}&variantId=${encodeURIComponent(variantId)}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!json.ok) { say("error", json.error || "지우지 못했습니다"); return; }
      setStatus(json.status);
      say("ok", "지웠습니다");
    } catch (e) {
      say("error", e.message);
    }
  }

  async function accept(files) {
    for (const file of files) {
      const { slot } = guessSlot(file.name);
      if (slot) await upload(slot, file);
      else setPending(file);   // 이름으로 못 찾으면 사람에게 물어본다
    }
  }

  const onDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    accept([...e.dataTransfer.files]);
  };

  const rows = useMemo(() => {
    if (!status) return [];
    return status.rows.filter((r) => role === "전체" || r.role === role);
  }, [status, role]);

  const grouped = useMemo(() => {
    const by = {};
    for (const r of rows) (by[r.due] ??= []).push(r);
    return Object.entries(by).sort(([a], [b]) => {
      const key = (d) => (d.includes("/") ? Number(d.split("/")[0]) * 100 + Number(d.split("/")[1]) : 9999);
      return key(a) - key(b);
    });
  }, [rows]);

  if (!status) return <main className={s.wrap}><p className={s.dim}>불러오는 중…</p></main>;

  const { summary, cross, presets } = status;

  return (
    <main
      className={s.wrap}
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { e.preventDefault(); if (--dragDepth.current <= 0) setDragging(false); }}
      onDrop={onDrop}
    >
      {dragging && <div className={s.veil}><span>여기에 놓으세요</span></div>}

      <header className={s.head}>
        <div>
          <h1>정류장 — 파일 올리는 곳</h1>
          <p className={s.dim}>
            파일을 끌어다 놓기만 하면 됩니다. 이름을 보고 알아서 자리를 찾고, 규격도 여기서 봅니다.
            {" "}<a href="/guide" className={s.guideLink}>사용설명서 →</a>
            {" · "}<a href="/todo" className={s.guideLink}>할 일 목록 →</a>
          </p>
        </div>
        <div className={s.counts}>
          <div><b>{summary.augDone}</b><span>/{summary.augTotal} 8월 파일</span></div>
          <div><b>{summary.presetDone}</b><span>/{summary.presetTotal} 조명 프리셋</span></div>
          {taskSummary && (
            <a className={s.countLink} href="/todo">
              <b>{taskSummary.done}</b><span>/{taskSummary.total} 할 일</span>
            </a>
          )}
          {summary.errors > 0 && <div className={s.bad}><b>{summary.errors}</b><span>고칠 것</span></div>}
        </div>
      </header>

      <button className={s.drop} onClick={() => inputRef.current?.click()}>
        <span className={s.dropIcon}>＋</span>
        파일 끌어다 놓기 <span className={s.dim}>또는 눌러서 고르기</span>
        <span className={s.dropHint}>GLB · MP3 · WAV · CSV · 여러 개 한꺼번에</span>
      </button>
      <input
        ref={inputRef} type="file" multiple hidden
        onChange={(e) => { accept([...e.target.files]); e.target.value = ""; }}
      />

      {busy.length > 0 && (
        <p className={s.busy}>재는 중… {busy.join(", ")}</p>
      )}

      <nav className={s.tabs}>
        {ROLES.map((r) => (
          <button key={r} className={role === r ? s.tabOn : s.tab} onClick={() => setRole(r)}>
            {r}
          </button>
        ))}
      </nav>

      {(role === "전체" || role === "아트") && (
        <section className={s.section}>
          <h2>조명 프리셋 <span className={s.dim}>화이트박스에서</span></h2>
          <div className={s.presets}>
            {presets.map((p) => (
              <div key={p.name} className={p.saved ? s.presetOn : s.presetOff}>
                <b>{p.label}</b>
                <code>{p.name}</code>
                <span>{p.saved ? when(p.receivedAt) : "대기"}</span>
              </div>
            ))}
          </div>
          <p className={s.note}>
            <a href="/whitebox">화이트박스</a>에서 조명을 조절하고 「저장」을 누르면 여기 자동으로 뜹니다.
          </p>
        </section>
      )}

      {cross.length > 0 && (role === "전체" || role === "사운드") && (
        <section className={s.section}>
          <h2>서로 비교해야 아는 것 <span className={s.dim}>배경 트랙 4종</span></h2>
          <ul className={s.cross}>
            {cross.map((c) => (
              <li key={c.id} className={c.ok === null ? s.pend : c.ok ? s.pass : s.fail}>
                <span>{c.ok === null ? "…" : c.ok ? "✓" : "!"}</span>
                <b>{c.label}</b>
                <em>{c.detail}</em>
              </li>
            ))}
          </ul>
        </section>
      )}

      {grouped.map(([due, list]) => (
        <section key={due} className={s.section}>
          <h2>{due} <span className={s.dim}>{list.filter((r) => r.uploaded).length}/{list.length}</span></h2>
          <ul className={s.list}>
            {list.map((r) => (
              <Row
                key={r.id}
                row={r}
                onReplace={(f) => upload(r, f)}
                onChoose={(vid) => chooseVariant(r.id, vid)}
                onDeleteVariant={(vid) => deleteVariant(r.id, vid)}
              />
            ))}
          </ul>
        </section>
      ))}

      {pending && (
        <SlotPicker
          file={pending}
          onPick={(slot) => { const f = pending; setPending(null); upload(slot, f); }}
          onCancel={() => setPending(null)}
        />
      )}

      <div className={s.toasts}>
        {toasts.map((t) => (
          <div key={t.id} className={t.kind === "ok" ? s.tOk : s.tBad}>{t.text}</div>
        ))}
      </div>

      <footer className={s.foot}>
        <a href="/guide">사용설명서</a> ·{" "}
        <a href="/whitebox">화이트박스 테스트 환경</a> ·{" "}
        <a href="/todo">할 일 목록</a> ·{" "}
        <a href="/vo">대사 오디오 듣기</a> ·{" "}
        <a href="/sfx">환경 SFX 후보 듣기</a> ·{" "}
        <a href="/story">⭐ 발표용 시나리오 데모</a> ·{" "}
        <a href="/judge">판정 대시보드</a> ·{" "}
        매니페스트는 자동으로 만들어집니다 —{" "}
        <a href="/api/manifest?download=1">내려받기</a> ·{" "}
        <a href="/api/health">백엔드 상태</a>
      </footer>
    </main>
  );
}

function Row({ row, onReplace, onChoose, onDeleteVariant }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const m = row.measure;
  const issues = m?.issues ?? [];

  const chips = [];
  if (m?.durationSec != null) chips.push(`${m.durationSec}초`);
  if (m?.lufsIntegrated != null) chips.push(`${m.lufsIntegrated} LUFS`);
  if (m?.truePeakDb != null) chips.push(`피크 ${m.truePeakDb} dB`);
  if (m?.triangles != null) chips.push(`삼각형 ${m.triangles.toLocaleString()}`);
  if (m?.textures?.length) chips.push(`텍스처 ${m.textures.length}장`);
  if (m?.rows != null) chips.push(`${m.filled}/${m.rows}줄`);
  if (row.bytes != null) chips.push(bytesLabel(row.bytes));

  return (
    <li className={row.uploaded ? (row.errors ? s.rowBad : s.rowOn) : s.rowOff}>
      <div className={s.rowMain} onClick={() => setOpen((o) => !o)}>
        <span className={s.mark}>
          {!row.uploaded ? "○" : row.errors ? "!" : "✓"}
        </span>
        <div className={s.rowText}>
          <b>
            {row.label}
            {row.critical && <em className={s.crit}>중요</em>}
          </b>
          <small>
            {row.uploaded
              ? <>{row.filename} · {when(row.uploadedAt)}</>
              : <>{row.file} · {row.hint || "아직 안 올라옴"}</>}
          </small>
        </div>
        <div className={s.chips}>
          {chips.slice(0, 3).map((c, i) => <span key={i}>{c}</span>)}
        </div>
        {row.templateUrl && (
          <a
            className={s.template}
            href={row.templateUrl}
            download={row.templateName || true}
            onClick={(e) => e.stopPropagation()}
          >
            빈 양식 받기
          </a>
        )}
        <button
          className={s.replace}
          onClick={(e) => { e.stopPropagation(); ref.current?.click(); }}
        >
          {row.uploaded ? "샘플 추가" : "올리기"}
        </button>
        <input
          ref={ref} type="file" hidden
          accept={(KIND_EXT[row.kind] ?? []).join(",")}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onReplace(f); }}
        />
      </div>

      {(open || row.errors > 0) && issues.length > 0 && (
        <ul className={s.issues}>
          {issues.map((i, k) => (
            <li key={k} className={i.severity === "error" ? s.iErr : s.iWarn}>
              {i.severity === "error" ? "고쳐야 함" : "확인"} — {i.msg}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className={s.detail}>
          {row.hint && <p>{row.hint}</p>}
          <p className={s.dim}>담당 {row.role} · 마감 {row.due} · 기대 이름 <code>{row.file}</code></p>
          {m?.byLayer && (
            <p className={s.dim}>
              {Object.entries(m.byLayer).map(([k, v]) => `${k} ${v.filled}/${v.total}`).join(" · ")}
            </p>
          )}
          {m?.truePeakApprox && <p className={s.dim}>트루 피크는 4배 오버샘플 근사입니다</p>}
          {row.variants?.length > 1 ? (
            <VariantList row={row} onChoose={onChoose} onDelete={onDeleteVariant} />
          ) : (
            <Preview row={row} />
          )}
        </div>
      )}
    </li>
  );
}

// 샘플이 둘 이상이면 나란히 놓고 팀이 듣고 고를 수 있게 한다.
function VariantList({ row, onChoose, onDelete }) {
  return (
    <ul className={s.variants}>
      {row.variants.map((v) => {
        const isChosen = v.id === row.chosenId;
        return (
          <li key={v.id} className={isChosen ? s.variantOn : s.variantOff}>
            <div className={s.variantHead}>
              <b>{v.note || v.filename}</b>
              {isChosen ? (
                <span className={s.chosenTag}>선택됨</span>
              ) : (
                <button className={s.chooseBtn} onClick={() => onChoose(v.id)}>이걸로 선택</button>
              )}
              <button className={s.delBtn} onClick={() => onDelete(v.id)}>삭제</button>
            </div>
            {row.kind === "audio" && (
              <audio controls preload="none" src={`/api/assets/file/${row.id}?variant=${v.id}`} className={s.player} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// 다른 팀원이 올라온 파일을 직접 듣거나(오디오) 보게(3D) 하는 부분.
// GLB 뷰어(@google/model-viewer)는 무거워서, 실제로 3D 미리보기를 열 때만 불러온다.
function Preview({ row }) {
  const [show3d, setShow3d] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (show3d && !ready) import("@google/model-viewer").then(() => setReady(true));
  }, [show3d, ready]);

  if (!row.uploaded) return null;
  const fileUrl = `/api/assets/file/${row.id}`;

  if (row.kind === "audio") {
    return <audio controls preload="none" src={fileUrl} className={s.player} />;
  }

  if (row.kind === "dialogue") {
    return (
      <a className={s.previewLink} href={fileUrl} target="_blank" rel="noreferrer">
        새 탭에서 표 보기 →
      </a>
    );
  }

  if (row.kind === "model") {
    return (
      <div>
        <button className={s.previewToggle} onClick={() => setShow3d((v) => !v)}>
          {show3d ? "3D 미리보기 닫기" : "3D 미리보기 보기"}
        </button>
        {show3d && (
          ready ? (
            // eslint-disable-next-line react/no-unknown-property
            <model-viewer
              src={fileUrl}
              camera-controls=""
              auto-rotate=""
              exposure="1"
              style={{ width: "100%", height: 280, marginTop: 8, background: "#0d0f13", borderRadius: 8 }}
            />
          ) : (
            <p className={s.dim}>불러오는 중…</p>
          )
        )}
      </div>
    );
  }

  return null;
}

function SlotPicker({ file, onPick, onCancel }) {
  const ext = extOf(file.name);
  const fits = SLOTS.filter((sl) => (KIND_EXT[sl.kind] ?? []).includes(ext));

  return (
    <div className={s.modalBack} onClick={onCancel}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <h3>어느 자리인가요?</h3>
        <p className={s.dim}>
          <b>{file.name}</b> 은 이름으로 자리를 못 찾았습니다.
          고르시면 다음부터는 이 이름으로 저장됩니다.
        </p>
        <ul className={s.pick}>
          {fits.map((sl) => (
            <li key={sl.id}>
              <button onClick={() => onPick(sl)}>
                <b>{sl.label}</b>
                <span>{sl.role} · {sl.due}</span>
                <code>{sl.file}</code>
              </button>
            </li>
          ))}
          {!fits.length && <li className={s.dim}>{ext} 는 받지 않는 형식입니다</li>}
        </ul>
        <button className={s.cancel} onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}
