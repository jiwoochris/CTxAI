// app/demo/page.js 는 "use client" 라 메타데이터를 직접 내보낼 수 없어서,
// 이 폴더의 탭 제목만 예전 프로토타입 이름으로 되돌리는 서버 레이아웃입니다.

export const metadata = {
  title: "버스정류장 XR — 오디오 프로토타입",
  description: "기다림 버스정류장 XR 5-Track 오디오 프로토타입 · 방향 지각 테스트",
};

export default function DemoLayout({ children }) {
  return children;
}
