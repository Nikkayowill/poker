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

  terrain-atlas.png 512x640, an 8x10 grid of the pack's 64x64 frames, in the
                   order lib/stackacres/terrain.ts's `terrainFrame` expects
                   (`build_atlas` below is that order). Five material pairs,
                   twelve transition frames each (straight, curve_in and
                   curve_out at the four rotations) plus four plain plates of
                   the pair's higher material: grass-beach, beach-shallow,
                   shallow-deep, grass-dirt -- the grass-beach set again with
                   its sand tinted to the farm's road tan, so the dirt roads
                   and the barn yard are cut from the same cloth as the shore
                   -- and grass-cobble, that dirt set again with its earth
                   paved over (`cobble_frames`). The scene draws these 1:1
                   into per-chunk canvases (art-terrain.ts), so nothing here
                   is resampled.

                   The grass-bearing frames have their soil rim erased: in
                   the pack every diamond carries a dark 1-2 px rim along its
                   two lower edges, meant to be hidden by the next row's
                   blades. In the lawn it is (see `lattice`); a coast tile is
                   drawn OVER the lawn with no row of its own below it, so the
                   rim would stand as a dark zigzag along every grass edge.
                   Only the grass side is touched -- sand has no rim.

  deep-tile.png    512x512, SEAMLESS. Open sea: the scene lays it as a grid
                   of plain images east of the coast tiles (art-terrain.ts),
                   128 screen units each at the lawn's density, so it is
                   made big to keep that grid short. The pack ships
                   `ts_deep0` as one 640x320 diamond rather than a 64x64
                   plate, so four 64x32 sub-diamonds are cut from its middle
                   and stamped on the lawn's lattice like the grass is.

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
second, unrelated one. The cobbles are the farm's own paint outright.

