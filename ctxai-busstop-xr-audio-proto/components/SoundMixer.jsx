"use client";

// 3단계 — GainNode 4개로 배경음을 섞는 데모. 3D/조명 없이 "반응한다"는 인상을
// 가장 싸게 확인할 수 있는 항목이라 1·2단계보다 먼저 붙인다.
//
// 1단계(PipelineCheck)·2단계(MoodRecorder)가 분석을 끝낼 때마다 상위 컴포넌트가
// scores prop을 갱신해주고, 여기서는 그 값을 그대로 믹서에 흘려보내기만 한다.

import { useEffect, useRef, useState } from "react";
import { getAudioContext } from "@/lib/audio";
import { createMoodMixer } from "@/lib/moodMix";

const GENRE_LABELS = { horror: "공포", romance: "로맨스", comedy: "코미디", fantasy: "판타지" };

export default function SoundMixer({ scores }) {
  const [active, setActive] = useState(false);
  const [applied, setApplied] = useState(null);
  const mixerRef = useRef(null);

  function toggle() {
    if (active) {
      mixerRef.current?.stop();
      mixerRef.current = null; // 오실레이터는 재시작 불가 — 다음 켜기에서 새로 만든다
      setActive(false);
      setApplied(null);
      return;
    }
    const ctx = getAudioContext();
    const mixer = createMoodMixer(ctx);
    mixer.start();
    mixerRef.current = mixer;
    setActive(true);
    if (scores) setApplied(mixer.setScores(scores));
  }

  useEffect(() => {
    if (active && scores) setApplied(mixerRef.current?.setScores(scores));
  }, [scores, active]);

  useEffect(() => {
    return () => mixerRef.current?.stop();
  }, []);

  return (
    <div className="panel">
      <div className="tag">3단계 · 소리 섞기 (3D보다 먼저)</div>
      <h2>점수 → 배경음 블렌딩</h2>
      <div className="info-block" style={{ color: "var(--muted)", marginBottom: 12 }}>
        GainNode 4개를 항상 켜두고, 점수 비율대로 볼륨을 조절합니다. 설계 노트 규칙대로 상위 2개
        장르만 반영하고 나머지는 0으로 줄입니다(전부 섞으면 회색이 되는 문제 회피). 위 1·2단계에서
        분석이 끝나면 그 점수가 여기로 그대로 흘러들어옵니다.
      </div>

      <div className="cta">
        <button onClick={toggle}>{active ? "🔇 믹서 끄기" : "🔊 믹서 켜기"}</button>
      </div>

      {active && (
        <div className="info-block">
          <span className="label">지금 섞이는 소리</span>
          {applied && Object.values(applied).some((v) => v > 0)
            ? Object.entries(applied)
                .filter(([, v]) => v > 0)
                .map(([g, v]) => `${GENRE_LABELS[g]} ${v.toFixed(2)}`)
                .join(" + ")
            : "아직 분석 결과 없음 — 위에서 1·2단계 중 하나를 실행하면 반영됩니다."}
        </div>
      )}
    </div>
  );
}
