// 에셋 슬롯 정의 — 서버와 브라우저가 같이 씁니다.
//
// 「무엇이 필요한가」를 여기 한 곳에만 적습니다.
// 현황판 · 업로드 판정 · manifest 생성이 전부 이 표에서 나옵니다.
// 규격 문서(Bus/규격/명명규칙.md)와 짝입니다 — 여기를 고치면 그 문서도 고쳐야 합니다.

// 판타지(F) 드롭 확정 — Bus/규격/구현_리스크와_지원_필요사항.md §3 (2026-08-22).
// 3축(공포·로맨스·코미디)만 남긴다.
export const GENRES = ["H", "R", "C"];

export const GENRE_LABEL = { H: "🖤 공포", R: "💗 로맨스", C: "💛 코미디" };

export const PRESETS = [
  { name: "lp_neutral", label: "중립", due: "8/14", aug: true },
  { name: "lp_H", label: "🖤 공포", due: "8/14", aug: true },
  { name: "lp_R", label: "💗 로맨스", due: "8/14", aug: true },
  { name: "lp_C", label: "💛 코미디", due: "8/14", aug: true },
];

const genreName = { H: "horror", R: "romance", C: "comedy" };

// kind: model | audio | dialogue
// aug : 8월 시연에 필요한가 (현황판의 「남은 일」 계산 기준)
export const SLOTS = [
  // ── 아트 · 3D ──────────────────────────────────────────
  { id: "structure.shelter", path: "models.structure[shelter]", kind: "model",
    file: "prop_shelter.glb", label: "정류장 구조물", role: "아트", due: "8/12", aug: true },
  { id: "structure.bench", path: "models.structure[bench]", kind: "model",
    file: "prop_bench.glb", label: "벤치", role: "아트", due: "8/12", aug: true,
    hint: "피벗 = 착석 지점 바닥 (0,0,0)" },
  { id: "structure.silhouette", path: "models.structure[silhouette]", kind: "model",
    file: "prop_silhouette.glb", label: "옆사람 실루엣", role: "아트", due: "8/15", aug: true,
    hint: "애니메이션 없어도 됨" },
  { id: "sign.model", path: "models.sign.model", kind: "model",
    file: "prop_sign.glb", label: "노선도 표지판", role: "아트", due: "8/12", aug: true,
    hint: "이름 자리를 평면 사각형으로 분리 + UV 0~1", critical: true },

  { id: "npc.model", path: "models.npc.model", kind: "model",
    file: "npc_companion.glb", label: "NPC 본체", role: "아트", due: "9월", aug: false,
    hint: "머리 본 이름을 Head 로" },

  ...GENRES.map((g) => ({
    id: `npc.clip.${g}`, path: `models.npc.clips.${g}`, kind: "model",
    file: `att_${genreName[g]}.glb`, label: `NPC 태도 ${GENRE_LABEL[g]}`,
    role: "아트", due: "9월", aug: false, hint: "루트 모션 없음 · 루프",
  })),
  { id: "npc.clip.neutral", path: "models.npc.clips.neutral", kind: "model",
    file: "att_neutral.glb", label: "NPC 태도 중립", role: "아트", due: "9월", aug: false },

  ...GENRES.map((g) => ({
    id: `prop.${g}`, path: `models.genreProps.${g}`, kind: "model",
    file: `prop_${genreName[g]}.glb`, label: `장르 소품 ${GENRE_LABEL[g]}`,
    role: "아트", due: "9월", aug: false,
  })),
  ...GENRES.map((g) => ({
    id: `bus.${g}`, path: `models.bus.${g}`, kind: "model",
    file: `bus_${genreName[g]}.glb`, label: `버스 3D ${GENRE_LABEL[g]}`,
    role: "아트", due: "10월", aug: false,
  })),

  // ── 사운드 ────────────────────────────────────────────
  ...GENRES.map((g) => ({
    id: `bgm.${g}`, path: `audio.bgm.${g}`, kind: "audio",
    file: `bgm_${g}.mp3`, label: `배경 트랙 ${GENRE_LABEL[g]}`,
    role: "사운드", due: "8/8", aug: true, critical: true,
    hint: "30초 루프 · 네 트랙 LUFS 동일 (권장 −20)",
  })),
  { id: "vo.q1", path: "audio.voice.lines.q1", kind: "audio",
    file: "vo_q1.mp3", label: "Q1 음성", role: "사운드", due: "8/11", aug: true,
    hint: "당신은 무엇을 기다리고 있습니까?" },
  { id: "vo.reprompt", path: "audio.voice.lines.reprompt", kind: "audio",
    file: "vo_reprompt.mp3", label: "되묻기 음성", role: "사운드", due: "8/11", aug: true,
    hint: "조금 더 말씀해 주시겠어요." },
  { id: "vo.filler1", path: "audio.voice.lines.filler1", kind: "audio",
    file: "vo_filler1.mp3", label: "채움 1", role: "사운드", due: "8/11", aug: true,
    hint: "...음." },
  { id: "vo.filler2", path: "audio.voice.lines.filler2", kind: "audio",
    file: "vo_filler2.mp3", label: "채움 2", role: "사운드", due: "8/11", aug: true,
    hint: "...그렇군요." },
  { id: "sfx.inhale", path: "audio.sfx.inhale", kind: "audio",
    file: "sfx_inhale.wav", label: "들숨", role: "사운드", due: "8/11", aug: true,
    critical: true, hint: "이 파일 하나가 2초 지연을 덮습니다" },
  { id: "vo.announce", path: "audio.voice.lines.announce", kind: "audio",
    file: "vo_announce.mp3", label: "전광판 안내방송", role: "사운드", due: "9월", aug: false,
    hint: "\"272번 버스는 5분 후 도착 예정입니다.\" — 정류장_스크립트_v2 §1-6, 안내방송 톤(감정 없이)" },
  ...GENRES.map((g) => ({
    id: `bussfx.${g}`, path: `audio.busSfx.${g}`, kind: "audio",
    file: `bus_${genreName[g]}.wav`, label: `버스 소리 ${GENRE_LABEL[g]}`,
    role: "사운드", due: "10월", aug: false, hint: "모노로 주세요",
  })),

  // ── 기획 ──────────────────────────────────────────────
  { id: "dialogue.csv", path: "dialogue.source", kind: "dialogue",
    file: "대사양식.csv", label: "대사 표", role: "기획", due: "8/11", aug: true,
    hint: "Sheets 에서 CSV 로 내보내 올려 주세요",
    templateUrl: "/templates/dialogue-template.csv",
    templateName: "대사양식.csv" },
];

