// 연출 엔진 회귀 테스트 — 외부 의존 없이 node 로 바로 돈다: node scripts/test-direction.mjs
// 매핑표·상태 저장소·풀 선택 규칙이 문서(반응형_실시간_영화.md §3·§4)와 어긋나면 여기서 잡힌다.

import assert from "node:assert/strict";
import { createDirectionState, entropyConfidence, rank } from "../lib/directionState.js";
import { ANCHORS, TRIGGERS, deriveParams, deriveBgmGains } from "../lib/directionMap.js";
import { pickPoolLine, TINT_THRESHOLD } from "../lib/dialoguePool.js";
import { evalActors, T } from "../lib/filmTimeline.js";

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
  assert.ok(d.st.target.H > 0.99);
  d.tick(0.1);
  assert.ok(d.st.current.H < 0.5, "한 프레임에 다 따라가면 떨림 방지가 없는 것");
  for (let i = 0; i < 100; i++) d.tick(0.1);
  assert.ok(d.st.current.H > 0.95); assert.ok(d.st.settled > 0.45 && d.st.settled < 0.6, `settled=${d.st.settled}`);
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

console.log(`\n${n} 통과${process.exitCode ? " (실패 있음)" : ""}`);
