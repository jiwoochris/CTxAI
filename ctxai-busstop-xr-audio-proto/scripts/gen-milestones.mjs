// 대시보드 "진행 상황" 마일스톤을 git 커밋 로그에서 자동으로 뽑아 파일로 저장한다.
//
// Vercel 배포는 이 서브폴더만 업로드하고 .git은 올라가지 않으므로, 실행 결과인
// lib/milestones.generated.json 을 커밋해서 배포에 실어 보낸다 — 그래서 이 스크립트는
// "배포 직전 로컬에서" 돌려야 한다 (git 저장소 전체가 있는 곳에서만 동작).
//
//   npm run milestones        (레포 루트에서 최근 커밋을 다시 읽어 갱신)
//
// git 이 없거나 실패하면 기존 파일을 그대로 두고 조용히 종료한다 — Vercel 빌드 중
// (.git 없음) 실수로 이 스크립트가 돌아도 빌드가 깨지지 않게.

import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", ".."); // ctxai-busstop-xr-audio-proto/scripts -> CTxAI/
const OUT_FILE = path.resolve(HERE, "..", "lib", "milestones.generated.json");
const MAX_ITEMS = 8;

function bail(reason) {
  console.warn(`[gen-milestones] ${reason} — 기존 파일 유지`);
  process.exit(0);
}

if (!existsSync(path.join(REPO_ROOT, ".git"))) {
  bail(`git 저장소를 못 찾음 (${REPO_ROOT})`);
}

let raw;
try {
  raw = execFileSync(
    "git",
    ["log", `-n`, String(MAX_ITEMS), "--pretty=format:%ad|%s", "--date=short",
      "--", "ctxai-busstop-xr-audio-proto", "Bus/규격"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
} catch (e) {
  bail(`git log 실패: ${e.message}`);
}

const milestones = raw
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const i = line.indexOf("|");
    return { date: line.slice(0, i), text: line.slice(i + 1) };
  });

if (!milestones.length) bail("git log 결과 없음");

writeFileSync(OUT_FILE, JSON.stringify(milestones, null, 2) + "\n");
console.log(`[gen-milestones] ${milestones.length}개 마일스톤을 ${path.relative(REPO_ROOT, OUT_FILE)}에 기록`);