RUNNING IT. `python3 scripts/prepare-stackacres-terrain.py` rebuilds all four
files and needs the packs. `--cobble` rebuilds only the atlas's paving, off
the atlas already in the repo, and needs nothing unzipped.
"""

from __future__ import annotations

import random
import sys
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


ROTATIONS = ("45", "135", "225", "315")

# The road tan the dirt frames are tinted to. `tint` keeps the beach plate's
# own light and dark and only moves the hue, the same as the soil bed; this
# lands the plate's mean sand at about (212, 167, 104), a shade warmer and
# darker than the shore so a road and a beach never read as the same ground.
DIRT_TOP = (236, 186, 116)


def diamond_mask() -> Image.Image:
    """The 64x32 base diamond of a frame, at BASE_TOP, as an L mask."""
    mask = Image.new("L", (TILE_W, 64), 0)
    ImageDraw.Draw(mask).polygon(
        [(TILE_W // 2, BASE_TOP), (TILE_W - 1, BASE_TOP + TILE_H // 2), (TILE_W // 2, BASE_TOP + TILE_H), (0, BASE_TOP + TILE_H // 2)],
        fill=255,
    )
    return mask


def deep_plates() -> list[Image.Image]:
    """Four 64x64 frames cut from the middle of the pack's one big deep
    diamond, each masked to the standard base diamond so it stamps exactly
    like every other plate."""
    big = plate("ts_deep0")
    mask = diamond_mask()
    out = []
    for x0, y0 in ((224, 112), (288, 144), (352, 128), (256, 160)):
        frame = Image.new("RGBA", (TILE_W, 64), (0, 0, 0, 0))
        frame.paste(big.crop((x0, y0, x0 + TILE_W, y0 + TILE_H)), (0, BASE_TOP))
        frame.putalpha(mask)
        out.append(frame)
    return out


def erase_grass_rim(frame: Image.Image) -> Image.Image:
    """Clears the pack's dark soil rim from a grass-bearing frame.

    The rim sits two to four pixels above each lower edge of the diamond and
    is the one dark, red-over-green colour in the frame: the grass itself is
    green-dominant and the sand is bright. So the test is by colour, inside a
    six-pixel band above the two lower edges, which leaves a sand edge (no
    rim, bright) exactly as it was.
    """
    out = frame.copy()
    px = out.load()
    for x in range(TILE_W):
        # y of the lower edge at this column: the SW edge on the left half,
        # the SE edge on the right, both rising toward the tips.
        edge = BASE_TOP + TILE_H // 2 + (x // 2 if x < TILE_W // 2 else (TILE_W - 1 - x) // 2)
        for y in range(max(0, edge - 6), min(64, edge + 1)):
            r, g, b, a = px[x, y]
            if a and r > g and r < 110 and b < 70:
                px[x, y] = (0, 0, 0, 0)
    return out


def tint_sand(frame: Image.Image, top: tuple[int, int, int]) -> Image.Image:
    """`tint`, applied to the sand pixels only: anything bright and
    red-over-green. The grass half of a grass-beach frame is left alone."""
    out = frame.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0 or r <= g or r < 120:
                continue
            k = (r * 299 + g * 587 + b * 114) / 1000 / 200.0
            px[x, y] = (min(255, int(top[0] * k)), min(255, int(top[1] * k)), min(255, int(top[2] * k)), a)
    return out


# ---- the cobbled roads ------------------------------------------------------
#
# A main road is paved (lib/stackacres/paths.ts's `surface`) and its sixteen
# frames are the grass-dirt set with the dirt swapped for stone: the same
# diamonds, the same grass edge, and the same worn tan fringe where the two
# blend, so a cobbled road meets the lawn exactly as a dirt one does and
# joins a dirt road without a seam of its own.
#
# THE STONES ARE LAID IN WORLD SPACE, and the pattern repeats every cell --
# CELL units, one diamond. That period is the whole trick: every frame, the
# four plates and all twelve transitions, is cut from one infinite field at
# one phase, so a stone running off the edge of any tile is picked up by
# whatever tile lies beside it. It is also why the four plate "variants"
# lib/stackacres/terrain.ts asks for are the same picture here -- varying
# them is precisely what would break that.

# StackAcres' own stone ramp (`art-palette.ts`'s RAMPS.stone), spread wider:
# at nine device pixels a stone the difference between one cobble and the
# next has to be its COLOUR, since there is no room to shade one.
COBBLE_DARK = (118, 115, 108)
COBBLE_LIGHT = (186, 183, 174)
# The shaded underside every stone is set into, and what shows in the joints:
# the road's own tan, well darkened. Grit, not mortar -- this is stone set
# into a farm track, not a city pavement.
COBBLE_SEAT = (88, 85, 79)
COBBLE_JOINT = (78, 63, 47)

# Mirrors lib/stackacres/terrain.ts's TERRAIN_CELL. One frame diamond is one
# cell, so this is the paving's period in world units.
CELL = 16
# World units between stone centres before jitter. Four across a cell puts
# eight across a 32-unit grid road, which is chunky enough to still read as
# stone on a phone, where the whole bake is halved.
STONE_PITCH = 4.0
# How much of the pitch a stone's radius takes. Just over half, so
# neighbours touch and the joint is the seat showing between them rather
# than a gap of ground.
STONE_RADIUS = 0.55
# Copies of the period laid either side, enough to cover a whole frame.
COBBLE_REPEATS = (-2 * CELL, -CELL, 0, CELL, 2 * CELL)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
    )


def cell_screen(wx: float, wy: float) -> tuple[float, float]:
    """A world point in a cell's own frame -> its pixel in that cell's 64x64
    frame. `isoProject` with the origin on the diamond's north tip: a cell is
    CELL units square and its diamond is TILE_W x TILE_H at BASE_TOP, which
    is two pixels per unit."""
    return ((wx - wy) * 2 + TILE_W / 2, (wx + wy) + BASE_TOP)


def cobble_stones(seed: int = 20260909) -> list[dict[str, float | bool]]:
    """One period of paving: a jittered lattice of stones, every other row
    shifted half a pitch so the courses stagger like laid stone instead of
    lining up into a grid."""
    n = round(CELL / STONE_PITCH)
    pitch = CELL / n
    rng = random.Random(seed)
    stones: list[dict[str, float | bool]] = []
    for row in range(n):
        for col in range(n):
            x = (col + 0.5 + rng.uniform(-0.22, 0.22)) * pitch + (pitch / 2 if row % 2 else 0)
            stones.append({
                "x": x % CELL,
                "y": (row + 0.5 + rng.uniform(-0.22, 0.22)) * pitch,
                "size": rng.uniform(0.82, 1.10),
                "tone": rng.random(),
                # A few stones are warmer or plainly darker than the rest,
                # which is what stops the paving reading as one grey sheet.
                "warm": rng.random() < 0.30,
                "dark": rng.random() < 0.15,
            })
    return stones


def cobble_field(seed: int = 20260909) -> Image.Image:
    """The paving over a whole 64x64 frame, ready to be masked to whatever
    part of a diamond is road. Drawn back to front across the copies of the
    period so a stone in front overlaps the seat of the one behind it."""
    art = Image.new("RGBA", (TILE_W, 64), COBBLE_JOINT + (255,))
    pen = ImageDraw.Draw(art)
    placed = [
        (stone, dx, dy)
        for stone in cobble_stones(seed)
        for dx in COBBLE_REPEATS
        for dy in COBBLE_REPEATS
    ]
    placed.sort(key=lambda p: (p[0]["x"] + p[1]) + (p[0]["y"] + p[2]))
    for stone, dx, dy in placed:
        cx, cy = cell_screen(stone["x"] + dx, stone["y"] + dy)
        # A world circle projects to an ellipse twice as wide as it is tall.
        r = STONE_PITCH * STONE_RADIUS * stone["size"]
        rx, ry = r * 2.83, r * 1.41
        face = mix(COBBLE_DARK, COBBLE_LIGHT, stone["tone"])
        if stone["warm"]:
            face = mix(face, (158, 134, 104), 0.32)
        if stone["dark"]:
            face = mix(face, (74, 72, 68), 0.45)
        pen.ellipse([cx - rx, cy - ry + 0.9, cx + rx, cy + ry + 0.9], fill=COBBLE_SEAT + (255,))
        pen.ellipse(
            [cx - rx * 0.92, cy - ry * 0.92 - 0.3, cx + rx * 0.92, cy + ry * 0.92 - 0.3],
            fill=face + (255,),
        )
    return art


def pave(frame: Image.Image, field: Image.Image) -> Image.Image:
    """One grass-dirt frame with its dirt paved over.

    The dirt is the bright, red-over-green half of the frame -- `tint_sand`'s
    own test, run again on what it produced. Everything else is left exactly
    as it was: the grass, its blades, and the pixels along the boundary where
    the two are blended, which stay as a thin tan verge between the stone and
    the lawn.
    """
    mask = Image.new("L", frame.size, 0)
    mp, fp = mask.load(), frame.load()
    for y in range(frame.height):
        for x in range(frame.width):
            r, g, b, a = fp[x, y]
            if a and r > g and r >= 120:
                mp[x, y] = a
    out = frame.copy()
    out.paste(field, (0, 0), mask)
    return out


def cobble_frames(dirt: list[Image.Image]) -> list[Image.Image]:
    """The grass-cobble block: the sixteen grass-dirt frames, paved."""
    field = cobble_field()
    return [pave(frame, field) for frame in dirt]


def transition_frames(pair: str) -> list[Image.Image]:
    """The pair's twelve transition frames, in atlas order: straight at the
    four rotations, then curve_in, then curve_out."""
    return [
        Image.open(SRC / pair / shape / rot / "0.png").convert("RGBA")
        for shape in ("straight", "curve_in", "curve_out")
        for rot in ROTATIONS
    ]


def base_frames(name: str) -> list[Image.Image]:
    return [plate(name, rot) for rot in ROTATIONS]


# How many material pairs the atlas holds, and so how many rows: pair p
# takes rows 2p and 2p+1. lib/stackacres/terrain.ts's PAIR_ constants are
# the same order.
ATLAS_PAIRS = 5


def pack_atlas(rows: list[list[Image.Image]]) -> Image.Image:
    """Rows of frames -> the atlas. Pair p's straight and curve_in frames
    fill row 2p, its curve_out frames the first half of row 2p+1 and the four
    plain plates of its higher material the second half.
    lib/stackacres/terrain.ts indexes into this by the same arithmetic."""
    atlas = Image.new("RGBA", (TILE_W * 8, 64 * ATLAS_PAIRS * 2), (0, 0, 0, 0))
    for pair in range(ATLAS_PAIRS):
        frames = rows[pair * 2] + rows[pair * 2 + 1]
        assert len(frames) == 16, f"pair {pair} has {len(frames)} frames"
        for i, frame in enumerate(frames):
            assert frame.size == (TILE_W, 64), f"pair {pair} frame {i} is {frame.size}"
            atlas.alpha_composite(frame, ((i % 8) * TILE_W, (pair * 2 + i // 8) * 64))
    return atlas


def build_atlas() -> Image.Image:
    """The whole atlas, from the pack."""
    grass_beach = [erase_grass_rim(f) for f in transition_frames("ts_grass-beach0")]
    dirt_edges = [tint_sand(f, DIRT_TOP) for f in grass_beach]
    dirt_plates = [tint_sand(f, DIRT_TOP) for f in base_frames("ts_beach0")]
    cobble = cobble_frames(dirt_edges + dirt_plates)
    return pack_atlas([
        grass_beach,
        base_frames("ts_beach0"),
        transition_frames("ts_beach-shallow0"),
        base_frames("ts_shallow0"),
        transition_frames("ts_shallow-deep0"),
        deep_plates(),
        dirt_edges,
        dirt_plates,
        cobble[:12],
        cobble[12:],
    ])


def repave_atlas(atlas: Image.Image) -> Image.Image:
    """The built atlas with its grass-cobble block rebuilt from its own
    grass-dirt one.

    The pack this script reads is Kayo's own supply and is not committed, so
    the paving -- which needs nothing from it but the dirt frames already in
    the atlas -- is re-runnable on its own. `--cobble` is that run.
    """
    def frame(index: int, pair: int) -> Image.Image:
        x = (index % 8) * TILE_W
        y = (pair * 2 + index // 8) * 64
        return atlas.crop((x, y, x + TILE_W, y + 64))

    rows: list[list[Image.Image]] = []
    for pair in range(4):
        rows.append([frame(i, pair) for i in range(12)])
        rows.append([frame(i, pair) for i in range(12, 16)])
    cobble = cobble_frames(rows[6] + rows[7])
    rows.append(cobble[:12])
    rows.append(cobble[12:])
    return pack_atlas(rows)


def build_deep(size: int = 512) -> Image.Image:
    """Open sea, seamless, at the lawn's own lattice density."""
    field = lattice(size, deep_plates(), seed=20260909, scale=GRASS_SCALE)
    bed = Image.new("RGBA", (size, size), (48, 104, 148, 255))
    bed.alpha_composite(field)
    return bed


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if "--cobble" in sys.argv:
        path = OUT / "terrain-atlas.png"
        atlas = repave_atlas(Image.open(path).convert("RGBA"))
        atlas.save(path)
        print(f"terrain-atlas.png {atlas.size} (repaved)")
        return
    grass = build_grass()
    grass.save(OUT / "grass-tile.png")
    print(f"grass-tile.png {grass.size}")
    bed = build_soil_bed()
    bed.save(OUT / "soil-bed.png")
    print(f"soil-bed.png {bed.size}")
    atlas = build_atlas()
    atlas.save(OUT / "terrain-atlas.png")
    print(f"terrain-atlas.png {atlas.size}")
    deep = build_deep()
    deep.save(OUT / "deep-tile.png")
    print(f"deep-tile.png {deep.size}")


if __name__ == "__main__":
    main()
