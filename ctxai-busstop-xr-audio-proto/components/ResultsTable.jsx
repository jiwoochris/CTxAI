"use client";

import { resultsToCsv, downloadCsv } from "@/lib/csv";

export default function ResultsTable({ results, onReset }) {
  const correctCount = results.filter((r) => r.correct).length;

  function handleDownload() {
    const csv = resultsToCsv(results);
    const filename = `busstop-xr-direction-test-${Date.now()}.csv`;
    downloadCsv(filename, csv);
  }

  return (
    <div className="panel">
      <div className="tag">테스트 결과</div>
      <h2>
        방향 테스트 기록 ({results.length}건 중 {correctCount}건 정답)
      </h2>

      {results.length === 0 ? (
        <div className="info-block" style={{ color: "var(--muted)" }}>
          아직 기록된 응답이 없습니다. 위에서 이벤트를 재생하고 응답하면 여기에 쌓입니다.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>시각</th>
              <th>이벤트</th>
              <th>정답</th>
              <th>응답</th>
              <th>결과</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.timestamp}</td>
                <td>{r.eventName}</td>
                <td>{r.groundTruth}</td>
                <td>{r.answer}</td>
                <td className={r.correct ? "correct" : "incorrect"}>{r.correct ? "정답" : "오답"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="cta" style={{ display: "flex", gap: 8 }}>
        <button onClick={handleDownload} disabled={results.length === 0}>
          결과 CSV 다운로드
        </button>
        <button className="ghost" onClick={onReset} disabled={results.length === 0}>
          기록 초기화
        </button>
      </div>
    </div>
  );
}
