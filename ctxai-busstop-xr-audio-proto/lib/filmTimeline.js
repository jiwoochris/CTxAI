// /film 타임라인 — 정류장_스크립트_v2.md §1 공통 도입부(다섯 관찰 단서)를 시간축에 놓고,
// 배우(우비 인물·트럭·고양이·옆사람·버스)의 위치를 시간의 순수 함수로 계산한다.
//
// 시간은 "영화 시간"(초). 데모용으로 speed 배수를 걸어 압축할 수 있다.
// 위치 좌표는 components/BlockoutStage.jsx 의 배치와 같다 — 벤치 착석 지점 바닥 = (0,0,0),
// 정면 = -z, 오른쪽 = +x. 도로는 x 1.4 (가까운 차선) / 3.4 (건너편 차선), z -30 → +8 로 흐른다.
//
// 오디오 큐의 key는 public/reactive/audio/manifest.json 의 sfx key다.

export const T = {
  poster: 6,
  cafeBell: 12,
  figureWalkEnd: 40,
  truckStart: 25, truckSplash: 29, truckEnd: 34,
  frog: 37,
  catIn: 43, catStop: 45, catOut: 46.5, catGone: 49,
  catScream: 52, clatter: 53,
  judge: 58,          // 우비 인물이 시야에서 사라지고, 판정 라벨(누가 앉는가)이 정해진다
  announce: 59,       // "272번 버스는 5분 후 도착 예정입니다"
  npcWalkStart: 63, npcSeated: 68,
  sceneStart: 69,     // 이때부터 대사 루프(페이지가 진행) — 상태는 계속 갱신된다
};

// 한 번만 발동하는 큐 — 오디오와 센서 사건. 페이지의 디렉터가 t가 큐를 지날 때 fire 한다.
export const CUES = [
  { t: 0.5, name: "ambience", sfx: "01", loop: true, volume: 0.45 },
  { t: T.poster, name: "poster", sfx: "14", volume: 0.7, sense: { azimuth: 72, dur: 3, kind: "probe" } },
  { t: T.cafeBell, name: "cafeBell", sfx: "09", volume: 0.55, sense: { azimuth: -38, dur: T.figureWalkEnd - T.cafeBell, kind: "track" } },
  { t: T.truckSplash - 0.6, name: "truckSplash", sfx: "02", volume: 0.9, sense: { azimuth: 8, dur: 2.5, kind: "startle" } },
  { t: T.frog, name: "frog", sfx: "10", volume: 0.8, sense: { azimuth: 135, dur: 3, kind: "probe" } },
  { t: T.catIn + 0.6, name: "cat", sfx: "11", volume: 0.8, sense: { azimuth: 30, dur: T.catGone - T.catIn - 0.6, kind: "startle" } },
  { t: T.catScream, name: "catScream", sfx: "12", volume: 0.9, sense: { azimuth: -115, dur: 2.5, kind: "probe" } },
  { t: T.clatter, name: "clatter", sfx: "13", volume: 0.7 },
  { t: T.judge, name: "judge" },
  { t: T.announce, name: "announce", slot: "vo_announce", volume: 1.0 },
  { t: T.npcWalkStart, name: "npcWalk" },
  { t: T.npcSeated, name: "npcSeated" },
  { t: T.sceneStart, name: "scene" },
];

function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
function seg(t, a, b) { return smooth((t - a) / (b - a)); }

/**
 * 시간 t(초) → 배우 상태. dominant는 판정 뒤 앉는 인물(R/H/C), npcDistance는 연출 상태에서 온 값.
 * busAt: 버스가 도착하기 시작한 시각(페이지가 대사 종료 시 설정). null이면 아직.
 */
