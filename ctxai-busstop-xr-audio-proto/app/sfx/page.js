"use client";

// 환경 SFX 후보 듣기 — 스톡에서 받아온 17개 후보를 팀 누구나 들어볼 수 있게.
// 최종 선택은 아직 안 났습니다 — 여기서 듣고 골라주세요.

import { useEffect, useState } from "react";
import { SFX_CANDIDATES } from "../../lib/sfxCandidates";
import s from "./sfx.module.css";

export default function SfxPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/sfx", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []))
      .catch(() => setError("불러오지 못했습니다"));
  }, []);

  const total = items?.length ?? SFX_CANDIDATES.length;
  const ready = items?.filter((i) => i.hasAudio).length ?? 0;

  return (
    <main className={s.wrap}>
      <header className={s.head}>
        <div>
          <h1>환경 SFX 후보</h1>
          <p className={s.dim}>
            스톡(Freesound CC0 · Pixabay 로열티프리)에서 받아온 후보 {total}개 — 최종 선택은 아직 안 났습니다.
            {" "}<a href="/guide?doc=sfx-candidates">출처·라이선스 목록 보기 →</a>
          </p>
        </div>
        {items && <div className={s.count}><b>{ready}</b><span>/{total} 올라옴</span></div>}
      </header>

      {error && <p className={s.err}>{error}</p>}
      {!items && !error && <p className={s.dim}>불러오는 중…</p>}

      <ul className={s.list}>
        {(items ?? []).map((i) => (
          <li key={i.slotId} className={s.item}>
            <div className={s.itemText}>
              <b>{i.label}</b>
              {i.note && <small>{i.note}</small>}
            </div>
            {i.hasAudio ? (
              <audio className={s.player} controls preload="none" src={`/api/sfx/file/${i.slotId}`} />
            ) : (
              <span className={s.missing}>아직 없음</span>
            )}
          </li>
        ))}
      </ul>

      <footer className={s.foot}>
        <a href="/">← 대시보드</a>
        {" · "}<a href="/todo">할 일 목록</a>
      </footer>
    </main>
  );
}
