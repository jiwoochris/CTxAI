// 파일 저장소 — 서버 전용.
//
// 8월에는 로컬 파일시스템으로 충분합니다. 팀 인원이 한 자리 수이고,
// 파일도 수십 개입니다. 9월에 여러 곳에서 붙기 시작하면 Blob 으로 바꾸되,
// 이 파일의 함수 네 개만 갈아 끼우면 되도록 바깥에 경로를 노출하지 않습니다.
//
//   storage/
//     assets/<slotId>/<파일이름>      실제 파일
//     records.json                    슬롯별 최신 기록
//     presets/<이름>.json             조명 프리셋

import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "storage");
const ASSETS = path.join(ROOT, "assets");
const PRESETS = path.join(ROOT, "presets");
const RECORDS = path.join(ROOT, "records.json");

async function ensure(dir) {
  await fs.mkdir(dir, { recursive: true });
}

// ── 기록 ────────────────────────────────────────────────

export async function readRecords() {
  try {
    return JSON.parse(await fs.readFile(RECORDS, "utf8"));
  } catch (e) {
    return {};
  }
}

async function writeRecords(records) {
  await ensure(ROOT);
  // 같은 순간에 두 사람이 올려도 마지막 것만 남고 파일이 깨지지는 않게
  const tmp = RECORDS + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(records, null, 2));
  await fs.rename(tmp, RECORDS);
}

/**
 * 파일 하나를 슬롯에 넣는다. 같은 슬롯에 다시 올리면 덮어씁니다.
 * record 에는 브라우저가 재 놓은 측정값(LUFS·길이·삼각형 수 등)이 들어옵니다.
 */
export async function putAsset(slotId, filename, bytes, record) {
  const dir = path.join(ASSETS, slotId);
  await ensure(dir);

  // 슬롯 하나에 파일 하나. 이름이 바뀌었으면 예전 것을 지운다.
  for (const old of await fs.readdir(dir).catch(() => [])) {
    if (old !== filename) await fs.unlink(path.join(dir, old)).catch(() => {});
  }
  await fs.writeFile(path.join(dir, filename), bytes);

  const records = await readRecords();
  records[slotId] = {
    slotId,
    filename,
    bytes: bytes.length,
    uploadedAt: new Date().toISOString(),
    ...record,
  };
  await writeRecords(records);
  return records[slotId];
}

export async function getAssetPath(slotId) {
  const dir = path.join(ASSETS, slotId);
  const files = await fs.readdir(dir).catch(() => []);
  return files.length ? path.join(dir, files[0]) : null;
}

export async function removeAsset(slotId) {
  await fs.rm(path.join(ASSETS, slotId), { recursive: true, force: true });
  const records = await readRecords();
  delete records[slotId];
  await writeRecords(records);
}

// ── 프리셋 ──────────────────────────────────────────────

const PRESET_NAME = /^lp_[A-Za-z0-9_]+$/;

export async function putPreset(name, preset) {
  if (!PRESET_NAME.test(name)) throw new Error(`프리셋 이름이 규칙에 맞지 않습니다: ${name}`);
  await ensure(PRESETS);
  const body = { ...preset, receivedAt: new Date().toISOString() };
  await fs.writeFile(path.join(PRESETS, `${name}.json`), JSON.stringify(body, null, 2));
  return body;
}

export async function listPresets() {
  const files = await fs.readdir(PRESETS).catch(() => []);
  const out = {};
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      out[f.replace(/\.json$/, "")] = JSON.parse(await fs.readFile(path.join(PRESETS, f), "utf8"));
    } catch (e) {}
  }
  return out;
}
