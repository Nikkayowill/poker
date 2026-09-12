"""
prepare-stackacres-farmpack-crops.py

Rip-and-replace prep for StackAcres' whole crop roster: cuts the 3 growth
frames this game actually uses (seedling/sprout/mature) out of the newly
supplied Gr8FarmPack, replacing all 22 CraftPix-rendered crops outright --
same "start like we just found some" trade the CraftPix pass itself made
against the two original hand-vector crops (see catalogue.ts's own header).

WHY THIS SCRIPT LOOKS SIMPLER THAN trim-stackacres-craftpix-crops.py. That
script shared one canvas window across all 3 stages of a crop because its
source was a fixed camera render -- the ground plane was the same pixel row
in every stage, so the trim window had to line up across stages to keep that
alignment. This pack is flat 2D pixel art with no shared camera: each numbered
frame is its own independent sprite, already roughly bottom-anchored and
horizontally centred in its own canvas (see the pack's own file bboxes -- Kayo
confirmed this by eye). So each frame is trimmed to ITS OWN alpha bbox alone,
independent of the other two stages, and CROP_FOOT comes out (0, 0) for every
crop: bottom-centre of a bottom-anchored trim IS the root point, no ground-
band measurement needed. Don't reintroduce the shared-canvas rig unless a
future pack actually needs it.

Picks frames 1, 3 and 5 of each crop's 5 numbered stages -- a consistent
spread across all crops beats hand-picking a "best" frame per crop, and
consistency is what "just found some" means here.

Output: public/stackacres/sprites/<cropid><stage>.png (stage 0/1/2), same
naming convention every other StackAcres sprite prep script uses. Also
prints the CROP_BOX (art units) and CROP_FOOT (dx/dy, both ~0) tables
crop-visuals.ts's own per-crop tables are built from -- re-run this after a
pack update rather than hand-editing those tables.
"""

from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "assets-src" / "stackacres-farm-pack-oddblot" / "Gr8FarmPack" / "Plants"
DST = REPO / "public" / "stackacres" / "sprites"
ART_SCALE = 8

# crop id -> (source subfolder, file prefix). Frames are "<prefix>{1,3,5}.png"
# in that subfolder. The prefix is not always the folder name or the crop id
# -- the pack's own filenames are inconsistent crop to crop (BPepper, Egg,
# Greenbean, Pep) -- so it is spelled out explicitly rather than guessed.
#
# "wheatsheaf", not "wheat": the obvious id collides with two things already
# in this codebase under the plain name "wheat" -- machine-items.ts's
# MACHINE_RAW_ITEMS wheat (the Wheat Plot's raw material, a totally separate
# system from a stocked unit) and paths.ts's "wheatField" waypoint id. Since
# StackAcresItem's item id equals the stock id (see items.ts's header), a
# crop literally named "wheat" would shadow the Wheat Plot's own wheat in
# every MachineItemId lookup (machineItemSellPrice/Icon/Label all check
# isStackAcresItem first) -- a silent, wrong price on every Mill run. Label
# stays "Wheat"; only the id moved, same divergence pattern "brokoly"/
# "Broccoli" already uses below.
CROPS: dict[str, tuple[str, str]] = {
    "bell_pepper": ("Bell pepper", "BPepper"),
    "broccoli": ("Brocollli", "Broccoli"),
    "cabbage": ("Cabbage", "Cabbage"),
    "carrot": ("Carrot", "Carrot"),
    "celery": ("Celery", "Celery"),
    "corn": ("Corn", "Corn"),
    "eggplant": ("Eggplant", "Egg"),
    "green_bean": ("Green bean", "Greenbean"),
    "lettuce": ("Lettuce", "Lettuce"),
    "onion": ("Onion", "Onion"),
    "pepper": ("Pepper", "Pep"),
    "potato": ("Potato", "Potato"),
    "radish": ("Radish", "Radish"),
    "spinach": ("Spinach", "Spinach"),
    "tomato": ("Tomato", "Tomato"),
    "wheatsheaf": ("Wheat", "Wheat"),
}

# Seedling / sprout / mature, out of each crop's 5 numbered frames.
FRAME_NUMBERS = (1, 3, 5)


def trim_flush_bottom(im: Image.Image) -> Image.Image:
    """Trim to the frame's own alpha bbox, then pad up to a whole ART_SCALE
    multiple on each side -- centred left/right, flush to the bottom -- so
    every later scale factor lands on a whole pixel, same invariant the
    CraftPix trim held."""
    rgba = im.convert("RGBA")
    bbox = rgba.getbbox()
    if bbox is None:
        raise SystemExit("frame is fully transparent")
    left, top, right, bottom = bbox
    px_w, px_h = right - left, bottom - top
    unit_w = max(1, -(-px_w // ART_SCALE))
    unit_h = max(1, -(-px_h // ART_SCALE))
    canvas_w, canvas_h = unit_w * ART_SCALE, unit_h * ART_SCALE

    trimmed = rgba.crop(bbox)
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    canvas.alpha_composite(trimmed, ((canvas_w - px_w) // 2, canvas_h - px_h))
    return canvas, unit_w, unit_h


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    box_table: dict[str, tuple[int, int]] = {}

    for crop_id, (folder, prefix) in CROPS.items():
        mature_box = None
        for stage, frame_no in enumerate(FRAME_NUMBERS):
            src_path = SRC / folder / f"{prefix}{frame_no}.png"
            im = Image.open(src_path)
            canvas, unit_w, unit_h = trim_flush_bottom(im)
            canvas.save(DST / f"{crop_id}{stage}.png")
            if stage == 2:
                mature_box = (unit_w, unit_h)
            print(f"{crop_id}{stage}: {folder}/{prefix}{frame_no}.png -> {unit_w * ART_SCALE}x{unit_h * ART_SCALE}px = {unit_w}x{unit_h} units")
        assert mature_box is not None
        box_table[crop_id] = mature_box

    print()
    print("CROP_BOX table (art units, mature/stage-2 frame):")
    for name, (w, h) in box_table.items():
        print(f"  {name}: {{ w: {w}, h: {h} }},")

    print()
    print("CROP_FOOT table: every frame is trimmed flush to its own bottom-")
    print("centre, so the root point IS the anchor -- (0, 0) for every crop.")
    for name in box_table:
        print(f"  {name}: {{ dx: 0, dy: 0 }},")


if __name__ == "__main__":
    main()
