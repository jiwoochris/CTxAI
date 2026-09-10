// /film 타임라인 — 정류장_스크립트_v2.md §1 공통 도입부(다섯 관찰 단서)를 시간축에 놓고,
// 배우(우비 인물·트럭·고양이·옆사람·버스)의 위치를 시간의 순수 함수로 계산한다.
//
// 시간은 "영화 시간"(초). 데모용으로 speed 배수를 걸어 압축할 수 있다.
// 위치 좌표: 벤치 착석 지점 바닥 = (0,0,0), 정면 = -z, 오른쪽 = +x. 도로는 정면에서 좌우(x)로 지나간다.
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
  npcWalkStart: 62, npcSeated: 68, // 6초 걷기(−6 → 벤치 끝, 1.5m/s) — 관객 앞을 지나는 모습이 보이도록
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
// 배우 좌표계 — 관객이 앉은 벤치 바닥 = 원점, 정면 = -z, 오른쪽 = +x.
// 도로: 가까운 차선 중심 z=-4.75, 건너편 차선 중심 z=-15.25 (연석 -3 / 중앙선 -10 / 건너편 연석 -17).
// 카페 (-19,-26) · 횡단보도 x=-5 · 공원 입구 숲 +x 쪽 · 풀숲 뒤 z>2.
function heading(dx, dz) { return Math.atan2(dx, dz); } // 모델 정면(+z)이 진행 방향을 보게 하는 yaw
const BUS_STOP_X = -1.2; // 정차 시 차체 중심. 앞문은 +2.4 → x≈1.2

