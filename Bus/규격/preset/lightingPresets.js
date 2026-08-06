// 조명 프리셋 — 런타임 적용 · 두 장 섞기
//
// 아트는 다섯 장만 만듭니다 (lp_neutral · lp_H · lp_R · lp_C · lp_F).
// 열여섯 배합은 이 다섯 장 중 두 장을 섞어 전부 표현합니다 (요청서 §2.4).
// 조합 프리셋(lp_R-H 등)은 만들지 않습니다 — 여기서 만들어 냅니다.
//
// lerpPreset() 은 순수 함수라 PlayCanvas 없이 node 에서 검증됩니다.
// applyPreset() 만 pc.Application 을 씁니다.

// ── 값의 종류 ───────────────────────────────────────────────
// 이어서 섞을 수 있는 값과, 섞으면 뜻이 깨지는 값을 나눈다.
// 후자는 t < 0.5 에서 a, 그 이상에서 b 를 그대로 쓴다.
const DISCRETE_SCENE = new Set(["fogType", "tonemapping", "gamma"]);
const DISCRETE_LIGHT = new Set(["type", "falloffMode", "castShadows"]);

const COLOR_SCENE = new Set(["ambient", "fogColor"]);
const VECTOR_SCENE = new Set(["skyRotation"]);

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

const lerpNum = (a, b, t) => a + (b - a) * t;

function lerpArray(a, b, t) {
  const len = Math.max(a?.length ?? 0, b?.length ?? 0);
  const out = new Array(len);
  for (let i = 0; i < len; i++) out[i] = lerpNum(a?.[i] ?? 0, b?.[i] ?? 0, t);
  return out;
}

// 값 하나를 섞는다. 숫자·배열이 아니면 가까운 쪽을 고른다.
function lerpValue(a, b, t, discrete) {
  if (discrete) return t < 0.5 ? a : b;
  if (a === undefined || a === null) return b;
  if (b === undefined || b === null) return a;
  if (Array.isArray(a) || Array.isArray(b)) return lerpArray(a, b, t);
  if (typeof a === "number" && typeof b === "number") return lerpNum(a, b, t);
  if (typeof a === "boolean" || typeof b === "boolean") return t < 0.5 ? a : b;
  return t < 0.5 ? a : b;
}

/**
 * 프리셋 두 장을 섞는다.
 *
 *   lerpPreset(lp_R, lp_H, 0.35)   // 로맨스 사건 + 공포 태도 = "경계하는 그리움"
 *
 * t = 0 이면 a, 1 이면 b. 전환 애니메이션(1:40의 4초, 5:10의 6초)에도 같은 함수를 씁니다.
 *
 * 한쪽에만 있는 조명은 반대쪽 intensity 를 0 으로 두고 섞습니다 —
 * 공포에만 있는 깜빡이는 형광등이 로맨스로 갈수록 자연스럽게 꺼집니다.
 */
export function lerpPreset(a, b, t, name) {
  if (!a) return b;
  if (!b) return a;
  t = clamp01(t);

  // ── 씬 설정 ──
  const scene = {};
  const sceneKeys = new Set([...Object.keys(a.scene ?? {}), ...Object.keys(b.scene ?? {})]);
  for (const k of sceneKeys) {
    const av = a.scene?.[k];
    const bv = b.scene?.[k];
    const discrete = DISCRETE_SCENE.has(k);
    scene[k] = lerpValue(av, bv, t, discrete);
    // 색과 벡터는 길이를 보존한다
    if ((COLOR_SCENE.has(k) || VECTOR_SCENE.has(k)) && Array.isArray(scene[k])) {
      const want = (av ?? bv)?.length ?? scene[k].length;
      scene[k] = scene[k].slice(0, want);
    }
  }

  // ── 조명 ── 이름으로 짝을 맞춘다
  const index = (list) => {
    const m = new Map();
    for (const L of list ?? []) m.set(L.name, L);
    return m;
  };
  const ai = index(a.lights);
  const bi = index(b.lights);
  const names = [...new Set([...ai.keys(), ...bi.keys()])];

  const lights = names.map((n) => {
    const A = ai.get(n);
    const B = bi.get(n);

    // 한쪽에만 있으면 intensity 0 인 유령을 만들어 짝을 맞춘다
    const base = A ?? B;
    const ghost = { ...base, intensity: 0, enabled: base.enabled, componentEnabled: true };
    const L = A ?? ghost;
    const R = B ?? ghost;

    const out = { name: n };
    const keys = new Set([...Object.keys(L), ...Object.keys(R)]);
    for (const k of keys) {
      if (k === "name") continue;
      if (k === "resourceId") { out[k] = L[k] ?? R[k]; continue; }
      out[k] = lerpValue(L[k], R[k], t, DISCRETE_LIGHT.has(k));
    }
    // 양쪽 다 꺼져 있으면 켜지 않는다
    out.enabled = (L.enabled !== false) || (R.enabled !== false);
    return out;
  });

  return {
    presetVersion: a.presetVersion ?? b.presetVersion,
    name: name ?? `${a.name}×${b.name}@${t.toFixed(2)}`,
    mixedFrom: [a.name, b.name, t],
    scene,
    lights,
  };
}

