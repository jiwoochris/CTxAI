// GLB 검사 — 브라우저 전용.
//
// 규약 문서를 읽고 지키는 대신, 올리는 순간 기계가 봅니다 (요청서 §2.2).
// glTF 2.0 의 JSON 청크만 파싱하므로 라이브러리가 필요 없습니다.
//
// 보는 것: 형식 · 삼각형 수 · 텍스처 크기 · 루트 모션 · 본 이름 · 씬 원점
// 못 보는 것: 피벗이 「바닥 접지면 중앙」인가 (이건 눈으로 봐야 합니다)

import { LIMITS } from "../assetSpec";

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function parseGlb(bytes) {
  const dv = new DataView(bytes);
  if (dv.byteLength < 20) throw new Error("파일이 너무 작습니다");
  if (dv.getUint32(0, true) !== MAGIC) {
    throw new Error("GLB 가 아닙니다 (.gltf + 별도 텍스처 파일일 수 있습니다)");
  }
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`glTF ${version} 입니다 — 2.0 이어야 합니다`);

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= dv.byteLength) {
    const len = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === JSON_CHUNK) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, start, len)));
    } else if (type === BIN_CHUNK) {
      bin = { start, len };
    }
    offset = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error("JSON 청크가 없습니다");
  return { json, bin };
}

// PNG · JPEG 헤더에서 가로세로만 읽는다 (디코딩 없이)
function imageSize(u8) {
  // PNG: 89 50 4E 47 ... IHDR
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    const dv = new DataView(u8.buffer, u8.byteOffset);
    return { width: dv.getUint32(16), height: dv.getUint32(20), format: "PNG" };
  }
  // JPEG: FF D8 ... SOFn
  if (u8[0] === 0xff && u8[1] === 0xd8) {
    let i = 2;
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xff) { i++; continue; }
      const marker = u8[i + 1];
      const len = (u8[i + 2] << 8) | u8[i + 3];
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      if (marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (u8[i + 5] << 8) | u8[i + 6], width: (u8[i + 7] << 8) | u8[i + 8], format: "JPEG" };
      }
      i += 2 + len;
    }
  }
  return null;
}

function triangleCount(json) {
  const acc = json.accessors ?? [];
  let tris = 0;
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      const mode = p.mode ?? 4; // 4 = TRIANGLES
      if (mode !== 4) continue;
      const count = p.indices !== undefined
        ? acc[p.indices]?.count ?? 0
        : acc[p.attributes?.POSITION]?.count ?? 0;
      tris += Math.floor(count / 3);
    }
  }
  return tris;
}

// 루트 노드(씬 최상위)에 위치 애니메이션이 걸려 있으면 루트 모션
function rootMotion(json) {
  const sceneIdx = json.scene ?? 0;
  const roots = new Set(json.scenes?.[sceneIdx]?.nodes ?? []);
  const hits = [];
  for (const anim of json.animations ?? []) {
    for (const ch of anim.channels ?? []) {
      const node = ch.target?.node;
      if (node !== undefined && roots.has(node) && ch.target?.path === "translation") {
        hits.push(anim.name || "(이름 없는 애니메이션)");
      }
    }
  }
  return [...new Set(hits)];
}

/**
 * GLB 하나를 검사한다. 규약 위반은 issues 에 담아 돌려주고, 던지지 않는다.
 * severity: "error" = 런타임에서 깨짐 / "warn" = 확인 필요
 */
export async function measureGlb(file, slot) {
  const out = { kind: "model", issues: [] };
  const add = (severity, msg) => out.issues.push({ severity, msg });

  let parsed;
  try {
    parsed = parseGlb(await file.arrayBuffer());
  } catch (e) {
    add("error", e.message);
    out.error = e.message;
    return out;
  }

  const { json, bin } = parsed;
  const bytes = await file.arrayBuffer();

  out.generator = json.asset?.generator ?? null;
  out.triangles = triangleCount(json);
  out.meshes = (json.meshes ?? []).length;
  out.nodes = (json.nodes ?? []).length;
  out.animations = (json.animations ?? []).map((a) => a.name || "(이름 없음)");
  out.nodeNames = (json.nodes ?? []).map((n) => n.name).filter(Boolean);

  // ── 압축 확장 — 런타임에 디코더가 필요합니다
  const ext = json.extensionsRequired ?? [];
  out.extensionsRequired = ext;
  if (ext.includes("KHR_draco_mesh_compression")) {
    add("warn", "Draco 압축이 걸려 있습니다. 런타임에 디코더를 붙여야 합니다 — 개발에 알려 주세요");
  }
  if (ext.includes("KHR_texture_basisu")) {
    add("warn", "Basis 텍스처입니다. Quest 3 에서 확인이 필요합니다");
  }

  // ── 텍스처 크기
  const sizes = [];
  for (const img of json.images ?? []) {
    if (img.bufferView === undefined || !bin) continue;
    const bv = json.bufferViews?.[img.bufferView];
    if (!bv) continue;
    const start = bin.start + (bv.byteOffset ?? 0);
    const u8 = new Uint8Array(bytes, start, Math.min(bv.byteLength, 64 * 1024));
    const size = imageSize(u8);
    if (size) sizes.push({ name: img.name ?? null, ...size });
  }
  out.textures = sizes;
  const tooBig = sizes.filter((s) => s.width > LIMITS.textureMax || s.height > LIMITS.textureMax);
  if (tooBig.length) {
    add("error", `텍스처가 ${LIMITS.textureMax}×${LIMITS.textureMax} 를 넘습니다: ` +
      tooBig.map((s) => `${s.width}×${s.height}`).join(", "));
  }
  const external = (json.images ?? []).filter((i) => i.uri && !i.uri.startsWith("data:"));
  if (external.length) {
    add("error", `텍스처가 파일 안에 들어 있지 않습니다 (${external.length}개). GLB 로 내보낼 때 「텍스처 포함」을 켜 주세요`);
  }

  // ── 루트 모션 — 위치는 코드가 제어합니다
  const rm = rootMotion(json);
  if (rm.length) {
    out.rootMotion = rm;
    add("error", `루트 모션이 있습니다 (${rm.join(", ")}). 제자리 애니메이션으로 주세요 — 위치는 코드가 움직입니다`);
  }

  // ── 슬롯별 추가 검사
  if (slot?.id === "npc.model") {
    const head = out.nodeNames.find((n) => /^head$/i.test(n));
    out.headBone = head ?? null;
    if (!head) add("warn", "Head 라는 이름의 본을 못 찾았습니다. 다른 이름이면 알려 주세요 — 시선을 코드가 섞습니다");
  }
  if (slot?.id === "sign.model") {
    const mats = (json.materials ?? []).map((m) => m.name).filter(Boolean);
    out.materials = mats;
    const plate = mats.find((m) => /nameplate|name_plate|이름/i.test(m));
    out.nameplateMaterial = plate ?? null;
    if (!plate) {
      add("warn", `이름 자리 머티리얼을 못 찾았습니다. 지금 머티리얼: ${mats.join(", ") || "없음"} — 어느 것인지 알려 주세요`);
    }
  }
  if (slot?.id?.startsWith("npc.clip") && !out.animations.length) {
    add("error", "애니메이션이 없습니다. 태도 클립은 애니메이션이 들어 있어야 합니다");
  }

  // ── 폴리곤 상한은 8/17 T4 실측 뒤에 정합니다
  out.triangleLimitPending = true;

  return out;
}
