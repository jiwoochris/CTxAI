#!/usr/bin/env bash
# `cdp.mjs record` 결과(dir/000001.jpg…, times.txt, audio.webm)를 소리 있는 mp4 로 합친다.
#   scripts/assemble-recording.sh <녹화 디렉터리> <out.mp4>
# 프레임 간격이 일정하지 않으므로(헤드리스 8~12fps) times.txt 의 실제 시각으로 concat 목록을 만들어 24fps 로 다시 샘플한다.
set -euo pipefail
DIR="$1"; OUT="$2"
LIST="$DIR/concat.txt"
python3 - "$DIR" > "$LIST" <<'PY'
import sys, os
d = sys.argv[1]
rows = [l.split() for l in open(os.path.join(d, "times.txt")) if l.strip()]
ts = [float(r[1]) for r in rows]
for i, (r, t) in enumerate(zip(rows, ts)):
    nxt = ts[i + 1] if i + 1 < len(ts) else t + 0.1
    print(f"file '{os.path.join(d, int(r[0]).__format__('06d') + '.jpg')}'")
    print(f"duration {max(0.01, nxt - t):.3f}")
print(f"file '{os.path.join(d, int(rows[-1][0]).__format__('06d') + '.jpg')}'")
PY
ffmpeg -v error -y -f concat -safe 0 -i "$LIST" -i "$DIR/audio.webm" \
  -vf "fps=24,scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | sed 's/^/duration(s): /'
ls -la "$OUT"
