"""Cut StackAcres' whole wild flora out of the isometric plant pack.

This script used to cut nine sprites: the meadow's three grass heights, a
tuft, two weeds and three scrub. The trees, the pine and the bush were a
deliberate carve-out -- Kayo's call, recorded here and in
stackacres-sprites.ts, they stayed as the flat vector painters they had always
been. That carve-out is REVERSED as of 2026-09-06, on his instruction: "rid of
everything from before and fill the map up with the new plates completely."
So every wild plant on the map now comes off this one pack, and the roster
went 9 -> 44 so the map has variety to fill up WITH -- that is every plate in the
pack that is neither snow-laden nor the wrong climate (see below).

What is NOT here, and cannot be: `flower1/2/3`, `rock`, `log`, `mushroom` and
`boulder` are still painters, because the pack is a PLANT pack -- it has no
flower and no stone in it. They are the only scenery left that this file does
not feed.

WHAT IS LEFT ON THE FLOOR, and why, since the pack has 79 plates and this
takes 44. Two piles, neither of them a judgement call about quality:

  35 cannot be used here at all. `pine-full` (8) and `pine-half` (8) are the
  same conifers under a full and a half load of SNOW -- they render white, and
  there is no winter on this map. palm (6), bamboo (6), cactus (4) and hemp
  (3) are the wrong climate; a saguaro at the edge of a wheat field reads as a
  bug, not as variety.

  0 usable plates are skipped. Every plate that is neither snow nor desert is
  cut. If StackAcres ever grows a winter season or a desert district, those 35
  are a fully rendered set already sitting in the zip.

THE PACK IS RENDERED ALMOST BLACK, and this is the thing to know before
touching any of it. Measured over pixels at alpha>200: bigtree01's mean RGB is
(11, 12, 3) with a MAXIMUM channel of 51; pine-none04 is (16, 19, 8), max 50.
That is not a dark green, it is black with a tint, and it is why the old
version of this file carried a `SCRUB_GAMMA = 0.62` lift for the three bush
plates alone.

A BRIGHTNESS CURVE ALONE CANNOT FIX IT, and the failed attempt is worth
recording so nobody spends the afternoon on it twice. Normalising each plate
onto its own 98th percentile and pushing saturation does make the plants
visible, and it makes every one of them ACID YELLOW. The reason is in the
numbers above: the blue channel is 2.5 where green is 11.8, so scaling to a
readable brightness scales a plant that has essentially no blue in it, and
"green with no blue" is yellow. White-balancing instead of scaling does not
work either -- lifting a mean of 2.5 to a foliage-like 62 is a 25x gain on a
channel whose entire range is quantisation noise, which arrives as blotches.

So the plates are GRADIENT-MAPPED rather than relit: `ramp_map` takes each
pixel's luminance, stretches it across the plate's own 4th-to-96th percentile,
and looks the result up in one of art-palette.ts's `RAMPS` (rim -> side ->
top). That fixes the colour by construction -- the pack's foliage comes out on
exactly the greens the painters already use, which is also the answer to the
style clash, since the thing that made this art read as foreign was never the
silhouette, it was the colour. A little of the render's own tone is mixed back
(`KEEP`) so a canopy is not flat.

BARK IS A CANOPY-ONLY SPLIT. A straight gradient map paints the trunks green
too, so `ramp_map` optionally re-maps pixels where r > g through the `soil`
ramp. That test is right for a tree and WRONG for a shrub: measured, bush05
and shrub1-01 are themselves redder than they are green, so the same flag
turns them into brown autumn bushes. Only the `canopy` families pass a bark
ramp; everything else maps whole.

STRIP THE SHADOW BEFORE MAPPING, never after, or the ramp lifts the wash into
a solid grey-green blob that no later test can find.

WHERE THE BAKED SHADOW ACTUALLY IS. Not where the old version of this file
said. It claimed the wash sat at "alpha 9 to 84" and tested `alpha <= 110 and
max(rgb) <= 120`, which is why the trees and pines shipped with their shadow
intact through the first cut of this pass: measured, the wash is a FLAT
LAYER AT ALPHA 128-130, just above that ceiling, and it is pure black (97% of
it at max(rgb) <= 6). bigtree01 carries 4,966 pixels of it. The test is now
`alpha < 190 and max(rgb) <= 10` -- the alpha bound keeps the plant's own
solid body (200+), and the value bound is what does the real work, since even
the darkest foliage here reads 10 or above while the wash is 0.

WHY THE TEST IS STILL GATED PER PLATE. It is not safe everywhere. The five
`grasses` plates and the two `swirl` plates are wisps -- thin blades drawn at
low alpha over their whole area, not just at the edges -- and they lose 22% to
61% of their own pixels to a test like this. They also happen to be the only
plates in the pack rendered WITHOUT a ground shadow, so they are excluded.
Everything else here has one; verified by eye against a light background,
which is the only test that works (see scripts/shadow_check.py). Note that
`weed01` and `weed03` DO carry a shadow and were missing from the old set, so
the shipped `weed-tall`/`weed-short` had a baked smudge under them on top of
the scene's own grounding ellipse.

Source: isometric-plant-pack (Kayo's supply), unzipped to scripts/iso/ and
gitignored there. `isometric tiles/` holds the cut-out plates and is the only
usable art in the zip.

DO NOT go looking for higher-resolution sources at the pack root. An earlier
version of this comment called those "the full-size renders they came from",
which is wrong and cost an afternoon: bigtree.png, bush.png, palm.png and the
rest are the BLENDER MATERIAL TEXTURES -- a bark tile, a leaf billboard, a
single frond -- for iso-objects.blend, not renders of anything. So the ~200px
cut-outs are the whole resolution budget, and the boxes above (a broadleaf at
122x78 art units, which is 976x624 px) upscale them roughly 4.5x. `fit`
compensates with an unsharp mask whose radius grows with the upscale; a fixed
radius does nothing to detail that has itself been stretched.

The zip does ship iso-objects.blend, so re-rendering these crisp at any size
(and with the lighting fixed at source, which would retire half this file) is
available to a future pass. It is a different job from this one.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parent.parent
# Not committed -- unzip isometric-plant-pack.zip next to this script to re-run.
SRC = Path(__file__).resolve().parent / "iso" / "isometric tiles"
OUT = REPO / "public" / "stackacres" / "sprites"

ART_SCALE = 8

# art-palette.ts's RAMPS, as (rim, side, top). Copied rather than imported for
# the obvious reason -- this is Python and that is TypeScript -- so if a ramp
# is retuned there, retune it here and re-run. The scenery is baked art now,
# not a painter, so it will NOT follow a palette change on its own.
RAMPS: dict[str, tuple[str, str, str]] = {
    "leaf": ("#235411", "#429322", "#6bd041"),
    "pine": ("#163f21", "#2c7a3f", "#439f57"),
    "wild": ("#33591d", "#487a2b", "#5e9b3a"),
    "grass": ("#3d6f19", "#67ab2c", "#9be23f"),
    "soil": ("#4a2f19", "#6b4526", "#8a5c34"),
}

# family -> (ramp, does this family have a trunk to keep brown).
#
# Broadleaf and conifer are split so a wood is not one green: `leaf` is the
# warm green the vector trees used, `pine` is the cooler one, and keeping that
# distinction is most of what stops a mixed treeline reading as wallpaper.
# Everything at ground level maps through `wild`, which the palette defines as
# the deliberately duller green of land nobody has cleared -- exactly right for
# scenery whose whole job is to lose to the farm.
FAMILY: dict[str, tuple[str, bool]] = {
    "canopy": ("leaf", True),
    "conifer": ("pine", True),
    "shrub": ("wild", False),
    "ground": ("wild", False),
    "frond": ("leaf", False),
    "grass": ("grass", False),
}

# How much of the render's own tone is mixed back over the ramp. Low, but not
# zero: at zero a canopy is a flat poster paint, and the pack's one real gift
# is the leaf-by-leaf variation the painters never had.
KEEP = 0.22

# name -> (plate, box width, box height in art units, keep, family).
#
# Boxes are the plate's OWN aspect at a chosen height, not a guess: `fit`
# contains rather than stretches, so a box at the wrong aspect just pads the
# sprite with air and shrinks the plant inside it. The three meadow heights
# are the exception and keep the boxes they were tuned at -- they are one
# sprite per 16-unit tile and the field's density reads off their footprint.
FRAMES: dict[str, tuple[str, int, int, float, str]] = {
    # -- Canopy. Replaces the flat `treeRound` painters outright. ----------
    # Note these are WIDER THAN THEY ARE TALL (aspect ~1.5) where the vector
    # trees were the reverse (0.8). That is what an isometric camera does to
    # a tree, and it is why the boxes are not the old 64x80: keeping that box
    # would have contained a 1.56-aspect plate to 64 wide and left 39 of its
    # 80 units as empty sky, drawing every tree at half the mass it should be.
    "tree1": ("bigtree01", 122, 78, 1.0, "canopy"),
    "tree2": ("bigtree02", 94, 78, 1.0, "canopy"),
    "tree3": ("bigtree03", 120, 78, 1.0, "canopy"),
    # Conifers. 06 and 08 are two- and three-trunk clusters in the pack, kept
    # as clusters -- one scenery item that reads as a small stand, which is
    # cheaper than three items and gives a treeline a coarser grain.
    "pine": ("pine-none04", 99, 104, 1.0, "conifer"),
    "pine2": ("pine-none06", 98, 100, 1.0, "conifer"),
    "pine3": ("pine-none08", 102, 98, 1.0, "conifer"),
    # The other five conifer plates. Worth having specifically because they
    # are TALLER and slimmer than the first three (aspect 0.65-0.92 against
    # 0.95-1.04), so a treeline built from all eight has a skyline instead of
    # eight copies of one height. 05 and 07 are the pack's other multi-trunk
    # clusters.
    "pine4": ("pine-none01", 92, 100, 1.0, "conifer"),
    "pine5": ("pine-none02", 77, 118, 1.0, "conifer"),
    "pine6": ("pine-none03", 82, 114, 1.0, "conifer"),
    "pine7": ("pine-none05", 93, 112, 1.0, "conifer"),
    "pine8": ("pine-none07", 92, 116, 1.0, "conifer"),
    # -- Bushes. The farm-edge size band. ----------------------------------
    "bush": ("bush05", 41, 26, 1.0, "shrub"),
    "bush2": ("bush01", 34, 28, 1.0, "shrub"),
    "bush3": ("bush04", 28, 24, 1.0, "shrub"),
    # -- Scrub. Between a tuft and a bush. ---------------------------------
    "scrub-low": ("bush03", 32, 16, 1.0, "shrub"),
    "scrub-round": ("bush02", 23, 19, 1.0, "shrub"),
    "scrub-fan": ("shrub1-01", 36, 34, 1.0, "shrub"),
    "scrub-plume": ("shrub1-03", 41, 32, 1.0, "shrub"),
    "scrub-broad": ("shrub2-01", 34, 26, 1.0, "shrub"),
    "scrub-leafy": ("shrub2-04", 38, 25, 1.0, "shrub"),
    # The rest of both shrub sets. `shrub1` is the upright, bristly family and
    # `shrub2` the broad flat rosettes, which is why the six below split into
    # two clearly different silhouettes rather than six of one.
    "scrub-sprig": ("shrub1-02", 22, 24, 1.0, "shrub"),
    "scrub-bristle": ("shrub1-04", 29, 32, 1.0, "shrub"),
    "scrub-thicket": ("shrub1-05", 38, 30, 1.0, "shrub"),
    "scrub-rosette": ("shrub2-02", 37, 26, 1.0, "shrub"),
    "scrub-patch": ("shrub2-03", 27, 19, 1.0, "shrub"),
    "scrub-mound": ("shrub2-05", 46, 30, 1.0, "shrub"),
    # -- Broad-leaved ground cover. The wood's damp floor. -----------------
    "frond1": ("tropical01", 24, 17, 1.0, "frond"),
    "frond2": ("tropical03", 34, 15, 1.0, "frond"),
    "frond3": ("tropical05", 31, 22, 1.0, "frond"),
    "frond4": ("tropical02", 19, 15, 1.0, "frond"),
    "frond5": ("tropical04", 28, 15, 1.0, "frond"),
    # -- Weeds. Open ground. -----------------------------------------------
    "weed-tall": ("weed01", 21, 16, 1.0, "ground"),
    "weed-short": ("weed03", 16, 12, 1.0, "ground"),
    "weed3": ("weed02", 20, 15, 1.0, "ground"),
    "weed4": ("weed05", 18, 13, 1.0, "ground"),
    "weed5": ("weed06", 22, 13, 1.0, "ground"),
    "weed6": ("weed04", 22, 11, 1.0, "ground"),
    # -- Grass. --------------------------------------------------------------
    # The Long Meadow, waist-high down to cut. One sprite per 16-unit tile at
    # whatever height the scythe has left it (`meadowDensityAt`), so each has
    # to stay its painter's box: 14x13, 14x8 and 14x4 art units.
    #
    # The pack renders grass at one height only. A mown tile is the same grass
    # with the top taken off, so `keep` cuts a tuft down from its feet and
    # feathers the cut, exactly as the corn ramp does in
    # prepare-stackacres-crops.py -- and for the same reason: without the
    # feather, the render's own dark interior leaves a hard horizontal edge
    # that upscales into a visible bar across the top of every stubble tile.
    # The three heights come off three DIFFERENT plates rather than one plate
    # cut three ways, so the field is not a grid of one silhouette.
    "grass-tall": ("grasses02", 18, 17, 1.0, "grass"),
    "grass-mid": ("grasses04", 18, 11, 1.0, "grass"),
    "grass-stubble": ("grasses03", 18, 5, 0.34, "grass"),
    # The open world's own grass clump -- ten a chunk, so it is most of what
    # the player actually sees underfoot away from the farm.
    "tuft": ("grasses01", 14, 10, 1.0, "grass"),
    "tuft2": ("grasses05", 10, 10, 1.0, "grass"),
    # Flat rosettes. The smallest thing the pack has; they break up bare lawn
    # without adding another silhouette at tuft height.
    "swirl1": ("swirl01", 14, 8, 1.0, "grass"),
    "swirl2": ("swirl02", 16, 9, 1.0, "grass"),
}

# Plates rendered standing on a baked ground shadow -- which is every plate
# this file uses EXCEPT the grasses and the swirls. See the module docstring
# for why that exception is not optional.
UNSHADOWED_PREFIXES = ("grasses", "swirl")

# A pixel is baked shadow when it is BLACK and not part of the plant's own
# solid body. See the module docstring for the measurement -- the wash is a
# flat layer at alpha 128-130 and the plant sits at 200+, so the alpha bound
# only has to fall between them; the value bound is what identifies it.
SHADOW_ALPHA = 190
SHADOW_VALUE = 10

# Where the luminance stretch clips. Percentiles rather than min/max so one
# stray specular pixel cannot set the white point for a whole tree.
TONE_LO_PCT = 4
TONE_HI_PCT = 96
TONE_GAMMA = 0.9

CUT_FEATHER = 0.18

LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)


def shadowed(plate: str) -> bool:
    return not plate.startswith(UNSHADOWED_PREFIXES)


def rgb255(value: str) -> np.ndarray:
    h = value.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def strip_shadow(art: Image.Image) -> Image.Image:
    """Drops the baked ground shadow, wherever on the plate it falls."""
    a = np.array(art).astype(np.int16)
    alpha = a[..., 3]
    value = a[..., :3].max(axis=2)
    a[..., 3] = np.where((alpha > 0) & (alpha < SHADOW_ALPHA) & (value <= SHADOW_VALUE), 0, alpha)
    out = Image.fromarray(a.astype(np.uint8), "RGBA")
    box = out.getbbox()
    return out.crop(box) if box else out


def _ramp3(t: np.ndarray, ramp: tuple[str, str, str]) -> np.ndarray:
    """Looks a 0..1 field up in a three-stop ramp: rim -> side -> top."""
    rim, side, top = (rgb255(c) for c in ramp)
    low = t < 0.5
    k = np.where(low, t / 0.5, (t - 0.5) / 0.5)[..., None]
    a0 = np.where(low[..., None], rim, side)
    a1 = np.where(low[..., None], side, top)
    return a0 + (a1 - a0) * k


def ramp_map(art: Image.Image, family: str) -> Image.Image:
    """Maps a near-monochrome render onto one of the game's own palette ramps.

    Alpha is never touched -- scaling it fringes every leaf edge -- so the
    silhouette this returns is exactly the silhouette it was given."""
    ramp_name, has_bark = FAMILY[family]
    a = np.array(art).astype(np.float32)
    rgb = a[..., :3]
    alpha = a[..., 3]
    # Above 40 rather than above 0: a wispy plate's faintest fringe is mostly
    # anti-aliasing, and letting it set the black point flattens the stretch.
    vis = alpha > 40
    if vis.sum() == 0:
        return art
    lum = rgb @ LUMA
    lo = float(np.percentile(lum[vis], TONE_LO_PCT))
    hi = float(np.percentile(lum[vis], TONE_HI_PCT))
    if hi - lo < 1.0:
        hi = lo + 1.0
    t = np.clip((lum - lo) / (hi - lo), 0, 1) ** TONE_GAMMA

    mapped = _ramp3(t, RAMPS[ramp_name])
    if has_bark:
        # Redder than it is green: a trunk or a branch. The margin keeps the
        # test off pixels where the two channels are within rounding of each
        # other, which is most of the foliage.
        woody = (rgb[..., 0] > rgb[..., 1] + 1.5)[..., None]
        mapped = np.where(woody, _ramp3(t, RAMPS["soil"]), mapped)

    own = np.clip(rgb * (200.0 / max(hi, 1.0)), 0, 255)
    out = mapped * (1.0 - KEEP) + own * KEEP
    return Image.fromarray(np.dstack([np.clip(out, 0, 255), alpha]).astype(np.uint8), "RGBA")


def feather_top(plant: Image.Image) -> Image.Image:
    """Ramps alpha to zero across a cut, so it reads as a growing tip."""
    rows = max(1, round(plant.height * CUT_FEATHER))
    alpha = plant.getchannel("A")
    px = alpha.load()
    for y in range(rows):
        k = (y + 1) / (rows + 1)
        for x in range(plant.width):
            px[x, y] = round(px[x, y] * k)
    plant.putalpha(alpha)
    box = plant.getbbox()
    return plant.crop(box) if box else plant


def plate(name: str, keep: float, family: str) -> Image.Image:
    art = Image.open(SRC / f"{name}.png").convert("RGBA")
    if shadowed(name):
        art = strip_shadow(art)
    art = ramp_map(art, family)
    box = art.getbbox()
    if box:
        art = art.crop(box)
    if keep < 1.0:
        art = art.crop((0, art.height - round(art.height * keep), art.width, art.height))
        box = art.getbbox()
        if box:
            art = art.crop(box)
        art = feather_top(art)
    return art


def fit(art: Image.Image, unit_w: int, unit_h: int) -> Image.Image:
    """Contain inside the box, centred, flush to the bottom edge -- the
    convention every sprite-backed painter here relies on, so scaling about
    the painter's own (0.5, 1) anchor cannot lift a plant off the ground."""
    w, h = unit_w * ART_SCALE, unit_h * ART_SCALE
    k = min(w / art.width, h / art.height)
    scaled = art.resize(
        (max(1, round(art.width * k)), max(1, round(art.height * k))), Image.LANCZOS
    )
    # The canopy plates are only ~200px on their longest side and the boxes
    # above ask for four to five times that, so the sharpening has to grow
    # with the upscale or a tree arrives as a green smudge. Radius tracks k
    # because a fixed 2px radius does nothing to detail that has itself been
    # stretched to 5x -- there is no 2px detail left to find.
    if k > 1.2:
        radius = min(4.0, 1.0 + k * 0.6)
        percent = int(min(170, 80 + k * 20))
        scaled = scaled.filter(
            ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=2)
        )
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((w - scaled.width) // 2, h - scaled.height))
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (src, uw, uh, keep, family) in FRAMES.items():
        art = fit(plate(src, keep, family), uw, uh)
        art.save(OUT / f"{name}.png")
        print(f"{name}.png {art.size}  <- {src} [{family}] keep={keep}")


if __name__ == "__main__":
    main()