export function evalActors(t, { dominant = null, npcDistance = 0.9, busAt = null } = {}) {
  const a = {};

  // 우비 인물 — 카페(-9,-12)에서 나와 횡단보도 앞(-1.4,-4.2)까지 걸어온다. 판정 시점에 시야에서 사라진다.
  if (t >= T.cafeBell && t < T.judge) {
    const p = seg(t, T.cafeBell + 1, T.figureWalkEnd);
    // 트럭이 지나가는 동안(횡단보도 앞) 잠시 멈춘다 (v1.1 "횡단보도 앞에 그녀는 잠시 멈췄다")
    const x = lerp(-9, -1.4, p);
    const z = lerp(-11.6, -4.2, p);
    // 트럭이 지난 뒤 길을 건너 정류장 쪽(왼쪽 앞)으로 — 구조물에 가려지는 위치까지
    const cross = t > T.truckEnd ? seg(t, T.truckEnd, T.judge) : 0;
    a.figure = { visible: true, x: x + cross * 0.6, z: z + cross * 2.2, walking: p < 1 || cross > 0, bob: t };
  } else a.figure = { visible: false };

  // 포터 트럭 — 가까운 차선 x=1.4, 먼 곳(-30)에서 관객 앞을 지나 뒤(+9)로.
  if (t >= T.truckStart && t <= T.truckEnd) {
    const p = (t - T.truckStart) / (T.truckEnd - T.truckStart);
    a.truck = { visible: true, x: 1.5, z: lerp(-30, 9, p) };
    a.splash = t >= T.truckSplash - 0.2 && t <= T.truckSplash + 1.2 ? (t - (T.truckSplash - 0.2)) / 1.4 : null;
  } else { a.truck = { visible: false }; a.splash = null; }

  // 고양이 — 오른쪽 숲(7,-3)에서 뛰어들어 벤치 앞(0.9,-0.7)에 멈춰 관객을 보고, 왼쪽(-6,-1)으로 달아난다.
  if (t >= T.catIn && t <= T.catGone) {
    let x, z, running = true, facingBench = false;
    if (t < T.catStop) { const p = seg(t, T.catIn, T.catStop); x = lerp(7, 0.9, p); z = lerp(-3, -0.7, p); }
    else if (t < T.catOut) { x = 0.9; z = -0.7; running = false; facingBench = true; }
    else { const p = seg(t, T.catOut, T.catGone); x = lerp(0.9, -6, p); z = lerp(-0.7, -1.2, p); }
    a.cat = { visible: true, x, z, running, facingBench, bob: t };
  } else a.cat = { visible: false };

  // 포스터 — 바람에 파닥이는 순간
  a.posterFlutter = t >= T.poster && t < T.poster + 2.5 ? Math.sin((t - T.poster) * 18) * Math.exp(-(t - T.poster) * 1.4) : 0;

  // 옆사람 — 왼쪽 앞(-2.6,-1.6)에서 걸어와 벤치 오른쪽에 앉는다. 착석 뒤 거리는 연출 상태가 정한다.
  if (dominant && t >= T.npcWalkStart) {
    const seatX = 0.35 + npcDistance;           // 관객(x=0) 기준 거리
    if (t < T.npcSeated) {
      const p = seg(t, T.npcWalkStart, T.npcSeated);
      a.npc = { visible: true, x: lerp(-2.6, seatX, p), z: lerp(-1.8, 0.05, p), seated: false, walking: true, bob: t };
    } else {
      a.npc = { visible: true, x: seatX, z: 0.05, seated: true, walking: false, bob: t };
    }
  } else a.npc = { visible: false };

  // 272번 버스 — 먼 곳에서 와서 벤치 앞(z≈-0.6)에 선다. 문이 열리고, 인물이 떠난다.
  if (busAt != null && t >= busAt) {
    const p = seg(t, busAt, busAt + 7);
    const z = lerp(-34, -0.4, p);
    const stopped = t >= busAt + 7;
    a.bus = { visible: true, x: 1.7, z, stopped, doorOpen: stopped, headlight: 1 - p * 0.4 };
    // 인물 퇴장 — 공포: 벤치 뒤 풀숲으로 / 로맨스·코미디: 버스로
    if (stopped && a.npc.visible) {
      const q = seg(t, busAt + 8, busAt + 13);
      if (dominant === "H") a.npc = { ...a.npc, seated: false, walking: q < 1, x: lerp(a.npc.x, 1.2, q), z: lerp(0.05, 3.2, q), bob: t, visible: q < 1 };
      else a.npc = { ...a.npc, seated: false, walking: q < 1, x: lerp(a.npc.x, 1.1, q), z: lerp(0.05, -0.9, q), bob: t, visible: q < 0.98 };
    }
    a.busLeaving = t >= busAt + 14 ? seg(t, busAt + 14, busAt + 20) : 0;
    if (a.busLeaving > 0) a.bus.z = lerp(-0.4, 12, a.busLeaving);
    a.fade = t >= busAt + 17 ? seg(t, busAt + 17, busAt + 21) : 0;
  } else { a.bus = { visible: false }; a.busLeaving = 0; a.fade = 0; }

  return a;
}
