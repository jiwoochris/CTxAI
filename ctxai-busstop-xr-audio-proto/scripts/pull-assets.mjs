// 팀 대시보드(Supabase 저장소)에 올라간 오디오를 로컬 public/reactive/audio 로 내려받는다.
// /film 페이지는 Supabase 없이 이 로컬 파일만 쓴다. 사용: node scripts/pull-assets.mjs
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.ASSET_BASE || "https://busstop-team.vercel.app";
const OUT = path.resolve("public/reactive/audio");
fs.mkdirSync(OUT, { recursive: true });

async function save(url, name) {
  const dest = path.join(OUT, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return "skip";
  const r = await fetch(url);
  if (!r.ok) return `fail ${r.status}`;
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return "ok";
}

const manifest = { vo: [], sfx: [], slots: [] };

const vo = await (await fetch(`${BASE}/api/vo2`)).json();
for (const l of vo.lines || []) {
  if (!l.hasAudio) continue;
  const name = `vo_${l.genre}_${l.seq}.mp3`;
  const st = await save(`${BASE}/api/vo2/file/${encodeURIComponent(l.slotId)}`, name);
  manifest.vo.push({ genre: l.genre, seq: l.seq, text: l.text, file: name });
  console.log("vo", name, st);
}

const sfx = await (await fetch(`${BASE}/api/sfx`)).json();
for (const it of sfx.items || []) {
  if (!it.hasAudio) continue;
  const name = `sfx_${it.key}.mp3`;
  const st = await save(`${BASE}/api/sfx/file/${encodeURIComponent(it.slotId)}`, name);
  manifest.sfx.push({ key: it.key, label: it.label, file: name });
  console.log("sfx", name, st);
}

// 필수 슬롯 — BGM 3트랙, 안내방송, Q1/되묻기/채움/들숨
const SLOTS = ["bgm.H", "bgm.R", "bgm.C", "vo.announce", "vo.q1", "vo.reprompt", "vo.filler1", "vo.filler2", "sfx.inhale"];
for (const slot of SLOTS) {
  const r = await fetch(`${BASE}/api/assets/file/${slot}`);
  if (!r.ok) { console.log("slot", slot, "fail", r.status); continue; }
  const ct = r.headers.get("content-type") || "";
  const ext = ct.includes("wav") ? "wav" : ct.includes("mpeg") || ct.includes("mp3") ? "mp3" : ct.includes("ogg") ? "ogg" : "bin";
  const name = `${slot.replace(".", "_")}.${ext}`;
  fs.writeFileSync(path.join(OUT, name), Buffer.from(await r.arrayBuffer()));
  manifest.slots.push({ slot, file: name });
  console.log("slot", name, "ok", ct);
}

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("done", manifest.vo.length, "vo /", manifest.sfx.length, "sfx /", manifest.slots.length, "slots");
