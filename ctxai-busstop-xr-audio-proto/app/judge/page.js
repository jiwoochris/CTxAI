"use client";

// v1 — 이산 선택 버전. 연속 블렌딩으로 바꾼 버전은 /judge-v2.
// 방향 전환 근거: Bus/규격/구현_리스크와_지원_필요사항.md §3.
//
// 판정 대시보드 — 행동·텍스트·음성 세 채널이 실시간으로 어떻게 합쳐져 장르를
// 정하는지 보여주는 개발/발표용 화면. 관객이 보는 /story 에는 이 정보가
// 노출되지 않는다 (판정 메커니즘은 숨기고, 증명은 여기서 따로 한다).
// 설계 근거: Bus/규격/판정_기준.md

import { useRef, useState } from "react";
import Link from "next/link";
import { observe, judgeFromBehavior, fuseChannels } from "@/lib/behaviorSense";
import { highlightKeywords, scoresFromMoodApi } from "@/lib/textKeywords";
import { analyzeProsody } from "@/lib/voiceProsody";

const OBSERVE_MS = 11000;
const GENRE_LABEL = { R: "로맨스", H: "공포", C: "블랙코미디" };

export default function JudgeDashboard() {
  const [state, setState] = useState("idle"); // idle | running | done | error
  const [live, setLive] = useState({ faceFound: false });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  async function recordAndScore(audioTrack) {
    const blob = await new Promise((resolve) => {
      try {
        const rec = new MediaRecorder(new MediaStream([audioTrack]));
        const chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
        rec.start();
        setTimeout(() => rec.stop(), OBSERVE_MS - 1000);
      } catch { resolve(null); }
    });
    if (!blob) return { textScores: null, voiceScores: null, transcript: null, matched: null, moodReason: null, prosodyMetrics: null };

    const [moodResult, prosodyResult] = await Promise.all([
      (async () => {
        try {
          const form = new FormData();
          form.append("audio", blob, "clip.webm");
          const res = await fetch("/api/mood", { method: "POST", body: form });
          const data = await res.json();
          return data?.ok ? data : null;
        } catch { return null; }
      })(),
      analyzeProsody(blob),
    ]);

    const textScores = scoresFromMoodApi(moodResult?.scores);

    return {
      textScores,
      voiceScores: prosodyResult?.scores || null,
      transcript: moodResult?.transcript || null,
      matched: highlightKeywords(moodResult?.transcript),
      moodReason: moodResult?.scoreReason || null,
      prosodyMetrics: prosodyResult?.metrics || null,
    };
  }

  async function run() {
    setState("running");
    setError(null);
    setResult(null);
    try {
      const stream = streamRef.current || await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" }, audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const audioTrack = stream.getAudioTracks()[0];
      const voicePromise = audioTrack
        ? recordAndScore(audioTrack)
        : Promise.resolve({ textScores: null, voiceScores: null, transcript: null, matched: null, prosodyMetrics: null });
      const behaviorPromise = observe(videoRef.current, OBSERVE_MS, setLive);

      const [behaviorObs, voiceOut] = await Promise.all([behaviorPromise, voicePromise]);
      const behaviorResult = judgeFromBehavior(behaviorObs.ok ? behaviorObs.metrics : null);
      const final = fuseChannels({
        behaviorScores: behaviorResult.scores,
        textScores: voiceOut.textScores,
        voiceScores: voiceOut.voiceScores,
      });

      setResult({
        metrics: behaviorObs.metrics,
        behaviorReason: behaviorResult.reason,
        behaviorScores: behaviorResult.scores,
        ...voiceOut,
        final,
      });
      setState("done");
    } catch (e) {
      setError(e?.message || String(e));
      setState("error");
    }
  }

  return (
    <main>
      <h1>판정 대시보드 — v1 (이산 선택)</h1>
      <div className="sub">
        행동(웹캠) · 텍스트(키워드) · 음성(톤) 세 채널이 실시간으로 어떻게 합쳐져 장르를 정하는지 보여주는
        개발/발표용 화면입니다. 관객용 화면(<Link href="/story">/story</Link>)에는 이 정보가 노출되지 않습니다.
        Q1 음성 질문 재생은 생략하고 버튼을 누르면 바로 11초간 관찰·녹음합니다.
        연속 배합 비율을 그대로 보는 버전은 <Link href="/judge-v2">/judge-v2</Link>.
      </div>

      <div className="panel">
        <div className="tag">웹캠</div>
        <video
          ref={videoRef} muted playsInline
          style={{ width: 220, borderRadius: 10, transform: "scaleX(-1)", background: "#111", display: "block" }}
        />
        <div className="info-block" style={{ marginTop: 8 }}>
          {live.faceFound
            ? `얼굴 감지됨 — dx ${live.dx?.toFixed(3)} · dy ${live.dy?.toFixed(3)} · scale ${live.scaleRatio?.toFixed(3)}`
            : "얼굴 없음"}
        </div>
        <div className="cta" style={{ marginTop: 10 }}>
          <button onClick={run} disabled={state === "running"}>
            {state === "running" ? "관찰 중... (11초)" : "판정 실행"}
          </button>
        </div>
        {error && <div className="feedback incorrect">{error}</div>}
      </div>

      {result && (
        <>
          <ChannelPanel title="A. 행동 (가중치 50%)" scores={result.behaviorScores}>
            <div className="info-block">{result.behaviorReason}</div>
            <div className="info-block" style={{ fontFamily: "monospace", fontSize: 12 }}>
              {JSON.stringify(result.metrics)}
            </div>
          </ChannelPanel>

          <ChannelPanel title="B. 텍스트 — Claude Haiku 의미 분석 (가중치 30%)" scores={result.textScores}>
            <div className="info-block">전사: {result.transcript || "(답변 없음 — /api/mood 미실행)"}</div>
            {result.moodReason && <div className="info-block">모델 근거: {result.moodReason}</div>}
            {result.matched && (
              <div className="info-block" style={{ opacity: 0.6 }}>
                (참고용, 판정엔 미사용) 연관 단어 — 공포: {result.matched.H.join(", ") || "-"} · 로맨스: {result.matched.R.join(", ") || "-"} · 코미디: {result.matched.C.join(", ") || "-"}
              </div>
            )}
          </ChannelPanel>

          <ChannelPanel title="C. 음성/톤 (가중치 20%)" scores={result.voiceScores}>
            {result.prosodyMetrics?.source && (
              <div className="info-block">
                {result.prosodyMetrics.source === "model" && "음성 이해 모델(Gemini) 판단"}
                {result.prosodyMetrics.source === "heuristic_fallback" && "⚠ 모델 호출 실패 — RMS 휴리스틱 폴백"}
                {result.prosodyMetrics.source === "no_speech" && "발화 없음 — 신호 제외"}
              </div>
            )}
            {result.prosodyMetrics && (
              <div className="info-block" style={{ fontFamily: "monospace", fontSize: 12 }}>
                {JSON.stringify(result.prosodyMetrics)}
              </div>
            )}
          </ChannelPanel>

          <div className="panel">
            <div className="tag">최종 판정 (v1 — 가장 높은 장르 하나만 표시)</div>
            <h2>{GENRE_LABEL[result.final.dominant]}</h2>
            <div className="info-block">{result.final.reason}</div>
            <ScoreBars scores={result.final.scores} />
          </div>
        </>
      )}

      <div className="footer-note">
        <Link href="/story" style={{ color: "var(--muted)" }}>← 관객용 화면(/story)으로</Link>
        {" · "}
        <Link href="/judge-v2" style={{ color: "var(--muted)" }}>v2(연속 블렌딩) 대시보드</Link>
        {" · "}
        <Link href="/" style={{ color: "var(--muted)" }}>대시보드</Link>
      </div>
    </main>
  );
}

function ScoreBars({ scores }) {
  if (!scores) return <div className="info-block">신호 없음</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      {["R", "H", "C"].map((g) => (
        <div key={g} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 70, fontSize: 12 }}>{GENRE_LABEL[g]}</span>
          <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.round((scores[g] || 0) * 100)}%`, height: "100%", background: "#8fae95" }} />
          </div>
          <span style={{ width: 40, fontSize: 12, textAlign: "right" }}>{Math.round((scores[g] || 0) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function ChannelPanel({ title, scores, children }) {
  return (
    <div className="panel">
      <div className="tag">{title}</div>
      {children}
      <ScoreBars scores={scores} />
    </div>
  );
}
