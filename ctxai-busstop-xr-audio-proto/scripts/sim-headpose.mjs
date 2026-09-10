// 헤드 포즈 센서 시뮬레이션 — 세 종류의 관객을 흉내 내서 상태가 실제로 갈리는지 본다.
import { createDirectionState } from "../lib/directionState.js";
import { createHeadPoseSensor } from "../lib/headPoseSense.js";
import { CUES, T } from "../lib/filmTimeline.js";

function run(profile) {
  const d = createDirectionState();
  const s = createHeadPoseSensor({ push: d.pushEvidence, mark: d.markEvent });
  const dt = 1 / 60; let t = 0; const fired = new Set();
  let yaw = 0, z = 0; let targetYaw = 0, targetZ = 0; let holdUntil = 0; let rate = 4;
  const active = [];
  while (t < 75) {
    for (const c of CUES) if (t >= c.t && !fired.has(c.name)) { fired.add(c.name); if (c.sense) { s.beginEvent(c.name, c.sense.azimuth, c.sense.dur, { kind: c.sense.kind }); active.push({ ...c, at: t }); } }
    // 관객 행동 모델
    const ev = active.find((e) => t - e.at < 0.3 && t - e.at >= 0);
    if (ev) {
      if (profile === "fearful") { targetYaw = ev.sense.azimuth * 0.9; rate = 14; holdUntil = t + 3.5; targetZ = ev.sense.kind === "startle" ? 0.12 : 0.02; }
      if (profile === "curious") { targetYaw = ev.sense.azimuth * 0.95; rate = 6; holdUntil = t + 2.6; targetZ = -0.03; }
      if (profile === "calm") { targetYaw = ev.sense.kind === "track" ? ev.sense.azimuth * 0.8 : ev.sense.azimuth * 0.15; rate = 2.5; holdUntil = t + (ev.sense.kind === "track" ? 12 : 0.8); targetZ = 0; }
    }
    if (t > holdUntil) {
      if (profile === "fearful") { rate = 0.9; targetYaw = 0; }         // 느린 회복, 그리고 다시 확인
      if (profile === "curious") { rate = 8; targetYaw = (Math.floor(t * 0.7) % 2 ? 25 : -20); } // 계속 두리번
      if (profile === "calm") { rate = 2; targetYaw = 0; }
      targetZ = 0;
    }
    if (profile === "fearful" && ev == null && active.length && Math.floor(t) % 6 === 5 && t - holdUntil > 1) { targetYaw = active[active.length - 1].sense.azimuth * 0.7; }
    yaw += (targetYaw - yaw) * Math.min(1, rate * dt);
    z += (targetZ - z) * Math.min(1, 6 * dt);
    s.update(yaw, 0, z, dt);
    d.tick(dt); t += dt;
  }
  const c = d.st.current;
  console.log(profile.padEnd(8), `R ${(c.R*100).toFixed(0)}%  H ${(c.H*100).toFixed(0)}%  C ${(c.C*100).toFixed(0)}%  settled ${(d.st.settled*100).toFixed(0)}%`);
  for (const e of s.report().events) console.log("   ", e.name.padEnd(12), `R${(e.R*100).toFixed(0)} H${(e.H*100).toFixed(0)} C${(e.C*100).toFixed(0)}`, JSON.stringify(e.feats));
}
for (const p of ["fearful", "curious", "calm"]) run(p);
