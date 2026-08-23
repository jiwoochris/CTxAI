// 텍스처(포스터 등) 검사 — 브라우저 전용.
//
// GLB 안에 박힌 텍스처는 glb.js 가 이미 본다. 이건 GLB 밖에서 독립 파일로
// 오는 텍스처(포스터 찢긴/원본 등)를 위한 것 — 규칙은 같다: 한 장 최대 2048×2048.

import { LIMITS } from "../assetSpec";

export async function measureTexture(file) {
  const out = { kind: "texture", issues: [] };
  const add = (severity, msg) => out.issues.push({ severity, msg });

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    add("error", `이미지를 열지 못했습니다: ${e.message}`);
    out.error = e.message;
    return out;
  }

  out.width = bitmap.width;
  out.height = bitmap.height;
  bitmap.close?.();

  if (out.width > LIMITS.textureMax || out.height > LIMITS.textureMax) {
    add("error", `텍스처가 ${LIMITS.textureMax}×${LIMITS.textureMax} 를 넘습니다: ${out.width}×${out.height}`);
  }

  return out;
}
