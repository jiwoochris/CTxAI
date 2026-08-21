"use client";

// 대사 오디오 듣기 — 정류장_스크립트_v2 46줄을 팀 누구나 들어볼 수 있게.
// ?genre=R 또는 ?genre=H,C 로 트랙만 걸러서 볼 수 있습니다 (할 일 목록의
// "결과 보기" 링크가 이렇게 씁니다).

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DIALOGUE_V2_GENRE_LABEL } from "../../lib/dialogueV2Lines";
import s from "./vo.module.css";

const GENRE_ORDER = ["R", "H", "C"];

function VoBody() {
  const params = useSearchParams();
  const [lines, setLines] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/vo2", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setLines(j.lines ?? []))
      .catch(() => setError("불러오지 못했습니다"));
  }, []);

  const wanted = useMemo(() => {
    const raw = params.get("genre");
    if (!raw) return null;
    return new Set(raw.split(",").map((g) => g.trim().toUpperCase()).filter(Boolean));
  }, [params]);

  const groups = useMemo(() => {
    if (!lines) return [];
    const order = wanted ? GENRE_ORDER.filter((g) => wanted.has(g)) : GENRE_ORDER;
    return order.map((g) => [g, lines.filter((l) => l.genre === g)]).filter(([, l]) => l.length > 0);
  }, [lines, wanted]);

  const total = lines?.length ?? 0;
  const ready = lines?.filter((l) => l.hasAudio).length ?? 0;

  return (
    <main className={s.wrap}>
      <header className={s.head}>
        <div>
          <h1>대사 오디오</h1>
          <p className={s.dim}>
            정류장_스크립트_v2 대사 {total || 46}줄 —{" "}
            <a href="/guide?doc=busstop-script-v2">스크립트 보기 →</a>
          </p>
        </div>
        {lines && <div className={s.count}><b>{ready}</b><span>/{total} 올라옴</span></div>}
      </header>

      {error && <p className={s.err}>{error}</p>}
      {!lines && !error && <p className={s.dim}>불러오는 중…</p>}

      {groups.map(([g, list]) => (
        <section key={g} className={s.section}>
          <h2>{DIALOGUE_V2_GENRE_LABEL[g]} <span className={s.dim}>{list.length}줄</span></h2>
          <ul className={s.list}>
            {list.map((l) => (
              <li key={l.slotId} className={s.item}>
                <span className={s.seq}>{g}-{l.seq}</span>
                <span className={s.text}>{l.text}</span>
                {l.hasAudio ? (
                  <audio className={s.player} controls preload="none" src={`/api/vo2/file/${l.slotId}`} />
                ) : (
                  <span className={s.missing}>아직 없음</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className={s.foot}>
        <a href="/">← 대시보드</a>
        {" · "}<a href="/todo">할 일 목록</a>
      </footer>
    </main>
  );
}

export default function VoPage() {
  return (
    <Suspense fallback={<main className={s.wrap}><p className={s.dim}>불러오는 중…</p></main>}>
      <VoBody />
    </Suspense>
  );
}
