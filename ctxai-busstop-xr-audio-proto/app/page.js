// 루트("/")는 이제 할 일 목록으로 바로 이동한다 — 파일 업로드 도구는
// 숨김 처리하고 /upload 로 옮겼다 (필요하면 직접 주소로 들어갈 수 있음).
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/todo");
}
