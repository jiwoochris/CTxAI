// 백엔드 상태 — 「curl 로 두드릴 수 있는 상태」의 첫 번째 문 (8/8).
//
//   curl -s localhost:3000/api/health | jq

import { readRecords, listPresets, storageMode } from "../../../lib/store";
import { SLOTS, PRESETS } from "../../../lib/assetSpec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [records, presets] = await Promise.all([readRecords(), listPresets()]);
  const aug = SLOTS.filter((s) => s.aug);

  return Response.json({
    ok: true,
    now: new Date().toISOString(),
    // local 이면 배포 때마다 파일이 사라집니다. 운영에서는 supabase 여야 합니다.
    storage: storageMode(),
    keys: {
      OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,   // STT + 채점
      ELEVENLABS_API_KEY: !!process.env.ELEVENLABS_API_KEY,   // 음성 합성
      ELEVENLABS_VOICE_ID: !!process.env.ELEVENLABS_VOICE_ID, // 8/8 사운드가 채움
    },
    endpoints: {
      "POST /api/mood": "음성 → 4장르 점수 (multipart: audio)",
      "POST /api/assets": "에셋 올리기 (multipart: file, slotId, measure?)",
      "GET  /api/assets": "현황",
      "GET  /api/assets/file/:slotId": "올라온 파일",
      "POST /api/preset": "조명 프리셋 저장 (JSON)",
      "GET  /api/preset": "프리셋 목록",
      "GET  /api/manifest": "생성된 manifest.json",
    },
    progress: {
      augustAssets: `${aug.filter((s) => records[s.id]).length}/${aug.length}`,
      presets: `${PRESETS.filter((p) => presets[p.name]).length}/${PRESETS.length}`,
      totalUploaded: Object.keys(records).length,
    },
  });
}