export function evalActors(t, { dominant = null, npcDistance = 0.9, busAt = null } = {}) {
  const a = {};

  // 우비 인물 — 카페 문(-18,-24.4)에서 나와 횡단보도 건너편 끝(-5,-17.6)까지 걷고, 트럭이 지나가길
  // 기다렸다가(36~40s) 길을 건너(40~52s) 인도를 따라 정류장 왼쪽 옆(-2.8, 0.2)까지 오고(52~58s, 판정),
  // 정류장 왼쪽 관목(-3,1.9) 뒤로 돌아 들어가(58~61s) 사라진다 — 시야 안에서 갑자기 없어지지 않게.
  const figureEnd = T.judge + 3;
  if (t >= T.cafeBell && t < figureEnd) {
    let x, z, walking = true;
    if (t < 36) { const p = seg(t, T.cafeBell + 1, 36); x = lerp(-18, -5, p); z = lerp(-24.4, -17.6, p); }
    else if (t < 40) { x = -5; z = -17.6; walking = false; }
    else if (t < 52) { const p = seg(t, 40, 52); x = -5; z = lerp(-17.6, -2.4, p); }
    else if (t < T.judge) { const p = (t - 52) / (T.judge - 52); x = lerp(-5, -2.8, p); z = lerp(-2.4, 0.2, p); }
    else { const p = (t - T.judge) / (figureEnd - T.judge); x = lerp(-2.8, -3.6, p); z = lerp(0.2, 2.8, p); }
    // 진행 방향으로 몸을 돌린다 (정지 중엔 도로를 본다)
    const yaw = t < 36 ? heading(13, 6.8) : t < 52 ? heading(0, 1) : t < T.judge ? heading(2.2, 2.6) : heading(-0.8, 2.6);
    a.figure = { visible: true, x, z, walking, yaw, bob: t };
  } else a.figure = { visible: false };

  // 포터 트럭 — 가까운 차선을 오른쪽에서 왼쪽으로(v2.md §1-3). 정류장 앞(x≈0.6)에서 물웅덩이를 밟는다.
  if (t >= T.truckStart && t <= T.truckEnd) {
    const p = (t - T.truckStart) / (T.truckEnd - T.truckStart);
    a.truck = { visible: true, x: lerp(27, -27, p), z: -4.75 }; // 54m/9s ≈ 22km/h — 정면 시야(±48°)에 2초쯤 머문다
    a.splash = t >= T.truckSplash - 0.2 && t <= T.truckSplash + 1.2 ? (t - (T.truckSplash - 0.2)) / 1.4 : null;
  } else { a.truck = { visible: false }; a.splash = null; }

  // 고양이 — 오른쪽 공원 진입로(9,-2.6)에서 뛰어들어 벤치 앞(0.9,-1.5)에 멈춰 관객을 보고, 왼쪽(-9,-2.2)으로 달아난다.
  if (t >= T.catIn && t <= T.catGone) {
    let x, z, running = true, facingBench = false;
    if (t < T.catStop) { const p = seg(t, T.catIn, T.catStop); x = lerp(9, 0.9, p); z = lerp(-2.6, -1.5, p); }
    else if (t < T.catOut) { x = 0.9; z = -1.5; running = false; facingBench = true; }
    else { const p = seg(t, T.catOut, T.catGone); x = lerp(0.9, -9, p); z = lerp(-1.5, -2.2, p); }
    a.cat = { visible: true, x, z, running, facingBench, bob: t };
  } else a.cat = { visible: false };

  // 포스터 — 바람에 파닥이는 순간
  a.posterFlutter = t >= T.poster && t < T.poster + 2.5 ? Math.sin((t - T.poster) * 18) * Math.exp(-(t - T.poster) * 1.4) : 0;

  // 옆사람 — 왼쪽 인도(-6,-1.7)에서 인도를 따라 걸어와(관객 앞 1.5m 를 지나며 얼굴이 보인다) 벤치 오른쪽 끝 앞에서
  // 멈춰 돌아선 뒤 앉는다. 관객 코앞(0.5m 안)으로는 절대 들어오지 않는다. 착석 뒤 거리는 연출 상태가 정한다.
  if (dominant && t >= T.npcWalkStart) {
    const seatX = 0.35 + npcDistance;
    const turnAt = T.npcSeated - 1.1;
    if (t < turnAt) {
      const p = (t - T.npcWalkStart) / (turnAt - T.npcWalkStart); // 등속 — 걷는 사람은 가감속이 거의 없다
      const x = lerp(-6, seatX + 0.15, p), z = lerp(-1.7, -1.25, p);
      a.npc = { visible: true, x, z, seated: false, walking: true, yaw: heading(seatX + 6.15, 0.45), bob: t };
    } else if (t < T.npcSeated) {
      const p = seg(t, turnAt, T.npcSeated);
      const x = lerp(seatX + 0.15, seatX, p), z = lerp(-1.25, 0.3, p);
      a.npc = { visible: true, x, z, seated: false, walking: true, yaw: lerp(heading(0, 1), heading(-0.15, 1.55), p), bob: t };
    } else {
      a.npc = { visible: true, x: seatX, z: 0.3, seated: true, walking: false, yaw: Math.PI, bob: t };
    }
  } else a.npc = { visible: false };

  // 272번 버스 — 왼쪽 커브 너머(v1.1)에서 가까운 차선으로 와서 정류장 앞에 선다. 차체 중심 x=−1.2 에 서면
  // 앞문(차체 앞쪽 2.4m)이 관객 정면 오른쪽 x≈1.2 에 온다. 문이 열리고 인물이 떠난다.
  if (busAt != null && t >= busAt) {
    const p = seg(t, busAt, busAt + 7);
    const x = lerp(-48, BUS_STOP_X, p);
    const stopped = t >= busAt + 7;
    a.bus = { visible: true, x, z: -4.75, stopped, doorOpen: stopped, headlight: 1 - p * 0.4 };
    // 인물 퇴장 — 공포: 벤치 뒤 풀숲으로 / 로맨스·코미디: 버스 문 앞(1.2,-2.6)으로. 정차는 9초(문 열림 1초 뒤 일어선다)
    if (stopped && a.npc.visible) {
      const q = seg(t, busAt + 8, busAt + 14);
      if (dominant === "H") a.npc = { ...a.npc, seated: false, walking: q < 1, x: lerp(a.npc.x, 1.6, q), z: lerp(0.3, 3.6, q), yaw: heading(0.5, 3.3), bob: t, visible: q < 1 };
      else a.npc = { ...a.npc, seated: false, walking: q < 1, x: lerp(a.npc.x, BUS_STOP_X + 2.4, q), z: lerp(0.3, -2.7, q), yaw: heading(BUS_STOP_X + 2.4 - a.npc.x, -3.0), bob: t, visible: q < 0.98 };
    }
    a.bus.doorOpen = stopped && t < busAt + 16;
    a.busLeaving = t >= busAt + 16 ? seg(t, busAt + 16, busAt + 22) : 0;
    if (a.busLeaving > 0) a.bus.x = lerp(BUS_STOP_X, 50, a.busLeaving);
    a.fade = t >= busAt + 19 ? seg(t, busAt + 19, busAt + 23) : 0;
  } else { a.bus = { visible: false }; a.busLeaving = 0; a.fade = 0; }

  return a;
}
