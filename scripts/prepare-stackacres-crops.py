"""Cut the six crop growth frames out of the isometric crop pack.

WHAT A FRAME HAS TO BE. `stackacres-art.ts` fronts each of the six crop
painters with a PNG of the same box (`spriteBacked`): carrot frames are a
12x16 art-unit box, corn frames 12x22, baked at ART_SCALE 8. Every frame is
fitted to its box HEIGHT and pasted flush to the canvas's own bottom edge,
which is the convention that lets `FOOT_INSET` in lib/stackacres/crop-visuals.ts
stay all-zero: the ink starts exactly at the box's bottom edge, so scaling a
frame about its (0.5, 1) anchor cannot float it off the soil.

Growth is `cropSpriteScale`'s job (1.6x / 2.5x / 4x), not this script's -- so
every frame fills its box and the three read as one plant getting bigger
because their SILHOUETTES differ, not because the art is pre-scaled. Pre-
scaling here would multiply against that ladder and make a seedling vanish.

WHY THESE PARTICULAR PLANTS. The pack renders twelve crops as rows of single
plants, and the two the game needs are fixed by the ECONOMY, not by taste:
`STACKACRES_ITEMS` in lib/stackacres/items.ts pays a Sprout Row in Carrots and
a Cash Crop in Corn, those item ids are stored, and the museum and the town
contracts both name them. So the ripe frame of each has to be the pack's own
carrot and its own corn. The two younger frames borrow neighbouring plants
from the same sheet that share the register and differ in shape -- a small
leaf rosette and then the real carrot; a young cone and then the real corn
spike. Six genuinely different renders, which is the same trade the trees and
the FLUX crops before them made: a PNG cannot be recoloured, so the variety
has to be in the art.

BAND MAP. The sheet is one row per crop with no labels, so the rows were
matched to the pack's own per-crop files by mean colour -- every match below
came back under 4.0 in RGB distance except the two lettuces, which are told
apart by height. Re-derive it rather than trusting it if the pack changes.

Source: hjm-all_crops_in_lines.png (Kayo's supply), 1600x1200.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parent.parent
# Not committed -- drop the sheet next to this script to re-run.
SRC = Path(__file__).resolve().parent / "hjm-all_crops_in_lines.png"
OUT = REPO / "public" / "stackacres" / "sprites"

ART_SCALE = 8

# Row bands in the sheet, top to bottom, with what each one is. Found by
# scanning for rows that carry any ink; kept as literals so a re-run does not
# silently re-segment a sheet somebody has edited.
BANDS: dict[str, tuple[int, int]] = {
    "carrots": (45, 69),
    "potatoes": (132, 160),
    "pumpkins": (215, 263),
    "tomatoes-v2": (266, 339),
    "tomatoes": (360, 429),
    "wheat": (484, 518),
    "corn": (532, 609),
    "leafy_lettuce": (687, 699),
    "round_lettuce": (776, 790),
    "red_cabbage": (865, 880),
    "pointy_cabbage": (948, 971),
    "green_cabbage_a": (1045, 1061),
    "green_cabbage_b": (1135, 1151),
}

# How many specimens are stood together to make one frame.
#
# Corn only, and it is the difference between the frame reading as a plant and
# reading as a wisp of smoke. The pack's corn is a single stalk 16 pixels wide
# and 75 tall; contained in a 12x22 box that is 39 pixels of ink in a 96-pixel
# frame, and once the scene draws the ripe frame at 4x it is a hairline of
# sparse, gappy foliage about ten world units wide and ninety tall. Standing
# three stalks shoulder to shoulder fills the box, closes the gaps, and is
# also just what corn does -- it grows in a stand, not as a lone spike. The
# same reason the pack's own grass plates are several blades per tile.
#
# The cabbages need none of this: they are solid, roughly square, and fill
# their box on their own.
CLUMP: dict[str, int] = {"corn0": 3, "corn1": 3, "corn2": 3}

# frame -> (band, box width, box height in art units, keep).
#
# `keep` is the fraction of the plant's HEIGHT to keep, measured up from its
# feet. It exists for corn and only for corn: the sheet renders corn as a
# single mature spike with no younger version, every one of its thirty
# specimens between 61 and 75 pixels tall, so the younger stalks have to be
# cut out of full ones. That is not a fudge -- a corn plant genuinely IS its
# own lower half earlier in the season -- and it keeps all three corn frames
# the same plant, which is better than the ramp reached for first (a cabbage
# standing in for young corn, which rendered blue-grey and read as a stone).
#
# The seedling and the half-grown frame are deliberately NOT the ripe plant
# shrunk. A carrot's growth is its top opening out and a corn's is its stalk
# going up, and those are different silhouettes -- the only channel a three-
# frame ramp has once the palette is fixed by the render.
#
# NEITHER RIPE FRAME IS THE PACK'S ROW OF THE SAME NAME, and both departures
# are for the same reason. The pack renders its carrots and its potatoes as
# 8-10 pixel scribbles that are more gap than plant; upscaled into a 12-unit
# box they read as a smear, which is the worst thing to have in the frame the
# player is waiting for. The leaf-vegetable rows are the same crop as far as
# this game is concerned -- the leafy top of a row crop, grown in rows -- and
# they have enough ink to survive the upscale. Nothing user-facing calls a
# Sprout Row a cabbage: the yield is still the `carrot` item, because that id
# is stored and priced (lib/stackacres/items.ts).
#
# The Sprout Row's three frames are a flat sprout, a small head and a full
# head: one silhouette opening out. The Cash Crop's three are all the SAME
# corn plant at three heights, which is why `keep` exists.
FRAMES: dict[str, tuple[str, int, int, float]] = {
    "carrot0": ("leafy_lettuce", 12, 16, 1.0),
    "carrot1": ("round_lettuce", 12, 16, 1.0),
    "carrot2": ("green_cabbage_b", 12, 16, 1.0),
    "corn0": ("corn", 12, 22, 0.20),
    "corn1": ("corn", 12, 22, 0.48),
    "corn2": ("corn", 12, 22, 1.0),
}

# Which specimen along the row to take. The rows hold 30-76 copies of the same
# plant at slightly different rolls; picking a fixed index rather than the
# first keeps a frame away from a row's end, where a plant can be clipped by
# the sheet's own edge. The two corn frames take different specimens so the
# half-grown stalk is not literally the ripe one with its head cut off.
SPECIMEN: dict[str, int] = {
    "carrot0": 5,
    "carrot1": 26,
    "carrot2": 7,
    "corn0": 22,
    "corn1": 16,
    "corn2": 8,
}

# How much to lift the renders before they are fitted.
#
# The pack is lit flat and dark -- the crop rows average around RGB (45, 65,
# 26) -- which was fine against the black it was rendered on and is not fine
# standing on a tilled bed at RGB (200, 144, 88). Without this the ripe frames
# read as dark smudges on bright earth. A gamma lift rather than a flat
# brightness add, so the leaves open up without the darkest pixels (which are
# the plant's own form) washing out to grey.
CROP_GAMMA = 0.72

# Minimum run of ink-bearing columns that counts as a plant rather than as a
# stray antialiased pixel between two of them.
MIN_SPECIMEN_PX = 4


def specimens(sheet: Image.Image, band: tuple[int, int]) -> list[tuple[int, int]]:
    """Column runs holding a plant, left to right, for one row band."""
    y0, y1 = band
    strip = sheet.crop((0, y0, sheet.width, y1 + 1))
    alpha = strip.getchannel("A")
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x in range(strip.width):
        # A column is inked if anything in it is more than faintly opaque.
        inked = alpha.crop((x, 0, x + 1, strip.height)).getextrema()[1] > 24
        if inked and start is None:
            start = x
        elif not inked and start is not None:
            if x - start >= MIN_SPECIMEN_PX:
                runs.append((start, x - 1))
            start = None
    if start is not None:
        runs.append((start, strip.width - 1))
    return runs


def cut(sheet: Image.Image, band: tuple[int, int], index: int, keep: float = 1.0) -> Image.Image:
    runs = specimens(sheet, band)
    if not runs:
        raise SystemExit(f"no specimens found in band {band}")
    x0, x1 = runs[index % len(runs)]
    y0, y1 = band
    plant = sheet.crop((x0, y0, x1 + 1, y1 + 1))
    # Trim to the plant's own ink: the band's height is the whole ROW's
    # tallest specimen, and a short one would otherwise be pasted with dead
    # space under it and float above the soil.
    box = plant.getbbox()
    if box:
        plant = plant.crop(box)
    if keep < 1.0:
        # Kept from the FEET up, so what is thrown away is the top of the
        # stalk rather than its base.
        plant = plant.crop((0, plant.height - round(plant.height * keep), plant.width, plant.height))
        box = plant.getbbox()
        if box:
            plant = plant.crop(box)
        plant = feather_top(plant)
    return plant


# How much of a cut plant's height is faded out at the cut.
#
# Without this a cut leaves a hard horizontal edge straight across the stalk,
# and because the render carries a dark halo around its own foliage, that edge
# upscales into a visible dark RECTANGLE sitting on top of the plant -- the
# single most obvious defect in the first corn ramp. Fading the cut turns it
# into a growing tip. Kept small: fade too much and the stalk tapers to
# nothing and stops reading as cut off at all.
CUT_FEATHER = 0.18


def feather_top(plant: Image.Image) -> Image.Image:
    """Ramps alpha to zero across the top of a cut plant, so the cut reads as
    a growing tip rather than as a sliced edge."""
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


def clump(plants: list[Image.Image]) -> Image.Image:
    """Stands several specimens side by side as one plant.

    Overlapped by a third of a stalk's width and staggered in depth -- the
    outer two are dropped a couple of pixels and drawn FIRST, so the middle
    one reads as nearest. Bottom-aligned, because they are all standing on the
    same ground.
    """
    if len(plants) == 1:
        return plants[0]
    step = max(1, round(min(p.width for p in plants) * 0.66))
    width = step * (len(plants) - 1) + max(p.width for p in plants)
    height = max(p.height for p in plants) + 2
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    middle = len(plants) // 2
    order = [i for i in range(len(plants)) if i != middle] + [middle]
    for i in order:
        art = plants[i]
        drop = 0 if i == middle else 2
        out.alpha_composite(art, (i * step, height - art.height - (2 - drop)))
    box = out.getbbox()
    return out.crop(box) if box else out


def lift(plant: Image.Image) -> Image.Image:
    """Gamma-lifts the render so it reads against tilled soil. Alpha is left
    exactly alone -- lifting it would fringe every leaf edge."""
    table = [min(255, round(255 * (i / 255) ** CROP_GAMMA)) for i in range(256)]
    r, g, b, a = plant.split()
    return Image.merge(
        "RGBA", (r.point(table), g.point(table), b.point(table), a)
    )


def fit(plant: Image.Image, unit_w: int, unit_h: int) -> Image.Image:
    """Fit inside the box, centred, flush to the bottom edge.

    CONTAIN, not fit-to-height, which is where the tree and FLUX-crop prep
    scripts this otherwise follows had it easier. Those sources were all
    roughly the same aspect, so fitting them to the box height filled the box
    and nothing else happened. These are not: a seedling off this sheet is 15
    by 9 pixels and its ripe frame is 10 by 21, so height-fitting the seedling
    scales it 14x -- half again wider than its own box and a smear at that
    magnification.

    Containing costs nothing the ramp needs and gives it something. The
    seedling ends up occupying about half its box's height, so the natural
    size difference between the three renders SURVIVES into the game and adds
    itself to `cropSpriteScale`'s 1.6/2.5/4 ladder rather than being flattened
    out before it gets there. It also caps the upscale at what the widest
    frame needs, around 6x, instead of 14.

    Bottom-flush either way, which is the part `FOOT_INSET` depends on: the
    ink starts at the box's bottom edge, so scaling about the painter's own
    (0.5, 1) anchor cannot lift a plant off the soil.
    """
    w, h = unit_w * ART_SCALE, unit_h * ART_SCALE
    k = min(w / plant.width, h / plant.height)
    scaled = plant.resize(
        (max(1, round(plant.width * k)), max(1, round(plant.height * k))), Image.LANCZOS
    )
    # LANCZOS at 6x leaves these soft enough to read as out of focus next to
    # the terrain tiles, which are shown near their own native density. A
    # single unsharp pass buys the edge back without the stair-stepping a
    # nearest-neighbour upscale would put on curved leaves.
    scaled = scaled.filter(ImageFilter.UnsharpMask(radius=2, percent=110, threshold=2))
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((w - scaled.width) // 2, h - scaled.height))
    return canvas


def main() -> None:
    sheet = Image.open(SRC).convert("RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (band, uw, uh, keep) in FRAMES.items():
        count = CLUMP.get(name, 1)
        # Consecutive specimens, so a clump is three different stalks rather
        # than one stalk stamped three times.
        stalks = [
            lift(cut(sheet, BANDS[band], SPECIMEN[name] + i, keep)) for i in range(count)
        ]
        plant = clump(stalks)
        art = fit(plant, uw, uh)
        art.save(OUT / f"{name}.png")
        print(f"{name}.png {art.size}  <- {band}[{SPECIMEN[name]}]x{count} {plant.size}")


if __name__ == "__main__":
    main()
