#!/usr/bin/env bash
# Prepares avatar artwork for the store.
#
# Source images are high-resolution square-ish portraits; the app shows them
# at ~160px in the store grid and ~40px at a seat, so shipping the originals
# would send megabytes to render a thumbnail. This squares them, resizes to a
# sane master size, and writes optimized WebP.
#
#   scripts/prepare-avatars.sh <source-dir>
#
# Every file in <source-dir> is matched to a catalog id by filename order or
# by already being named <id>.png. Run it again any time artwork changes.
set -euo pipefail

SRC="${1:-}"
OUT="public/avatars"
SIZE=512

if [[ -z "$SRC" || ! -d "$SRC" ]]; then
  echo "usage: scripts/prepare-avatars.sh <source-dir>" >&2
  exit 1
fi

command -v magick >/dev/null || { echo "ImageMagick (magick) is required." >&2; exit 1; }
mkdir -p "$OUT"

shopt -s nullglob nocaseglob
sources=("$SRC"/*.{png,jpg,jpeg,webp})
shopt -u nullglob nocaseglob

if (( ${#sources[@]} == 0 )); then
  echo "No images found in $SRC" >&2
  exit 1
fi

echo "Preparing ${#sources[@]} image(s) -> $OUT (${SIZE}px WebP)"
for src in "${sources[@]}"; do
  id="$(basename "${src%.*}")"
  dest="$OUT/$id.webp"
  # Crop to a centred square first so no portrait is stretched, then resize.
  magick "$src" \
    -auto-orient \
    -gravity north \
    -resize "${SIZE}x${SIZE}^" \
    -extent "${SIZE}x${SIZE}" \
    -quality 82 \
    -define webp:method=6 \
    "$dest"
  printf '  %-28s %s\n' "$id.webp" "$(du -h "$dest" | cut -f1)"
done

echo
echo "Done. Catalog entries reference /avatars/<id>.webp"
