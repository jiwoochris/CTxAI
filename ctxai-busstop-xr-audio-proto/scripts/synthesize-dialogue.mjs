#!/usr/bin/env node
// 대사 배치 합성 — Bus/규격/대사양식_v2.csv → assets/vo/*.mp3
//
//   node scripts/synthesize-dialogue.mjs            실제로 합성 (보이스 없으면 자동으로 --dry-run처럼 동작)
//   node scripts/synthesize-dialogue.mjs --dry-run   API 호출 없이 뭘 할지만 미리 보기
//   node scripts/synthesize-dialogue.mjs --force     이미 있는 파일도 다시 합성
//
// 필요한 환경변수 (.env.local):
//   ELEVENLABS_API_KEY          필수
//   ELEVENLABS_VOICE_ID_R       로맨스(여성) 보이스 ID
//   ELEVENLABS_VOICE_ID_H       공포(중년 남성) 보이스 ID
//   ELEVENLABS_VOICE_ID_C       블랙코미디(할머니) 보이스 ID
//   ELEVENLABS_MODEL_ID         선택, 기본 eleven_v3 (lib/manifestBuild.js 와 맞춰야 함)
//
// 보이스 ID가 없는 장르는 건너뛰고 이유를 알려줍니다 — 기본 보이스로 대신 합성하지 않습니다.
// (다른 캐릭터인데 같은 목소리로 잘못 만들어지는 게, 안 만드는 것보다 나쁩니다.)

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Next.js가 아니라 plain node로 돌리므로 .env.local을 직접 읽어 넣는다.
const envPath = path.join(ROOT, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const CSV_PATH = path.join(ROOT, "..", "Bus", "규격", "대사양식_v2.csv");
const OUT_DIR = path.join(ROOT, "assets", "vo");
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_v3";

const VOICE_ID_BY_GENRE = {
  R: process.env.ELEVENLABS_VOICE_ID_R || "",
  H: process.env.ELEVENLABS_VOICE_ID_H || "",
  C: process.env.ELEVENLABS_VOICE_ID_C || "",
};
const GENRE_LABEL = { R: "로맨스", H: "공포", C: "블랙코미디" };

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
let DRY_RUN = args.includes("--dry-run");

const API_KEY = process.env.ELEVENLABS_API_KEY || "";
if (!API_KEY) {
  console.log("⚠️  ELEVENLABS_API_KEY 가 없습니다 — --dry-run 처럼 미리보기만 합니다.");
  DRY_RUN = true;
}

// ── CSV 파서 — lib/measure/dialogue.js 와 같은 규칙 (쉼표/따옴표만) ──
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
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

async function synthesize(text, voiceId) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL_ID }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
  return Buffer.from(await res.arrayBuffer());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const csv = readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(csv);
  const header = rows[0].map((h) => h.trim());
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const data = rows.slice(1);

  console.log(`대사양식_v2.csv — ${data.length}줄 · 모델 ${MODEL_ID}${DRY_RUN ? " · DRY RUN" : ""}\n`);

  for (const g of Object.keys(GENRE_LABEL)) {
    if (!VOICE_ID_BY_GENRE[g]) {
      console.log(`⚠️  ${GENRE_LABEL[g]}(${g}) 보이스 ID 없음 — ELEVENLABS_VOICE_ID_${g} 를 .env.local 에 넣어 주세요. 이 장르는 전부 건너뜁니다.`);
    }
  }
  console.log("");

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  let made = 0, skippedNoVoice = 0, skippedExists = 0, failed = 0;

  for (const r of data) {
    const genre = (r[col["장르"]] ?? "").trim();
    const seq = (r[col["순번"]] ?? "").trim();
    const line = (r[col["대사"]] ?? "").trim();
    const emotion = (r[col["감정태그"]] ?? "").trim();
    const filename = (r[col["파일명"]] ?? "").trim();
    if (!line || !filename) continue;

    const outPath = path.join(OUT_DIR, filename);
    const label = `[${genre}-${seq}] ${filename}`;
    const text = emotion ? `[${emotion}] ${line}` : line;

    if (existsSync(outPath) && !FORCE) {
      console.log(`•  ${label} — 이미 있음 (건너뜀, --force로 다시 만들기)`);
      skippedExists++;
      continue;
    }

    const voiceId = VOICE_ID_BY_GENRE[genre];
    if (!voiceId) {
      skippedNoVoice++;
      continue; // 위에서 이미 경고했음
    }

    if (DRY_RUN) {
      console.log(`○  ${label} — "${text}" (${voiceId.slice(0, 6)}…)`);
      made++;
      continue;
    }

    try {
      const bytes = await synthesize(text, voiceId);
      writeFileSync(outPath, bytes);
      console.log(`✓  ${label} — ${bytes.length.toLocaleString()} bytes`);
      made++;
    } catch (e) {
      console.log(`✗  ${label} — 실패: ${e.message}`);
      failed++;
    }

    await sleep(300); // API 배려
  }

  console.log(`\n${DRY_RUN ? "미리보기" : "완료"}: ${made} · 보이스 없어서 건너뜀 ${skippedNoVoice} · 이미 있어서 건너뜀 ${skippedExists} · 실패 ${failed}`);
  console.log(`출력 위치: ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
