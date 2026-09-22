"""The ground, painted from the LPC terrain atlas instead of pixel by pixel.

WHY THIS EXISTS. rich/terrain.py draws every ground pixel procedurally: noise
for grass, a different noise for dirt, hand-rolled edges between them. It is
good work and it is the wrong tool -- what it produces is one texture with
soft-ish borders, and next to the drawn props it reads as a backdrop rather
than as ground. The LPC terrain set (art/stackacres-td/lpc/terrain, CC-BY-SA
3.0 / GPL 3.0, credited in Attribution.txt) is drawn ground, by the same hands
that drew the cast this game already uses, and it carries the thing the
procedural painter never had: real transitions, with grass blades hanging over
a dirt edge and a rock shore around water.

HOW IT IS LAID OUT. A terrain in the atlas is a 3x3 block. The middle tile is
the fill and the eight around it are its edges and outside corners, drawn on
transparency so the block is stamped OVER whatever is beneath. So the whole
ground is: grass everywhere, then each patch of something-else stamped on top
with the right one of its nine tiles. That is the standard way LPC maps are
built, and it is why `BLOCKS` below is nine tiles named by one corner.

Inside corners -- the notch where two tiles of the same material meet
diagonally -- are not in a 3x3 block and are not drawn. LPC ships it this way.

RESOLUTION. The atlas is 32px per tile; this game's maps are authored at 16
units per tile. Painting at 32 and letting the engine draw the result at half
scale gives the ground twice the texels per world unit it has today, at the
same size on screen and with no coordinate anywhere having to move.
"""
import os

import numpy as np
from PIL import Image

ATLAS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lpc", "terrain", "terrain_atlas.png")
TILE = 32           # the atlas's own tile size
SCALE = 2           # atlas tile / map tile: 32px drawn into a 16-unit square

# Top-left tile of each 3x3 block, found by its centre being the only fully
# opaque tile of the nine (see `find_blocks` in the pack notes). Names are this
# game's own materials (rich/terrain.py's ORDER), not the pack's.
BLOCKS = {
    "grass": (3, 22),     # the base everything else is stamped onto
    "path": (15, 2),      # warm tan dirt with pebbles: the farm roads
    "water": (9, 11),     # blue with a rock shore: the pond
    "stream": (9, 11),
    "sand": (0, 28),
    "gravel": (21, 2),
    "mud": (3, 28),
    "cobble": (18, 2),
    "soil": (3, 28),      # bare dug earth; a planted BED is a sprite, not terrain
}

_atlas = None


def atlas():
    global _atlas
    if _atlas is None:
        _atlas = np.asarray(Image.open(ATLAS).convert("RGBA")).astype(np.float64)
    return _atlas


def _tile(col, row):
    return atlas()[row * TILE:(row + 1) * TILE, col * TILE:(col + 1) * TILE]


# How much of a tile a material has to cover to own the whole tile. Roads are
# greedy on purpose: a 3x3 block has no straight-edge tile narrow enough for a
# two-tile road, so a road drawn at its exact width comes out as a string of
# scalloped corner tiles. Letting it claim any tile it meaningfully touches
# makes it wide enough to have a middle, and a middle is what reads as a lane.
CLAIM = {"path": 0.22, "water": 0.42, "stream": 0.42}
DEFAULT_CLAIM = 0.5


def tile_materials(owner, names, w, h):
    """One material per map tile, from rich/terrain.py's per-PIXEL owner grid.

    The procedural painter works in pixels and its borders wander, so a tile is
    owned by whichever material covers most of it, as long as that is more than
    the material's own share of `CLAIM`.
    """
    out = [["grass"] * w for _ in range(h)]
    step = owner.shape[0] // h
    for ty in range(h):
        for tx in range(w):
            cell = owner[ty * step:(ty + 1) * step, tx * step:(tx + 1) * step]
            codes, counts = np.unique(cell, return_counts=True)
            order = counts.argsort()[::-1]
            for i in order:
                code = int(codes[i])
                if not code:
                    continue
                material = names[code]
                if counts[i] > cell.size * CLAIM.get(material, DEFAULT_CLAIM):
                    out[ty][tx] = material
                break
    return out


def _nine(material, north, east, south, west):
    """Which of a block's nine tiles to stamp, from the four sides that match."""
    col, row = BLOCKS[material]
    return col + (0 if not west else 2 if not east else 1), row + (0 if not north else 2 if not south else 1)


def paint(tiles, w, h):
    """The whole ground as a float64 HxWx3 at SCALE * 16 px per map tile."""
    img = np.zeros((h * TILE, w * TILE, 3), np.float64)
    base = _tile(*[c + 1 for c in BLOCKS["grass"]])[..., :3]
    for ty in range(h):
        for tx in range(w):
            img[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE] = base
    for ty in range(h):
        for tx in range(w):
            material = tiles[ty][tx]
            if material == "grass" or material not in BLOCKS:
                continue
            same = lambda dx, dy: (
                0 <= tx + dx < w and 0 <= ty + dy < h and tiles[ty + dy][tx + dx] == material
            )
            col, row = _nine(material, same(0, -1), same(1, 0), same(0, 1), same(-1, 0))
            patch = _tile(col, row)
            a = patch[..., 3:4] / 255.0
            y0, x0 = ty * TILE, tx * TILE
            under = img[y0:y0 + TILE, x0:x0 + TILE]
            img[y0:y0 + TILE, x0:x0 + TILE] = under * (1 - a) + patch[..., :3] * a
    return img
