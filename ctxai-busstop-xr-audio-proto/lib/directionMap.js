// 연출 매핑표(ontology) — 연출 상태 벡터 {R,H,C} + settled 를 실제 렌더·연기·소리
// 파라미터로 바꾼다. 8월 중간발표 원페이지가 "향후 과제"로 적은 "감정 축마다
// 색온도·안개 밀도·BGM·TTS 속성을 표로 정의하는 온톨로지"의 첫 구현이다.
//
// 근거 — 정류장_스크립트_v1.1.md "장르별 하늘과 빛" 표:
//   로맨스     구름이 갈라지며 낮은 해가 뚫고 나온다. 젖은 도로 전체가 금빛으로 빛난다
//   공포       구름이 더 두꺼워진다. 오후 세 시인데 밤처럼 어둡다 (밤이 아니라 "대낮의 어둠")
//   블랙코미디 균일하게 밝은 흐림. 그림자가 사라진다
//   중립       아직 어느 장르에도 속하지 않는 소나기 뒤의 흐린 오후 (v2.md §1)
//
// NPC 파라미터의 범위는 정류장_역할별_요청서_v5.0.md §2.7 "코드가 제어할 것" 표를 그대로 쓴다:
//   시선 접촉률 0~1 · 벤치와의 거리 0.5~1.4m · 대사 사이 침묵 0.4~2.5초 · 목소리 크기 0.75~1.10
//
// 이 표는 코드가 아니라 창작 결정이다 — 값은 기획·아트·사운드가 고치면 된다.
// 연속값은 벡터 가중 평균으로 섞고(연속 채널), 불연속 사건(가로등 점등 등)은 임계값으로 켠다.

const GENRES = ["R", "H", "C"];

// 연속 파라미터 앵커 — 장르별 순수값. 색은 [r,g,b] 0~1.
export const ANCHORS = {
  neutral: {
    skyTop: [0.47, 0.50, 0.56], skyHorizon: [0.66, 0.68, 0.71],
    sunColor: [0.91, 0.93, 0.95], sunIntensity: 0.65, sunElevation: 38, sunAzimuth: 35,
    ambientColor: [0.79, 0.80, 0.83], ambientIntensity: 0.7,
    hemiSky: [0.62, 0.66, 0.72], hemiGround: [0.30, 0.30, 0.28], hemiIntensity: 0.35,
    fogColor: [0.56, 0.59, 0.64], fogDensity: 0.022, // 30m 카페와 우비 인물이 보여야 한다 (0.030 은 건너편이 지워졌다)
    shadow: 0.45,          // 0 = 그림자 없음, 1 = 진한 그림자 (directional light 세기·앰비언트 대비로 표현)
    roadColor: [0.62, 0.64, 0.68], roadGloss: 0.5,
    neonColor: [1.0, 0.60, 0.24], neonIntensity: 1.2,
    cafeGlow: 0.7, lampOn: 0.0,
    npcDistance: 0.9, npcGaze: 0.4, npcSilence: 1.2, npcVolume: 0.95, npcSway: 0.4, npcLean: 0.0,
    envIntensity: 0.5, skyExposureR: 0.4, skyExposureH: 0.42, skyExposureC: 0.55,
  },
  R: {
    skyTop: [0.72, 0.58, 0.55], skyHorizon: [1.0, 0.80, 0.55],
    sunColor: [1.0, 0.81, 0.56], sunIntensity: 1.55, sunElevation: 14, sunAzimuth: -55,
    ambientColor: [0.96, 0.79, 0.60], ambientIntensity: 0.75,
    hemiSky: [0.98, 0.78, 0.60], hemiGround: [0.35, 0.28, 0.22], hemiIntensity: 0.45,
    fogColor: [0.90, 0.64, 0.45], fogDensity: 0.016,
    shadow: 1.0,
    roadColor: [0.95, 0.78, 0.60], roadGloss: 0.9,
    neonColor: [1.0, 0.60, 0.24], neonIntensity: 1.0,
    cafeGlow: 1.0, lampOn: 0.0,
    npcDistance: 0.78, npcGaze: 0.75, npcSilence: 0.6, npcVolume: 1.0, npcSway: 0.5, npcLean: 0.15,
    envIntensity: 0.9, skyExposureR: 0.5, skyExposureH: 0.42, skyExposureC: 0.55,
  },
  H: {
    skyTop: [0.10, 0.13, 0.13], skyHorizon: [0.22, 0.27, 0.26],
    sunColor: [0.44, 0.60, 0.52], sunIntensity: 0.22, sunElevation: 40, sunAzimuth: 35,
    ambientColor: [0.20, 0.25, 0.23], ambientIntensity: 0.45,
    hemiSky: [0.20, 0.27, 0.25], hemiGround: [0.08, 0.09, 0.08], hemiIntensity: 0.3,
    fogColor: [0.12, 0.16, 0.15], fogDensity: 0.072,
    shadow: 0.3,
    roadColor: [0.30, 0.34, 0.33], roadGloss: 0.4,
    neonColor: [0.37, 0.68, 0.54], neonIntensity: 1.3,
    cafeGlow: 0.35, lampOn: 1.0,
    npcDistance: 1.2, npcGaze: 0.12, npcSilence: 2.3, npcVolume: 0.78, npcSway: 0.1, npcLean: -0.2,
    envIntensity: 0.18, skyExposureR: 0.4, skyExposureH: 0.13, skyExposureC: 0.55,
  },
  C: {
    skyTop: [0.84, 0.85, 0.80], skyHorizon: [0.98, 0.94, 0.78],
    sunColor: [1.0, 0.96, 0.80], sunIntensity: 0.45, sunElevation: 62, sunAzimuth: 0,
    ambientColor: [1.0, 0.96, 0.80], ambientIntensity: 1.15,
    hemiSky: [0.98, 0.95, 0.82], hemiGround: [0.55, 0.53, 0.45], hemiIntensity: 0.6,
    fogColor: [0.96, 0.93, 0.78], fogDensity: 0.013,
    shadow: 0.0,
    roadColor: [0.90, 0.88, 0.80], roadGloss: 0.3,
    neonColor: [1.0, 0.81, 0.36], neonIntensity: 1.1,
    cafeGlow: 0.8, lampOn: 0.0,
    npcDistance: 0.85, npcGaze: 0.5, npcSilence: 0.8, npcVolume: 1.1, npcSway: 1.0, npcLean: 0.05,
    envIntensity: 1.0, skyExposureR: 0.4, skyExposureH: 0.42, skyExposureC: 0.62,
  },
};

