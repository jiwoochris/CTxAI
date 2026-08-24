"use client";

// 머리 포즈 로깅 — 행동 판정용 (Bus/규격/판정_기준.md). v2.md §2의 임계값(2초
// 지속반응, 5~8초 자세 기준선 등)은 규칙만 있고 실측이 없어서, 여기서는 임계값을
// 코딩하지 않고 카메라 quaternion에서 기준선 대비 편차·지속시간·회복시간·재통과
// 횟수만 뽑는다. 헤드셋(카메라 quaternion) 경로 전용 — 웹캠 경로의 대응물은
// lib/behaviorSense.js의 observe()/judgeFromBehavior(), 이 컴포넌트가 emit하는
// 값을 받는 헤드셋 판정 함수는 judgeFromHeadPose().
//
// app/whitebox(개발용 파일럿 로깅 패널)와 app/story-vr(실제 관객 판정) 둘 다 쓴다.

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, MathUtils } from "three";

export default function HeadPoseTelemetry({ thresholdDeg, resetSignal, onSample }) {
  const { camera } = useThree();
  const baseline = useRef(null);
  const acc = useRef({ maxMagDeg: 0, aboveSec: 0, maxAboveSec: 0, reversals: 0, wasAbove: false, recoveryMs: null, aboveExitAt: null });
  const lastEmit = useRef(0);

  useEffect(() => {
    const e = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
    baseline.current = { yaw: MathUtils.radToDeg(e.y), pitch: MathUtils.radToDeg(e.x) };
    acc.current = { maxMagDeg: 0, aboveSec: 0, maxAboveSec: 0, reversals: 0, wasAbove: false, recoveryMs: null, aboveExitAt: null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  useFrame((_, delta) => {
    if (!baseline.current) return;
    const e = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
    const yaw = MathUtils.radToDeg(e.y);
    const pitch = MathUtils.radToDeg(e.x);
    const dYaw = yaw - baseline.current.yaw;
    const dPitch = pitch - baseline.current.pitch;
    const mag = Math.sqrt(dYaw * dYaw + dPitch * dPitch);
    const a = acc.current;
    a.maxMagDeg = Math.max(a.maxMagDeg, mag);
    const above = mag > thresholdDeg;
    if (above) {
      a.aboveSec += delta;
      a.maxAboveSec = Math.max(a.maxAboveSec, a.aboveSec);
      if (!a.wasAbove) { a.reversals += 1; a.recoveryMs = null; a.aboveExitAt = null; }
      a.wasAbove = true;
    } else {
      if (a.wasAbove) a.aboveExitAt = Date.now();
      a.wasAbove = false;
      a.aboveSec = 0;
      if (a.aboveExitAt != null && mag < thresholdDeg * 0.3) {
        a.recoveryMs = Date.now() - a.aboveExitAt;
        a.aboveExitAt = null;
      }
    }

    const now = performance.now();
    if (now - lastEmit.current > 120) {
      lastEmit.current = now;
      onSample({
        t: Date.now(), yaw, pitch, dYaw, dPitch, mag, above,
        maxMagDeg: a.maxMagDeg, aboveSec: a.aboveSec, maxAboveSec: a.maxAboveSec,
        reversals: a.reversals, recoveryMs: a.recoveryMs,
      });
    }
  });

  return null;
}
