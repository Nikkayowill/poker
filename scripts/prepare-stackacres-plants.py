"""Cut StackAcres' grass tufts and its scrub out of the isometric plant pack.

TWO JOBS, both feeding `stackacres-sprites.ts`:

  grass-tall / grass-mid / grass-stubble
      The Long Meadow's own grass, one sprite per 16-unit tile at whatever
      height the scythe has left it (`meadowDensityAt`). These front the three
      `grassTall`/`grassMid`/`grassStubble` painters in art-zones.ts, so each
      one has to be its painter's box: 14x13, 14x8 and 14x4 art units.

  scrub-* / weed-* / tuft-*
      Scenery. These do NOT replace the farm's existing trees and bushes --
      Kayo's explicit carve-out, those stay exactly as they are -- they are
      new kinds scattered alongside them so the open ground has more in it.

WHY THE THREE MEADOW HEIGHTS ARE ONE PLANT CUT SHORT. The pack renders grass
at one height only. A mown tile is the same grass with the top taken off, so
`keep` cuts a tuft down from its feet and feathers the cut, exactly as the
corn ramp does in prepare-stackacres-crops.py -- and for the same reason:
without the feather, the render's own dark interior leaves a hard horizontal
edge that upscales into a visible bar across the top of every stubble tile.

SHADOWS, and why the obvious test for one does not work here. Several plates
are rendered standing on a baked ground shadow, and every sprite the farm
draws already gets its OWN grounding ellipse from the scene -- so a baked one
ships two shadows stacked and the plant reads as floating over a smudge.

The FLUX crop prep found its baked mound by COLOUR (dark and near-neutral,
where the plant was not). That test is useless on this pack: measured, 92% of
the bush plates' own pixels come back dark-and-near-neutral, because the
bushes themselves are nearly black. What separates the shadow here is ALPHA.
The plant is drawn at alpha 200 and up; the shadow is a flat wash at alpha 9
to 84. So `strip_shadow` drops pixels that are both faint and dark, anywhere
on the plate, and leaves the plant untouched. Plates not in `SHADOWED` are
passed through; the test for a new one is to look at it against a LIGHT
background, where a shadow is obvious and where it is invisible against the
dark preview the pack ships.

Source: isometric-plant-pack (Kayo's supply). `isometric tiles/` holds the
cut-out plates; the loose PNGs at the pack root are the full-size renders they
came from and are not used.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parent.parent
# Not committed -- unzip isometric-plant-pack.zip next to this script to re-run.
SRC = Path(__file__).resolve().parent / "iso" / "isometric tiles"
OUT = REPO / "public" / "stackacres" / "sprites"

ART_SCALE = 8

# name -> (plate, box width, box height in art units, keep).
#
# The three meadow heights come off three DIFFERENT plates rather than one
# plate cut three ways, so the field is not a grid of one silhouette at three
# lengths. The stubble is cut, because no plate in the pack is mown.
FRAMES: dict[str, tuple[str, int, int, float]] = {
    # The Long Meadow, waist-high down to cut.
    "grass-tall": ("grasses02", 14, 13, 1.0),
    "grass-mid": ("grasses04", 14, 8, 1.0),
    "grass-stubble": ("grasses03", 14, 4, 0.34),
    # Scenery. `tuft` is the open world's own grass clump -- ten a chunk, so
    # it is most of what the player actually sees underfoot away from the
    # farm, and it was a drawn three-stroke mark before this.
    "tuft": ("grasses01", 8, 6, 1.0),
    "weed-tall": ("weed01", 14, 11, 1.0),
    "weed-short": ("weed03", 12, 7, 1.0),
    # Scrub. Bigger than a tuft and smaller than the farm's own bushes, which
    # is the size band the open ground had nothing in.
    "scrub-low": ("bush03", 22, 11, 1.0),
    "scrub-round": ("bush02", 16, 13, 1.0),
    "scrub-fan": ("shrub1-01", 26, 24, 1.0),
}

# Plates rendered standing on a baked ground shadow. See the module docstring.
SHADOWED: frozenset[str] = frozenset(
    {"bush02", "bush03", "bush04", "shrub1-01", "shrub2-01", "bigtree01", "bigtree02"}
)

# Plates dark enough to need lifting -- the three bushes, which render close
# to black. Neither the grasses nor the shrub are here: they already carry a
# strong colour, and lifting them washes them out to a pale khaki.
LIFTED: frozenset[str] = frozenset({"bush02", "bush03", "bush04"})

# A pixel counts as baked shadow when it is both this faint and this dark.
# Measured off the pack: plant pixels sit at alpha 200+, the shadow wash at 9
# to 84. The gap is wide, so the threshold is not delicate -- but it does have
# to be an ALPHA threshold and not a colour one; see the module docstring.
SHADOW_ALPHA = 110
SHADOW_VALUE = 120

# How much to lift the scrub plates. The pack renders its bushes almost black,
# which read as holes in the ground against the new lawn rather than as
# plants. Gamma, not a flat add, so the silhouette keeps its shape.
SCRUB_GAMMA = 0.62

CUT_FEATHER = 0.18


def strip_shadow(art: Image.Image) -> Image.Image:
    """Drops the baked ground shadow, wherever on the plate it falls."""
    out = art.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if a <= SHADOW_ALPHA and max(r, g, b) <= SHADOW_VALUE:
                px[x, y] = (r, g, b, 0)
    box = out.getbbox()
    return out.crop(box) if box else out


def lift(art: Image.Image, gamma: float) -> Image.Image:
    """Gamma-lifts a plate. Alpha is left alone -- lifting it fringes every
    leaf edge."""
    table = [min(255, round(255 * (i / 255) ** gamma)) for i in range(256)]
    r, g, b, a = art.split()
    return Image.merge("RGBA", (r.point(table), g.point(table), b.point(table), a))


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


def plate(name: str, keep: float) -> Image.Image:
    art = Image.open(SRC / f"{name}.png").convert("RGBA")
    if name in SHADOWED:
        art = strip_shadow(art)
    if name in LIFTED:
        art = lift(art, SCRUB_GAMMA)
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
    if k > 1.2:
        scaled = scaled.filter(ImageFilter.UnsharpMask(radius=2, percent=90, threshold=2))
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((w - scaled.width) // 2, h - scaled.height))
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (src, uw, uh, keep) in FRAMES.items():
        art = fit(plate(src, keep), uw, uh)
        art.save(OUT / f"{name}.png")
        print(f"{name}.png {art.size}  <- {src} keep={keep}")


if __name__ == "__main__":
    main()
