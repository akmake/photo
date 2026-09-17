#!/bin/bash
# N lanes at once, each on its own 3 photos, cores split between them.
#
# Run on the machine AS IT IS -- engine up, browser open, nothing closed for
# the sake of the measurement. That is the point: the number that matters is
# what a photographer's machine does while it is also doing other things.
#
#   bash opo/lanes.sh <N> [photo-dir]
#
# Prints: LANES, cores each, frames done, wall seconds. Per-frame detail and
# per-lane peak memory land in opo/out/lanes_<N>.jsonl.
set -u
N=$1
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
OUT="$HERE/out"
D="${2:-/c/Users/yosef dahan/Downloads/17072026/11/22}"
PY="$ROOT/engine/.venv/Scripts/python.exe"
CORES=$((24 / N))

# 12 real frames. Each lane gets three of its own, and its own cold cache, so
# no lane can be fed by another's work.
ALL=("321A5089" "321A5095" "321A5097" "321A5115" "321A5117" "321A5127" \
     "321A5173" "321A5208" "321A5235" "321A5254" "321A5264" "321A5115")

mkdir -p "$OUT"
rm -f "$OUT/lanes_$N.jsonl"
start=$(date +%s)
for ((i=0; i<N; i++)); do
  a=${ALL[$((i*3))]}; b=${ALL[$((i*3+1))]}; c=${ALL[$((i*3+2))]}
  rm -rf "$OUT/home_${N}_$i"
  "$PY" "$HERE/lane_probe.py" "$CORES" "$OUT/home_${N}_$i" \
      "$D/$a.JPG" "$D/$b.JPG" "$D/$c.JPG" 2>/dev/null | tail -1 >> "$OUT/lanes_$N.jsonl" &
done
wait
end=$(date +%s)
echo "LANES=$N CORES_EACH=$CORES FRAMES=$((N*3)) WALL_S=$((end - start))"
