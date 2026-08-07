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
        <h2><span>1</span> 아래 버튼을 북마크 바로 끌어다 놓으세요 (한 번만)</h2>
        <p className={s.dim}>
          버튼을 그냥 누르는 걸로는 안 됩니다 — 브라우저가 웹페이지에서 클릭 한 번으로
          북마크를 만드는 걸 막아 놔서, 이 방법(끌어다 놓기)이 유일합니다. 딱 한 번만 하시면 됩니다.
        </p>
        <ol className={s.miniSteps}>
          <li>화면 위쪽에 북마크 바가 보이는지 확인하세요. 안 보이면 <b>⌘⇧B</b> (Windows는 <b>Ctrl+Shift+B</b>)</li>
          <li>아래 노란 버튼을 마우스로 누른 채로 그 북마크 바까지 끌고 가서 손을 떼세요</li>
          <li>북마크 바에 <b>💡 정류장 프리셋</b>이 생기면 성공입니다</li>
        </ol>
        <div className={s.dragRow}>
          <a className={s.bm} href={bookmarklet} onClick={(e) => e.preventDefault()}>
            💡 정류장 프리셋
          </a>
          <span className={s.arrow}>← 이걸 북마크 바로 드래그</span>
        </div>
      </section>

      <section className={s.step}>
        <h2><span>2</span> 조명을 저장하고 싶을 때마다 누르세요</h2>
        <p>
          PlayCanvas <b>편집 화면</b>(Launch 미리보기 아님)에서 조명·안개 등을 조절하다가,
          <b> 저장하고 싶은 순간에</b> 방금 만든 북마크를 누르세요. 오른쪽 위에 작은 창이 뜨고,
          거기서 프리셋 이름을 고르고 <b>저장</b> 버튼만 누르면 개발에게 바로 전달됩니다.
        </p>
        <p className={s.dim}>
          한 번 누르고 끝나는 게 아닙니다 — 조명을 계속 만지는 동안 저장하고 싶을 때마다
          다시 누르시면 됩니다. 페이지를 새로고침하면 창이 사라지니, 그럴 때도 다시 눌러 주세요.
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
        <a href="/">← 파일 올리는 곳</a>
      </footer>
    </main>
  );
}
