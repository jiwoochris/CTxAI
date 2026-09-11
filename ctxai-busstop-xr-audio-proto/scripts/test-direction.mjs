// 연출 엔진 회귀 테스트 — 외부 의존 없이 node 로 바로 돈다: node scripts/test-direction.mjs
// 매핑표·상태 저장소·풀 선택 규칙이 문서(반응형_실시간_영화.md §3·§4)와 어긋나면 여기서 잡힌다.

import assert from "node:assert/strict";
import { createDirectionState, entropyConfidence, rank } from "../lib/directionState.js";
import { ANCHORS, TRIGGERS, deriveParams, deriveBgmGains } from "../lib/directionMap.js";
import { pickPoolLine, TINT_THRESHOLD } from "../lib/dialoguePool.js";
import { evalActors, T } from "../lib/filmTimeline.js";
import { DIALOGUE_V2_LINES } from "../lib/dialogueV2Lines.js";
import { DIALOGUE_V2_BEATS, beatOf, playsLine, playedCount, gazeFor, answerWatchStart, answerWatchUpdate, answerWatchResult } from "../lib/dialogueBeats.js";

let n = 0;
function test(name, fn) { try { fn(); n++; console.log("ok ", name); } catch (e) { console.log("FAIL", name, "—", e.message); process.exitCode = 1; } }
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("순수 벡터 + settled 1 이면 매핑표 앵커값 그대로", () => {
  for (const g of ["R", "H", "C"]) {
    const p = deriveParams({ R: g === "R" ? 1 : 0, H: g === "H" ? 1 : 0, C: g === "C" ? 1 : 0 }, 1);
    assert.ok(close(p.npcDistance, ANCHORS[g].npcDistance), `${g} npcDistance`);
    assert.ok(close(p.fogDensity, ANCHORS[g].fogDensity), `${g} fogDensity`);
  }
});

test("settled 0 이면 어떤 벡터든 중립 앵커", () => {
  const p = deriveParams({ R: 0, H: 1, C: 0 }, 0);
  assert.ok(close(p.npcDistance, ANCHORS.neutral.npcDistance));
  assert.ok(close(p.lampOn, ANCHORS.neutral.lampOn));
  assert.equal(p.triggers.lampEarlyOn, false);
});

test("사건 트리거 — 공포 42% 이상이면 가로등이 켜지고, 코미디 45% 이상이면 그림자 0", () => {
  const h = deriveParams({ R: 0.5, H: 0.45, C: 0.05 }, 1);
  assert.equal(h.triggers.lampEarlyOn, true); assert.ok(close(h.lampOn, 1));
  const c = deriveParams({ R: 0.5, H: 0.02, C: 0.48 }, 1);
  assert.equal(c.triggers.flatLight, true); assert.equal(c.shadow, 0);
  const under = deriveParams({ R: 0.6, H: 0.4, C: 0 }, 1);
  assert.equal(under.triggers.lampEarlyOn, false);
});

test("BGM 게인 — 상위 2개만, settled 0 이면 셋이 고르게", () => {
  const even = deriveBgmGains({ R: 0.6, H: 0.3, C: 0.1 }, 0);
  assert.ok(close(even.R, even.H) && close(even.H, even.C));
  const top2 = deriveBgmGains({ R: 0.6, H: 0.3, C: 0.1 }, 1);
  assert.ok(close(top2.C, 0)); assert.ok(top2.R > top2.H && top2.H > 0);
});

test("상태 저장소 — 증거가 쌓이면 target 이 기울고 current 는 완만히 따라간다", () => {
  const d = createDirectionState({ followRate: 0.6, settleMass: 2 });
  d.pushEvidence({ R: 0, H: 1, C: 0 }, 1, "test");
  // 균등 사전분포(0.8)가 깔려 있어 증거 1.0 으로는 약 0.7 — 한 방에 100% 가 되면 안 된다
  assert.ok(d.st.target.H > 0.6 && d.st.target.H < 0.8, `target.H=${d.st.target.H}`);
  d.tick(0.1);
  assert.ok(d.st.current.H < 0.5, "한 프레임에 다 따라가면 떨림 방지가 없는 것");
  for (let i = 0; i < 100; i++) d.tick(0.1);
  assert.ok(d.st.current.H > 0.6); assert.ok(d.st.settled > 0.45 && d.st.settled < 0.6, `settled=${d.st.settled}`);
  assert.equal(rank(d.st.current).dominant, "H");
  assert.ok(d.st.trajectory.length >= 15);
});

test("확신도 — 균등 0, 순수 1", () => {
  assert.ok(close(entropyConfidence({ R: 1 / 3, H: 1 / 3, C: 1 / 3 }), 0, 1e-9));
  assert.ok(close(entropyConfidence({ R: 1, H: 0, C: 0 }), 1));
});

test("풀 선택 — 보조 장르 비중이 임계값 이상이면 그 변주, 아니면 원문", () => {
  const pool = { ok: true, lines: [
    { genre: "H", seq: "01", secondary: "base", text: "b", file: "H_base_01.m4a" },
    { genre: "H", seq: "01", secondary: "R", text: "r", file: "H_R_01.m4a" },
  ] };
  assert.equal(pickPoolLine(pool, "H", "01", { R: TINT_THRESHOLD + 0.01, H: 0.6, C: 0.09 }).secondary, "R");
  assert.equal(pickPoolLine(pool, "H", "01", { R: 0.2, H: 0.7, C: 0.1 }).secondary, null);
  assert.equal(pickPoolLine(pool, "H", "01", { R: 0.1, H: 0.5, C: 0.4 }).secondary, null, "C 변주가 없으면 원문");
});

