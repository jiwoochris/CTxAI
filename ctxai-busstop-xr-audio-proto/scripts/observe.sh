#!/usr/bin/env bash
# 헤드리스 크롬으로 /film 을 1배속 완주시키며 5초마다 PNG·HUD 텍스트를 남긴다.
#   scripts/observe.sh <출력 디렉터리> [URL 쿼리, 기본 "auto=1&cam=0"] [프레임 수, 기본 54]
# 전제: dev 서버가 3017 에서 돌고 있다 (npm run film -- -p 3017). 크롬이 9224 에 없으면 띄운다.
set -euo pipefail
OUT="${1:-shots/run}"; QUERY="${2:-auto=1&cam=0}"; COUNT="${3:-54}"
PORT=9224; CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if ! curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null; then
  mkdir -p /tmp/chrome-film2
  nohup "$CHROME" --headless=new --user-data-dir=/tmp/chrome-film2 --remote-debugging-port=$PORT \
    --window-size=1600,900 --autoplay-policy=no-user-gesture-required --no-first-run --hide-scrollbars about:blank \
    > /tmp/chrome-film2.log 2>&1 &
  for i in $(seq 1 20); do sleep 1; curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null && break; done
fi
cd "$(dirname "$0")/.."
TID=$(node scripts/cdp.mjs open $PORT "http://localhost:3017/film?$QUERY")
echo "tab $TID → $OUT ($COUNT frames)"
node scripts/cdp.mjs loop $PORT "$TID" "$OUT" 5 "$COUNT"
node scripts/cdp.mjs close $PORT "$TID"
echo "done: $OUT"
