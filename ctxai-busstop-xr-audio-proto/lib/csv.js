// 방향 테스트 결과를 CSV로 내보내는 유틸 (스펙 문서 8장 테스트 프로토콜용 기록)

export function resultsToCsv(rows) {
  const header = ["시각", "이벤트", "의도된 방향(정답)", "테스터 응답", "정답 여부"];
  const lines = [header.join(",")];
  rows.forEach((r) => {
    const line = [
      r.timestamp,
      r.eventName,
      r.groundTruth,
      r.answer,
      r.correct ? "정답" : "오답",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
    lines.push(line);
  });
  return lines.join("\n");
}

export function downloadCsv(filename, csvContent) {
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
