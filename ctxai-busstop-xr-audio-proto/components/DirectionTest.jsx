"use client";

import { useState } from "react";
import { getAudioContext, players } from "@/lib/audio";
import { horrorEvents } from "@/lib/events";

// 블라인드 방향 테스트 — 스펙 문서 8장 "테스트 프로토콜" 구현.
// 캡션/자막으로 정답을 미리 보여주지 않고, 재생 → 테스터 응답 → 정답 공개 순서로 진행한다.
export default function DirectionTest({ onLogResult }) {
  const [playedKeys, setPlayedKeys] = useState({});
  const [answers, setAnswers] = useState({});

  function handlePlay(ev) {
    const ctx = getAudioContext();
    players[ev.audioKey](ctx);
    setPlayedKeys((p) => ({ ...p, [ev.key]: true }));
  }

  function handleAnswer(ev, option) {
    if (!playedKeys[ev.key]) return; // 먼저 재생해야 응답 가능
    const correct = ev.correctAnswers.includes(option);
    const entry = {
      timestamp: new Date().toLocaleString("ko-KR"),
      eventKey: ev.key,
      eventName: ev.name,
      groundTruth: ev.groundTruth,
      answer: option,
      correct,
    };
    setAnswers((a) => ({ ...a, [ev.key]: entry }));
    onLogResult?.(entry);
  }

  return (
    <div className="panel">
      <div className="tag">방향 테스트 (블라인드)</div>
      <h2>공포 트랙 — 방향 지각 테스트</h2>
      <div className="info-block" style={{ marginBottom: 12, color: "var(--muted)" }}>
        헤드폰을 착용하고 각 이벤트를 재생한 뒤, 소리가 어디서 났다고 느껴지는지 골라주세요.
        정답은 응답 후 공개됩니다.
      </div>

      {horrorEvents.map((ev) => {
        const played = playedKeys[ev.key];
        const result = answers[ev.key];
        return (
          <div key={ev.key} className="event" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div className="name">{ev.name}</div>
                <div className="desc">{ev.desc}</div>
              </div>
              <button className="secondary" onClick={() => handlePlay(ev)}>
                ▶ {played ? "다시 재생" : "재생"}
              </button>
            </div>

            {played && (
              <div className="options">
                {ev.testOptions.map((opt) => (
                  <button
                    key={opt}
                    className={result?.answer === opt ? "picked" : ""}
                    onClick={() => handleAnswer(ev, opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {result && (
              <div className={`feedback ${result.correct ? "correct" : "incorrect"}`}>
                {result.correct ? "✔ 정답" : "✘ 오답"} — 의도된 방향: {ev.groundTruth}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
