"use client";

// 문서 뷰어 — public/*.md 를 읽어 렌더링만 합니다. 기본은 대시보드 사용설명서(guide.md).
// ?doc=dialogue-format-guide 처럼 주면 public/dialogue-format-guide.md 를 보여줍니다.
// 원본은 Bus/규격/ 아래 같은 내용의 .md 와 동일 — 두 군데 손으로 맞추지 않도록 여기서는 표시만 합니다.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { marked } from "marked";
import s from "./guide.module.css";

const SAFE_DOC = /^[a-z0-9_-]+$/i;

function GuideBody() {
  const params = useSearchParams();
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const requested = params.get("doc") || "guide";
    const doc = SAFE_DOC.test(requested) ? requested : "guide";

    setHtml(null);
    setError(false);
    fetch(`/${doc}.md`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((md) => setHtml(marked.parse(md)))
      .catch(() => setError(true));
  }, [params]);

  return (
    <>
      {error && <p className={s.dim}>문서를 불러오지 못했습니다.</p>}
      {!error && !html && <p className={s.dim}>불러오는 중…</p>}
      {html && <article className={s.doc} dangerouslySetInnerHTML={{ __html: html }} />}
    </>
  );
}

export default function GuidePage() {
  return (
    <main className={s.wrap}>
      <Suspense fallback={<p className={s.dim}>불러오는 중…</p>}>
        <GuideBody />
      </Suspense>
      <footer className={s.foot}>
        <a href="/">← 파일 올리는 곳</a>
      </footer>
    </main>
  );
}
