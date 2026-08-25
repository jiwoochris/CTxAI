// story-vr(웹 VR 프로토타입)만 따로 보여줄 별도 주소 — busstop-team-vr.vercel.app.
// 새 Vercel 프로젝트를 따로 만드는 대신, 같은 배포에 별칭(alias) 하나를 더 붙이고
// 그 주소로 들어왔을 때만 루트("/")를 /story-vr로 보낸다. 그 외 주소(원래 사이트)는
// 지금처럼 /todo로 그대로 간다 — app/page.js는 손대지 않는다.
import { NextResponse } from "next/server";

const VR_HOST = "busstop-team-vr.vercel.app";

export function middleware(req) {
  const host = req.headers.get("host") || "";
  if (host.startsWith(VR_HOST)) {
    return NextResponse.redirect(new URL("/story-vr", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/" };
