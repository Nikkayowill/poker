#!/usr/bin/env bash
# Build the web character roster with named seated poker animation clips.
#
# Source masters remain untouched in assets-src/models. Blender writes an
# authoring-quality intermediate; glTF-Transform then applies the same 256px
# WebP + meshopt web pipeline as compress-3d-assets.sh.

set -euo pipefail

BLENDER_BIN="${BLENDER_BIN:-blender}"
TEXTURE_SIZE="${TEXTURE_SIZE:-256}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if command -v gltf-transform >/dev/null 2>&1; then
  GLTF=(gltf-transform)
else
  GLTF=(npx --yes @gltf-transform/cli@4.2.1)
fi

mkdir -p "$ROOT/public/models"

for source in "$ROOT"/assets-src/models/*.glb; do
  name="$(basename "$source")"
  animated="$WORK/animated.glb"
  resized="$WORK/resized.glb"
  webp="$WORK/webp.glb"
  output="$ROOT/public/models/$name"

  "$BLENDER_BIN" --background --factory-startup \
    --python "$ROOT/scripts/build-poker-character-animations.py" -- \
    "$source" "$animated"
  "${GLTF[@]}" resize "$animated" "$resized" \
    --width "$TEXTURE_SIZE" --height "$TEXTURE_SIZE" >/dev/null
  "${GLTF[@]}" webp "$resized" "$webp" >/dev/null
  "${GLTF[@]}" meshopt "$webp" "$output" >/dev/null

  printf '  %-18s %8s -> %8s\n' "$name" \
    "$(du -h "$source" | cut -f1)" "$(du -h "$output" | cut -f1)"
  rm -f "$animated" "$resized" "$webp"
done

echo "Built poker actions into $(find "$ROOT/public/models" -maxdepth 1 -name '*.glb' | wc -l) characters."
