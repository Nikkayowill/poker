#!/usr/bin/env bash
# Build a solid alpha silhouette for a figure rendered on a pure-black plate.
#
# The character's jacket, hood and hair are genuinely black, so a global
# black key (or a plain corner flood-fill) tunnels straight through the
# torso. Instead: threshold very low to catch every lit pixel, close hard
# to bridge the unlit gaps between them, then fill whatever is enclosed.
# Biased generous on purpose — a few retained near-black background pixels
# are invisible against a dark room, a hole showing green felt is not.
#
# The bust runs off the BOTTOM of every frame, so the exterior is sealed on
# three sides only. Ringing all four connects the unlit gaps at the jacket's
# hem to the outside world, and they never get filled.
#
# usage: silhouette.sh <src.png> <out-mask.png> [closeRadius] [threshold%]
set -euo pipefail
SRC="$1"; OUT="$2"; R="${3:-16}"; T="${4:-1}"

magick "$SRC" -alpha off -colorspace Gray -threshold "${T}%" \
  -morphology Close Disk:"$R" \
  "$OUT"

magick "$OUT" \
  \( -clone 0 -negate \
     -background white -gravity North -splice 0x1 \
     -background white -gravity West  -splice 1x0 \
     -background white -gravity East  -splice 1x0 \
     -fill black -floodfill +0+0 white \
     -gravity North -chop 0x1 -gravity West -chop 1x0 -gravity East -chop 1x0 \) \
  -compose Lighten -composite \
  "$OUT"
