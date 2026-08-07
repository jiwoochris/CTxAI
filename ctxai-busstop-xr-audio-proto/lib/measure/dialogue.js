// 대사 표 검사 — 순수 함수. 브라우저·서버 양쪽에서 씁니다.
//
// 기획이 Sheets 에서 CSV 로 내보내 올리면 그 자리에서 봅니다.
// 규격: Bus/규격/대사양식_작성법.md

const REQUIRED = ["층", "배합ID", "사건", "태도", "순번", "대사", "최대길이(초)", "파일명"];
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

  // 배합 16벌
  const ids = new Set(data.filter((r) => get(r, "층") === "배합").map((r) => get(r, "배합ID")));
  out.combinations = ids.size;
  if (ids.size && ids.size !== 16) {
    add("error", `배합이 ${ids.size}개입니다 — 사건 4 × 태도 4 = 16 이어야 합니다`);
  }

  // 층별 채움 현황
  out.byLayer = {};
  for (const r of data) {
    const layer = get(r, "층") || "(빈칸)";
    const b = (out.byLayer[layer] ??= { total: 0, filled: 0 });
    b.total++;
    if (get(r, "대사")) b.filled++;
  }

  // 줄 단위 검사 — 채워진 행만
  const longRows = [], fbWithNoun = [], cbWithoutNoun = [], badParticle = [];
  for (const r of data) {
    const line = get(r, "대사");
    if (!line) continue;
    const id = get(r, "배합ID");
    const seq = get(r, "순번");
    const max = Number(get(r, "최대길이(초)")) || 0;

    if (max && line.length > max * CHARS_PER_SEC) {
      longRows.push(`${id}/${seq} (${line.length}자, ${max}초)`);
    }
    if (seq === "cb_fb" && line.includes("{noun}")) fbWithNoun.push(`${id}/${seq}`);
    if (seq === "cb" && !line.includes("{noun}")) cbWithoutNoun.push(`${id}/${seq}`);

    // {noun|이:가} 형식 검사
    for (const m of line.matchAll(/\{noun(\|[^}]*)?\}/g)) {
      const suffix = m[1];
      if (suffix && !/^\|[^:|]+:[^:|]+$/.test(suffix)) {
        badParticle.push(`${id}/${seq}: ${m[0]}`);
      }
    }
  }

  if (longRows.length) {
    add("warn", `길이를 넘는 줄 ${longRows.length}개 — 합성 뒤 실제 길이로 다시 봅니다: ${longRows.slice(0, 5).join(", ")}${longRows.length > 5 ? " …" : ""}`);
  }
  if (fbWithNoun.length) {
    add("error", `폴백에 {noun} 이 들어 있습니다 (${fbWithNoun.join(", ")}). 폴백은 명사 없이 완결돼야 합니다`);
  }
  if (cbWithoutNoun.length) {
    add("warn", `콜백에 {noun} 이 없습니다 (${cbWithoutNoun.slice(0, 5).join(", ")}). 관객 단어가 안 들어갑니다`);
  }
  if (badParticle.length) {
    add("error", `조사 형식이 틀렸습니다 (${badParticle.slice(0, 3).join(", ")}). {noun|이:가} 처럼 「받침있음:받침없음」 두 개여야 합니다`);
  }

  // 사건 대사는 태도 중립이어야 하므로 태도 칸이 비었거나 (중립)
  const eventWithAttitude = data.filter(
    (r) => get(r, "층") === "사건" && get(r, "태도") && get(r, "태도") !== "(중립)"
  );
  if (eventWithAttitude.length) {
    add("warn", `사건 층에 태도가 적힌 행이 ${eventWithAttitude.length}개 있습니다 — 사건 대사는 태도 중립이어야 합니다`);
  }

  return out;
}
