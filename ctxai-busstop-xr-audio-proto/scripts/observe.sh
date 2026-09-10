#!/usr/bin/env bash
# 헤드리스 크롬으로 /film 을 1배속 완주시키며 5초마다 PNG·HUD 텍스트를 남긴다.
#   scripts/observe.sh <출력 디렉터리> [URL 쿼리, 기본 "auto=1&cam=0"] [프레임 수, 기본 54]
# 전제: dev 서버가 돌고 있다 — 기본 포트 3017 (npm run film -- -p 3017), 다른 포트면 FILM_PORT=3000 처럼 넘긴다.
# 크롬이 9224 에 없으면 띄운다. 탭은 한 번에 하나만 — 둘이면 fps 가 떨어져 영화 시간이 느려진다.
set -euo pipefail
OUT="${1:-shots/run}"; QUERY="${2:-auto=1&cam=0}"; COUNT="${3:-54}"
FILM_PORT="${FILM_PORT:-3017}"
PORT=9224; CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if ! curl -s -o /dev/null "http://localhost:$FILM_PORT/film"; then echo "dev 서버가 $FILM_PORT 에 없습니다 (npm run film -- -p $FILM_PORT)"; exit 1; fi
if ! curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null; then
  mkdir -p /tmp/chrome-film2
  nohup "$CHROME" --headless=new --user-data-dir=/tmp/chrome-film2 --remote-debugging-port=$PORT \
    --window-size=1600,900 --autoplay-policy=no-user-gesture-required --no-first-run --hide-scrollbars about:blank \
    > /tmp/chrome-film2.log 2>&1 &
  for i in $(seq 1 20); do sleep 1; curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null && break; done
fi
cd "$(dirname "$0")/.."
TID=$(node scripts/cdp.mjs open $PORT "http://localhost:$FILM_PORT/film?$QUERY")
echo "tab $TID → $OUT ($COUNT frames)"
node scripts/cdp.mjs loop $PORT "$TID" "$OUT" 5 "$COUNT"
node scripts/cdp.mjs close $PORT "$TID"
echo "done: $OUT"
