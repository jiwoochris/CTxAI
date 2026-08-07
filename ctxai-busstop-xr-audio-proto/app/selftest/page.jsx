"use client";

// 이 브라우저에서 측정이 되는가.
//
// 측정은 브라우저가 합니다. Safari 의 decodeAudioData, IIRFilterNode 지원처럼
// 브라우저마다 다른 부분이 있어서, 팀원이 자기 브라우저에서 한 번 눌러 보고
// 「됩니다」를 확인할 수 있게 해 둡니다.
//
// 절대 기준값을 외워 두는 대신 자기모순이 없는지를 봅니다 —
// 같은 소리를 6 dB 차이로 재면 LUFS 도 6 dB 차이가 나야 합니다.

import { useState } from "react";
import { measureAudio } from "@/lib/measure/audio";
import { measureDialogue } from "@/lib/measure/dialogue";
import s from "../tool/tool.module.css";

// 사인파 WAV 를 만든다 (16-bit PCM, 48kHz, 모노)
function makeWav({ freq = 1000, seconds = 3, amp = 0.1, rate = 48000 }) {
  const n = Math.floor(seconds * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));

  str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, "data"); dv.setUint32(40, n * 2, true);

  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / rate) * amp;
    dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true);
  }
  return new File([buf], "selftest.wav", { type: "audio/wav" });
}

// 정상 케이스는 16벌을 다 갖춰야 합니다 — 실제로 올라올 표와 같은 모양
const CSV_OK = (() => {
  const codes = ["H", "R", "C", "F"];
  const rows = ["층,배합ID,사건,태도,배합이름,순번,대사,최대길이(초),감정태그,파일명"];
  for (const ev of codes) {
    for (const at of codes) {
      const id = `${ev}-${at}`;
      rows.push(`배합,${id},사건,태도,,1,그 사람은 늘 늦었어요.,5,,vo_${id}_1.mp3`);
      rows.push(`배합,${id},사건,태도,,cb,...아직 그 {noun|은:는} 안 왔네요.,4,,vo_${id}_cb.mp3`);
      rows.push(`배합,${id},사건,태도,,cb_fb,...아직 안 오네요.,4,,vo_${id}_cb_fb.mp3`);
    }
  }
  return rows.join("\n");
})();

const CSV_BAD = [
  "층,배합ID,사건,태도,배합이름,순번,대사,최대길이(초),감정태그,파일명",
  "배합,R-H,로맨스,공포,경계하는 그리움,cb,아직 안 왔네요.,4,,vo_R-H_cb.mp3",
  "배합,R-H,로맨스,공포,경계하는 그리움,cb_fb,...아직 그 {noun} 안 왔네요.,4,,vo_R-H_cb_fb.mp3",
  "배합,R-H,로맨스,공포,경계하는 그리움,1,{noun|이} 오기로 했었나요.,5,,vo_R-H_1.mp3",
].join("\n");

export default function SelfTest() {
  const [rows, setRows] = useState(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const out = [];
    const push = (name, pass, detail) => out.push({ name, pass, detail });

    try {
      // ── 오디오 ──
      const loud = await measureAudio(makeWav({ amp: 0.2 }));
      const quiet = await measureAudio(makeWav({ amp: 0.1 })); // 정확히 6.02 dB 아래
      const full = await measureAudio(makeWav({ amp: 1.0 }));

      push("디코딩", !loud.error, loud.error || `${loud.durationSec}초 · ${loud.sampleRate}Hz · ${loud.channels}ch`);
      push("길이", Math.abs(loud.durationSec - 3) < 0.05, `${loud.durationSec}초 (기대 3)`);

      const hasLufs = typeof loud.lufsIntegrated === "number" && typeof quiet.lufsIntegrated === "number";
      push("LUFS 측정됨", hasLufs, hasLufs ? `${loud.lufsIntegrated} / ${quiet.lufsIntegrated}` : "IIRFilterNode 미지원일 수 있습니다");

      if (hasLufs) {
        const diff = loud.lufsIntegrated - quiet.lufsIntegrated;
        push("LUFS 선형성", Math.abs(diff - 6.02) < 0.3, `6 dB 차이 → ${diff.toFixed(2)} dB (기대 6.02)`);
      }

      push("트루 피크 (풀스케일)", Math.abs(full.truePeakDb) < 0.6, `${full.truePeakDb} dBFS (기대 ≈ 0)`);
      push("트루 피크 (−14 dB)", Math.abs(loud.truePeakDb + 13.98) < 0.6, `${loud.truePeakDb} dBFS (기대 ≈ −14.0)`);

      // ── 대사 표 ──
      const good = measureDialogue(CSV_OK);
      push("대사 표 — 정상", good.issues.filter((i) => i.severity === "error").length === 0,
        `${good.filled}/${good.rows}줄 채움`);

      const bad = measureDialogue(CSV_BAD);
      const msgs = bad.issues.map((i) => i.msg).join(" | ");
      push("대사 표 — 폴백에 {noun}", /폴백에 \{noun\}/.test(msgs), "잡아냄");
      push("대사 표 — 콜백에 {noun} 없음", /콜백에 \{noun\} 이 없습니다/.test(msgs), "잡아냄");
      push("대사 표 — 조사 형식 오류", /조사 형식/.test(msgs), "잡아냄");
    } catch (e) {
      push("실행", false, e.message);
    }

    setRows(out);
    setRunning(false);
  }

  const passed = rows?.filter((r) => r.pass).length ?? 0;

  return (
    <main className={s.wrap}>
      <h1>측정 자가 진단</h1>
      <p className={s.dim}>
        파일 측정(LUFS · 트루 피크 · 대사 표 검사)은 이 브라우저가 합니다.
        여기서 전부 통과하면 올리실 때도 제대로 재집니다.
      </p>

      <button className={s.copy} onClick={run} disabled={running}>
        {running ? "재는 중…" : "검사 실행"}
      </button>

      {rows && (
        <>
          <p style={{ marginTop: 20, fontWeight: 700 }}>
            {passed}/{rows.length} 통과
          </p>
          <ul className={s.list} style={{ marginTop: 8 }}>
            {rows.map((r, i) => (
              <li key={i} style={{ color: r.pass ? "#7fd67f" : "#f08c8c", padding: "4px 0" }}>
                {r.pass ? "✓" : "✗"} {r.name}
                <span style={{ color: "#8c9098", marginLeft: 8, fontSize: 13 }}>{r.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <footer className={s.foot}><a href="/">← 파일 올리는 곳</a></footer>
    </main>
  );
}
