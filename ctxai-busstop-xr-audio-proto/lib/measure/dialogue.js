// 대사 표 검사 — 순수 함수. 브라우저·서버 양쪽에서 씁니다.
//
// 기획이 Sheets 에서 CSV 로 내보내 올리면 그 자리에서 봅니다.
// 규격: Bus/규격/대사양식_v2.csv (장르·순번·대사·최대길이(초)·감정태그·파일명)
//
// v1.1 양식(층·배합ID·사건·태도·16조합·{noun} 콜백)은 V2에서 빠졌습니다 — 연속
// 블렌딩으로 방향을 바꾸면서 사건과 태도를 배합해 만들던 표가 장르별 고정 대사
// 목록으로 단순해졌기 때문입니다 (Bus/규격/방향전환_업무재분장.md).

import { GENRES } from "../assetSpec";

const REQUIRED = ["장르", "순번", "대사", "최대길이(초)", "감정태그", "파일명"];
const CHARS_PER_SEC = 5.5; // 한국어 TTS 대략치 — 넘어도 막지 않고 알려만 줍니다

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (c === "\r") continue;
    cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export function measureDialogue(text) {
  const out = { kind: "dialogue", issues: [] };
  const add = (severity, msg) => out.issues.push({ severity, msg });

  const rows = parseCsv(text);
  if (rows.length < 2) {
    add("error", "빈 표입니다");
    return out;
  }

  const header = rows[0].map((h) => h.trim());
  const missing = REQUIRED.filter((k) => !header.includes(k));
  if (missing.length) {
    add("error", `열이 없습니다: ${missing.join(", ")} — 양식의 열 이름을 바꾸지 말아 주세요`);
    return out;
  }

  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const data = rows.slice(1);
  const get = (r, k) => (r[col[k]] ?? "").trim();

  out.rows = data.length;
  out.filled = data.filter((r) => get(r, "대사")).length;
  out.empty = out.rows - out.filled;
  out.emotionTagged = data.filter((r) => get(r, "감정태그")).length;

  // 장르별 채움 현황 + 잘못된 장르 코드
  out.byGenre = {};
  const badGenre = new Set();
  const seenSeq = {}; // genre -> Set(순번)
  const dupeSeq = [];
  for (const r of data) {
    const genre = get(r, "장르") || "(빈칸)";
    const b = (out.byGenre[genre] ??= { total: 0, filled: 0 });
    b.total++;
    if (get(r, "대사")) b.filled++;
    if (genre !== "(빈칸)" && !GENRES.includes(genre)) badGenre.add(genre);

    const seq = get(r, "순번");
    if (seq) {
      const set = (seenSeq[genre] ??= new Set());
      if (set.has(seq)) dupeSeq.push(`${genre}/${seq}`);
      set.add(seq);
    }
  }
  if (badGenre.size) {
    add("error", `모르는 장르 코드입니다: ${[...badGenre].join(", ")} — ${GENRES.join("/")} 중 하나여야 합니다`);
  }
  if (dupeSeq.length) {
    add("error", `같은 장르에 순번이 겹칩니다: ${dupeSeq.slice(0, 5).join(", ")}${dupeSeq.length > 5 ? " …" : ""}`);
  }

  // 줄 단위 검사 — 채워진 행만
  const longRows = [], badFilename = [];
  for (const r of data) {
    const line = get(r, "대사");
    if (!line) continue;
    const genre = get(r, "장르");
    const seq = get(r, "순번");
    const max = Number(get(r, "최대길이(초)")) || 0;
    const filename = get(r, "파일명");

    if (max && line.length > max * CHARS_PER_SEC) {
      longRows.push(`${genre}/${seq} (${line.length}자, ${max}초)`);
    }

    const expected = `vo_${genre}_${seq}.mp3`;
    if (filename && genre && seq && filename !== expected) {
      badFilename.push(`${genre}/${seq}: "${filename}" (기대: "${expected}")`);
    }
  }

  if (longRows.length) {
    add("warn", `길이를 넘는 줄 ${longRows.length}개 — 합성 뒤 실제 길이로 다시 봅니다: ${longRows.slice(0, 5).join(", ")}${longRows.length > 5 ? " …" : ""}`);
  }
  if (badFilename.length) {
    add("warn", `파일명이 "vo_{장르}_{순번}.mp3" 패턴과 다릅니다 (${badFilename.slice(0, 5).join(", ")}${badFilename.length > 5 ? " …" : ""}) — scripts/synthesize-dialogue.mjs가 이 칸을 그대로 믿고 합성하니 확인해 주세요`);
  }

  return out;
}
