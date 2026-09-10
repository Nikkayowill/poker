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
import json
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

# Where each model's own root point landed in its 512x512 frame, written by
# the render script (`ground_anchor`). Without it a sprite can only be
# anchored by the bottom-centre of its trimmed canvas, which is the lowest
# pixel anywhere in the frame -- on anything that sprawls that is a front
# leaf, and the plant ends up drawn up and back off its own bed.
with open(os.path.join(SRC, "anchors.json")) as handle:
    ANCHORS = json.load(handle)

box_table = {}
foot_table = {}


def ground_band_centre(image, band_fraction=0.15):
    """Where a frame's ink sits ACROSS the ground, in its own pixels: the
    alpha-weighted centre of the bottom slice of the sprite.

    Not the same question `anchors.json` answers. That is the model's root
    point in 3D -- the centre of its whole bounding box, at ground level --
    which carries the plant's DEPTH correctly and is what stops a rosette
    floating above its bed. But a model that leans (a bulb whose leaves fan
    to one side) has its bbox centre away from the bulb, and anchoring
    sideways on it hangs the plant off the edge of its own soil.

    Sideways, what has to line up is where the plant's mass rests, so that is
    measured here instead: the bottom `band_fraction` of the ink, weighted by
    alpha. A lowest-pixel measure was tried first and is worse -- on a rosette
    the lowest pixel is the tip of one front leaf, which dragged the whole
    cabbage six units off centre.
    """
    alpha = image.split()[-1]
    w, h = image.size
    px = alpha.load()
    bbox = alpha.getbbox()
    if bbox is None:
        return w / 2
    band_top = max(bbox[1], bbox[3] - max(2, int((bbox[3] - bbox[1]) * band_fraction)))
    total = 0
    weighted = 0
    for y in range(band_top, bbox[3]):
        for x in range(bbox[0], bbox[2]):
            a = px[x, y]
            if a > 40:
                total += a
                weighted += a * x
    return weighted / total if total else w / 2


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

    # The root point in this canvas's own coordinates, then as an offset from
    # the bottom-centre the scene anchors at: how far right of centre, and
    # how far up from the bottom edge, both in art units.
    # Sideways from the ink, down the frame from the 3D root -- see
    # `ground_band_centre` for why the two halves come from different
    # measurements.
    anchor_x, anchor_y = ANCHORS[crop]
    # Clamped at zero: a NEGATIVE dy is a model whose projected root sits
    # below its own lowest ink, and honouring it lifts the plant off the soil
    # it is supposed to be growing out of -- the carrot floated a good three
    # units over its own heap. Sinking a plant into the bed is fine; hanging
    # one above it is not.
    foot_table[out_name] = (
        (ground_band_centre(mature) - crop_left - canvas_w / 2) / ART_SCALE,
        max(0.0, (crop_bottom - anchor_y) / ART_SCALE),
    )

    box_table[out_name] = (unit_w, unit_h)
    print(f"{out_name}: canvas {canvas_w}x{canvas_h}px -> box {unit_w}x{unit_h} units")

print()
print("CROP_BOX table (art units):")
for name, (w, h) in box_table.items():
    print(f'  {name}: {{ w: {w}, h: {h} }},')

print()
print("CROP_FOOT table (art units, from the canvas's bottom centre):")
for name, (dx, dy) in foot_table.items():
    print(f"  {name}: {{ dx: {dx:.2f}, dy: {dy:.2f} }},")

