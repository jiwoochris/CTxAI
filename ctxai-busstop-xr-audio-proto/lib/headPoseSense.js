// 헤드 포즈 증거 추출 — 헤드셋(또는 데스크톱의 드래그 카메라)의 yaw/pitch/위치를
// 매 프레임 받아, 연출 상태에 넣을 {R,H,C} 증거를 만든다.
//
// v2.md §5가 정의한 정식 경로("시선 = 헤드셋 헤드 포즈, 눈동자 추적 아님")를
// 체험 내내 도는 연속 센서로 만든 것이다. lib/behaviorSense.js의 judgeFromHeadPose()는
// 11초 관찰 창 하나를 한 번 채점했지만, 여기서는
//   (1) 연출된 사건(스크립트 v2 §1의 다섯 단서)마다 "그 방향을 봤는가·얼마나 오래·
//       얼마나 빨리 돌렸는가·다시 확인했는가·얼마나 빨리 돌아왔는가"를 사건 단위로 재고,
//   (2) 사건과 무관한 상시 지표(재통과 횟수, 뒤로 물러남, 응시 지속)를 창 단위로 재서
// 두 종류 증거를 각각 pushEvidence로 흘려보낸다.
//
// 판정 규칙은 v2.md §2-4를 그대로 따른다:
//   공포     = 방어 반응 AND 지속 경계 AND 느린 회복   (퍼지 AND = 최솟값)
//   블랙코미디 = 탐색 행동 AND 빠른 회복                (최솟값)
//   로맨스   = 나머지 (사람에 대한 선택적 관심이 있으면 가산)
// 임계값은 전부 잠정치다 — 파일럿 실측 전. 숫자는 위쪽 상수에 모아 뒀다.

const LOOK_TOLERANCE_DEG = 28;    // 사건 방위각 ±이만큼이면 "그쪽을 봤다"
const STARTLE_YAW_VEL = 140;      // deg/s — 이보다 빠른 고개 돌림은 "화들짝"
const RETREAT_M = 0.07;           // 기준 대비 뒤로 이만큼 물러나면 "뒤로 뺌" (헤드셋 위치)
const SUSTAIN_SEC = 2.0;          // 2초 이상 응시 = 지속 반응 (v2.md §2-2)
const SLOW_RECOVERY_SEC = 3.0;
const FAST_RECOVERY_SEC = 1.5;
const WINDOW_SEC = 10;            // 상시 지표를 내보내는 창 길이
const BASELINE_SEC = 5;           // 초기 자세 기준선 (v2.md §2-3 "초기 5~8초")

function clamp01(x) { return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }
function angDiff(a, b) { let d = ((a - b) % 360 + 540) % 360 - 180; return Math.abs(d); }

/**
 * @param {object} opts
 * @param {(scores, weight, source, note) => void} opts.push  연출 상태의 pushEvidence
 * @param {(name, detail) => void} [opts.mark]  이벤트 로그
 */
