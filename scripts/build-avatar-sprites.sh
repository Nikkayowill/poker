#!/usr/bin/env bash
#
# Build public/avatars3d/*.webp from the supplied character renders.
#
# WHAT THE SOURCES ARE LIKE, because it is never the same twice:
#
#  - front / frontleft45 / frontright arrived already cut out (real alpha).
#  - back(player POV) arrived on a solid BLACK plate. It cannot be keyed:
#    the jacket, hood and hair are genuinely black, so a global key — and
#    even a plain corner flood-fill — tunnels straight through the torso
#    (measured: a 3% flood-fill ate a third of the figure). Those go
#    through avatar-silhouette.sh instead.
#  - backL45 / backR45 arrived with a "transparency" CHECKERBOARD painted
#    into the pixels and no alpha channel at all. That one keys safely from
#    the corners, because it is near-white (246-255) and nothing on the
#    character is.
#
# Always measure a new render (`magick identify -format '%A'` plus a corner
# sample) rather than trusting how a viewer displays it: a real transparent
# PNG and a painted checkerboard look identical on screen.
#
# WHAT THIS PRODUCES: six sprites at one common bust box, normalised on
# HEAD HEIGHT rather than on the frame. Head height is the invariant that
# survives a pose change — the newer rear renders are turned closer to
# profile, so their shoulders are ~40% narrower relative to the head, which
# is correct for that pose and must not be "corrected" by scaling to the
# silhouette. Normalising the head keeps the character the same size at
# every seat while letting each pose keep its own width.
#
# The crop's bottom row also removes the baked table edge from frontright
# (y>=955) and the chair backs from the older rear views (y>=880).
set -euo pipefail
SRC="${SRC:-/home/nikkayowilliams/Pictures/New2.5D_Avatars}"
W="$(cd "$(dirname "$0")" && pwd)"
MASKS="${MASKS:-$W/.avatar-masks}"
OUT="${1:?usage: build-avatar-sprites.sh <output-dir>}"
mkdir -p "$MASKS" "$OUT"

CROP_W=1200
CROP_H=800
OUT_W=900
OUT_H=600
# Crown-to-neck height every render is normalised to, in source pixels.
TARGET_HEAD_H=375

# ---------------------------------------------------------------------
# The bottom falloff that seats each figure in its chair.
#
# A bust cropped at mid-chest ends on a straight horizontal cut, and a
# straight cut reads as a sticker no matter how dark the room is. This
# dissolves the lower body instead — but NOT as a plain vertical ramp,
# because a uniform ramp fades a sleeve and the middle of a chest at the
# same rate and the eye reads that as a transparency effect rather than as
# occlusion.
#
# Real occlusion by a chair and a table edge is uneven: the torso goes
# first (it is furthest back and lowest), the hoodie follows, and the
# sleeves — which sit forward, high and to the sides — survive longest.
# So the fade's start height is a function of horizontal distance from the
# centre, plus a low-frequency noise field so the boundary is organic
# rather than a clean arc.
#
# FADE_CENTRE / FADE_EDGE are where the falloff begins as a fraction of
# the sprite's height: the torso at the centre column begins dissolving
# well before a sleeve at the outer column does. Everything above
# FADE_CENTRE — face, shoulders, upper torso — is untouched.
FADE_CENTRE=0.76
FADE_EDGE=0.93
FADE_NOISE=0.035

# Seeded, because this script must be reproducible: `+noise Random` draws
# from an unseeded RNG, so without this every rebuild emits different
# assets and "regenerate from the originals" stops being a check anyone
# can run. Same rule the scene's own jitter obeys — deterministic, never
# Math.random().
FADE_SEED=20260807

