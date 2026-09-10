"use client";

// 두 관객 비교 — "너 나랑 다른 걸 봤네".
// 원 제안서와 요청서 v5.0이 원한 장치(체험 뒤 두 사람이 카드를 비교하는 자리)를
// data/sessions/ 에 자동 저장된 연출 궤적으로 만든다. 같은 정류장, 같은 다섯 사건인데
// 두 사람의 하늘이 언제부터 어떻게 갈렸는지가 그래프 하나로 보인다.
//
// /film/compare            → 최근 두 세션
// /film/compare?a=<id>&b=<id>

import { useEffect, useMemo, useState } from "react";
import s from "../../story/story.module.css";
import f from "../film.module.css";

const GENRE = { R: { label: "로맨스", accent: "#f2a7c0" }, H: { label: "공포", accent: "#8fae95" }, C: { label: "블랙코미디", accent: "#e0a86a" } };
const EVENT_LABEL = { poster: "포스터", cafeBell: "우비 인물", truckSplash: "물보라", frog: "개구리", cat: "고양이", catScream: "비명" };

function useQuery() {
  const [q, setQ] = useState({});
  useEffect(() => { setQ(Object.fromEntries(new URLSearchParams(window.location.search).entries())); }, []);
  return q;
}

function Chart({ a, b }) {
  const W = 900, H = 220, PAD = 10;
  const tMax = Math.max(a?.trajectory?.at(-1)?.t || 1, b?.trajectory?.at(-1)?.t || 1);
  const x = (t) => PAD + (t / tMax) * (W - PAD * 2);
  const y = (v) => H - PAD - v * (H - PAD * 2);
  const path = (tr, g) => tr.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[g]).toFixed(1)}`).join(" ");
  const marks = (a?.events || []).filter((e) => e.kind === "event" && e.name === "event:start");
  return (
    <svg className={f.chart} style={{ height: 220 }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {marks.map((m, i) => (
        <g key={i}>
          <line x1={x(m.t)} x2={x(m.t)} y1={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
          <text x={x(m.t) + 3} y={PAD + 10 + (i % 3) * 11} fill="rgba(255,255,255,0.45)" fontSize="9">{EVENT_LABEL[m.detail?.name] || m.detail?.name}</text>
        </g>
      ))}
      {["R", "H", "C"].map((g) => (
        <g key={g}>
          {a?.trajectory && <path d={path(a.trajectory, g)} fill="none" stroke={GENRE[g].accent} strokeWidth="2.2" />}
          {b?.trajectory && <path d={path(b.trajectory, g)} fill="none" stroke={GENRE[g].accent} strokeWidth="2.2" strokeDasharray="6 4" opacity="0.85" />}
        </g>
      ))}
    </svg>
  );
}

function describe(sess) {
  if (!sess) return "";
  const fin = sess.final?.current || {};
  const top = ["R", "H", "C"].sort((p, q) => (fin[q] || 0) - (fin[p] || 0));
  const ev = (sess.headPose?.events || []);
  const looked = ev.filter((e) => e.feats?.looked).map((e) => EVENT_LABEL[e.name] || e.name);
  const notLooked = ev.filter((e) => !e.feats?.looked).map((e) => EVENT_LABEL[e.name] || e.name);
  return `옆에 앉은 사람 ${GENRE[sess.dominant]?.label || "-"} · 마지막 배합 ${top.map((g) => `${GENRE[g].label} ${Math.round((fin[g] || 0) * 100)}%`).join(" · ")}`
    + (looked.length ? ` · 본 것: ${looked.join(", ")}` : "") + (notLooked.length ? ` · 안 본 것: ${notLooked.join(", ")}` : "")
    + (sess.selfReport ? ` · 본인 느낌: ${GENRE[sess.selfReport]?.label}` : "");
}

function diverge(a, b) {
  if (!a?.trajectory || !b?.trajectory) return null;
  const bt = b.trajectory;
  for (const p of a.trajectory) {
    const q = bt.find((z) => Math.abs(z.t - p.t) < 0.6);
    if (!q) continue;
    const d = Math.abs(p.R - q.R) + Math.abs(p.H - q.H) + Math.abs(p.C - q.C);
    if (d > 0.35) return p.t;
  }
  return null;
}

export default function ComparePage() {
  const q = useQuery();
  const [list, setList] = useState([]);
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const [ids, setIds] = useState({ a: null, b: null });

  useEffect(() => {
    fetch("/api/session").then((r) => r.json()).then((j) => {
      const items = (j.items || []).slice().reverse();
      setList(items);
      const ia = q.a || items[0]?.id || null;
      const ib = q.b || items.find((i) => i.id !== ia)?.id || null;
      setIds({ a: ia, b: ib });
    }).catch(() => {});
  }, [q.a, q.b]);

  useEffect(() => {
    if (ids.a) fetch(`/api/session?id=${encodeURIComponent(ids.a)}`).then((r) => r.json()).then((j) => setA(j.session || null));
    if (ids.b) fetch(`/api/session?id=${encodeURIComponent(ids.b)}`).then((r) => r.json()).then((j) => setB(j.session || null));
  }, [ids]);

  const divergeAt = useMemo(() => diverge(a, b), [a, b]);
  const same = a && b && a.dominant === b.dominant;

  return (
    <div className={s.stage} style={{ overflow: "auto" }}>
      <div className={s.topBar}>
        <a className={s.homeLink} href="/film">← /film</a>
        <span className={s.dim}>두 관객 비교 · 같은 정류장, 다른 하늘</span>
        <span />
      </div>
      <div style={{ maxWidth: 960, margin: "70px auto 40px", padding: "0 20px" }}>
        <h1 className={f.endTitle} style={{ fontSize: 26 }}>
          {a && b ? (same ? `둘 다 ${GENRE[a.dominant].label}였지만, 같은 밤은 아니었습니다` : `A는 ${GENRE[a.dominant]?.label}, B는 ${GENRE[b.dominant]?.label}를 만났습니다`) : "세션을 고르세요"}
        </h1>
        <p className={f.endSub}>
          {divergeAt != null ? `두 정류장은 ${Math.floor(divergeAt / 60)}:${String(Math.floor(divergeAt % 60)).padStart(2, "0")} 부터 갈라졌습니다.` : a && b ? "두 궤적이 거의 같습니다." : ""}
        </p>
        <Chart a={a} b={b} />
        <div className={f.legend}>
          {["R", "H", "C"].map((g) => <span key={g}><i style={{ background: GENRE[g].accent }} />{GENRE[g].label}</span>)}
          <span className={s.dim}>실선 A · 점선 B</span>
        </div>
        {[["A", a, "a"], ["B", b, "b"]].map(([label, sess, key]) => (
          <div key={key} style={{ margin: "10px 0 16px", padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
              <b>{label}</b>
              <select value={ids[key] || ""} onChange={(e) => setIds((p) => ({ ...p, [key]: e.target.value }))} style={{ background: "rgba(0,0,0,0.4)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 8px", fontSize: 12 }}>
                {list.map((i) => <option key={i.id} value={i.id}>{i.savedAt?.slice(5, 16).replace("T", " ")} · {GENRE[i.dominant]?.label || "-"}{i.selfReport ? ` (본인 ${GENRE[i.selfReport]?.label})` : ""}</option>)}
              </select>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.75)" }}>{describe(sess)}</p>
          </div>
        ))}
        <p className={s.dim} style={{ fontSize: 12 }}>세션은 /film 종료 시 data/sessions/ 에 자동 저장됩니다. 전시에서는 두 사람이 이 화면을 나란히 보는 자리를 체험 자리와 떨어뜨려 두세요 (요청서 v5.0 §3.3 마이크 오염).</p>
      </div>
    </div>
  );
}