export function createHeadPoseSensor({ push, mark }) {
  let t = 0;
  let baseline = null;                 // { yaw, pitch, z }
  const baseSamples = [];
  let prev = null;                     // { yaw, pitch, t }
  const active = new Map();            // 사건 이름 → 진행 중 관찰
  const done = [];

  // 상시 창 지표
  let win = freshWindow();
  function freshWindow() {
    return { start: t, reversals: 0, wasAway: false, awayEnterAt: null, maxAwaySec: 0, awaySec: 0, retreat: 0, maxVel: 0, lastExitAt: null, recoverySec: null, lookAtNpcSec: 0 };
  }

  let npcAzimuth = null; // 캐릭터 장면에서 옆사람 방향 (설정되면 "사람에 대한 관심" 지표를 잰다)

  /**
   * 연출된 사건 시작. 사건이 끝난 뒤 endSec 초까지 관찰하고 채점한다.
   * @param {string} name
   * @param {number} azimuthDeg  사건 방향 (정면 0, 오른쪽 +)
   * @param {number} durationSec 사건 자체가 지속되는 시간
   * @param {{kind: 'startle'|'track'|'probe', tail?: number}} meta  물보라/고양이 = startle, 우비 인물 = track, 포스터/개구리 = probe.
   *   tail = 사건이 끝난 뒤 회복·재확인을 더 지켜보는 시간(초, 기본 4). 배속 데모에서는 1/speed 로 줄여 넘긴다.
   */
  function beginEvent(name, azimuthDeg, durationSec, meta = {}) {
    active.set(name, {
      name, azimuth: azimuthDeg, kind: meta.kind || "probe",
      start: t, end: t + durationSec, observeUntil: t + durationSec + (meta.tail ?? 4),
      looked: false, lookLatency: null, lookSec: 0, lookedAgainAfterEnd: false,
      maxVel: 0, retreat: 0, recoverySec: null, leftLookAt: null, everLeft: false,
      yawAtStart: prev?.yaw ?? 0,
    });
    mark?.("event:start", { name, azimuthDeg });
  }

  function scoreEvent(ev) {
    const looked = ev.looked ? 1 : 0;
    const latencyFast = ev.lookLatency == null ? 0 : clamp01(1 - ev.lookLatency / 2.5);
    const sustained = clamp01(ev.lookSec / SUSTAIN_SEC);
    const startle = clamp01(ev.maxVel / STARTLE_YAW_VEL);
    const retreat = clamp01(ev.retreat / RETREAT_M);
    const defensive = Math.max(startle * 0.8, retreat);
    const recovery = ev.recoverySec ?? (ev.everLeft ? 0 : 4);
    const slowRecovery = clamp01(recovery / SLOW_RECOVERY_SEC);
    const fastRecovery = clamp01(1 - recovery / FAST_RECOVERY_SEC);
    const recheck = ev.lookedAgainAfterEnd ? 1 : 0;

    let H = 0, C = 0, R = 0;
    if (!ev.looked) {
      // 사건 방향을 아예 보지 않았다 — 고개 속도는 이 사건에 대한 반응이 아니므로 쓰지 않는다.
      // 뒤로 물러남(헤드셋 위치)만 방어 신호로 남기고, 나머지는 "낮은 반응" = 로맨스 쪽.
      H = retreat; C = 0; R = 0.6;
    } else if (ev.kind === "startle") {
      // 물보라·고양이: 방어 반응 AND 느린 회복 → 공포. 봤지만 빨리 안정 → 코미디 쪽.
      H = Math.min(defensive, Math.max(sustained, recheck, slowRecovery));
      C = Math.min(looked, fastRecovery, 1 - defensive * 0.6);
      R = looked ? 0.25 : 0.5;
    } else if (ev.kind === "track") {
      // 우비 인물: 오래 따라봄 = 사람에 대한 관심 → 로맨스. 다시 찾음 → 탐색(코미디).
      R = Math.max(sustained, looked * 0.4);
      C = Math.min(recheck, fastRecovery);
      H = Math.min(sustained, slowRecovery) * 0.5;
    } else {
      // 포스터·개구리: 적극 탐색(빨리 보고 오래 읽고 다시 확인) → 코미디. 놀라 돌아보고 못 돌아옴 → 공포.
      C = Math.max(Math.min(sustained, fastRecovery), recheck * 0.8, latencyFast * looked * 0.5);
      H = Math.min(defensive, slowRecovery);
      R = looked ? 0.2 : 0.45;
    }
    const sum = R + H + C || 1;
    return { R: R / sum, H: H / sum, C: C / sum, feats: { looked, lookLatency: ev.lookLatency, lookSec: ev.lookSec, maxVel: ev.maxVel, retreat: ev.retreat, recoverySec: ev.recoverySec, recheck } };
  }

  function setNpcAzimuth(deg) { npcAzimuth = deg; }

  /**
   * 매 프레임. yaw/pitch는 도(deg), 카메라 기준 정면 0, 오른쪽 +. z는 미터(뒤로 +).
   */
  function update(yawDeg, pitchDeg, posZ, dt) {
    t += dt;
    if (baseSamples.length < 60 && t < BASELINE_SEC) {
      baseSamples.push({ yaw: yawDeg, pitch: pitchDeg, z: posZ });
      if (!baseline) baseline = { yaw: yawDeg, pitch: pitchDeg, z: posZ };
      else {
        baseline.yaw += (yawDeg - baseline.yaw) * 0.1;
        baseline.pitch += (pitchDeg - baseline.pitch) * 0.1;
        baseline.z += (posZ - baseline.z) * 0.1;
      }
    }
    if (!baseline) baseline = { yaw: yawDeg, pitch: pitchDeg, z: posZ };

    const vel = prev ? Math.abs(angDiff(yawDeg, prev.yaw)) / Math.max(dt, 1e-3) : 0;
    const retreat = Math.max(0, posZ - baseline.z);
    const away = angDiff(yawDeg, baseline.yaw) > LOOK_TOLERANCE_DEG;

    // ---- 사건별 관찰 ----
    for (const ev of active.values()) {
      const lookingAt = angDiff(yawDeg, ev.azimuth) <= LOOK_TOLERANCE_DEG;
      ev.maxVel = Math.max(ev.maxVel, vel);
      ev.retreat = Math.max(ev.retreat, retreat);
      if (t <= ev.end + 1.5) {
        if (lookingAt) {
          if (!ev.looked) { ev.looked = true; ev.lookLatency = t - ev.start; }
          ev.lookSec += dt;
          ev.leftLookAt = null;
        } else if (ev.looked && ev.leftLookAt == null) {
          ev.leftLookAt = t; ev.everLeft = true;
        }
      } else if (lookingAt && ev.looked) {
        ev.lookedAgainAfterEnd = true;
      }
      // 회복: 사건 방향에서 눈을 뗀 뒤 기준선 근처(±tolerance*0.6)로 돌아오기까지
      if (ev.leftLookAt != null && ev.recoverySec == null && angDiff(yawDeg, baseline.yaw) < LOOK_TOLERANCE_DEG * 0.6) {
        ev.recoverySec = t - ev.leftLookAt;
      }
      if (t >= ev.observeUntil) {
        const s = scoreEvent(ev);
        active.delete(ev.name);
        done.push({ name: ev.name, ...s });
        // 보지 않은 사건은 "반응 없음"이라는 약한 증거다(0.25). 봤을 때의 채점(1.0/0.8)보다 훨씬
        // 가볍게 둬야, 사건 두어 개에 분명히 반응한 관객이 나머지 사건을 안 봤다는 이유로
        // 로맨스로 뒤집히지 않는다 (실측: 안 본 사건 6개 = 순수 로맨스 4.8 무게로 강제 배합 4를 눌렀다).
        const w = !ev.looked ? 0.25 : ev.kind === "startle" ? 1.0 : 0.8;
        push({ R: s.R, H: s.H, C: s.C }, w, "headpose:event", ev.name);
        mark?.("event:scored", { name: ev.name, scores: { R: s.R, H: s.H, C: s.C }, feats: s.feats });
      }
    }

    // ---- 상시 창 지표 ----
    win.maxVel = Math.max(win.maxVel, vel);
    win.retreat = Math.max(win.retreat, retreat);
    if (away) {
      win.awaySec += dt; win.maxAwaySec = Math.max(win.maxAwaySec, win.awaySec);
      if (!win.wasAway) { win.reversals += 1; win.lastExitAt = null; }
      win.wasAway = true;
    } else {
      if (win.wasAway) win.lastExitAt = t;
      win.wasAway = false; win.awaySec = 0;
      if (win.lastExitAt != null && angDiff(yawDeg, baseline.yaw) < LOOK_TOLERANCE_DEG * 0.4) {
        win.recoverySec = t - win.lastExitAt; win.lastExitAt = null;
      }
    }
    if (npcAzimuth != null && angDiff(yawDeg, npcAzimuth) <= LOOK_TOLERANCE_DEG) win.lookAtNpcSec += dt;

    if (t - win.start >= WINDOW_SEC) {
      const defensive = Math.max(clamp01(win.maxVel / STARTLE_YAW_VEL) * 0.7, clamp01(win.retreat / RETREAT_M));
      const sustained = clamp01(win.maxAwaySec / SUSTAIN_SEC);
      const rec = win.recoverySec ?? (win.reversals > 0 ? SLOW_RECOVERY_SEC : 0);
      const slowRecovery = clamp01(rec / SLOW_RECOVERY_SEC);
      const fastRecovery = clamp01(1 - rec / FAST_RECOVERY_SEC);
      const explore = clamp01(win.reversals / 3);
      let H = Math.min(defensive, sustained, slowRecovery);
      let C = Math.min(explore, fastRecovery);
      let R = clamp01(1 - Math.max(H, C));
      const attention = npcAzimuth != null ? clamp01(win.lookAtNpcSec / (WINDOW_SEC * 0.5)) : 0;
      if (npcAzimuth != null) {
        // 옆사람을 차분히 오래 봄 = 사람에 대한 관심 (로맨스 가산), 보지 않고 자꾸 딴 곳을 살핌 = 경계
        R = Math.max(R, attention * (1 - defensive));
        if (attention < 0.15 && explore > 0.3) H = Math.max(H, 0.35 * slowRecovery + 0.15);
      }
      // 새 정보가 없는 창(고개도 안 돌리고, 물러나지도 않고, 옆사람도 특별히 보지 않음)은
      // 아무것도 밀어 넣지 않는다 — "반응 없음 = 로맨스"는 도입부 사건 채점이 이미 담당한다.
      // 여기서까지 로맨스를 넣으면 5분 장면 내내 상태가 로맨스로 흘러가 도입부 반응이 지워진다.
      const quiet = win.reversals === 0 && defensive < 0.1 && attention < 0.15;
      if (!quiet) {
        const sum = R + H + C || 1;
        const scores = { R: R / sum, H: H / sum, C: C / sum };
        // 상시 지표는 사건 채점보다 가볍게(0.35) — 사건이 근거가 더 두껍다.
        push(scores, 0.35, "headpose:window", `rev=${win.reversals} away=${win.maxAwaySec.toFixed(1)}s${attention > 0.15 ? ` npc=${attention.toFixed(2)}` : ""}`);
      }
      win = freshWindow();
    }

    prev = { yaw: yawDeg, pitch: pitchDeg, t };
  }

  function report() { return { baseline, events: done, activeCount: active.size }; }

  return { update, beginEvent, setNpcAzimuth, report };
}
