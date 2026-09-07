"""
trim-stackacres-craftpix-crops.py

Second half of render-stackacres-craftpix-crops.py's pipeline: trims that
script's raw 512x512 Blender renders down to the flush-bottom, shared-canvas
convention lib/stackacres/crop-visuals.ts and stackacres-art.ts expect --
all 3 growth stages of one crop share ONE canvas, sized to the MATURE
(stage 2) frame's own opaque content, and every canvas dimension is an exact
multiple of ART_SCALE (8px/unit) so cropFootprintHalf etc. land on whole
units. Also prints the CROP_BOX table (art units) crop-visuals.ts's own
per-crop box table was built from -- rerun this after a re-render to get
fresh numbers, don't hand-edit that table's values independently of it.
"""
import os
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent

# Wherever render-stackacres-craftpix-crops.py's OUTPUT_DIR wrote to -- the
# raw renders are not checked into this repo, only the trimmed result is.
SRC = "/home/nikkayowilliams/Pictures/craftpix-891167-fbx-source/output_sprites"
DST = str(REPO / "public" / "stackacres" / "sprites")
ART_SCALE = 8

RENAME = {}
# All 22 rendered models, replacing the old hand-vector carrot/corn crops
# outright -- their existing sprite files (carrot0-2.png/corn0-2.png) are
# overwritten below with the new CraftPix-sourced art.
CROPS = ["artichoke", "beet", "brokoly", "cabbage", "carrot", "corn", "corn2", "cucumber",
         "eggplant", "garlic", "grap", "grap2", "onion", "pepper", "poppy", "potato",
         "pumpkin", "sunflowe_broken", "sunflower", "tomato", "wheat1", "wheat2"]

box_table = {}

for crop in CROPS:
    out_name = RENAME.get(crop, crop)

    mature = Image.open(os.path.join(SRC, f"{crop}2.png"))
    alpha = mature.split()[-1]
    bbox = alpha.getbbox()
    if bbox is None:
        raise SystemExit(f"{crop}: stage-2 render is fully transparent")
    left, top, right, bottom = bbox

    px_w = right - left
    px_h = bottom - top
    # Round the crop box up to the nearest whole art unit (8px), then pad the
    # trim window to match -- this is what keeps every later scale factor
    # (STAGE_SCALE x ART_SCALE) landing on a whole pixel, the same invariant
    # carrot/corn's own boxes hold.
    unit_w = max(1, -(-px_w // ART_SCALE))  # ceil div
    unit_h = max(1, -(-px_h // ART_SCALE))
    canvas_w = unit_w * ART_SCALE
    canvas_h = unit_h * ART_SCALE

    # Center the extra padding left/right; keep the BOTTOM flush at `bottom`
    # (that's the "stands on its own floor" convention) and let extra height
    # pad the TOP.
    pad_w = canvas_w - px_w
    crop_left = left - pad_w // 2
    crop_right = crop_left + canvas_w
    crop_bottom = bottom
    crop_top = crop_bottom - canvas_h

    for stage in (0, 1, 2):
        im = Image.open(os.path.join(SRC, f"{crop}{stage}.png"))
        tile = im.crop((crop_left, crop_top, crop_right, crop_bottom))
        assert tile.size == (canvas_w, canvas_h), (crop, stage, tile.size, canvas_w, canvas_h)
        tile.save(os.path.join(DST, f"{out_name}{stage}.png"))

    box_table[out_name] = (unit_w, unit_h)
    print(f"{out_name}: canvas {canvas_w}x{canvas_h}px -> box {unit_w}x{unit_h} units")

print()
print("CROP_BOX table (art units):")
for name, (w, h) in box_table.items():
    print(f'  {name}: {{ w: {w}, h: {h} }},')
