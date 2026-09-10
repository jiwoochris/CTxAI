// PolyHaven(CC0) 모델을 받아 GLB 하나로 묶고 meshopt 로 압축해 public/reactive/models/props/ 에 둔다.
// 사용: node scripts/pull-polyhaven.mjs painted_wooden_bench street_lamp_01 ...
// 텍스처 해상도는 1k. 결과 파일명은 <id>.glb. 이미 있으면 건너뛴다.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ids = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && arr[i - 1] !== "--simplify");
if (!ids.length) { console.error("모델 id 를 하나 이상 주세요"); process.exit(1); }
const OUT = path.resolve("public/reactive/models/props");
const TMP = path.resolve("/tmp/polyhaven");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

async function dl(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

for (const id of ids) {
  const out = path.join(OUT, `${id}.glb`);
  if (fs.existsSync(out)) { console.log("skip", id); continue; }
  const meta = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const g = meta.gltf || {};
  const res = "1k" in g ? "1k" : Object.keys(g)[0];
  if (!res) { console.log("no gltf", id); continue; }
  const entry = g[res].gltf;
  const dir = path.join(TMP, id);
  const gltfPath = path.join(dir, path.basename(entry.url));
  await dl(entry.url, gltfPath);
  for (const [rel, inc] of Object.entries(entry.include || {})) await dl(inc.url, path.join(dir, rel));
  // gltf(+bin+textures) → glb → meshopt
  const glbRaw = path.join(dir, `${id}.raw.glb`);
  execFileSync("npx", ["--yes", "@gltf-transform/cli", "copy", gltfPath, glbRaw], { stdio: "ignore" });
  // 나무처럼 지오메트리가 큰 모델은 --simplify <비율> 로 폴리곤을 줄인다 (예: --simplify 0.3)
  const simpIdx = process.argv.indexOf("--simplify");
  const ratio = simpIdx > 0 ? Number(process.argv[simpIdx + 1]) : 0;
  let src = glbRaw;
  if (ratio > 0 && ratio < 1) {
    const simp = path.join(dir, `${id}.simp.glb`);
    execFileSync("npx", ["--yes", "@gltf-transform/cli", "simplify", glbRaw, simp, "--ratio", String(ratio), "--error", "0.002"], { stdio: "ignore" });
    src = simp;
  }
  execFileSync("npx", ["--yes", "@gltf-transform/cli", "meshopt", src, out], { stdio: "ignore" });
  console.log("ok", id, res, Math.round(fs.statSync(out).size / 1024), "KB");
}
