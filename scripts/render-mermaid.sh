#!/usr/bin/env bash
# render-mermaid.sh — one-shot headless Mermaid → PNG renderer (root-container safe).
# Usage: render-mermaid.sh <chart.mmd> [out.png] [scale]
#   out.png defaults to <chart>.png; scale defaults to 2 (doubles resolution).
set -euo pipefail

SRC="${1:?usage: render-mermaid.sh <chart.mmd> [out.png] [scale]}"
OUT="${2:-${SRC%.mmd}.png}"
SCALE="${3:-2}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$DIR/puppeteer.json"

npx -y @mermaid-js/mermaid-cli -i "$SRC" -o "$OUT" -b white -p "$CFG" -s "$SCALE"
echo "rendered $OUT"