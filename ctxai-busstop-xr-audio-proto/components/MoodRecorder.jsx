"use client";

// 2단계 — 브라우저 마이크를 잡아 /api/mood(Whisper STT + Claude Haiku 채점)로
// 연결하는 데모. lib/voice.js 의 브라우저 내장 STT 와 달리 서버 파이프라인을
// 실제로 검증하는 용도라 MediaRecorder 로 오디오 파일을 만들어 통째로 올린다.

import { useRef, useState } from "react";
import GenreScores from "@/components/GenreScores";

export default function MoodRecorder({ onScores }) {
  const [state, setState] = useState("idle"); // idle | recording | analyzing | done | error
  const [transcript, setTranscript] = useState("");
  const [scores, setScores] = useState(null);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  async function analyze() {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    const form = new FormData();
    form.append("audio", blob, "clip.webm");

    try {
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

  async function startRecording() {
    setError(null);
    setTranscript("");
    setScores(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("analyzing");
        analyze();
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setState("recording");
    } catch (err) {
      setError("마이크 권한을 확인하세요: " + (err?.message || err));
      setState("error");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  return (
    <div className="panel">
      <div className="tag">2단계 · 목소리 → 장르 점수</div>
      <h2>실제 마이크 파이프라인 테스트</h2>
      <div className="info-block" style={{ color: "var(--muted)", marginBottom: 12 }}>
        녹음 시작 후 문장을 말하고 종료를 누르면, Whisper로 전사한 뒤 Claude Haiku가 공포·로맨스·코미디·판타지
        점수를 매깁니다.
      </div>

      <div className="cta" style={{ display: "flex", gap: 8 }}>
        {state !== "recording" ? (
          <button onClick={startRecording} disabled={state === "analyzing"}>
            🎙 녹음 시작
          </button>
        ) : (
          <button className="secondary" onClick={stopRecording}>
            ⏹ 녹음 종료 및 분석
          </button>
        )}
      </div>

      {state === "analyzing" && <div className="info-block">분석 중...</div>}
      {error && <div className="feedback incorrect">{error}</div>}

      <GenreScores transcript={transcript} scores={scores} />
    </div>
  );
}
