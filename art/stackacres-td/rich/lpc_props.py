"""Rocks, stumps, bushes, lily pads, mushrooms and flowers from the LPC terrain set.

The small things scattered over the farm, swapped for the pack's own so they
match its ground, trees, water and cast. Cut from
art/stackacres-td/lpc/terrain/terrain_atlas.png (CC-BY-SA 3.0 / GPL 3.0,
credited in its Attribution.txt), by pixel boxes found by scanning the sheet
for separate drawings.

Built the same way as ./lpc_trees.py, for the same reason: each comes as a
half-size stand-in the export measures, carrying the full-detail original in
`img.info["hires"]` for the engine to draw at scale 0.5.

Two things the pieces they replace did, and these still do:

- A bush is walked THROUGH, not around (`passable`): the farmer brushes it and
  it rustles.
- A berried bush has to look like it is carrying something. The four berried
  bushes are the farm's forage nodes, and "this one has fruit on it" is the only
  thing that tells a player to pick it. The pack has no berry bush, so a
  berried one is the pack's bush with its red berry cluster laid over it.
"""

import numpy as np
from PIL import Image

from lpc_trees import SCALE, _base, _cut, _half

ROCKS_BIG = [(768, 676, 31, 22), (962, 686, 29, 44), (928, 772, 31, 22)]
ROCKS_SMALL = [(674, 675, 28, 27), (451, 740, 23, 19), (422, 742, 20, 21), (423, 801, 18, 30)]
STUMP = (740, 582, 25, 19)
BUSH = (289, 448, 31, 30)
BERRIES = (390, 779, 19, 16)
LILY = (194, 964, 30, 28)
MUSHROOMS = [(866, 898, 28, 28), (834, 994, 28, 28)]
FLOWER = (484, 788, 25, 41)
# The pack's two-wide waterfall (the same drawing base_out_atlas.png carries):
# a lip where the water tips over, the falling sheet, and the splash at its foot.
WATERFALL = (688, 384, 64, 128)
FALL_LIP, FALL_FOOT = 16, 24          # pack px of the lip and the splash; the rest falls
FALL_LOOP, FALL_BLEND = 64, 16        # the falling sheet as a seamless loop, and how much of it is cross-faded
# The stone blocks the waterfall tips over: a row of slabs on top, cracked
# block faces below. The pack has no cliff, and these are the pieces drawn
# beside its waterfall. Pack tiles, 32px.
LEDGE_TOPS = [(608, 448), (608, 448), (576, 448), (608, 448), (608, 448), (640, 448)]
LEDGE_FACES = [(448, 480), (576, 480), (640, 480), (448, 480)]
TILE = 32


def _made(hires, passable=False):
    """(stand-in picture, its base point), carrying the full-detail picture."""
    bx, by = _base(hires)
    proxy = _half(hires)
    proxy.info["hires"] = {"img": hires, "scale": SCALE}
    if passable:
        proxy.info["passable"] = True
    return proxy, (round(bx * SCALE), round(by * SCALE))


def rock(big=False, seed=0):
    pool = ROCKS_BIG if big else ROCKS_SMALL
    return _made(_cut(pool[seed % len(pool)]))


def stump():
    return _made(_cut(STUMP))


def bush(seed=0, berries=False):
    img = _cut(BUSH).copy()
    if berries:
        fruit = _cut(BERRIES)
        # Two clusters, set into the leaves rather than stuck on the outline.
        for fx, fy in ((3 + seed % 3, 5), (img.width - fruit.width - 3, 11 + seed % 2)):
            img.alpha_composite(fruit, (fx, fy))
    return _made(img, passable=True)


def waterfall():
    """The waterfall, still. The engine lays a moving copy of its falling sheet
    (`waterfall_sheet`) over the part between the lip and the splash; `falls`
    says where that part is, in map px down from the top of the picture."""
    proxy, base = _made(_cut(WATERFALL))
    proxy.info["falls"] = {"top": FALL_LIP * SCALE, "height": (WATERFALL[3] - FALL_LIP - FALL_FOOT) * SCALE}
    return proxy, base


def ledge(tiles, faces=2):
    """A stone ledge `tiles` wide: a row of slabs over `faces` rows of cracked block."""
    img = Image.new("RGBA", (tiles * TILE, (1 + faces) * TILE))
    for n in range(tiles):
        rows = [LEDGE_TOPS[(n * 5 + 2) % len(LEDGE_TOPS)]] + [LEDGE_FACES[(n * 3 + r) % len(LEDGE_FACES)] for r in range(faces)]
        for r, (x, y) in enumerate(rows):
            img.alpha_composite(_cut((x, y, TILE, TILE)), (n * TILE, r * TILE))
    return _made(img)


def waterfall_sheet():
    """A square of falling water that loops top to bottom, for the engine to scroll.

    The drawing's own sheet does not repeat, so the loop is made: the rows just
    past the loop's length are faded in over its first rows, which puts the
    bottom edge's continuation at the top and leaves no seam where it wraps."""
    body = np.asarray(_cut(WATERFALL), dtype=float)[FALL_LIP:FALL_LIP + FALL_LOOP + FALL_BLEND]
    out = body[:FALL_LOOP].copy()
    fade = (np.arange(FALL_BLEND) / FALL_BLEND)[:, None, None]
    out[:FALL_BLEND] = body[:FALL_BLEND] * fade + body[FALL_LOOP:] * (1 - fade)
    return Image.fromarray(out.round().astype(np.uint8), "RGBA")


def lily_pad(flower=False):
    return _made(_cut(LILY))


def mushrooms(seed=0):
    return _made(_cut(MUSHROOMS[seed % len(MUSHROOMS)]))


def flower(seed=0):
    return _made(_cut(FLOWER))
