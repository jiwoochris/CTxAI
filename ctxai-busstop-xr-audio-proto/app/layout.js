import "./globals.css";

export const metadata = {
  title: "버스정류장 XR — 오디오 프로토타입",
  description: "기다림 버스정류장 XR 5-Track 오디오 프로토타입 · 방향 지각 테스트",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
