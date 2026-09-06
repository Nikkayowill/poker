"""Build StackAcres' ground textures out of the isometric terrain tilesets.

WHY A SCRIPT. Same reason `extract-stackacres-tiles.py` is one: the mapping
from a pack's file layout to a game texture is the part that is expensive to
rediscover, and re-running this is how the art gets swapped.

WHAT IT MAKES, and what each one has to satisfy:

  grass-tile.png   512x512, SEAMLESS. `bakeGrass` draws it 2x2 into a
                   1024x1024 canvas and Phaser tiles THAT across a screen-
                   space TileSprite, so a visible seam repeats across the
                   whole map. Built by stamping the pack's 64x32 iso diamonds
                   on their own lattice and wrapping every stamp nine times,
                   which is what makes the wrap exact rather than blurred.

  soil-bed.png     512x256, ONE tilled bed, not a texture. A soil bed is a
                   64-unit world square, and `isoProject` sends any square to
                   a diamond twice as wide as it is tall, so the bed is a
                   128x64 screen diamond and this is that diamond at 4x. It
                   is drawn as a single image per bed rather than a masked
                   repeating texture: at bed size a repeat has nothing to
                   repeat, and drawing it whole is what lets the furrows land
                   exactly on `soilFurrowOffsets()` -- the lines the plants
                   actually stand on. Furrows that disagree with the rows are
                   worse than no furrows.

  water-tile.png   256x256, SEAMLESS. The pond's surface grain, and ONLY the
                   grain. The pond is a hand-drawn ellipse with a sand ring,
                   a gradient, a bank shadow and glints (art-water.ts), and
                   the pack's water is a square-diamond COASTLINE set -- laying
                   those over an ellipse would replace a smooth shore with a
                   stair-stepped one, which is worse art, not newer art. So
                   the shore stays drawn and this supplies what the drawn
                   version has none of: actual water texture under the
                   gradient, in the same lattice and at the same density as
                   the lawn it sits in.

SOURCES. Both packs are Kayo's own supply, unzipped next to this script:

  Tiles/           64x64 isometric terrain diamonds (grass x6, beach,
                   shallow, deep, and the transition sets). The diamond's
                   base is 64x32 sitting at y=30 inside the 64x64 frame --
                   BASE_TOP below -- with grass blades overhanging above it.
                   That overhang is the whole reason the stamps are wrapped:
                   a blade that runs off the top of the texture has to come
                   back on the bottom.

The soil ramp is StackAcres' own (`art-palette.ts`'s RAMPS.soil), not the
pack's: the beach tile supplies the GRAIN and the palette supplies the
COLOUR, so a bed still sits in the farm's own paint rather than importing a
second, unrelated one.
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

REPO = Path(__file__).resolve().parent.parent
# Not committed -- unzip Tiles.zip next to this script to re-run.
SRC = Path(__file__).resolve().parent / "Tiles" / "Tiles"
OUT = REPO / "public" / "stackacres" / "sprites"

# The diamond's own geometry inside the pack's 64x64 frame. Measured off the
# beach tile, which has no overhang: its alpha bbox is 64x33+0+30.
TILE_W, TILE_H = 64, 32
BASE_TOP = 30

GRASS_SETS = [f"ts_grass{i}" for i in range(6)]


def plate(name: str, facing: str = "45") -> Image.Image:
    return Image.open(SRC / name / "straight" / facing / "0.png").convert("RGBA")


def lattice(
    size: int,
    stamps: list[Image.Image],
    seed: int,
    scale: int = 1,
) -> Image.Image:
    """Stamp diamonds on the iso lattice, filling `size` square, seamlessly.

    The lattice is the diamond's own tiling: every other row is offset half a
    diamond, so the period is one diamond wide and half a diamond tall. That
    period has to divide `size` exactly or the texture cannot wrap -- asserted
    rather than rounded, because a lattice one pixel off tiles into a diagonal
    seam that is easy to miss in a preview and impossible to miss on a phone.

    TWO THINGS MAKE THE WRAP EXACT, and the first one alone is not enough.

    First, the field is PERIODIC: which variant lands on a cell is chosen from
    the cell's coordinates taken modulo the period, not rolled fresh, so the
    infinite field genuinely repeats every `size` pixels rather than merely
    lining up geometrically.

    Second, it is drawn in STRICT PAINTER ORDER across a 3x3 block of periods
    and the centre one is cropped out. This is the part that was learned the
    hard way: stamping one period and compositing each stamp nine times at
    wrapped offsets lines the geometry up perfectly but layers it wrongly at
    the boundary -- each diamond is cut with a dark soil rim along its bottom
    edge, and every row is supposed to be covered by the blades of the row
    below it. At the wrap, the covering row is composited BEFORE the row it
    should cover, so exactly one lattice row keeps its rim and the finished
    lawn carries a dark zigzag straight across it.
    """
    dw, dh = TILE_W * scale, TILE_H * scale
    step = dh // 2
    assert size % dw == 0 and size % step == 0, (
        f"{size} is not a whole number of {dw}x{step} lattice periods"
    )
    cols, rows = size // dw, size // step
    # Row parity has to survive the modulo or the half-diamond offset flips at
    # the seam, so an odd row count would break the wrap on its own.
    assert rows % 2 == 0, f"{rows} lattice rows is odd; the stagger cannot wrap"

    rng = random.Random(seed)
    pick = [[rng.randrange(len(stamps)) for _ in range(cols)] for _ in range(rows)]

    art = stamps
    if scale != 1:
        art = [s.resize((s.width * scale, s.height * scale), Image.NEAREST) for s in stamps]

    big = Image.new("RGBA", (size * 3, size * 3), (0, 0, 0, 0))
    # One extra row and column past each edge: a stamp is anchored by its base
    # and its frame reaches above and to the left of that.
    for row in range(-1, rows * 3 + 1):
        for col in range(-1, cols * 3 + 1):
            x = col * dw + (dw // 2 if row % 2 else 0)
            y = row * step - BASE_TOP * scale
            big.alpha_composite(art[pick[row % rows][col % cols]], (x, y))
    return big.crop((size, size, size * 2, size * 2))


# How many source pixels one lattice diamond is drawn at. The pack's own 64px
# diamond is 16 scene units of lawn once `bakeGrass` and the TileSprite's
# 1/GRASS_PX tile scale are through with it, and at that density the blades
# land under one device pixel each on a phone and the whole field resolves to
# flat green static. Doubling puts a clump at ~32 units, which is the coarsest
# the pack survives: at 4x the soil showing between blades starts reading as
# dirt rather than as grass.
GRASS_SCALE = 2


def build_grass(size: int = 512, scale: int = GRASS_SCALE) -> Image.Image:
    """The open lawn. Every variant in the pack is in the mix, so the field
    does not read as one clump stamped in rows."""
    field = lattice(size, [plate(s) for s in GRASS_SETS], seed=20260906, scale=scale)
    # The pack's diamonds are cut with a hard alpha edge and a dark soil rim
    # underneath. Tiled edge-to-edge those rims line up into a faint grid, so
    # a flat bed of the grass's own mid-tone goes underneath: it fills the
    # sub-pixel gaps without lightening the blades themselves.
    bed = Image.new("RGBA", (size, size), (74, 106, 52, 255))
    bed.alpha_composite(field)
    return bed


# StackAcres' own soil ramp (`art-palette.ts`'s RAMPS.soil), not the pack's.
# The beach diamond supplies the GRAIN and the palette supplies the COLOUR, so
# a bed still sits in the farm's own paint rather than importing a second,
# unrelated one alongside it.
SOIL_TOP = (200, 144, 88)
SOIL_SIDE = (168, 112, 56)
SOIL_RIM = (126, 81, 39)

# Mirrors lib/stackacres/soil.ts. A bed is SOIL_TILE world units square, tilled
# into SOIL_FURROW_ROWS furrows at SOIL_ROW_PITCH intervals, and the plants
# stand ON those lines -- so the art has to put its furrows at exactly the
# offsets `soilFurrowOffsets()` returns, or every row of plants floats between
# two ridges. Held to that file by soil.test.ts on the TypeScript side; there
# is no import across the language boundary, so these are restated and the
# scene asserts the resulting image is the size it expects.
SOIL_TILE = 64
SOIL_FURROW_ROWS = 3
SOIL_ROW_PITCH = SOIL_TILE / (SOIL_FURROW_ROWS + 1)
# Device pixels per world unit in the finished bed. 4 is `ART_SCALE`, which is
# what every other baked sprite in the farm uses, so a bed and a barn are
# sampled at the same density.
SOIL_PX = 4


def tint(art: Image.Image, top: tuple[int, int, int]) -> Image.Image:
    """Recolours a plate to a target hue while keeping its own light and dark.

    Multiply, not replace: the beach tile's value structure IS the grain --
    the scattered darker specks are what stop a bed reading as a flat brown
    lozenge -- so the luminance is kept and only the hue is moved.
    """
    grey = art.convert("L")
    out = Image.new("RGBA", art.size)
    px, gp, ap = out.load(), grey.load(), art.load()
    for y in range(art.height):
        for x in range(art.width):
            a = ap[x, y][3]
            if a == 0:
                continue
            k = gp[x, y] / 200.0
            px[x, y] = (
                min(255, int(top[0] * k)),
                min(255, int(top[1] * k)),
                min(255, int(top[2] * k)),
                a,
            )
    return out


def build_soil_bed() -> Image.Image:
    """One tilled bed: the 128x64 screen diamond a 64-unit world square
    projects to, at SOIL_PX device pixels per unit.

    Drawn whole rather than tiled and masked, which is what the district-sized
    field it replaces did. At bed size a repeating texture has nothing left to
    repeat, and drawing the diamond outright is what lets the furrows land on
    `soilFurrowOffsets()` exactly instead of wherever a tile scale happened to
    put them.
    """
    s = SOIL_PX
    w, h = SOIL_TILE * 2 * s, SOIL_TILE * s
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    def screen(wx: float, wy: float) -> tuple[float, float]:
        """World point inside the tile -> pixel in this image. `isoProject`
        with the origin moved to the diamond's own west corner."""
        return ((wx - wy) * s + w / 2, (wx + wy) / 2 * s)

    # The bed itself: the beach plate tinted to soil, stamped on the same
    # lattice as the lawn so a bed and the grass around it share one grain,
    # then clipped to the diamond. Sixteen source diamonds fill a bed.
    grain = lattice(w, [tint(plate("ts_beach0"), SOIL_TOP)], seed=20260907, scale=2)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(
        [screen(0, 0), screen(SOIL_TILE, 0), screen(SOIL_TILE, SOIL_TILE), screen(0, SOIL_TILE)],
        fill=255,
    )
    bed = Image.new("RGBA", (w, h), SOIL_TOP + (255,))
    bed.alpha_composite(grain.crop((0, 0, w, h)))
    # Clods. The beach plate's own grain survives the tint but is far too
    # even to read as broken earth on its own -- a bed without this is a flat
    # brown lozenge. Deterministic, so re-running does not reshuffle the
    # farm's ground.
    #
    # Composited as its own layer rather than drawn onto `bed` directly:
    # ImageDraw WRITES pixels, alpha included, so a translucent fill straight
    # onto the bed punches a hole in it instead of tinting it, and the bed
    # then shows whatever is behind. That version read as gravel spattered
    # over the field.
    clods = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pen = ImageDraw.Draw(clods)
    rng = random.Random(20260908)
    for _ in range(w * h // 900):
        cx, cy = rng.randrange(w), rng.randrange(h)
        r = rng.uniform(0.6, 2.0) * s / 2
        dark = rng.random() < 0.55
        tone = SOIL_SIDE if dark else (226, 180, 124)
        pen.ellipse(
            [cx - r, cy - r * 0.62, cx + r, cy + r * 0.62],
            fill=tone + (rng.randrange(24, 52),),
        )
    bed.alpha_composite(clods)
    out.paste(bed, (0, 0), mask)

    # Furrows: a shadowed trench with a lit ridge above it, on the lines the
    # plants stand on. Drawn onto a separate layer and masked to the diamond
    # so a stroke's round cap cannot spill past the bed's own edge.
    lines = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pen = ImageDraw.Draw(lines)
    for row in range(SOIL_FURROW_ROWS):
        dy = (row + 1) * SOIL_ROW_PITCH
        a, b = screen(0, dy), screen(SOIL_TILE, dy)
        pen.line([a, b], fill=SOIL_RIM + (150,), width=max(2, s))
        pen.line(
            [(a[0], a[1] - s * 0.9), (b[0], b[1] - s * 0.9)],
            fill=(226, 180, 124, 110),
            width=max(1, s // 2),
        )
    lines = lines.filter(ImageFilter.GaussianBlur(s * 0.35))
    out.alpha_composite(Image.composite(lines, Image.new("RGBA", (w, h), (0, 0, 0, 0)), mask))

    # The rim, so a bed the player placed reads as a bed and not as a stain.
    edge = ImageDraw.Draw(out)
    edge.polygon(
        [screen(0, 0), screen(SOIL_TILE, 0), screen(SOIL_TILE, SOIL_TILE), screen(0, SOIL_TILE)],
        outline=SOIL_RIM + (220,),
        width=max(1, s // 2),
    )
    return out


def build_water(size: int = 256) -> Image.Image:
    """The pond's surface, seamless, at the lawn's own lattice density.

    Both depths in the mix. The pack ships `ts_deep0` as a 640x320 strip of
    animation frames rather than as one plate -- the pond does not animate its
    fill, so the first frame is taken and the rest ignored.
    """
    deep = plate("ts_deep0").crop((0, 0, TILE_W, 64))
    stamps = [plate("ts_shallow0"), deep, deep]
    field = lattice(size, stamps, seed=20260909, scale=GRASS_SCALE)
    bed = Image.new("RGBA", (size, size), (58, 116, 138, 255))
    bed.alpha_composite(field)
    return bed


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    grass = build_grass()
    grass.save(OUT / "grass-tile.png")
    print(f"grass-tile.png {grass.size}")
    bed = build_soil_bed()
    bed.save(OUT / "soil-bed.png")
    print(f"soil-bed.png {bed.size}")
    water = build_water()
    water.save(OUT / "water-tile.png")
    print(f"water-tile.png {water.size}")


if __name__ == "__main__":
    main()