test("타임라인 — 판정 전엔 옆사람이 없고, 착석 뒤 거리는 상태값을 따른다", () => {
  assert.equal(evalActors(T.judge - 1, { dominant: null }).npc.visible, false);
  const seated = evalActors(T.npcSeated + 1, { dominant: "H", npcDistance: 1.35 });
  assert.equal(seated.npc.seated, true); assert.ok(close(seated.npc.x, 0.35 + 1.35));
  const truck = evalActors(T.truckSplash, { dominant: null });
  assert.equal(truck.truck.visible, true); assert.ok(truck.splash != null);
});

test("타임라인 — 옆사람은 관객 코앞(0.9m 안)으로 들어오지 않고, 버스 문 앞으로 걸어간다", () => {
  for (let t = T.npcWalkStart; t <= T.npcSeated; t += 0.25) {
    const { npc } = evalActors(t, { dominant: "R", npcDistance: 0.7 });
    const d = Math.hypot(npc.x, npc.z - 0.35);
    assert.ok(d >= 0.9, `t=${t} 관객과 ${d.toFixed(2)}m`);
  }
  const busAt = 100;
  const stop = evalActors(busAt + 7.5, { dominant: "R", npcDistance: 0.7, busAt });
  assert.ok(close(stop.bus.x, -1.2, 0.05) && stop.bus.doorOpen, "정차 위치·문 열림");
  const gone = evalActors(busAt + 13.9, { dominant: "R", npcDistance: 0.7, busAt });
  assert.ok(close(gone.npc.x, 1.2, 0.1) && gone.npc.z < -2.5, `문 앞(1.2,-2.7)으로: ${gone.npc.x.toFixed(2)},${gone.npc.z.toFixed(2)}`);
  const h = evalActors(busAt + 13.9, { dominant: "H", npcDistance: 1.2, busAt });
  assert.ok(h.npc.z > 3, "공포는 벤치 뒤 풀숲으로");
});

test("대사 비트 — 모든 비트가 CSV 줄을 가리키고, 46줄 전부 비트가 있다", () => {
  const ids = new Set(DIALOGUE_V2_LINES.map((l) => `${l.genre}.${l.seq}`));
  for (const k of Object.keys(DIALOGUE_V2_BEATS)) assert.ok(ids.has(k), `없는 줄 ${k}`);
  for (const id of ids) assert.ok(DIALOGUE_V2_BEATS[id], `비트 없음 ${id}`);
});

test("대사 비트 — 답함/안답함 쌍은 한 회차에 하나만 재생되고, 마지막 말은 장르마다 하나이며 버스 뒤", () => {
  for (const g of ["R", "H", "C"]) {
    const lines = DIALOGUE_V2_LINES.filter((l) => l.genre === g);
    for (const answered of [false, true]) {
      const played = lines.filter((l) => playsLine(beatOf(l), answered));
      assert.equal(played.length, playedCount(lines), `${g} answered=${answered} 재생 수`);
      const branches = played.filter((l) => beatOf(l).branch).map((l) => beatOf(l).branch);
      assert.ok(branches.every((b) => b === (answered ? "answered" : "silent")), `${g} 갈래 혼합`);
    }
    // 갈래 줄 바로 앞에는 질문(ask)이 있다
    lines.forEach((l, i) => { const b = beatOf(l); if (b.branch === "answered") assert.equal(beatOf(lines[i - 1]).to, "ask", `${g}.${l.seq} 앞이 질문이 아님`); });
    const last = lines.filter((l) => beatOf(l).atBus);
    assert.equal(last.length, 1, `${g} atBus 수`);
    assert.equal(last[0], lines[lines.length - 1], `${g} atBus 가 마지막 줄이 아님`);
  }
  assert.ok(gazeFor({ to: "self" }) < 0.2 && gazeFor({ to: "ask" }) > 0.9 && close(gazeFor({ to: "ask", gaze: 0.1 }), 0.1));
});

test("비언어 응답 — 가만히 있으면 무응답, 끄덕임·돌림·가로젓기는 응답. 자동 시선(고정값)은 응답이 아니다", () => {
  const still = answerWatchStart(70, -5, 77); for (let i = 0; i < 60; i++) answerWatchUpdate(still, 70 + Math.sin(i) * 1.5, -5 + Math.cos(i), 77);
  assert.equal(answerWatchResult(still).answered, false);
  const nod = answerWatchStart(70, -5, 77); for (const p of [-5, -8, -12, -14, -10, -6, -4]) answerWatchUpdate(nod, 70, p);
  assert.deepEqual(answerWatchResult(nod), { answered: true, how: "nod" });
  const turn = answerWatchStart(0, 0, 77); for (const y of [10, 25, 40, 55, 65, 72]) answerWatchUpdate(turn, y, 0);
  assert.deepEqual(answerWatchResult(turn), { answered: true, how: "turn" });
  const shake = answerWatchStart(70, 0, 77); for (const y of [76, 82, 74, 64, 70, 78]) answerWatchUpdate(shake, y, 0);
  assert.deepEqual(answerWatchResult(shake), { answered: true, how: "shake" });
  const away = answerWatchStart(0, 0, 77); for (const y of [-10, -20, -5, 5]) answerWatchUpdate(away, y, 0); // 인물 반대쪽에서 두리번 — 응답 아님
  assert.equal(answerWatchResult(away).answered, false);
});

console.log(`\n${n} 통과${process.exitCode ? " (실패 있음)" : ""}`);
