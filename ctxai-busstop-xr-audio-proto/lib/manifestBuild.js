// manifest.json 생성 — 서버 전용.
//
// 사람이 JSON 을 편집하지 않습니다. 올라온 파일에서 만들어 냅니다.
// 형식은 Bus/규격/manifest.schema.json 과 같습니다.

import { SLOTS, GENRES, PRESETS, LIMITS } from "./assetSpec";
import { chosenVariant } from "./store";

function setPath(obj, path, value) {
  // "models.structure[bench]" 같은 배열 항목도 받는다
  const arrayItem = path.match(/^(.+)\[([^\]]+)\]$/);
  if (arrayItem) {
    const [, base, id] = arrayItem;
    const list = (getPath(obj, base) ?? []);
    const next = list.filter((e) => e.id !== id);
    next.push({ id, ...value });
    next.sort((a, b) => a.id.localeCompare(b.id));
    setPath(obj, base, next);
    return;
  }
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] ??= {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(obj, path) {
  return path.split(".").reduce((c, p) => (c == null ? undefined : c[p]), obj);
}

function statusOf(record) {
  if (!record) return "missing";
  return record.approved ? "final" : "draft";
}

/**
 * 저장된 기록 + 프리셋으로 매니페스트를 만든다.
 * 아무것도 안 올라왔어도 뼈대는 늘 완전합니다 — 런타임이 키를 찾다 실패하지 않게.
 */
export function buildManifest(records, presets, { voiceId = "", emotionTagsWork = null } = {}) {
  const m = {
    manifestVersion: "1.0",
    updatedAt: new Date().toISOString().slice(0, 10),
    generated: true,
    assetRoot: "/api/assets/file/",
    genres: [...GENRES],
    lighting: {
      presets: Object.fromEntries(
        PRESETS.map((p) => [p.name === "lp_neutral" ? "neutral" : p.name.slice(3), p.name])
      ),
      transitions: [
        { atSec: 0, to: "neutral", durationSec: 0.1, note: "체험 시작" },
        { atSec: 100, to: "event", durationSec: 4, note: "1:40 — 중립 → 사건 장르" },
        { atSec: 310, to: "mix", durationSec: 6, note: "5:10 — 사건 → 사건+태도 혼합" },
      ],
      saved: Object.keys(presets ?? {}).sort(),
    },
    models: { structure: [], sign: {}, npc: { clips: {}, variants: {} }, genreProps: {}, bus: {}, background: {} },
    textures: { poster: {} },
    audio: { bgm: {}, voice: { voiceId, model: "eleven_v3", emotionTagsWork, lines: {} }, sfx: {}, busSfx: {} },
    // combinationCount(사건4×태도4=16)는 v1.1 배합표 개념 — V2는 장르별 고정 대사
    // 목록이라 더는 맞지 않는다. 실제 업로드된 줄 수로 대체.
    dialogue: { source: "", lineCount: null, voiceOutputDir: "assets/vo/" },
  };

  for (const slot of SLOTS) {
    const r = chosenVariant(records[slot.id]);
    const entry = { file: r?.filename ?? slot.file, status: statusOf(r) };
    if (r?.note) entry.note = r.note;

    if (slot.kind === "audio") {
      if (r?.measure?.durationSec != null) entry.loopSec = r.measure.durationSec;
      entry.lufsIntegrated = r?.measure?.lufsIntegrated ?? null;
      entry.truePeakDb = r?.measure?.truePeakDb ?? null;
    }

    if (slot.id === "dialogue.csv") {
      m.dialogue.source = r ? `/api/assets/file/${slot.id}` : "";
      m.dialogue.lineCount = r?.measure?.rows ?? null;
      continue;
    }
    setPath(m, slot.path, entry);
  }

  // 아트가 알려 준 값 — 검사에서 뽑힌 것을 우선 반영
  const npc = chosenVariant(records["npc.model"]);
  m.models.npc.headBone = npc?.measure?.headBone ?? "Head";
  m.models.npc.runtimeRanges = {
    gazeContact: [0.0, 1.0], benchDistanceM: [0.5, 1.4],
    silenceSec: [0.4, 2.5], voiceGain: [0.75, 1.1],
  };
  // 공포·블랙코미디 전용 몸체 — 각자 머리 본 이름이 다를 수 있어 따로 뽑는다
  for (const g of ["H", "C"]) {
    const variant = chosenVariant(records[`npc.model.${g}`]);
    m.models.npc.variants[g].headBone = variant?.measure?.headBone ?? "Head";
  }

  // 가로등 조도 트리거 — 구조물 자체는 자유 슬롯(models.structure[streetlamp])이라
  // 여기서는 "어느 구조물이, 어느 장르에서 반응하는가"만 선언한다. 실제 깜빡임
  // 연출은 아직 없음 — /whitebox 조명 시스템 쪽 별도 작업 (Bus/규격/명명규칙.md 참고).
  m.lighting.streetlamp = { structureId: "streetlamp", flickerOnGenre: "H" };

  const sign = chosenVariant(records["sign.model"]);
  m.models.sign.nameplateMaterial = sign?.measure?.nameplateMaterial ?? "mat_nameplate";
  m.models.sign.nameplate = {
    colorHex: "#F5F2E8", fontFamily: "Pretendard", fontWeight: "Bold",
    heightRatio: 0.45, visibleFromSec: 110,
  };

  return m;
}

/**
 * 현황 요약 — 현황판이 쓰는 값.
 * 「8월에 필요한 것 중 몇 개가 들어왔나」가 핵심 숫자입니다.
 */
export function buildStatus(records, presets) {
  const rows = SLOTS.map((slot) => {
    const slotRec = records[slot.id];
    const r = chosenVariant(slotRec);
    const issues = r?.measure?.issues ?? [];
    return {
      ...slot,
      uploaded: !!r,
      filename: r?.filename ?? null,
      uploadedAt: r?.uploadedAt ?? null,
      bytes: r?.bytes ?? null,
      measure: r?.measure ?? null,
      errors: issues.filter((i) => i.severity === "error").length,
      warns: issues.filter((i) => i.severity === "warn").length,
      chosenId: slotRec?.chosenId ?? null,
      variants: (slotRec?.variants ?? []).map((v) => ({
        id: v.id,
        filename: v.filename,
        uploadedAt: v.uploadedAt,
        bytes: v.bytes,
        note: v.note ?? null,
        measure: v.measure ?? null,
      })),
    };
  });

  // 배경 트랙(장르 수만큼)은 서로 비교해야 알 수 있는 것이 있습니다.
  // ⚠️ 판타지 드롭으로 3트랙이 됐습니다 (2026-08-22) — 아래는 GENRES.length 기준으로
  // 셉니다. 하드코딩된 4로 비교하면 항상 미달로 떨어져서 이 검사 자체가 죽습니다.
  const cross = [];
  const bgm = GENRES.map((g) => chosenVariant(records[`bgm.${g}`])?.measure).filter(Boolean);
  const lufs = bgm.map((b) => b?.lufsIntegrated).filter((v) => typeof v === "number");
  const trackLabel = `${GENRES.length}트랙`;
  if (lufs.length === GENRES.length) {
    const spread = Math.max(...lufs) - Math.min(...lufs);
    cross.push({
      id: "bgm-lufs",
      ok: spread <= LIMITS.bgmLufsSpreadMax,
      label: `${trackLabel} 음량 맞춤`,
      detail: `편차 ${spread.toFixed(1)} dB (허용 ${LIMITS.bgmLufsSpreadMax})`,
    });
  } else if (lufs.length) {
    cross.push({ id: "bgm-lufs", ok: null, label: `${trackLabel} 음량 맞춤`, detail: `${GENRES.length - lufs.length}종 대기 중` });
  }

  const peaks = bgm.map((b) => b?.truePeakDb).filter((v) => typeof v === "number");
  if (peaks.length === GENRES.length) {
    const worst = Math.max(...peaks) + LIMITS.bgmSumDb;
    cross.push({
      id: "bgm-sum",
      ok: worst <= 0,
      label: `${trackLabel} 동시 재생 (T3)`,
      detail: `합산 최악값 ${worst.toFixed(1)} dBFS` + (worst > 0 ? " — 리미터로 받습니다" : ""),
    });
  }

  const loops = GENRES.map((g) => chosenVariant(records[`bgm.${g}`])?.measure?.durationSec).filter(Boolean);
  if (loops.length) {
    const off = loops.filter((d) => Math.abs(d - LIMITS.bgmLoopSec) > 1);
    cross.push({
      id: "bgm-loop",
      ok: off.length === 0,
      label: "루프 30초",
      detail: off.length ? `${off.length}종이 30초에서 벗어남 (${off.map((d) => d + "s").join(", ")})` : `${loops.length}종 확인`,
    });
  }

  const aug = rows.filter((r) => r.aug);
  return {
    rows,
    cross,
    presets: PRESETS.map((p) => ({ ...p, saved: !!presets?.[p.name], receivedAt: presets?.[p.name]?.receivedAt ?? null })),
    summary: {
      augTotal: aug.length,
      augDone: aug.filter((r) => r.uploaded).length,
      presetTotal: PRESETS.length,
      presetDone: PRESETS.filter((p) => presets?.[p.name]).length,
      errors: rows.reduce((s, r) => s + r.errors, 0),
    },
  };
}
