// 에셋 슬롯 정의 — 서버와 브라우저가 같이 씁니다.
//
// 「무엇이 필요한가」를 여기 한 곳에만 적습니다.
// 현황판 · 업로드 판정 · manifest 생성이 전부 이 표에서 나옵니다.
// 규격 문서(Bus/규격/명명규칙.md)와 짝입니다 — 여기를 고치면 그 문서도 고쳐야 합니다.

// 판타지(F) 드롭 확정 — Bus/규격/구현_리스크와_지원_필요사항.md §3 (2026-08-22).
// 3축(공포·로맨스·코미디)만 남긴다.
export const GENRES = ["H", "R", "C"];

// C = 블랙코미디. 코드는 그대로 재사용 확정 (Bus/규격/방향전환_업무재분장.md, 2026-08-22) —
// 새 장르 코드를 만들지 않는다.
export const GENRE_LABEL = { H: "🖤 공포", R: "💗 로맨스", C: "💛 블랙코미디" };

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
  // 가로등(공포용 조도 변화 트리거)은 새 슬롯이 아니라 이 구조물 배열에 자유롭게
  // 추가하면 됩니다 (id: "streetlamp" 등) — 명명규칙.md §2.1 참고. 트리거 자체는
  // lighting.streetlamp (manifestBuild.js) 로 선언만 해 두었고, 실제 깜빡임 연출은
  // /whitebox 조명 시스템 쪽 별도 작업입니다.
  { id: "sign.model", path: "models.sign.model", kind: "model",
    file: "prop_sign.glb", label: "노선도 표지판", role: "아트", due: "8/12", aug: true,
    hint: "이름 자리를 평면 사각형으로 분리 + UV 0~1", critical: true },

  { id: "npc.model", path: "models.npc.model", kind: "model",
    file: "npc_companion.glb", label: "NPC 본체 (로맨스 · 그녀)", role: "아트", due: "9월", aug: false,
    hint: "머리 본 이름을 Head 로" },

  // 공포·블랙코미디는 로맨스 "그녀"와 다른 인물이라 몸체 자체가 따로 필요합니다
  // (V2 반영 — Bus/규격/방향전환_업무재분장.md). 태도 클립은 아래 npc.clip.*로 계속 공용.
  { id: "npc.model.H", path: "models.npc.variants.H", kind: "model",
    file: "npc_horror.glb", label: `NPC 본체 ${GENRE_LABEL.H}`, role: "아트", due: "9월", aug: false,
    hint: "중년 남성 — 로맨스 쪽과 같은 색·무늬 우비를 미묘하게 다르게. 머리 본 이름을 Head 로" },
  { id: "npc.model.C", path: "models.npc.variants.C", kind: "model",
    file: "npc_comedy.glb", label: `NPC 본체 ${GENRE_LABEL.C}`, role: "아트", due: "9월", aug: false,
    hint: "70대 할머니 — 지팡이·가방. 머리 본 이름을 Head 로" },

  ...GENRES.map((g) => ({
    id: `npc.clip.${g}`, path: `models.npc.clips.${g}`, kind: "model",
    file: `att_${genreName[g]}.glb`, label: `NPC 태도 ${GENRE_LABEL[g]}`,
    role: "아트", due: "9월", aug: false, hint: "루트 모션 없음 · 루프",
  })),
  { id: "npc.clip.neutral", path: "models.npc.clips.neutral", kind: "model",
    file: "att_neutral.glb", label: "NPC 태도 중립", role: "아트", due: "9월", aug: false },

  // ── 아트 · 움직이는 요소 (V2 반영) ─────────────────────
  { id: "moving.truck", path: "models.moving.truck", kind: "model",
    file: "prop_truck.glb", label: "포터형 트럭", role: "아트", due: "9월", aug: false,
    hint: "물웅덩이 튀김 이벤트용. 루트 모션 없이 제자리 — 이동은 코드가 제어" },
  { id: "moving.cat", path: "models.moving.cat", kind: "model",
    file: "prop_cat.glb", label: "고양이", role: "아트", due: "9월", aug: false,
    hint: "애니메이션 클립 포함: 뛰어들어옴 → 멈춤 → 도망. 클립 이름은 자유 — 알려주시면 코드에서 매핑" },

  // ── 아트 · 포스터 텍스처 (V2 반영) ─────────────────────
  // GLB 안 텍스처가 아니라 독립 이미지 파일 — 이벤트 전후로 교체합니다.
  { id: "texture.poster.original", path: "textures.poster.original", kind: "texture",
    file: "tex_poster_original.png", label: "포스터 텍스처 (원본)", role: "아트", due: "9월", aug: false,
    hint: "도입부 기본 상태 — 비 안 맞은 버전" },
  { id: "texture.poster.torn", path: "textures.poster.torn", kind: "texture",
    file: "tex_poster_torn.png", label: "포스터 텍스처 (찢긴)", role: "아트", due: "9월", aug: false,
    hint: "사건 이후 교체되는 버전" },

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
  // V2 양식(장르·순번·대사·최대길이(초)·감정태그·파일명)으로 교체 — 배합ID·태도·
  // {noun} 콜백은 연속 블렌딩으로 방향이 바뀌면서 빠졌습니다. 실제 완성본은
  // Bus/규격/대사양식_v2.csv (46줄, 이미 채워져 있음).
  { id: "dialogue.csv", path: "dialogue.source", kind: "dialogue",
    file: "대사양식_v2.csv", label: "대사 표 (V2)", role: "기획", due: "완료", aug: true,
    hint: "Sheets 에서 CSV 로 내보내 올려 주세요 — 장르는 H/R/C만",
    templateUrl: "/templates/dialogue-template.csv",
    templateName: "대사양식_v2.csv" },
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
  texture: [".png", ".jpg", ".jpeg"],
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
  bgmSumDb: 6.0,             // 장르 트랙 동시 재생 시 합산 증가분 (판타지 드롭 전엔 "네 트랙"이었음)
  inhaleMaxSec: 2.5,
};
