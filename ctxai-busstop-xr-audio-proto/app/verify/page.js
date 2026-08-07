"use client";

// 1·2·3단계 확인 전용 페이지 — 메인 페이지(app/page.js)는 트랙 5개짜리
// 데모가 이미 꽉 차 있어서, "백엔드 파이프라인이 맞게 도는가"만 빠르게
// 확인하고 싶을 때 여기서 본다.

import { useState } from "react";
import Link from "next/link";
import PipelineCheck from "@/components/PipelineCheck";
import MoodRecorder from "@/components/MoodRecorder";
import SoundMixer from "@/components/SoundMixer";

export default function VerifyPage() {
  const [scores, setScores] = useState(null);

  return (
    <main>
      <h1>파이프라인 확인</h1>
      <div className="sub">
        목소리 → Whisper 전사 → Claude Haiku 4장르 채점 → 배경음 블렌딩, 이 흐름만 따로 떼어 확인하는
        페이지입니다.
      </div>

      <SoundMixer scores={scores} />
      <PipelineCheck onScores={setScores} />
      <MoodRecorder onScores={setScores} />

      <div className="footer-note">
        <Link href="/" style={{ color: "var(--muted)" }}>
          ← 전체 데모 페이지로
        </Link>
      </div>
    </main>
  );
}
