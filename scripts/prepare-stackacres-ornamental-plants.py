"""
prepare-stackacres-ornamental-plants.py

Cuts StackAcres' Farmstead garden clutter out of nine separate isometric
plant packs (Kayo's own supply: Agapanthus, Bamboo, Flax Formium, Hibiscus,
Howea, Mushroom_One, Mushroom_Two, Mushroom_Three, Ostrich Fern). Same role
as scripts/prepare-stackacres-farmpack-props.py -- a second art pack feeding
PropKind/CLUTTER_KINDS rather than the closed wild-flora SceneryKind roster
in lib/stackacres/world.ts, which stackacres-sprites.ts's own header marks as
"ONE PACK" on purpose. These are garden ornamentals (flowering shrubs, a
palm, ferns, fantasy toadstools), not open-country wild growth, so the
Farmstead clutter band is where they belong.

EACH PACK IS A WIND-SWAY ANIMATION SET, rendered for a rotating camera this
game doesn't have: every plant ships 16 frames per rotation angle (000
through 315) at four to six resolutions. None of that range is used -- one
frame (0001, the rest pose before any sway) at one angle (000, checked by eye
against all eight per plant; it is the fullest, most front-on read for every
species here) is a static PropKind, the same way the sway on ready crops
(stackacres-scene.ts's own `sway`) is a runtime tween on one still picture,
never a frame swap. The 180x180 tile (180x240 for Bamboo, whose plate is
taller than it is wide) was picked over 128/256/320 as the resolution whose
trimmed content lands in the existing clutter roster's own size band
(compare PROP_SIZE's `flowerBush1`/`smallBush2` in lib/stackacres/props.ts)
without upscaling artifacts or an oversized final box.

CURATED, NOT EXHAUSTIVE. Hibiscus alone ships 12 colour/pose combinations;
Mushroom_One and Mushroom_Two each ship 4 "Appearance" variants. Taking every
one would double the clutter roster's kind count for marginal variety over
picking the best of each family. What ships: one Agapanthus, one Bamboo,
all three Flax colourways (cheap, genuinely different plants), one Howea,
two Ostrich Ferns (of three -- Fern_03 repeats Fern_01's silhouette closely
enough that a third added nothing), one hibiscus per colour (four, first
pose only), all four Mushroom_Three colours (a matched fantasy set, the
pack's whole reason for being), and one generic toadstool each from
Mushroom_One/Mushroom_Two for cap-shape variety against Mushroom_Three's
spotted colour family and the existing flat-vector `mushroom` FOREST_FLOOR
painter.

THE PACK BAKES ITS OWN GROUND SHADOW, unlike Gr8FarmPack's plates (which have
none) and unlike the isometric-plant-pack's near-black renders (which do, at
a different alpha band) -- see prepare-stackacres-plants.py's own header for
that pack's measurement. This one's wash is pure black (rgb 0,0,0) at
alpha <= ~110 wherever it falls, and every solid plant pixel sits at alpha
255 with real colour, so the identical test that script already uses
(alpha < SHADOW_ALPHA and max(rgb) <= SHADOW_VALUE) strips it cleanly with no
per-plate exception needed -- verified across all eighteen plates, not just
sampled. Strip before trim, or the alpha bbox includes the shadow's own
footprint and every canvas trims short on its actual plant.

THE PACK IS ALREADY ON-PALETTE. Measured at alpha>200, these plates run
ordinary saturated greens/reds/blues/yellows (Hibiscus red: mean RGB
~(170,40,35); Mushroom_Three blue cap: strongly blue, not the near-black,
blue-starved render prepare-stackacres-plants.py had to gradient-map to fix).
So there is no `ramp_map` step here -- the source colour ships as-is, the
same "no colour correction needed" call prepare-stackacres-farmpack-props.py
made for the Gr8FarmPack plates.

Output: public/stackacres/sprites/<propid>.png, one frame per id, trimmed to
its own alpha bbox and padded to a whole ART_SCALE multiple, bottom-anchored
centred -- identical convention to prepare-stackacres-farmpack-props.py's
`trim_flush_bottom`, copied rather than imported for the same reason that
file gives (this is a one-shot prep script, not shared runtime code). Every
PROP_FOOT is therefore (0, 0). Then run `pnpm assets:webp` -- this script
writes PNG, the encoder converts to what stackacres-sprites.ts actually asks
for and deletes the PNG behind it.
"""

