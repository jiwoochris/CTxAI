import "./globals.css";

export const metadata = {
  title: "정류장 — 프로젝트 작업 툴",
  description: "아트·사운드·기획이 파일을 올리고 규격을 확인하는 곳",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
