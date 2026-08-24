// 두 장르 조명 프리셋을 배합 비율로 보간한다 — lib/bgmBlend.js가 BGM 볼륨을
// 배합 비율대로 섞는 것과 같은 생각을, 조명(환경광·주광 색/세기·안개)에 적용한 것.
//
// 프리셋 형식은 app/whitebox가 저장하는 그대로다(Bus/규격/preset/preset.schema.json):
//   { scene: { ambient:[r,g,b], exposure, fogType, fogColor:[r,g,b], fogDensity },
//     lights: [{ name, type, color:[r,g,b], intensity, position, enabled, castShadows }] }
//
// 결과는 components/AudienceStage.jsx의 lighting prop에 그대로 꽂을 수 있는 같은 모양이다.

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpVec3(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// 이름으로 짝을 맞춰 조명 배열 두 개를 섞는다 — 한쪽에만 있는 조명은 그 세기를
// 배합 비중만큼 낮춰서 반영한다(꺼진 것처럼 뚝 끊기지 않게).
function blendLights(lightsA, lightsB, weightA, weightB) {
  const byName = new Map();
  for (const l of lightsA ?? []) byName.set(l.name, { a: l, b: null });
  for (const l of lightsB ?? []) {
    const entry = byName.get(l.name);
    if (entry) entry.b = l;
    else byName.set(l.name, { a: null, b: l });
  }

  const out = [];
  for (const [name, { a, b }] of byName) {
    const base = a ?? b;
    if (!base || base.enabled === false) continue;
    const intensityA = a && a.enabled !== false ? (a.intensity ?? 1) * weightA : 0;
    const intensityB = b && b.enabled !== false ? (b.intensity ?? 1) * weightB : 0;
    out.push({
      name,
      type: base.type,
      position: base.position,
      castShadows: base.castShadows,
      enabled: true,
      color: a && b ? lerpVec3(a.color, b.color, weightB) : (a ?? b).color,
      intensity: intensityA + intensityB,
    });
  }
  return out;
}

/**
 * 프리셋 A·B를 weightB 비율로 섞는다 (weightA = 1 - weightB로 취급하지 않고
 * 둘 다 받는 이유: fuseChannels()의 두 점수를 그대로 넘길 수 있게 — 정규화는
 * 호출부에서 이미 끝난 값을 주는 걸 기본으로 하되, 여기서도 안전하게 다시 정규화한다).
 */
export function blendPresets(presetA, presetB, weightA, weightB) {
  if (!presetA && !presetB) return { scene: {}, lights: [] };
  if (!presetB || weightB <= 0) return presetA ?? presetB;
  if (!presetA || weightA <= 0) return presetB;

  const total = weightA + weightB || 1;
  const tA = weightA / total;
  const tB = weightB / total;

  const sceneA = presetA.scene ?? {};
  const sceneB = presetB.scene ?? {};

  return {
    scene: {
      ambient: lerpVec3(sceneA.ambient, sceneB.ambient, tB),
      exposure: lerp(sceneA.exposure ?? 1, sceneB.exposure ?? 1, tB),
      // 안개는 둘 중 하나라도 켜져 있으면 켠다 — 절반만 안개인 장면은 없다.
      fogType: sceneA.fogType === "exp2" || sceneB.fogType === "exp2" ? "exp2" : "none",
      fogColor: lerpVec3(sceneA.fogColor, sceneB.fogColor, tB),
      fogDensity: lerp(sceneA.fogDensity ?? 0, sceneB.fogDensity ?? 0, tB),
    },
    lights: blendLights(presetA.lights, presetB.lights, tA, tB),
  };
}