export const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]));

// ── 파일 이름으로 슬롯 추측 ────────────────────────────
// 업로드할 때 어느 칸인지 사람이 고르지 않아도 되게 한다.
export function guessSlot(filename) {
  const name = (filename || "").trim();
  const lower = name.toLowerCase();

  const exact = SLOTS.find((s) => s.file.toLowerCase() === lower);
  if (exact) return { slot: exact, confidence: "exact" };

  // 확장자 무시하고 이름만
  const base = lower.replace(/\.[^.]+$/, "");
  const byBase = SLOTS.find((s) => s.file.toLowerCase().replace(/\.[^.]+$/, "") === base);
  if (byBase) return { slot: byBase, confidence: "name" };

  // bgm_H / bgm_h / bgm-H 같은 변형
  const bgm = base.match(/^bgm[_\-\s]?([hrcf])$/i);
  if (bgm) return { slot: SLOT_BY_ID[`bgm.${bgm[1].toUpperCase()}`], confidence: "loose" };

  if (/\.csv$/i.test(lower)) return { slot: SLOT_BY_ID["dialogue.csv"], confidence: "loose" };

  return { slot: null, confidence: "none" };
}

// ── 확장자 규칙 ────────────────────────────────────────
export const KIND_EXT = {
  model: [".glb"],
  audio: [".mp3", ".wav"],
  dialogue: [".csv"],
};

export function extOf(filename) {
  const m = (filename || "").match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : "";
}

// ── 규격 상수 ──────────────────────────────────────────
export const LIMITS = {
  textureMax: 2048,          // 한 장 최대 2048×2048
  bgmLoopSec: 30,            // 배경 트랙 루프 길이
  bgmLufsTarget: -20,        // 권장 integrated LUFS
  bgmLufsSpreadMax: 1.0,     // 네 트랙 사이 허용 편차 (dB)
  bgmTruePeakTarget: -9,     // 목표 트루 피크 (D7 — 못 맞춰도 됨)
  fourTrackSumDb: 6.0,       // 네 트랙 동시 재생 시 합산 증가분
  inhaleMaxSec: 2.5,
};
