#!/usr/bin/env bash
# Prepares avatar artwork for the store and the table.
#
#   scripts/prepare-avatars.sh <source-dir>
#
# Source files must be named <catalog-id>.png. The id is the contract between
# artwork and catalog; matching by file order instead would silently reassign
# every player's avatar the day someone adds a file that sorts early.
#
# Each source is a transparent cut-out of a player sitting at a rail, and the
# app needs it two ways, so each one produces two files:
#
#   <id>.webp        the whole figure, for the seat at the table and the store
#                    card. Aspect ratio is preserved -- these are half-body
#                    portraits, and squaring them would cut off the hands on
#                    the rail that are the whole reason they read as sitting
#                    at a table rather than floating in a frame.
#
#   <id>-face.webp   a square crop of the head, for everywhere that shows a
#                    small circle: the navbar, the seat plate, the store grid.
#                    At 40px a full figure is an unreadable smudge.
#
# The head crop is measured from each figure rather than fixed, because the
# artwork is not framed consistently -- one of these is 2:3 where the rest are
# square, and any constant box that suits one misframes the other.
set -euo pipefail

SRC="${1:-}"
OUT="public/avatars"
FIGURE_WIDTH=512
FACE_SIZE=256

# Percentages of figure height. HEAD_FRACTION is the square's side; it wants
# head, neck and a little shoulder, so the circle does not crop to the chin.
# HEAD_LEAD lifts the top edge so hair is not shaved off.
HEAD_FRACTION=42
HEAD_LEAD=1

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

echo "Preparing ${#sources[@]} avatar(s) -> $OUT"
printf '  %-20s %-22s %s\n' "id" "figure" "face"

for src in "${sources[@]}"; do
  id="$(basename "${src%.*}")"

  # Where the drawn figure actually sits inside its canvas.
  #
  # Measured against alpha thresholded at 50%, not raw alpha. These cut-outs
  # carry a faint halo of near-zero alpha across the whole canvas, so a plain
  # trim reports the full frame every time and the head crop is then cut from
  # the wrong place -- one portrait came out framed 160px too high with its
  # face half the size of the rest before this threshold was here.
  #
  # A here-string, not process substitution: `magick ... info:` emits no
  # trailing newline, so `read` reports EOF and set -e kills the run without
  # printing anything at all.
  read -r fig_w fig_h fig_x fig_y \
    <<<"$(magick "$src" -alpha extract -threshold 50% -format '%@' info: | sed 's/[x+]/ /g')"
  img_w=$(magick "$src" -format '%w' info:)

  side=$(( fig_h * HEAD_FRACTION / 100 ))
  top=$(( fig_y - fig_h * HEAD_LEAD / 100 ))
  (( top < 0 )) && top=0
  # Heads are centred in frame, so centre the crop on the canvas rather than on
  # the figure's bounding box -- long hair drags that box off to one side.
  left=$(( (img_w - side) / 2 ))
  (( left < 0 )) && left=0

  magick "$src" -auto-orient \
    -resize "${FIGURE_WIDTH}x" \
    -quality 82 -define webp:method=6 \
    "$OUT/$id.webp"

  magick "$src" -auto-orient \
    -crop "${side}x${side}+${left}+${top}" +repage \
    -resize "${FACE_SIZE}x${FACE_SIZE}" \
    -quality 82 -define webp:method=6 \
    "$OUT/$id-face.webp"

  printf '  %-20s %-22s %s\n' "$id" \
    "$(magick "$OUT/$id.webp" -format '%wx%h' info:) $(du -h "$OUT/$id.webp" | cut -f1)" \
    "$(du -h "$OUT/$id-face.webp" | cut -f1)"
done

echo
echo "Done. Catalog references /avatars/<id>.webp and /avatars/<id>-face.webp"
