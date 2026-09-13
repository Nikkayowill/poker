"""
prepare-stackacres-farmpack-props.py

Prep for StackAcres' first batch of scattered-clutter props out of the same
Gr8FarmPack that supplied the crop roster (see
scripts/prepare-stackacres-farmpack-crops.py, whose trim convention this
copies exactly -- one frame per id here instead of three growth stages).

SCOPE. Only the pack's items with no existing prop and no placement
decision attached: things that slot straight into `CLUTTER_KINDS`
(lib/stackacres/props.ts) the same way `log`/`mushroom`/`boulder` already
do -- scattered by the district scatter, not hand-positioned. The pack's
fixed-structure candidates (silo, greenhouse, shed, table, market stalls)
are NOT here on purpose -- see the PR description. Also out of scope,
permanently: barn/windmill/scarecrow (style overlap with the existing
organic-FLUX props), trees, dirt/grass (the autotiled terrain pack, not a
prop), crate (already sprite-backed), trowel/pitchfork/snips/watering can
(tool-tier and drag-to-water systems, not static props), pump (same role as
the well).

THE BARBED WIRE (2026-09-12) now has a placement decision -- Kayo's own call
to run it along the back of the new Factory building -- so it is prepped
here too, four ids off the same four source plates: `barbEnd` (`Barb2.png`,
wire running one direction off the post -- a line terminus) in both its
native orientation and `barbEndWest`, the same picture mirrored, since a
line needs a post facing each way and this pack only drew one; and
`barbStraight1`/`barbStraight2` (`Barb3.png`/`Barb4.png`, two posts with
wire strung between) as the two run segments, alternated the way
`hayBale1`/`hayBale2` already avoid repeating one picture down a line.
`Barb1.png`, the corner post, stays out for now -- nothing here runs a
corner yet; it is a real source plate away from becoming a prop the moment
one does.

Each source file is its own independent canvas, already roughly bottom-
anchored and centred (same as the crops pack) -- so, same as
prepare-stackacres-farmpack-crops.py, no shared-canvas alignment is needed:
trim to each file's own alpha bbox, pad to a whole ART_SCALE multiple,
bottom-anchored centred. That makes every PROP_FOOT (0, 0), same reasoning
as CROP_FOOT there.

Output: public/stackacres/sprites/<propid>.png, one frame per id. Then run
`pnpm assets:webp` -- this script writes PNG (Pillow's format), the encoder
converts to what stackacres-sprites.ts actually asks for and deletes the
PNG behind it.
"""

from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "assets-src" / "stackacres-farm-pack-oddblot" / "Gr8FarmPack"
DST = REPO / "public" / "stackacres" / "sprites"
ART_SCALE = 8

# prop id -> source filename, directly under Gr8FarmPack/ (not Plants/).
PROPS: dict[str, str] = {
    "hayBale1": "Bale1.png",
    "hayBale2": "Bale2.png",
    "bucket": "Bucket.png",
    "stringLights": "Hanging.png",
    "smallBush1": "Smbush1.png",
    "smallBush2": "Smbush2.png",
    "wildflowers1": "Flwr2.png",
    "wildflowers2": "Flwr3.png",
    "flowerBush1": "Flwrbush.png",
    "flowerBush2": "Flwrbush2.png",
    "flowerSprig1": "smflwr.png",
    "flowerSprig2": "Smflwrs.png",
    # `Barb2.png` native orientation is post-on-the-left, wire reaching right
    # -- a west end cap, its post the outside edge of a run reaching east.
    # `barbEndEast` is that same plate mirrored (post-right, wire reaching
    # left), for the opposite end of the same run.
    "barbEndWest": "Barb2.png",
    "barbEndEast": "Barb2.png",
    "barbStraight1": "Barb3.png",
    "barbStraight2": "Barb4.png",
    # The corner post (2026-09-12): the fourth plate, now that the yard
    # placement dev panel lays runs that turn, not just straight ones (see
    # its own header in components/dev/StackAcresPlacementPanel.tsx). One
    # frame, native orientation -- the scene picks `setFlipX`/`setFlipY` per
    # instance the same way `barnSprite` already does, rather than four
    # baked rotations of one picture.
    "barbCorner": "Barb1.png",
}

# Ids that are the SAME source plate as another entry above, mirrored --
# see the module note on why `barbEndEast` needs this and nothing else does.
FLIP_HORIZONTAL: set[str] = {"barbEndEast"}


def trim_flush_bottom(im: Image.Image) -> tuple[Image.Image, int, int]:
    """Trim to the frame's own alpha bbox, then pad up to a whole ART_SCALE
    multiple on each side -- centred left/right, flush to the bottom -- so
    every later scale factor lands on a whole pixel. Identical to
    prepare-stackacres-farmpack-crops.py's helper of the same name."""
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

    for prop_id, filename in PROPS.items():
        src_path = SRC / filename
        im = Image.open(src_path)
        if prop_id in FLIP_HORIZONTAL:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        canvas, unit_w, unit_h = trim_flush_bottom(im)
        canvas.save(DST / f"{prop_id}.png")
        box_table[prop_id] = (unit_w, unit_h)
        print(f"{prop_id}: {filename} -> {unit_w * ART_SCALE}x{unit_h * ART_SCALE}px = {unit_w}x{unit_h} units")

    print()
    print("PROP_SIZE entries (art units):")
    for name, (w, h) in box_table.items():
        print(f"  {name}: {{ w: {w}, h: {h} }},")

    print()
    print("PROP_FOOT: every frame is trimmed flush to its own bottom-centre,")
    print("so (0, 0) for every one of these, same as the crop roster.")


if __name__ == "__main__":
    main()