build_fade_mask() {  # <dest-mask>
  local out="$1"
  # Low-frequency noise field, generated small and blurred so the boundary
  # undulates over tens of pixels rather than shimmering per-pixel.
  magick -size 44x30 xc: -seed "$FADE_SEED" +noise Random -colorspace Gray \
    -blur 0x1.4 -auto-level -resize 220x150! "$MASKS/.noise.png"
  # One smoothstep per pixel: 1 above the (noisy, centre-biased) start
  # height, easing to 0 at the very bottom row. `dd` is squared so the
  # sleeves hold on near the edges instead of the start height sliding
  # evenly across — occlusion is not linear in x. Symbol names are two
  # characters because -fx rejects single-character user symbols.
  magick "$MASKS/.noise.png" \
    -fx "dd=abs(2*i/w-1); ss=$FADE_CENTRE+($FADE_EDGE-$FADE_CENTRE)*dd*dd+$FADE_NOISE*(u-0.5); tt=min(1,max(0,(1-j/h)/max(0.02,1-ss))); tt*tt*(3-2*tt)" \
    -resize "${OUT_W}x${OUT_H}!" -blur 0x2 \
    "$out"
}

# <src> <alpha: auto|silhouette|whitekey> <centreX> <crown> <headH> <dest>
emit() {
  local src="$1" mode="$2" cx="$3" crown="$4" headh="$5" dest="$6"
  local tmp="$MASKS/.tmp-$dest.png"

  case "$mode" in
    auto) cp "$src" "$tmp" ;;
    silhouette)
      local mask="$MASKS/mask-$dest.png"
      [ -f "$mask" ] || "$W/avatar-silhouette.sh" "$src" "$mask" 10 1
      magick "$src" -alpha off \( "$mask" -blur 0x0.8 \) \
        -alpha off -compose CopyOpacity -composite "$tmp" ;;
    whitekey)
      # A GLOBAL white key here, unlike the black plates — safe because
      # nothing on this character is near-white, and necessary because the
      # curly hair encloses small pockets of background a corner
      # flood-fill can never reach.
      #
      # Then erode the alpha by 4px, which is not optional and not about
      # anti-aliasing: the supplied render has a white OUTER GLOW baked
      # around the whole silhouette (visible in the untouched source
      # against its own checkerboard). The glow is a gradient, so no
      # single fuzz removes it — keying leaves a bright rim tracing every
      # curl, unmissable against this room. Measured on renders at 1-6px:
      # 2 still fringes, 5+ starts rounding the curls off.
      magick "$src" -alpha set -fuzz 12% -transparent white \
        -channel A -morphology Erode Octagon:4 -blur 0x0.6 +channel \
        "$tmp" ;;
  esac

  # Normalise on head height, then take the common box from the scaled
  # crown and head centre.
  local pct x y
  pct=$(awk -v t="$TARGET_HEAD_H" -v h="$headh" 'BEGIN{printf "%.4f", 100*t/h}')
  x=$(awk -v c="$cx" -v p="$pct" -v w="$CROP_W" 'BEGIN{printf "%d", c*p/100 - w/2}')
  y=$(awk -v c="$crown" -v p="$pct" 'BEGIN{printf "%d", c*p/100 - 20}')

  magick "$tmp" \
    -resize "${pct}%" \
    -channel A -level 50%,78% +channel \
    -background none -gravity NorthWest -extent "$((x + CROP_W))x$((y + CROP_H))" \
    -crop "${CROP_W}x${CROP_H}+${x}+${y}" +repage \
    -resize "${OUT_W}x" \
    "$MASKS/.cropped-$dest.png"

  # Multiply the falloff into the alpha channel, last, in output pixels.
  magick "$MASKS/.cropped-$dest.png" \
    \( -clone 0 -alpha extract "$FADE_MASK" -compose Multiply -composite \) \
    -alpha off -compose CopyOpacity -composite \
    -define webp:lossless=false -quality 92 \
    "$OUT/$dest.webp"
}

FADE_MASK="$MASKS/.fade.png"
build_fade_mask "$FADE_MASK"

#    source file             alpha mode   headX crown headH  dest
emit "$SRC/front.png"            auto        768   50   375   front
emit "$SRC/frontleft45.png"      auto        765   49   358   frontleft45
emit "$SRC/frontright.png"       silhouette  762   33   375   frontright45
emit "$SRC/backL45.png"          whitekey    677   48   394   backleft45
emit "$SRC/backR45.png"          whitekey    712   36   389   backright45
emit "$SRC/back(player POV).png" silhouette  773   37   382   back
