#!/usr/bin/env bash
#
# Compress the 3D room's .glb assets for the web.
#
# WHY THIS EXISTS. The character exports are authoring-quality: thirteen
# 1024x1024 PNGs each, which is 19.8 MB on the wire for Michael alone and --
# the number that actually matters -- 5.59 MB of VRAM per texture, so roughly
# 430 MB of texture memory for a six-handed table. A phone does not have that,
# and the failure mode is a lost GL context, not a slow load.
#
# DO NOT USE `gltf-transform optimize` HERE. It was the first thing tried and
# it destroyed the room. That command bundles simplify/weld/join/flatten/
# instance alongside the texture work, and this scene cannot survive any of
# them: the table and rail came back as exploded ribbons, and -- less visibly
# but worse -- join/flatten rewrite the node graph that lib/game3d/chip-props.ts
# addresses BY NAME (the `seat_N` groups) and whose per-node accessor bounds it
# measures chip scale from. The file size looked wonderful. The render was
# unusable. Only texture steps belong in this pipeline; geometry is left alone.
#
# WebP rather than KTX2 is a deliberate trade. KTX2 stays compressed on the
# GPU and would cut VRAM another 4-8x, but it needs a Basis transcoder wired
# into the loader and a second WASM origin in the CSP. WebP needs neither, and
# resizing is what recovers most of the VRAM anyway. Revisit if a real device
# still drops its context.
#
# TEXTURE_SIZE is the one number worth arguing about, and it is judged on a
# screenshot, not on a file listing. At this camera a seated player is about
# 100 px tall on a 390 px phone, so 256 is already 2.5x the pixels anyone can
# resolve. Props get more, because a chip's rim and a card's corner are seen
# far closer than a player's face and are where aliasing actually shows.
#
# Reads from assets-src/ and writes to public/, always. That direction is the
# safety property: running this twice cannot compress an already-compressed
# file and quietly destroy it.
#
#   ./scripts/compress-3d-assets.sh
#   TEXTURE_SIZE=512 ./scripts/compress-3d-assets.sh
#
# Requires network on the first run (npx fetches @gltf-transform/cli).

set -euo pipefail

TEXTURE_SIZE="${TEXTURE_SIZE:-256}"
PROP_TEXTURE_SIZE="${PROP_TEXTURE_SIZE:-512}"
CLI="npx --yes @gltf-transform/cli@4.2.1"

if [ ! -d assets-src/models ]; then
  echo "error: assets-src/models not found. The uncompressed sources live" >&2
  echo "       there and are not what ships. See this script's header." >&2
  exit 1
fi

mkdir -p public/models public/props

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

compress() {
  local in="$1" out="$2" size="$3"
  # Intermediates MUST end in .glb and MUST NOT live under public/. The CLI
  # picks packed vs unpacked purely from the output extension, so a ".tmp"
  # suffix makes it write a .gltf-style unpacked model -- scattering every
  # texture and buffer as a loose sibling file. Done in place, that litters
  # public/ with dozens of stray .png/.webp/.bin next to the real assets.
  local a="$WORK/a.glb" b="$WORK/b.glb"
  # Three discrete texture steps. Nothing here touches geometry or the node
  # graph -- see the header for what happened the one time something did.
  $CLI resize "$in" "$a" --width "$size" --height "$size" >/dev/null 2>&1
  $CLI webp "$a" "$b" >/dev/null 2>&1
  # meshopt here is the buffer-level encoder, not a mesh edit: it quantizes
  # and packs vertex data. It needs the decoder enabled at every useGLTF call
  # site and 'wasm-unsafe-eval' in script-src -- both are in place.
  $CLI meshopt "$b" "$out" >/dev/null 2>&1
  rm -f "$a" "$b"
  printf '  %-26s %8s -> %8s\n' "$(basename "$out")" \
    "$(du -h "$in" | cut -f1)" "$(du -h "$out" | cut -f1)"
}

echo "characters (textures <= ${TEXTURE_SIZE}px):"
for f in assets-src/models/*.glb; do
  [ -e "$f" ] || continue
  compress "$f" "public/models/$(basename "$f")" "$TEXTURE_SIZE"
done

echo "props (textures <= ${PROP_TEXTURE_SIZE}px):"
for f in assets-src/props/*.glb; do
  [ -e "$f" ] || continue
  compress "$f" "public/props/$(basename "$f")" "$PROP_TEXTURE_SIZE"
done

echo
du -sh public/models public/props