// ── PlayCanvas 적용 ─────────────────────────────────────────

const FOG_TYPES = { 0: "none", 1: "linear", 2: "exp", 3: "exp2" };

/**
 * 프리셋을 실행 중인 씬에 바른다.
 *
 *   applyPreset(app, lerpPreset(presets.lp_R, presets.lp_H, 0.35))
 *
 * 조명 엔티티는 이름으로 찾습니다. 에디터에서 저장할 때의 이름과 같아야 합니다.
 * 못 찾은 조명은 onMissing 으로 알려 주고 건너뜁니다.
 */
export function applyPreset(app, preset, { onMissing } = {}) {
  if (!app || !preset) return { lights: 0, missing: [] };

  const scene = app.scene;
  const p = preset.scene ?? {};

  if (p.ambient) scene.ambientLight.set(...p.ambient);
  if (typeof p.exposure === "number") scene.exposure = p.exposure;
  if (typeof p.skyIntensity === "number") scene.skyboxIntensity = p.skyIntensity;
  if (typeof p.skyMip === "number") scene.skyboxMip = Math.round(p.skyMip);

  if (p.fogType !== undefined) {
    scene.fog = typeof p.fogType === "number" ? FOG_TYPES[p.fogType] ?? "none" : p.fogType;
  }
  if (p.fogColor) scene.fogColor.set(...p.fogColor);
  if (typeof p.fogDensity === "number") scene.fogDensity = p.fogDensity;
  if (typeof p.fogStart === "number") scene.fogStart = p.fogStart;
  if (typeof p.fogEnd === "number") scene.fogEnd = p.fogEnd;

  const missing = [];
  let applied = 0;

  for (const L of preset.lights ?? []) {
    const e = app.root.findByName(L.name);
    if (!e || !e.light) { missing.push(L.name); continue; }

    if (L.color) e.light.color.set(...L.color);
    if (typeof L.intensity === "number") e.light.intensity = L.intensity;
    if (typeof L.range === "number") e.light.range = L.range;
    if (typeof L.innerConeAngle === "number") e.light.innerConeAngle = L.innerConeAngle;
    if (typeof L.outerConeAngle === "number") e.light.outerConeAngle = L.outerConeAngle;
    if (typeof L.shadowIntensity === "number") e.light.shadowIntensity = L.shadowIntensity;
    if (typeof L.castShadows === "boolean") e.light.castShadows = L.castShadows;
    if (L.position) e.setLocalPosition(...L.position);
    if (L.rotation) e.setLocalEulerAngles(...L.rotation);
    if (typeof L.enabled === "boolean") e.enabled = L.enabled;
    applied++;
  }

  if (missing.length && onMissing) onMissing(missing);
  return { lights: applied, missing };
}

// ── 전환 ────────────────────────────────────────────────────

/**
 * 지금 프리셋에서 목표 프리셋으로 durationSec 동안 넘어간다.
 * 1:40 의 4초, 5:10 의 6초 전환에 씁니다.
 *
 * 반환값을 호출하면 전환을 중간에 끊습니다.
 */
export function transitionTo(app, from, to, durationSec, { onDone, onMissing } = {}) {
  let raf = null;
  let cancelled = false;
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const ms = Math.max(1, durationSec * 1000);

  const step = () => {
    if (cancelled) return;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const t = clamp01((now - t0) / ms);
    // 조명 전환은 선형보다 부드러운 게 자연스럽다
    const e = t * t * (3 - 2 * t);
    applyPreset(app, lerpPreset(from, to, e), { onMissing });
    if (t < 1) raf = requestAnimationFrame(step);
    else if (onDone) onDone();
  };
  step();

  return () => { cancelled = true; if (raf) cancelAnimationFrame(raf); };
}
