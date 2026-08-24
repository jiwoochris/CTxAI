// 텍스처(포스터·배경 파노라마 등) 검사 — 브라우저 전용.
//
// GLB 안에 박힌 텍스처는 glb.js 가 이미 본다. 이건 GLB 밖에서 독립 파일로
// 오는 텍스처를 위한 것. 기본 규칙: 한 장 최대 2048×2048.
// 예외: "bg.panorama"(정방형도법 배경)는 구 전체에 펼쳐지므로 더 큰 해상도를
// 허용하는 대신 가로:세로 2:1 비율을 요구한다 — 다르면 극좌표에서 이미지가 찌그러진다.

import { LIMITS } from "../assetSpec";

export async function measureTexture(file, slot) {
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

  const isPanorama = slot?.id === "bg.panorama";
  const widthMax = isPanorama ? LIMITS.panoramaWidthMax : LIMITS.textureMax;

  if (out.width > widthMax || (!isPanorama && out.height > widthMax)) {
    add("error", `텍스처가 ${widthMax}×${isPanorama ? widthMax / 2 : widthMax} 를 넘습니다: ${out.width}×${out.height}`);
  }

  if (isPanorama) {
    const aspect = out.width / out.height;
    out.aspect = aspect;
    if (Math.abs(aspect - 2) > LIMITS.panoramaAspectTolerance * 2) {
      add("error",
        `정방형도법(equirectangular)은 가로:세로 = 2:1 이어야 합니다 — 지금 비율 ${aspect.toFixed(2)}:1 (${out.width}×${out.height})`);
    }
  }

  return out;
}