// 불연속 사건 임계값 — 관객이 "알아챌 수 있는 사건 수준의 변화". 파라미터 하나가
// 슬쩍 바뀌는 게 아니라 무언가가 "일어난다". 원 제안서가 스스로 적은 실패 조건
// ("같은 장면의 조명만 다른 버전")을 피하기 위한 층이다.
export const TRIGGERS = {
  // 공포 비중이 이 값을 넘고 settled가 충분하면 가로등이 예정보다 일찍 켜진다 (v2.md 공포 트랙 "아직 오후인데도 소리 없이 켜진다")
  lampEarlyOn: { genre: "H", above: 0.42, minSettled: 0.5 },
  // 로맨스 비중이 넘으면 구름이 갈라진다 — 태양 광원이 뚜렷해지고 도로 반사가 올라간다
  sunBreak: { genre: "R", above: 0.45, minSettled: 0.5 },
  // 코미디 비중이 넘으면 그림자가 완전히 사라진다
  flatLight: { genre: "C", above: 0.45, minSettled: 0.5 },
  // 보조 장르 콜백 대사를 끼워 넣을 최소 비중 (story-v2와 같은 규칙)
  secondaryCallback: { above: 0.25 },
};

function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function blendAnchors(scores) {
  const out = {};
  const keys = Object.keys(ANCHORS.R);
  for (const k of keys) {
    const sample = ANCHORS.R[k];
    if (Array.isArray(sample)) {
      const v = [0, 0, 0];
      for (const g of GENRES) {
        const w = scores[g] || 0;
        const c = ANCHORS[g][k];
        v[0] += c[0] * w; v[1] += c[1] * w; v[2] += c[2] * w;
      }
      out[k] = v;
    } else {
      let v = 0;
      for (const g of GENRES) v += (ANCHORS[g][k] || 0) * (scores[g] || 0);
      out[k] = v;
    }
  }
  return out;
}

/**
 * 연출 상태 → 렌더 파라미터.
 * @param {{R:number,H:number,C:number}} scores  현재 벡터 (합 1)
 * @param {number} settled 0~1
 * @returns {object} 파라미터 + triggers { lampEarlyOn, sunBreak, flatLight }
 */
export function deriveParams(scores, settled = 1) {
  const blended = blendAnchors(scores);
  const n = ANCHORS.neutral;
  const t = Math.max(0, Math.min(1, settled));
  const p = {};
  for (const k of Object.keys(n)) {
    if (Array.isArray(n[k])) p[k] = mix3(n[k], blended[k], t);
    else p[k] = n[k] + (blended[k] - n[k]) * t;
  }

  const triggers = {};
  for (const [name, rule] of Object.entries(TRIGGERS)) {
    if (!rule.genre) continue;
    triggers[name] = t >= rule.minSettled && (scores[rule.genre] || 0) >= rule.above;
  }
  // 트리거가 켜지면 연속값 위에 사건 수준 변화를 얹는다.
  if (triggers.lampEarlyOn) p.lampOn = 1.0;
  if (triggers.sunBreak) { p.sunIntensity = Math.max(p.sunIntensity, 1.4); p.roadGloss = Math.max(p.roadGloss, 0.85); p.shadow = Math.max(p.shadow, 0.9); }
  if (triggers.flatLight) { p.shadow = 0; p.sunIntensity = Math.min(p.sunIntensity, 0.4); }

  p.triggers = triggers;
  return p;
}

// BGM 게인 — "다 섞으면 색이 사라진다" 규칙(lib/bgmBlend.js)대로 상위 2개만.
// settled가 낮을 땐 세 트랙을 고르게 낮게 깔아 "아직 정해지지 않은 밤"을 만든다
// (정류장_역할별_요청서_v5.0.md §2.5).
export function deriveBgmGains(scores, settled = 1, maxGain = 0.32) {
  const sorted = GENRES.map((g) => [g, scores[g] || 0]).sort((a, b) => b[1] - a[1]);
  const kept = new Set(sorted.slice(0, 2).map(([g]) => g));
  const top = {};
  let sum = 0;
  for (const [g, v] of sorted) { top[g] = kept.has(g) ? v : 0; sum += top[g]; }
  const out = {};
  for (const g of GENRES) {
    const blended = (sum > 0 ? top[g] / sum : 1 / 3) * maxGain;
    const even = maxGain * 0.45;
    out[g] = even + (blended - even) * settled;
  }
  return out;
}

export const AZIMUTH = {
  // 정면(도로) = 0°, 시계방향(오른쪽) = +. Bus/규격/3D_배경_구성_기획.md §4.
  road: 0, cafe: -38, forest: 60, poster: 72, frog: 135, reeds: 180, catScream: -115, npc: 58, bus: -20,
};
