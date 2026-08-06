#!/usr/bin/env node
// manifest.json 검증기 — 의존성 없음.
//
//   node Bus/규격/validate-manifest.mjs [manifest.json 경로]
//
// 스키마 전체를 검사하지 않고, "틀리면 런타임에서 실제로 깨지는 것"만 봅니다.
// 명명 규칙 위반은 경고(⚠), 구조/필수값 누락은 오류(✖)입니다. 오류가 있으면 exit 1.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";

const GENRES = ["H", "R", "C", "F"];
const errors = [];
const warns = [];
const infos = [];

const err = (where, msg) => errors.push({ where, msg });
const warn = (where, msg) => warns.push({ where, msg });

// ── 로드 ───────────────────────────────────────────────
const argPath = process.argv[2] ?? join(dirname(new URL(import.meta.url).pathname), "manifest.json");
const manifestPath = resolve(argPath);

if (!existsSync(manifestPath)) {
  console.error(`✖ 파일이 없습니다: ${manifestPath}`);
  process.exit(1);
}

let m;
try {
  m = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (e) {
  console.error(`✖ JSON 파싱 실패: ${e.message}`);
  process.exit(1);
}

const rootDir = dirname(manifestPath);
const assetRoot = m.assetRoot ?? "assets/";

// ── 공통 헬퍼 ──────────────────────────────────────────
const STATUSES = ["missing", "draft", "final"];

// 매니페스트 안의 모든 { file, status } 노드를 훑는다.
function walkAssets(node, path = "") {
  const found = [];
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((v, i) => found.push(...walkAssets(v, `${path}[${i}]`)));
    return found;
  }
  if (typeof node.file === "string" && typeof node.status === "string") {
    found.push({ path, node });
    return found;
  }
  for (const [k, v] of Object.entries(node)) {
    found.push(...walkAssets(v, path ? `${path}.${k}` : k));
  }
  return found;
}

function requirePath(obj, dotted) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object" || !(p in cur)) {
      err(dotted, "필수 항목이 없습니다");
      return undefined;
    }
    cur = cur[p];
  }
  return cur;
}

// ── 1. 뼈대 ────────────────────────────────────────────
if (m.manifestVersion !== "1.0") err("manifestVersion", `"1.0" 이어야 합니다 (현재: ${m.manifestVersion})`);

const genres = m.genres ?? [];
if (GENRES.some((g, i) => genres[i] !== g)) {
  err("genres", `["H","R","C","F"] 순서 그대로여야 합니다 (현재: ${JSON.stringify(genres)})`);
}

for (const p of [
  "lighting.presets",
  "lighting.transitions",
  "models.structure",
  "models.sign",
  "models.npc",
  "models.genreProps",
  "models.bus",
  "audio.bgm",
  "audio.voice",
  "audio.sfx",
  "dialogue",
]) requirePath(m, p);

// ── 2. 장르 4개가 다 있는가 ────────────────────────────
const genreMaps = [
  ["models.genreProps", m.models?.genreProps],
  ["models.bus", m.models?.bus],
  ["models.npc.clips", m.models?.npc?.clips],
  ["audio.bgm", m.audio?.bgm],
  ["audio.busSfx", m.audio?.busSfx],
];
for (const [where, map] of genreMaps) {
  if (!map) continue;
  for (const g of GENRES) if (!(g in map)) err(where, `장르 키 "${g}" 가 없습니다`);
  const extra = Object.keys(map).filter((k) => !GENRES.includes(k) && k !== "neutral");
  if (extra.length) warn(where, `모르는 키: ${extra.join(", ")} — 코드가 부르지 않습니다`);
}
// npc.clips 는 neutral 이 반드시 있어야 함
if (m.models?.npc?.clips && !("neutral" in m.models.npc.clips)) {
  err("models.npc.clips", '"neutral" 클립이 없습니다 — 사건 대사 구간에서 씁니다');
}

// ── 3. 조명 프리셋 ─────────────────────────────────────
const presets = m.lighting?.presets ?? {};
for (const k of ["neutral", ...GENRES]) {
  if (!presets[k]) err("lighting.presets", `"${k}" 프리셋 이름이 비어 있습니다`);
}
for (const k of Object.keys(presets)) {
  if (/^lp_[A-Za-z]+-[A-Za-z]+$/.test(presets[k] ?? "")) {
    warn("lighting.presets", `조합 프리셋으로 보입니다: ${presets[k]} — 만들지 않기로 했습니다 (코드가 두 장을 섞습니다)`);
  }
}

// ── 4. 에셋 노드 전수 검사 ─────────────────────────────
const assets = walkAssets(m);
let missing = 0, draft = 0, final = 0;

