// 연출 상태(direction state) — 반응형 실시간 VR 영화(/film)의 단일 진실.
//
// 이 프로젝트의 기술 주장은 "관객의 암묵적 반응이 장면 전체의 연출 파라미터를
// 연속적으로 움직인다"는 것이다. 그러려면 판정이 1분에 한 번 나고 끝나는 게 아니라,
// 체험 내내 증거가 쌓이고 그 결과가 매 프레임 렌더링에 반영돼야 한다. 이 모듈은
// 그 "쌓이고 흐르는" 부분만 맡는다 — 어떤 값을 어떻게 그리는지는 lib/directionMap.js.
//
// 구조
//   evidence  : 채널(헤드 포즈·웹캠·음성)이 pushEvidence({R,H,C}, weight)로 넣는 증거.
//               시간 감쇠가 있는 가중 누적이라 최근 반응이 더 무겁다.
//   target    : 누적 증거를 정규화한 목표 벡터.
//   current   : 매 프레임 target을 향해 완만하게 따라가는 현재 벡터 (떨림 방지,
//               구현_리스크와_지원_필요사항.md §4-3).
//   settled   : 0~1. 증거가 얼마나 쌓였는가. 0이면 "아직 어느 장르도 아닌 정류장"
//               (중립 프리셋), 1이면 배합 프리셋이 온전히 적용된다.
//   confidence: 섀넌 엔트로피 기반 뚜렷함 (lib/behaviorSense.js의 confidenceOf와 동일 정의).
//   trajectory: 시간별 상태 기록 — 체험이 끝난 뒤 "내 정류장은 이렇게 흘렀다" 카드의 재료.
//
// React 상태가 아니라 순수 객체다. R3F useFrame 안에서 tick()을 부르고 ref로 읽는다.

const GENRES = ["R", "H", "C"];

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normalize(v) {
  const sum = GENRES.reduce((a, g) => a + Math.max(0, v[g] || 0), 0);
  if (sum <= 0) return { R: 1 / 3, H: 1 / 3, C: 1 / 3 };
  return { R: Math.max(0, v.R || 0) / sum, H: Math.max(0, v.H || 0) / sum, C: Math.max(0, v.C || 0) / sum };
}

export function entropyConfidence(scores) {
  const vals = GENRES.map((g) => scores[g]).filter((p) => p > 0);
  if (!vals.length) return 0;
  const entropy = -vals.reduce((a, p) => a + p * Math.log(p), 0);
  return clamp01(1 - entropy / Math.log(3));
}

export function rank(scores) {
  const sorted = GENRES.map((g) => [g, scores[g] || 0]).sort((a, b) => b[1] - a[1]);
  return { dominant: sorted[0][0], secondary: sorted[1][0], secondaryWeight: sorted[1][1], dominantWeight: sorted[0][1] };
}

/**
 * @param {object} opts
 * @param {number} opts.followRate   current이 target을 따라가는 속도(1/초). 0.6이면 약 1.7초 시정수.
 * @param {number} opts.decayHalfLifeSec 증거의 반감기(초). 오래된 반응의 무게를 줄인다.
 * @param {number} opts.settleMass   settled가 1이 되는 누적 증거 무게.
 * @param {number} opts.sampleEveryMs trajectory 기록 간격.
 */
export function createDirectionState(opts = {}) {
  const followRate = opts.followRate ?? 0.6;
  const decayHalfLifeSec = opts.decayHalfLifeSec ?? 150; // 도입부 사건 채점이 5분 장면 끝까지 남도록
  const settleMass = opts.settleMass ?? 2.5;
  const sampleEveryMs = opts.sampleEveryMs ?? 500;

  const acc = { R: 0, H: 0, C: 0 };
  let accMass = 0;
  let totalMass = 0;

  const st = {
    current: { R: 1 / 3, H: 1 / 3, C: 1 / 3 },
    target: { R: 1 / 3, H: 1 / 3, C: 1 / 3 },
    settled: 0,
    confidence: 0,
    elapsed: 0, // 초, 체험 시작 기준
    phase: "idle",
    trajectory: [],
    events: [],
    lastEvidence: null,
  };

  let lastSampleAt = -Infinity;
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) fn(st);
  }

  function pushEvidence(scores, weight = 1, source = "unknown", note = "") {
    if (!scores || !(weight > 0)) return;
    const n = normalize(scores);
    for (const g of GENRES) acc[g] += n[g] * weight;
    accMass += weight;
    totalMass += weight;
    st.target = normalize(acc);
    st.lastEvidence = { t: st.elapsed, source, weight, scores: n, note };
    st.events.push({ t: Math.round(st.elapsed * 10) / 10, kind: "evidence", source, weight, scores: n, note });
  }

  function markEvent(name, detail) {
    st.events.push({ t: Math.round(st.elapsed * 10) / 10, kind: "event", name, detail });
  }

  function setPhase(phase) {
    if (st.phase !== phase) {
      st.phase = phase;
      markEvent("phase", phase);
      emit();
    }
  }

  // 매 프레임 호출. dt는 초.
  function tick(dt) {
    if (!(dt > 0)) return st;
    st.elapsed += dt;

    // 증거 감쇠 — 반감기 기준 지수 감쇠. 최근 반응이 더 무겁게 남는다.
    if (accMass > 0 && decayHalfLifeSec > 0) {
      const k = Math.pow(0.5, dt / decayHalfLifeSec);
      for (const g of GENRES) acc[g] *= k;
      accMass *= k;
    }

    // current → target 완만 추종
    const a = 1 - Math.exp(-followRate * dt);
    for (const g of GENRES) st.current[g] += (st.target[g] - st.current[g]) * a;
    st.current = normalize(st.current);

    // settled — 누적 증거 무게로. 감쇠하지 않는 totalMass를 쓴다(한 번 정해진
    // 정류장이 시간이 지났다고 다시 중립으로 돌아가면 안 되므로).
    const settledTarget = clamp01(totalMass / settleMass);
    st.settled += (settledTarget - st.settled) * (1 - Math.exp(-0.8 * dt));

    st.confidence = entropyConfidence(st.current);

    const nowMs = st.elapsed * 1000;
    if (nowMs - lastSampleAt >= sampleEveryMs) {
      lastSampleAt = nowMs;
      st.trajectory.push({
        t: Math.round(st.elapsed * 10) / 10,
        R: Math.round(st.current.R * 1000) / 1000,
        H: Math.round(st.current.H * 1000) / 1000,
        C: Math.round(st.current.C * 1000) / 1000,
        settled: Math.round(st.settled * 100) / 100,
        confidence: Math.round(st.confidence * 100) / 100,
      });
    }
    return st;
  }

  function snapshot() {
    return {
      current: { ...st.current },
      target: { ...st.target },
      settled: st.settled,
      confidence: st.confidence,
      elapsed: st.elapsed,
      phase: st.phase,
      ...rank(st.current),
    };
  }

  function exportSession(extra = {}) {
    return {
      exportedAt: new Date().toISOString(),
      final: snapshot(),
      trajectory: st.trajectory,
      events: st.events,
      ...extra,
    };
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { st, tick, pushEvidence, markEvent, setPhase, snapshot, exportSession, subscribe, GENRES };
}
