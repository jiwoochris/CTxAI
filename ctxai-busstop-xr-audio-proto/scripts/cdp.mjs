// 최소 CDP 클라이언트 — Node 22+ 내장 WebSocket 사용. 헤드리스 크롬(--remote-debugging-port)에 붙어
// 페이지를 열고, JS 를 평가하고, 스크린샷을 찍는다. Aside 의 120초 제한과 화면 캡처의 창 겹침 문제를 피한다.
//
//   node scripts/cdp.mjs open <port> <url>              → targetId 출력 (새 탭)
//   node scripts/cdp.mjs eval <port> <targetId> "<js>"  → 결과 JSON 출력
//   node scripts/cdp.mjs shot <port> <targetId> <out.png>
//   node scripts/cdp.mjs loop <port> <targetId> <dir> <intervalSec> <count>   → dir/fNNN.png, 끝나면 dir/DONE
//   node scripts/cdp.mjs close <port> <targetId>

import fs from "node:fs";
import path from "node:path";

const [cmd, port, ...rest] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;

async function targets() { return (await fetch(`${base}/json`)).json(); }

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const mid = ++id; pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { ws.close(); },
    });
    ws.onerror = (e) => reject(new Error("ws error " + (e.message || "")));
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) {
        const p = pending.get(d.id); pending.delete(d.id);
        d.error ? p.rej(new Error(d.error.message)) : p.res(d.result);
      }
    };
  });
}

async function attach(targetId) {
  const t = (await targets()).find((x) => x.id === targetId);
  if (!t) throw new Error("target not found: " + targetId);
  return connect(t.webSocketDebuggerUrl);
}

async function evalIn(c, js) {
  const r = await c.send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description || ""));
  return r.result.value;
}

async function shot(c, out) {
  const r = await c.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(out, Buffer.from(r.data, "base64"));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (cmd === "open") {
  const url = rest[0];
  const r = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const t = await r.json();
  console.log(t.id);
} else if (cmd === "drag") {
  // 마우스 드래그 (OrbitControls 로 고개 돌리기): drag <port> <targetId> x1 y1 x2 y2
  const [targetId, x1, y1, x2, y2] = rest;
  const c = await attach(targetId);
  const steps = 12;
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: +x1, y: +y1, button: "left", clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: +x1 + ((+x2 - +x1) * i) / steps, y: +y1 + ((+y2 - +y1) * i) / steps, button: "left" });
    await sleep(30);
  }
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: +x2, y: +y2, button: "left", clickCount: 1 });
  c.close();
} else if (cmd === "close") {
  await fetch(`${base}/json/close/${rest[0]}`);
} else if (cmd === "eval") {
  const c = await attach(rest[0]);
  console.log(JSON.stringify(await evalIn(c, rest[1]), null, 1));
  c.close();
} else if (cmd === "shot") {
  const c = await attach(rest[0]);
  await c.send("Page.enable");
  await shot(c, rest[1]);
  c.close();
} else if (cmd === "loop") {
  const [targetId, dir, interval, count] = rest;
  fs.mkdirSync(dir, { recursive: true });
  const c = await attach(targetId);
  await c.send("Page.enable");
  const t0 = Date.now();
  for (let i = 0; i < Number(count); i++) {
    const sec = Math.round((Date.now() - t0) / 1000);
    const out = path.join(dir, `f${String(sec).padStart(3, "0")}.png`);
    try { await shot(c, out); } catch (e) { fs.writeFileSync(path.join(dir, `err_${sec}.txt`), String(e)); }
    // HUD 텍스트도 같이 남긴다 (상태 수치 확인용)
    try {
      const hud = await evalIn(c, `(() => { const b = document.body.innerText; const i = b.indexOf('연출 상태'); const j = b.indexOf('가로등 점등'); const s = i >= 0 ? b.slice(i, j > i ? j : i + 260) : ''; const sub = document.querySelector('[class*=subtitle],[class*=caption]'); return (s + (sub ? ' || ' + sub.innerText : '')).replace(/\\n+/g, ' | ').slice(0, 400); })()`);
      if (hud) fs.appendFileSync(path.join(dir, "hud.txt"), `${sec}\t${hud}\n`);
    } catch {}
    await sleep(Number(interval) * 1000);
  }
  fs.writeFileSync(path.join(dir, "DONE"), new Date().toISOString());
  c.close();
} else {
  console.log("usage: open|close|eval|shot|loop");
  process.exit(1);
}
