"use client";

// 아트용 — 프리셋 도구 설치 안내.
// 북마크릿을 한 번 드래그해두면 그 뒤로는 클릭 한 번입니다.

import { useEffect, useState } from "react";
import s from "./tool.module.css";

export default function ToolPage() {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const bookmarklet = origin
    ? `javascript:(function(){window.CTX_PRESET_SERVER=${JSON.stringify(origin)};var s=document.createElement('script');s.src=${JSON.stringify(origin + "/preset-tool.js")}+'?'+Date.now();s.onerror=function(){alert('스크립트를 불러오지 못했습니다.\\n\\n에디터가 외부 스크립트를 막고 있을 수 있습니다.\\n아래 2번 방법(콘솔에 붙여넣기)을 써 주세요.')};document.body.appendChild(s)})()`
    : "";

  async function copyScript() {
    try {
      const text = await (await fetch("/preset-tool.js")).text();
      await navigator.clipboard.writeText(`window.CTX_PRESET_SERVER=${JSON.stringify(origin)};\n${text}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch (e) {
      window.open("/preset-tool.js", "_blank");
    }
  }

  return (
    <main className={s.wrap}>
      <header>
        <h1>조명 프리셋 도구</h1>
        <p className={s.dim}>
          PlayCanvas 에디터에서 조명을 조절하고 「저장」을 누르면 개발에게 바로 갑니다.
          파일을 보내실 필요 없습니다.
        </p>
      </header>

      <section className={s.step}>
        <h2><span>1</span> 아래 버튼을 북마크 바로 끌어다 놓으세요</h2>
        <p className={s.dim}>한 번만 하시면 됩니다. 북마크 바가 안 보이면 <b>⌘⇧B</b> (Windows는 <b>Ctrl+Shift+B</b>).</p>
        <div className={s.dragRow}>
          <a className={s.bm} href={bookmarklet} onClick={(e) => e.preventDefault()}>
            💡 정류장 프리셋
          </a>
          <span className={s.arrow}>← 이걸 북마크 바로 드래그</span>
        </div>
      </section>

      <section className={s.step}>
        <h2><span>2</span> 에디터에서 누르세요</h2>
        <p>
          PlayCanvas <b>편집 화면</b>을 열고 방금 만든 북마크를 누르면
          오른쪽 위에 패널이 뜹니다. 프리셋을 고르고 <b>저장</b>만 누르면 끝입니다.
        </p>
        <p className={s.dim}>
          Launch(미리보기) 화면 말고 편집 화면이어야 합니다. 새로고침하면 다시 눌러 주세요.
        </p>
      </section>

      <section className={s.alt}>
        <h3>북마크릿이 안 될 때</h3>
        <p className={s.dim}>
          에디터가 외부 스크립트를 막으면 북마크가 안 뜹니다. 그때는 이 방법을 쓰세요.
        </p>
        <ol>
          <li>에디터에서 <b>F12</b> (Mac은 <b>⌥⌘I</b>) → 위쪽 <b>Console</b> 탭</li>
          <li>아래 버튼으로 복사한 뒤 콘솔에 붙여넣고 Enter</li>
        </ol>
        <button className={s.copy} onClick={copyScript}>
          {copied ? "복사했습니다 ✓" : "스크립트 복사"}
        </button>
      </section>

      <section className={s.alt}>
        <h3>만드실 것 — 다섯 장</h3>
        <ul className={s.list}>
          <li><code>lp_neutral</code> 중립 — 체험 시작 ~ 1:40. 가장 오래 보는 화면</li>
          <li><code>lp_H</code> 🖤 공포</li>
          <li><code>lp_R</code> 💗 로맨스</li>
          <li><code>lp_C</code> 💛 코미디</li>
          <li><code>lp_F</code> 💜 판타지</li>
        </ul>
        <p className={s.dim}>
          조합 프리셋(<code>lp_R-H</code> 같은 것)은 만들지 마세요. 열여섯 배합은
          코드가 이 다섯 장 중 두 장을 섞어 만듭니다.
        </p>
        <p className={s.dim}>
          8월 합격 기준은 <b>넷이 서로 구분되는가</b> 하나입니다. 거칠어도 됩니다.
        </p>
      </section>

      <footer className={s.foot}>
        <a href="/team">← 파일 올리는 곳</a>
      </footer>
    </main>
  );
}