from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "assets-src" / "stackacres-ornamental-plants"
DST = REPO / "public" / "stackacres" / "sprites"
ART_SCALE = 8

# prop id -> (source subdirectory under SRC, filename).
PROPS: dict[str, tuple[str, str]] = {
    "agapanthus": ("Agapanthus", "Agapanthus_Wide_Body_000_0001.png"),
    "bamboo": ("Bamboo", "Bamboo_Body_000_0001.png"),
    "flax1": ("Flax", "Flax_01_Body_000_0001.png"),
    "flax2": ("Flax", "Flax_02_Body_000_0001.png"),
    "flax3": ("Flax", "Flax_03_Body_000_0001.png"),
    "howea": ("Howea", "Howea_Wide_Body_000_0001.png"),
    "fern1": ("Fern", "Fern_01_Body_000_0001.png"),
    "fern2": ("Fern", "Fern_02_Body_000_0001.png"),
    "hibiscusBlue": ("Hibiscus", "Blue_Hibiscus_01_Body_000_0001.png"),
    "hibiscusRed": ("Hibiscus", "Red_Hibiscus_01_Body_000_0001.png"),
    "hibiscusViolet": ("Hibiscus", "Violet_Hibiscus_01_Body_000_0001.png"),
    "hibiscusYellow": ("Hibiscus", "Yellow_Hibiscus_01_Body_000_0001.png"),
    "mushroomBlueCap": ("MushroomThree", "Mushroom_Blue_Body_000_0001.png"),
    "mushroomPurpleCap": ("MushroomThree", "Mushroom_Purple_Body_000_0001.png"),
    "mushroomRedCap": ("MushroomThree", "Mushroom_Red_Body_000_0001.png"),
    "mushroomYellowCap": ("MushroomThree", "Mushroom_Yellow_Body_000_0001.png"),
    "toadstool1": ("MushroomOne", "Mushroom_01_Body_000_0001.png"),
    "toadstool2": ("MushroomTwo", "Mushroom_01_Body_000_0001.png"),
}

# Where the baked shadow actually is -- see the module header. Identical
# test to prepare-stackacres-plants.py's `strip_shadow`, copied rather than
# imported.
SHADOW_ALPHA = 190
SHADOW_VALUE = 10


def strip_shadow(im: Image.Image) -> Image.Image:
    a = np.array(im).astype(np.int16)
    alpha = a[..., 3]
    value = a[..., :3].max(axis=2)
    a[..., 3] = np.where((alpha > 0) & (alpha < SHADOW_ALPHA) & (value <= SHADOW_VALUE), 0, alpha)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def trim_flush_bottom(im: Image.Image) -> tuple[Image.Image, int, int]:
    """Trim to the frame's own alpha bbox, then pad up to a whole ART_SCALE
    multiple on each side -- centred left/right, flush to the bottom -- so
    every later scale factor lands on a whole pixel. Identical to
    prepare-stackacres-farmpack-props.py's helper of the same name."""
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

    for prop_id, (subdir, filename) in PROPS.items():
        src_path = SRC / subdir / filename
        im = Image.open(src_path).convert("RGBA")
        im = strip_shadow(im)
        canvas, unit_w, unit_h = trim_flush_bottom(im)
        canvas.save(DST / f"{prop_id}.png")
        box_table[prop_id] = (unit_w, unit_h)
        print(f"{prop_id}: {subdir}/{filename} -> {unit_w * ART_SCALE}x{unit_h * ART_SCALE}px = {unit_w}x{unit_h} units")

    print()
    print("PROP_SIZE entries (art units):")
    for name, (w, h) in box_table.items():
        print(f"  {name}: {{ w: {w}, h: {h} }},")

    print()
    print("PROP_FOOT: every frame is trimmed flush to its own bottom-centre,")
    print("so (0, 0) for every one of these, same as the Gr8FarmPack clutter.")


if __name__ == "__main__":
    main()
