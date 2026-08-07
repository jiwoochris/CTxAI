// 파일 저장소 — 서버 전용.
//
// Supabase Storage 를 씁니다. Vercel 의 파일시스템은 배포·재시작마다
// 초기화되므로, 아트가 어제 저장한 프리셋이 오늘 사라지면 안 됩니다.
//
//   busstop/
//     assets/<slotId>/<파일이름>      실제 파일
//     records.json                    슬롯별 최신 기록
//     presets/<이름>.json             조명 프리셋
//
// 키가 없으면 로컬 파일시스템으로 떨어집니다 — 개발 장비에서 Supabase 없이
// 돌려볼 수 있게. 어느 쪽이든 함수 네 개의 모양은 같습니다.

import { promises as fs } from "node:fs";
import path from "node:path";

const BUCKET = "busstop";
const RECORDS_KEY = "records.json";

const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REMOTE = !!(URL_BASE && SERVICE_KEY);

// ── Supabase Storage REST ───────────────────────────────
// SDK 를 넣지 않고 REST 를 직접 씁니다. 쓰는 동작이 네 개뿐이라
// 의존성을 하나 더 들이는 것보다 이쪽이 가볍습니다.

function storageUrl(key) {
  return `${URL_BASE}/storage/v1/object/${BUCKET}/${key}`;
}

async function remotePut(key, bytes, contentType) {
  const res = await fetch(storageUrl(key), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`저장 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

async function remoteGet(key) {
  const res = await fetch(storageUrl(key), {
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`읽기 실패 (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function remoteRemove(prefix) {
  // 폴더 아래를 지우려면 목록을 먼저 받아야 합니다
  const list = await remoteList(prefix);
  if (!list.length) return;
  await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: list.map((n) => `${prefix}/${n}`) }),
  });
}

async function remoteList(prefix) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const rows = await res.json();
  // 폴더 자체가 placeholder 로 섞여 나오는 경우가 있어 걸러 냅니다
  return (Array.isArray(rows) ? rows : []).map((r) => r.name).filter((n) => n && n !== ".emptyFolderPlaceholder");
}

/** 버킷이 없으면 만든다. 첫 업로드 때 한 번만 실제로 동작합니다. */
let bucketReady = false;
async function ensureBucket() {
  if (!REMOTE || bucketReady) return;
  await fetch(`${URL_BASE}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    // 비공개 버킷. 파일은 /api/assets/file/:slotId 를 거쳐서만 나갑니다.
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  }).catch(() => {});
  bucketReady = true;
}

// ── 로컬 대체 ───────────────────────────────────────────

const LOCAL_ROOT = path.join(process.cwd(), "storage");
const localPath = (key) => path.join(LOCAL_ROOT, key);

async function localPut(key, bytes) {
  await fs.mkdir(path.dirname(localPath(key)), { recursive: true });
  await fs.writeFile(localPath(key), bytes);
}
async function localGet(key) {
  return fs.readFile(localPath(key)).catch(() => null);
}
async function localList(prefix) {
  return fs.readdir(localPath(prefix)).catch(() => []);
}
async function localRemove(prefix) {
  await fs.rm(localPath(prefix), { recursive: true, force: true });
}

// ── 공통 입출력 ─────────────────────────────────────────

const put = (key, bytes, ct) => (REMOTE ? (ensureBucket().then(() => remotePut(key, bytes, ct))) : localPut(key, bytes));
const get = (key) => (REMOTE ? remoteGet(key) : localGet(key));
const list = (prefix) => (REMOTE ? remoteList(prefix) : localList(prefix));
const remove = (prefix) => (REMOTE ? remoteRemove(prefix) : localRemove(prefix));

export const storageMode = () => (REMOTE ? "supabase" : "local");

const MIME = {
  ".glb": "model/gltf-binary", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".csv": "text/csv",
};
export const mimeFor = (name) => MIME[path.extname(name || "").toLowerCase()] ?? "application/octet-stream";

// ── 기록 ────────────────────────────────────────────────

export async function readRecords() {
  const raw = await get(RECORDS_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw.toString("utf8")); } catch (e) { return {}; }
}

async function writeRecords(records) {
  await put(RECORDS_KEY, Buffer.from(JSON.stringify(records, null, 2)), "application/json");
}

/**
 * 파일 하나를 슬롯에 넣는다. 같은 슬롯에 다시 올리면 덮어씁니다.
 * record 에는 브라우저가 재 놓은 측정값(LUFS·삼각형 수 등)이 들어옵니다.
 */
export async function putAsset(slotId, filename, bytes, record) {
  const dir = `assets/${slotId}`;

  // 슬롯 하나에 파일 하나. 이름이 바뀌었으면 예전 것을 지웁니다.
  const existing = await list(dir);
  if (existing.some((n) => n !== filename)) await remove(dir);

  await put(`${dir}/${filename}`, bytes, mimeFor(filename));

  const records = await readRecords();
  records[slotId] = {
    slotId, filename,
    bytes: bytes.length,
    uploadedAt: new Date().toISOString(),
    ...record,
  };
  await writeRecords(records);
  return records[slotId];
}

/** 슬롯에 든 파일의 바이트와 이름. 없으면 null. */
export async function getAsset(slotId) {
  const dir = `assets/${slotId}`;
  const files = await list(dir);
  if (!files.length) return null;
  const bytes = await get(`${dir}/${files[0]}`);
  return bytes ? { filename: files[0], bytes } : null;
}

export async function removeAsset(slotId) {
  await remove(`assets/${slotId}`);
  const records = await readRecords();
  delete records[slotId];
  await writeRecords(records);
}

// ── 프리셋 ──────────────────────────────────────────────

const PRESET_NAME = /^lp_[A-Za-z0-9_]+$/;

export async function putPreset(name, preset) {
  if (!PRESET_NAME.test(name)) throw new Error(`프리셋 이름이 규칙에 맞지 않습니다: ${name}`);
  const body = { ...preset, receivedAt: new Date().toISOString() };
  await put(`presets/${name}.json`, Buffer.from(JSON.stringify(body, null, 2)), "application/json");
  return body;
}

export async function listPresets() {
  const files = await list("presets");
  const out = {};
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = await get(`presets/${f}`);
    if (!raw) continue;
    try { out[f.replace(/\.json$/, "")] = JSON.parse(raw.toString("utf8")); } catch (e) {}
  }
  return out;
}
