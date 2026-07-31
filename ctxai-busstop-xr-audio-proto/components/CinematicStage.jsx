"use client";

// 영화 한 장면으로서의 정류장.
//
// 카메라는 관객의 어깨 뒤(over-the-shoulder). 화면 오른쪽 앞에 관객의 뒤통수가
// 실루엣으로 크게 앉아 있고, 그 옆에 인물이 앰버 림라이트를 받고 있다.
// 대사는 채팅 버블이 아니라 영화 자막으로 프레임 하단에 뜬다.
//
// 색보정은 scene_state 에 따라 움직인다:
//   착석~관계형성  차갑고 파란 저녁 (거리감)
//   정보공개~장르사건  앰버가 올라오고 비가 잦아든다 (친밀)
//   버스접근~귀환  채도가 빠지고 헤드라이트가 프레임을 지배한다 (이별)
//
// 전부 CSS/SVG 다. Three.js 없이 "장면"으로 읽히는 데까지가 이 단계의 목표.

import { useEffect, useRef } from "react";
import styles from "./CinematicStage.module.css";
import { stageIndex } from "@/lib/romanceScript";

// 자세 태그 → 실루엣 기울기. 인물이 "다가오는지 물러서는지"가 몸으로 보여야 한다.
function postureClass(posture) {
  if (!posture) return "";
  if (/일어|버스로|어깨에/.test(posture)) return styles.rising;
  if (/기울|돌림|정면으로|가까/.test(posture)) return styles.leanIn;
  if (/반대로|등돌|뺌|굳음|벽/.test(posture)) return styles.leanAway;
  return "";
}

// 장면 단계 → 색보정 (LUT 대신 CSS filter)
function grade(idx) {
  if (idx >= 6) return "saturate(0.8) contrast(1.14) brightness(0.9) hue-rotate(-5deg)";
  if (idx >= 5) return "saturate(1.14) contrast(1.06) brightness(1.04)";
  if (idx >= 4) return "saturate(1.06) contrast(1.04) brightness(0.99)";
  return "saturate(0.86) contrast(1.1) brightness(0.9) hue-rotate(6deg)";
}

const BUILDINGS = [
  { l: 2, w: 7, h: 52 },
  { l: 11, w: 5, h: 74 },
  { l: 18, w: 9, h: 40 },
  { l: 29, w: 6, h: 62 },
  { l: 37, w: 8, h: 34 },
  { l: 47, w: 5, h: 56 },
  { l: 54, w: 10, h: 44 },
];

function mmss(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function CinematicStage({
  stage,
  elapsed,
  charOn,
  charX,
  speaking,
  posture,
  cafeOpen,
  busIn,
  doorOpen,
  white,
  subtitle, // { who: 'char'|'user', text }
  beat,
  interim,
}) {
  const idx = stageIndex(stage?.id || "seated");
  const plateRef = useRef(null);

  useEffect(() => {
    if (plateRef.current) plateRef.current.style.filter = grade(idx);
  }, [idx]);

  // 비는 정보공개 구간부터 잦아든다
  const rainOpacity = idx >= 5 ? 0.05 : idx >= 4 ? 0.12 : 0.3;

  return (
    <div className={styles.frame}>
      <div ref={plateRef} className={styles.plate} style={{ filter: grade(idx) }}>
        <div className={styles.sky} />
        <div className={styles.duskGlow} style={{ opacity: idx >= 6 ? 0.35 : 0.9 }} />

        <div className={styles.skyline}>
          {BUILDINGS.map((b, i) => (
            <i key={i} style={{ left: `${b.l}%`, width: `${b.w}%`, height: `${b.h}%` }} />
          ))}
        </div>

        <div className={styles.shopRow}>
          <div className={`${styles.shop} ${cafeOpen ? styles.cafeOpen : ""}`}>
            <span />
          </div>
          <div className={styles.shop}>
            <span />
          </div>
          <div className={styles.shop}>
            <span />
          </div>
        </div>

        <div className={styles.road} />
        <div className={styles.reflect} />
        <div className={styles.roadSheen} />

        {/* 버스 — 왼쪽 멀리서 프레임 안으로 */}
        <div className={`${styles.bus} ${busIn ? styles.busArriving : ""}`}>
          <div className={styles.busBody} />
          <div className={styles.busWindows} />
          <div className={styles.busLamp} />
          <div className={`${styles.doorLight} ${doorOpen ? styles.doorOpen : ""}`} />
        </div>

        {/* 정류장 구조물 */}
        <div className={styles.shelter}>
          <div className={styles.canopy} />
          <div className={`${styles.post} ${styles.postL}`} />
          <div className={`${styles.post} ${styles.postR}`} />
          <div className={styles.glass} />
          <div className={styles.routePanel} />
          <div className={styles.canopyLight} style={{ opacity: idx >= 6 ? 0.45 : 1 }} />
          <div className={styles.bench} />
        </div>

        {/* 옆자리 인물 */}
        <div
          className={`${styles.figure} ${styles.char} ${charOn ? styles.charOn : ""} ${
            speaking ? styles.speaking : ""
          } ${postureClass(posture)}`}
          style={{ left: `${charX}%` }}
        >
          <div className={styles.figHead} />
          <div className={styles.figBody} />
        </div>

        {/* 관객 — 프레임 오른쪽 앞에 크게, 일부 잘려나가는 어깨 뒤 실루엣 */}
        <div className={`${styles.figure} ${styles.you}`} style={{ left: "91%" }}>
          <div className={styles.figHead} />
          <div className={styles.figBody} />
        </div>

        <div className={styles.rain} style={{ opacity: rainOpacity }} />
        <div className={styles.halation} />
      </div>

      <div className={styles.grain} />
      <div className={styles.vignette} />
      <div className={styles.bars} />

      <div className={styles.slate}>
        기다림 · 로맨스 · {stage?.label || ""}
      </div>
      <div className={styles.timecode}>{mmss(elapsed)}</div>

      {/* 자막 — 대사는 버블이 아니라 프레임 하단 자막으로 */}
      <div className={styles.subs}>
        {interim ? (
          <div className={`${styles.subLine} ${styles.subInterim}`}>{interim}</div>
        ) : beat ? (
          <div className={`${styles.subLine} ${styles.subBeat}`}>({beat})</div>
        ) : subtitle?.text ? (
          <div
            key={subtitle.key}
            className={`${styles.subLine} ${subtitle.who === "user" ? styles.subUser : ""}`}
          >
            {subtitle.text}
          </div>
        ) : null}
      </div>

      <div className={`${styles.whiteOut} ${white ? styles.whiteOn : ""}`} />
    </div>
  );
}