for (const { path, node } of assets) {
  if (!STATUSES.includes(node.status)) {
    err(path, `status 는 ${STATUSES.join(" / ")} 중 하나여야 합니다 (현재: ${node.status})`);
    continue;
  }
  if (node.status === "missing") { missing++; continue; }
  node.status === "draft" ? draft++ : final++;

  if (!node.file) {
    err(path, `status 가 ${node.status} 인데 file 이 비어 있습니다`);
    continue;
  }

  // 확장자
  const isModel = path.startsWith("models");
  if (isModel && !node.file.endsWith(".glb")) {
    err(path, `3D는 GLB 여야 합니다 (현재: ${node.file})`);
  }
  if (path.startsWith("audio") && !/\.(mp3|wav)$/.test(node.file)) {
    err(path, `오디오는 .mp3 또는 .wav 여야 합니다 (현재: ${node.file})`);
  }

  // 실제로 있는가
  const full = join(rootDir, assetRoot, node.file);
  if (!existsSync(full)) {
    warn(path, `status=${node.status} 인데 파일이 없습니다: ${join(assetRoot, node.file)}`);
  }

  // 명명 규칙 — 어겨도 동작은 하므로 경고
  const name = basename(node.file);
  const conventions = [
    [/^models\.structure/, /^prop_[a-z0-9_]+\.glb$/, "prop_{이름}.glb"],
    [/^models\.genreProps/, /^prop_[a-z0-9_]+\.glb$/, "prop_{장르}.glb"],
    [/^models\.npc\.clips/, /^att_[a-z0-9_]+\.glb$/, "att_{장르}.glb"],
    [/^models\.bus/, /^bus_[a-z0-9_]+\.glb$/, "bus_{장르}.glb"],
    [/^audio\.bgm/, /^bgm_[HRCF]\.(mp3|wav)$/, "bgm_{H|R|C|F}.mp3"],
    [/^audio\.busSfx/, /^bus_[a-z0-9_]+\.wav$/, "bus_{장르}.wav"],
  ];
  for (const [pathRe, nameRe, expected] of conventions) {
    if (pathRe.test(path) && !nameRe.test(name)) {
      warn(path, `명명 규칙과 다릅니다: ${name} (권장: ${expected}) — 의도한 것이면 무시하세요`);
    }
  }
}

// ── 5. 사운드가 채워야 할 값 ───────────────────────────
const voice = m.audio?.voice;
if (voice && !voice.voiceId) {
  warn("audio.voice.voiceId", "비어 있습니다 — 8/8 Voice Design ID. 9월 배치 합성이 여기에 걸려 있습니다");
}

const lufs = GENRES.map((g) => m.audio?.bgm?.[g]?.lufsIntegrated).filter((v) => typeof v === "number");
if (lufs.length === 4) {
  const spread = Math.max(...lufs) - Math.min(...lufs);
  if (spread > 1.0) {
    warn("audio.bgm.*.lufsIntegrated", `네 트랙의 LUFS 가 ${spread.toFixed(1)} dB 벌어져 있습니다 — 게인 계산이 동일 LUFS 전제입니다`);
  } else {
    infos.push(`배경 트랙 LUFS 편차 ${spread.toFixed(1)} dB — 통과`);
  }
} else if (lufs.length > 0) {
  warn("audio.bgm.*.lufsIntegrated", `${4 - lufs.length}개 트랙이 미측정입니다`);
}

const peaks = GENRES.map((g) => m.audio?.bgm?.[g]?.truePeakDb).filter((v) => typeof v === "number");
for (const g of GENRES) {
  const p = m.audio?.bgm?.[g]?.truePeakDb;
  if (typeof p === "number" && p > -9) {
    infos.push(`bgm_${g} 트루 피크 ${p} dBFS — 목표 −9 초과. 그대로 두셔도 됩니다 (개발이 리미터로 받음)`);
  }
}
if (peaks.length === 4) {
  // 네 트랙 동시 재생 최악값 = 개별 피크 + 6 dB
  const worst = Math.max(...peaks) + 6;
  if (worst > 0) {
    warn("audio.bgm", `네 트랙 동시 재생 시 합산 최악값이 ${worst.toFixed(1)} dBFS — 클리핑 구간입니다. 마스터 리미터 필수 (T3)`);
  } else {
    infos.push(`네 트랙 합산 최악값 ${worst.toFixed(1)} dBFS — 통과`);
  }
}

// ── 6. 대사 ────────────────────────────────────────────
if (m.dialogue && m.dialogue.combinationCount !== 16) {
  err("dialogue.combinationCount", `16 이어야 합니다 (사건 4 × 태도 4). 현재: ${m.dialogue.combinationCount}`);
}

// ── 출력 ───────────────────────────────────────────────
const line = (icon, { where, msg }) => `  ${icon} ${where}\n     ${msg}`;

console.log(`\n검사 대상: ${manifestPath}`);
console.log(`에셋 ${assets.length}개 — final ${final} / draft ${draft} / missing ${missing}\n`);

if (errors.length) {
  console.log(`✖ 오류 ${errors.length}건 — 고치지 않으면 런타임에서 깨집니다`);
  errors.forEach((e) => console.log(line("✖", e)));
  console.log("");
}
if (warns.length) {
  console.log(`⚠ 경고 ${warns.length}건 — 의도한 것이면 무시하셔도 됩니다`);
  warns.forEach((w) => console.log(line("⚠", w)));
  console.log("");
}
if (infos.length) {
  infos.forEach((i) => console.log(`  · ${i}`));
  console.log("");
}
if (!errors.length && !warns.length) console.log("✓ 통과\n");

process.exit(errors.length ? 1 : 0);
