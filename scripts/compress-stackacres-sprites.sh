#!/usr/bin/env bash
# Requantises every StackAcres PNG in place with pngquant.
#
# The art is generated at bake resolution (a broadleaf is 976x624, which is
# its 122x78 painter box at ART_SCALE), so the DIMENSIONS have to stay exactly
# as they are -- `bakeSpriteTexture` draws each file 1:1 into its own canvas
# and a smaller file would just be upscaled back. What can go is the colour
# depth: these are flat-ish vector-style renders with a few hundred real
# tones, shipped as 24-bit truecolour. A 256-entry palette holds them at an
# RGB error around 2-5/255 with the alpha channel essentially untouched, and
# that is worth roughly two thirds of the bytes.
#
# Quality floor is 65: pngquant writes nothing and exits 99 if it cannot hit
# it, and the script leaves that file alone rather than shipping something
# visibly banded.
#
# Only tracked files are touched, so an in-progress sprite sitting untracked
# in the tree is left for whoever is working on it.
set -euo pipefail

cd "$(dirname "$0")/.."

PNGQUANT="$(pnpm dlx pngquant-bin --version >/dev/null 2>&1 && find "$HOME/.cache/pnpm/dlx" -name pngquant -type f -path '*/.bin/*' 2>/dev/null | head -1)"
if [[ -z "${PNGQUANT}" || ! -x "${PNGQUANT}" ]]; then
  echo "pngquant not found (expected via 'pnpm dlx pngquant-bin')" >&2
  exit 1
fi

before=0
after=0
skipped=0

while IFS= read -r f; do
  size_before=$(stat -c%s "$f")
  if "${PNGQUANT}" --quality=65-92 --speed 1 --strip --force --output "$f.tmp" "$f" 2>/dev/null; then
    size_after=$(stat -c%s "$f.tmp")
    # pngquant occasionally makes a already-small file bigger; keep the winner.
    if (( size_after < size_before )); then
      mv "$f.tmp" "$f"
    else
      rm -f "$f.tmp"
      size_after=$size_before
    fi
  else
    rm -f "$f.tmp"
    size_after=$size_before
    skipped=$((skipped + 1))
  fi
  before=$((before + size_before))
  after=$((after + size_after))
done < <(git ls-files 'public/stackacres/**/*.png')

printf 'compressed %s -> %s (%d%%), %d left alone\n' \
  "$(numfmt --to=iec "$before")" "$(numfmt --to=iec "$after")" \
  $((after * 100 / before)) "$skipped"
