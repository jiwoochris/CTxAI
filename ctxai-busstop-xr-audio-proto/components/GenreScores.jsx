"use client";

// PipelineCheck(1단계)와 MoodRecorder(2단계)가 공유하는 결과 표시부.
// 전사문 + 공포/로맨스/코미디/판타지 막대그래프.

const GENRE_LABELS = {
  horror: { label: "공포", color: "#3fb6c9" },
  romance: { label: "로맨스", color: "#e0a458" },
  comedy: { label: "코미디", color: "#f2efe4" },
  fantasy: { label: "판타지", color: "#8a6bd6" },
};

export default function GenreScores({ transcript, scores }) {
  return (
    <>
      {transcript && (
        <div className="info-block" style={{ marginBottom: 10 }}>
          <span className="label">전사</span>
          {transcript}
        </div>
      )}

      {scores && (
        <div>
          {Object.entries(scores).map(([key, value]) => (
            <div key={key} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span>{GENRE_LABELS[key]?.label || key}</span>
                <span>{value.toFixed(2)}</span>
              </div>
              <div style={{ background: "#0f1420", borderRadius: 6, height: 8, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${value * 100}%`,
                    height: "100%",
                    background: GENRE_LABELS[key]?.color || "#5aa9a3",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
