// 공포 트랙 핵심 사운드 이벤트 스펙
// 출처: 버스정류장XR_오디오프로토타입_스펙_2026-07-31 (4장, 핵심 사운드 요소 스펙)
//
// audioKey  : lib/audio.js 의 재생 함수와 매칭
// groundTruth: 데모 자막에 노출되는 "의도된 방향" 설명
// testOptions: 블라인드 테스트에서 사용자에게 제시하는 방향 보기
// correctAnswers: testOptions 중 정답으로 인정하는 값(복수 가능)

export const horrorEvents = [
  {
    key: "side",
    audioKey: "sideWhisper",
    name: "옆자리 속삭임/대화",
    desc: "모노 원본 + 3D 포인트 배치, 근접(0.3~0.8m) 거리감 강조",
    groundTruth: "왼쪽 근접 (옆자리)",
    testOptions: ["왼쪽", "오른쪽", "정면", "뒤", "모르겠음"],
    correctAnswers: ["왼쪽"],
  },
  {
    key: "glass",
    audioKey: "glassBehind",
    name: "후면 반투명 유리 너머 소리",
    desc: "거리 감쇠 + 고역 감소(로우패스) 처리",
    groundTruth: "뒤쪽, 유리 너머로 먹먹하게",
    testOptions: ["왼쪽", "오른쪽", "정면", "뒤", "모르겠음"],
    correctAnswers: ["뒤"],
  },
  {
    key: "behind",
    audioKey: "headWhisper",
    name: "머리 뒤 속삭임",
    desc: "150~165도 근접 모노 배치",
    groundTruth: "머리 뒤쪽 근접",
    testOptions: ["왼쪽", "오른쪽", "정면", "뒤", "모르겠음"],
    correctAnswers: ["뒤"],
  },
  {
    key: "car",
    audioKey: "carPass",
    name: "차량 좌→우 이동",
    desc: "패닝 자동화 + 도플러 근사",
    groundTruth: "왼쪽 → 오른쪽으로 이동",
    testOptions: ["왼쪽→오른쪽", "오른쪽→왼쪽", "제자리", "모르겠음"],
    correctAnswers: ["왼쪽→오른쪽"],
  },
  {
    key: "bus",
    audioKey: "busApproach",
    name: "버스 접근",
    desc: "저주파→타이어→브레이크→공압도어, 순차 레이어링",
    groundTruth: "정면에서 점점 가까워짐",
    testOptions: ["정면", "뒤", "왼쪽", "오른쪽", "모르겠음"],
    correctAnswers: ["정면"],
  },
];

export const ambienceEvent = {
  key: "amb",
  audioKey: "ambience",
  name: "환경 앰비언스",
  desc: "앰비소닉 성격의 배경음 — 방향 테스트 대상 아님, 배경 지속 재생용",
};
