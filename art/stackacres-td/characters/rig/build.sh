#!/usr/bin/env bash
# Rebuild every character: frames (rig.py), Aseprite files and sheets, then checks.
set -euo pipefail
RIG="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$RIG")"
ASEPRITE="${ASEPRITE:-$HOME/.local/bin/aseprite}"

python3 "$RIG/rig.py"
for json in "$RIG"/build/*.json; do
  name="$(basename "$json" .json)"
  "$ASEPRITE" --batch --script-param json="$json" --script-param out="$ROOT/$name/$name" \
    --script "$RIG/build_aseprite.lua"
done
python3 "$RIG/check.py"
