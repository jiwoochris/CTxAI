"use client";

import { useState } from "react";
import SeatSelector from "@/components/SeatSelector";
import TrackInfoPanel from "@/components/TrackInfoPanel";
import SceneStage from "@/components/SceneStage";
import DirectionTest from "@/components/DirectionTest";
import ResultsTable from "@/components/ResultsTable";
import RomanceSlice from "@/components/RomanceSlice";
import AnimaticStage from "@/components/AnimaticStage";
import { tracks } from "@/lib/tracks";
import { getAudioContext, moodPreview } from "@/lib/audio";

const moodFreqs = {
  thriller: [110, 131, 155.6],
  comedy: [261.6, 329.6, 392],
  romance: [220, 277.2, 329.6],
  melo: [196, 246.9, 293.7],
};

export default function Page() {
  const [currentId, setCurrentId] = useState("horror");
  const [sceneActive, setSceneActive] = useState(false);
  const [sliceActive, setSliceActive] = useState(false);
  const [animaticActive, setAnimaticActive] = useState(false);
  const [results, setResults] = useState([]);

  const current = tracks.find((t) => t.id === currentId) ?? tracks[0];

  function handleMoodPreview() {
    const ctx = getAudioContext();
    moodPreview(ctx, moodFreqs[current.id] || [220, 277, 330]);
  }

  function handleLogResult(entry) {
    setResults((r) => [...r, entry]);
  }

  return (
    <main>
      <h1>기다림 버스정류장 XR — 오디오 프로토타입</h1>
      <div className="sub">
        8/17 중간평가용 · 좌석을 클릭해 트랙을 보고, 공포 트랙은 장면 체험 재생과 방향 테스트를 진행할 수 있습니다
      </div>

      <div className="banner">
        🎧 <b>헤드폰 착용 권장.</b> 실제 녹음/제작된 음원이 아직 없어 Web Audio API로 합성한 <b>테스트 음원</b>이며,
        PannerNode(HRTF)로 좌/우/전/후 방향을 근사합니다. <b>공포 트랙</b>이 8/17 시연 대상으로 가장 구체화되어 있어
        &quot;장면 체험 재생&quot;(설명용, 정답 포함)과 &quot;방향 테스트&quot;(블라인드, 정답 숨김) 두 가지를 모두 제공하고,
        나머지 4개 트랙은 무드 프리뷰만 제공합니다.
      </div>

      <div className="banner" style={{ borderColor: "#e8c98a" }}>
        🎬 <b>애니메틱 · 편집+사운드 증명용 (85초, 트랙 무관).</b> 그림은 회색 카드, 목소리는 시스템
        TTS(유나) 그대로 두고, <b>편집 리듬과 공간음향만으로</b> 감정이 생기는지 확인하는 비인터랙티브
        컷입니다. 20개 하드컷, 3번의 블랙 프레임 시간점프.
        <div className="cta" style={{ marginTop: 10 }}>
          <button onClick={() => setAnimaticActive(true)}>🎬 애니메틱 재생 (85초)</button>
        </div>
      </div>

      <SeatSelector tracks={tracks} currentId={currentId} onSelect={setCurrentId} />
      <TrackInfoPanel track={current} />

      {current.hasPrototype ? (
        <>
          <div className="cta">
            <button onClick={() => setSceneActive(true)}>🎬 장면 체험 재생 (약 25초, 설명용)</button>
          </div>
          <DirectionTest onLogResult={handleLogResult} />
          <ResultsTable results={results} onReset={() => setResults([])} />
        </>
      ) : current.hasSlice ? (
        <>
          <div className="banner" style={{ marginBottom: 14 }}>
            🎬 <b>5분 수직 슬라이스.</b> 소개서 §11 의 상태머신 6개 값(scene_state · trust · reveal_level ·
            tension · time_remaining · last_user_intent)이 실제로 돌아갑니다. 관객 발화 → 의도 분류 → 공개
            단계 게이트 → 대사 변주 → 신뢰도 갱신까지 한 바퀴, 그리고 4:20 이후 <b>공개 단계 동결</b>과 버스
            문 엔딩까지 포함합니다. 응답 지연을 2.6s 로 올리거나 오프라인으로 전환하면{" "}
            <b>브리지 대사 폴백</b>이 발동하는 것도 확인할 수 있습니다.
            <br />
            <br />
            HMD·3D·성우 없이 <b>&quot;관객이 실제로 말을 거는가 / 5분이 성립하는가&quot;</b>만 검증하는
            Tier 0 프로토타입입니다. 이 상태머신은 WebXR·네이티브 어느 쪽으로 가도 그대로 이식됩니다.
          </div>
          <div className="cta">
            <button onClick={() => setSliceActive(true)}>🎧 로맨스 5분 슬라이스 체험 (헤드폰 필수)</button>
          </div>
        </>
      ) : (
        <div className="cta">
          <button onClick={handleMoodPreview}>▶ 무드 프리뷰 재생 (사운드 이벤트 스펙 미확정)</button>
        </div>
      )}

      <div className="flow">
        <div className="step">
          <b>① 착석</b>&quot;편한 자리에 앉으세요&quot;만 안내
        </div>
        <div className="step">
          <b>② 위치 인식</b>좌우 위치 3초 평균 → 5구역 분류
        </div>
        <div className="step">
          <b>③ 트랙 잠금</b>체험 중 장르 변경 불가
        </div>
        <div className="step">
          <b>④ 5분 진행</b>장르별 공간·조명·사운드 진행
        </div>
        <div className="step">
          <b>⑤ 현실 귀환</b>버스 도착·문 열림과 함께 종료
        </div>
      </div>

      <div className="footer-note">
        기다림_버스정류장_XR_5트랙_프로젝트_소개서_v3 / 디렉터스컷_기준및지침_v2 / 버스정류장XR_오디오프로토타입_스펙 기반
      </div>

      <SceneStage active={sceneActive} onClose={() => setSceneActive(false)} />
      {sliceActive && <RomanceSlice onClose={() => setSliceActive(false)} />}
      {animaticActive && <AnimaticStage onClose={() => setAnimaticActive(false)} />}
    </main>
  );
}
