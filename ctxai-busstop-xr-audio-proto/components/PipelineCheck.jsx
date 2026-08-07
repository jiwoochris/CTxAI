"use client";

// 1단계 — 마이크 없이 "백엔드 파이프라인 자체가 맞게 도는가"만 확인한다.
// Bus/test_script.md 의 5개 발화를 미리 녹음해 둔 샘플(순수 4장르 + 혼합)을
// 그대로 /api/mood 에 흘려서, 순수 샘플은 해당 장르가 압도적으로 높게,
// 혼합 샘플은 여러 장르가 고르게 섞여 나오는지 눈으로 확인한다.

import { useState } from "react";
import GenreScores from "@/components/GenreScores";

const SAMPLES = [
  { id: "horror", label: "🖤 공포 (순수)", file: "/samples/horror.m4a" },
  { id: "romance", label: "💗 로맨스 (순수)", file: "/samples/romance.m4a" },
  { id: "comedy", label: "💛 코미디 (순수)", file: "/samples/comedy.m4a" },
  { id: "fantasy", label: "💜 판타지 (순수)", file: "/samples/fantasy.m4a" },
  { id: "mixed", label: "🌫 혼합 (경계 테스트)", file: "/samples/mixed.m4a" },
];

export default function PipelineCheck({ onScores }) {
  const [activeId, setActiveId] = useState(null);
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [transcript, setTranscript] = useState("");
  const [scores, setScores] = useState(null);
  const [error, setError] = useState(null);

  async function runSample(sample) {
    setActiveId(sample.id);
    setState("loading");
    setError(null);
    setTranscript("");
    setScores(null);

    try {
      const audioRes = await fetch(sample.file);
      const blob = await audioRes.blob();
      const form = new FormData();
      form.append("audio", blob, sample.file.split("/").pop());

      const res = await fetch("/api/mood", { method: "POST", body: form });
      const data = await res.json();
      if (data.configured === false) {
        setError(data.error);
        setState("error");
        return;
      }
      if (!data.ok) {
        setError(`분석 실패: ${data.reason}${data.detail ? ` — ${data.detail}` : ""}`);
        setState("error");
        return;
      }
      setTranscript(data.transcript);
      setScores(data.scores);
      onScores?.(data.scores);
      setState("done");
    } catch (err) {
      setError("네트워크 오류: " + (err?.message || err));
      setState("error");
    }
  }

  return (
    <div className="panel">
      <div className="tag">1단계 · 백엔드 파이프라인 확인</div>
      <h2>사전 녹음 샘플로 검증</h2>
      <div className="info-block" style={{ color: "var(--muted)", marginBottom: 12 }}>
        마이크 없이, 미리 녹음된 5개 문장(순수 4장르 + 혼합)을 Whisper 전사 → Claude Haiku 채점으로 그대로
        흘립니다. 순수 샘플은 해당 장르 점수가 뚜렷하게 높고, 혼합 샘플은 여러 장르가 고르게 섞여야 정상입니다.
      </div>

      <div className="options">
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            className={activeId === s.id ? "picked" : ""}
            onClick={() => runSample(s)}
            disabled={state === "loading"}
          >
            {s.label}
          </button>
        ))}
      </div>

      {state === "loading" && <div className="info-block" style={{ marginTop: 10 }}>분석 중...</div>}
      {error && <div className="feedback incorrect">{error}</div>}

      <div style={{ marginTop: 10 }}>
        <GenreScores transcript={transcript} scores={scores} />
      </div>
    </div>
  );
}
