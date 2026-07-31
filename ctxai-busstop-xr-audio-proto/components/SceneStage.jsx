"use client";

import { useEffect, useRef } from "react";
import styles from "./SceneStage.module.css";
import { getAudioContext, sideWhisper, glassBehind, headWhisper, carPass, busApproach, ambience } from "@/lib/audio";

// 공포 트랙 "장면 체험" — 발표/설명용 데모 모드.
// 방향을 자막으로 알려주기 때문에 블라인드 테스트에는 사용하지 않는다 (블라인드 테스트는 DirectionTest 컴포넌트 참고).
export default function SceneStage({ active, onClose }) {
  const carRef = useRef(null);
  const busGlowRef = useRef(null);
  const flashRef = useRef(null);
  const doorLRef = useRef(null);
  const doorRRef = useRef(null);
  const whiteOutRef = useRef(null);
  const glassPanelRef = useRef(null);
  const ledRef = useRef(null);
  const captionRef = useRef(null);
  const timersRef = useRef([]);

  useEffect(() => {
    if (!active) return;

    const ctx = getAudioContext();
    const timers = timersRef.current;

    // reset visuals
    if (carRef.current) carRef.current.style.opacity = 0;
    if (busGlowRef.current) busGlowRef.current.style.opacity = 0;
    if (flashRef.current) flashRef.current.style.opacity = 0;
    if (doorLRef.current) doorLRef.current.style.height = "0%";
    if (doorRRef.current) doorRRef.current.style.height = "0%";
    if (whiteOutRef.current) whiteOutRef.current.style.opacity = 0;
    if (glassPanelRef.current) glassPanelRef.current.classList.remove(styles.hit);
    if (ledRef.current) ledRef.current.classList.remove(styles.glitch);
    setCaption("");

    function setCaption(text) {
      const el = captionRef.current;
      if (!el) return;
      el.classList.remove(styles.show);
      window.setTimeout(() => {
        el.textContent = text;
        el.classList.add(styles.show);
      }, 120);
    }

    function at(sec, fn) {
      timers.push(window.setTimeout(fn, sec * 1000));
    }

    at(0.2, () => {
      setCaption("관객이 착석하고, 안개 낀 정류장에 홀로 남습니다.");
      ambience(ctx);
    });
    at(3.5, () => {
      setCaption("전광판이 같은 문구를 반복해서 보여줍니다.");
      ledRef.current?.classList.add(styles.glitch);
    });
    at(4.8, () => ledRef.current?.classList.remove(styles.glitch));
    at(6.5, () => {
      setCaption("바로 옆에서 속삭임이 들립니다 — 왼쪽 근접.");
      sideWhisper(ctx);
    });
    at(10.5, () => {
      setCaption("후면 유리 너머에서 둔탁한 소리가 전해집니다.");
      glassBehind(ctx);
      glassPanelRef.current?.classList.add(styles.hit);
    });
    at(13.5, () => {
      setCaption("머리 뒤에서 낮은 속삭임이 스칩니다.");
      headWhisper(ctx);
    });
    at(17, () => {
      setCaption("차 한 대가 왼쪽에서 오른쪽으로 지나갑니다.");
      carPass(ctx);
      const car = carRef.current;
      if (car) {
        car.style.opacity = 1;
        car.animate([{ left: "-6%" }, { left: "96%" }], { duration: 3200, easing: "linear" });
        window.setTimeout(() => {
          if (car) car.style.opacity = 0;
        }, 3200);
      }
    });
    at(21.5, () => {
      setCaption("버스가 서서히 다가옵니다.");
      busApproach(ctx);
      const glow = busGlowRef.current;
      if (glow) {
        glow.style.opacity = 1;
        glow.animate(
          [
            { transform: "scale(0.4)", opacity: 0 },
            { transform: "scale(2.4)", opacity: 0.9 },
          ],
          { duration: 2400, fill: "forwards" }
        );
      }
    });
    at(23.9, () => {
      flashRef.current?.animate([{ opacity: 0 }, { opacity: 0.35 }, { opacity: 0 }], { duration: 550 });
    });
    at(24.4, () => {
      setCaption("버스 문이 열립니다 — 현실로 귀환.");
      doorLRef.current?.animate([{ height: "0%" }, { height: "46%" }], { duration: 700, fill: "forwards" });
      doorRRef.current?.animate([{ height: "0%" }, { height: "46%" }], { duration: 700, fill: "forwards" });
    });
    at(25.6, () => {
      whiteOutRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, fill: "forwards" });
    });
    at(27, () => {
      onClose?.();
    });

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className={`${styles.overlay} ${active ? styles.show : ""}`}>
      <div className={styles.scene}>
        <div className={styles.treeline}></div>
        <div className={styles.streetlight}></div>
        <div className={styles.led} ref={ledRef}>
          <span>다음 버스 5분 후 도착 · 다음 버스 5분 후 도착 · </span>
        </div>
        <div className={styles.glassPanel} ref={glassPanelRef}></div>
        <div className={styles.bench}></div>
        <div className={styles.fog}></div>
        <div className={styles.fog2}></div>
        <div className={styles.car} ref={carRef}></div>
        <div className={styles.busGlow} ref={busGlowRef}></div>
        <div className={styles.flash} ref={flashRef}></div>
        <div className={styles.doorL} ref={doorLRef}></div>
        <div className={styles.doorR} ref={doorRRef}></div>
        <div className={styles.whiteOut} ref={whiteOutRef}></div>
        <div className={styles.caption} ref={captionRef}></div>
        <div className={styles.sceneTop}>
          <div className={styles.label}>공포 · 왼쪽 끝 좌석 · 약 25초 프리뷰 (설명용, 방향 정답 포함)</div>
          <button onClick={onClose}>✕ 닫기</button>
        </div>
      </div>
    </div>
  );
}
