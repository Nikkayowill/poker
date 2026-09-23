"""Trees and bushes from the LPC terrain set, in place of the hand-painted ones.

The procedural trees in ./trees.py are good work and they are not the pack:
next to the LPC ground, the LPC cast and the LPC water they read as a
different game's scenery. These are the pack's own trees, cut out of
art/stackacres-td/lpc/terrain/terrain_atlas.png (CC-BY-SA 3.0 / GPL 3.0,
credited in its Attribution.txt).

TWO SIZES OF EVERY TREE. The pack is drawn at 32px per map tile and this
game's maps at 16, so a pack tree has to be drawn at half size -- the same
reason the ground is painted at 32 and sized to the map. But everything the
export works out from a picture (where its shadow falls, which squares it
stands on, the grass over its feet, its draw order) is done at map scale,
one pixel per unit. So each tree is handed to the rig as a HALF-SIZE STAND-IN
for all of that, and carries the full-detail original in `img.info["hires"]`,
which is what export_rich.py writes into the atlas for the engine to draw at
`scale` 0.5. The geometry is right, and the picture on screen keeps every
pixel the pack drew.

Each tree also splits into what moves in the wind (the leaves) and what does
not (the trunk), which the engine's wind layer bends from the base. Leaves are
told from bark by colour: green over red.

Pure: pictures in, pictures out.
"""

import os

import numpy as np
from PIL import Image

ATLAS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lpc", "terrain", "terrain_atlas.png")
SCALE = 0.5

# Whole trees, trunk and all, by their pixel box in the atlas: found by
# scanning the sheet for separate drawings and keeping the green ones.
TREES = {
    "pine": (961, 5, 63, 147),
    "oak": (929, 902, 95, 117),
    "broadleaf": (867, 931, 60, 90),
}
# Pine crowns with no trunk: what a forest wall is made of, one crown
# overlapping the next so no trunk is ever seen between them.
CROWNS = [(772, 485, 85, 91), (870, 501, 85, 91)]
BUSH = (865, 400, 94, 80)

# How far the wind carries the top of each kind, in map px at full lean: the
# engine turns it into a bend from the base (components/arcade/stackacres-td/
# wind-sway.ts). A pine is stiff for its height; a broadleaf crown is soft and
# moves more; a crown in the wall round the edge is packed in and moves least.
BEND = {"pine": 2.0, "oak": 2.6, "broadleaf": 3.0, "crown": 1.4, "bush": 1.8}

_sheet = None


def sheet():
    global _sheet
    if _sheet is None:
        _sheet = Image.open(ATLAS).convert("RGBA")
    return _sheet


def _cut(box):
    x, y, w, h = box
    return sheet().crop((x, y, x + w, y + h))


def _leaves(img):
    """The leaves of a pack tree as their own picture, and the rest (trunk, roots) as another."""
    arr = np.asarray(img).astype(np.int16)
    leaf = (arr[..., 3] > 0) & (arr[..., 1] > arr[..., 0] + 8)
    upper, lower = arr.copy(), arr.copy()
    upper[~leaf, 3] = 0
    lower[leaf, 3] = 0
    return Image.fromarray(upper.astype(np.uint8), "RGBA"), Image.fromarray(lower.astype(np.uint8), "RGBA")


def _base(img):
    """Where a tree meets the ground, in its own pixels: the middle of its lowest opaque row."""
    alpha = np.asarray(img)[..., 3]
    rows = np.nonzero(alpha.max(axis=1))[0]
    bottom = int(rows[-1])
    cols = np.nonzero(alpha[bottom])[0]
    return int(round(cols.mean())), bottom


def _half(img):
    return img.resize((max(1, round(img.width * SCALE)), max(1, round(img.height * SCALE))), Image.LANCZOS)


def _made(hires, kind, rustle):
    """(stand-in picture, its base point), with the wind parts and the full-detail picture attached."""
    upper, lower = _leaves(hires)
    bx, by = _base(hires)
    proxy = _half(hires)
    proxy.info["sway"] = {"upper": _half(upper), "lower": _half(lower), "amp": BEND[kind], "rustle": rustle,
                          "kind": "broadleaf" if kind in ("oak", "broadleaf") else "conifer"}
    proxy.info["hires"] = {"img": hires, "upper": upper, "lower": lower, "scale": SCALE}
    return proxy, (round(bx * SCALE), round(by * SCALE))


def spruce(seed=0, big=False):
    """What the rig asks for as a spruce: the pack's pine."""
    return _made(_cut(TREES["pine"]), "pine", False)


def round_tree(seed=0):
    """What the rig asks for as a round tree: the pack's oak or its smaller broadleaf, by seed."""
    kind = "oak" if seed % 3 else "broadleaf"
    return _made(_cut(TREES[kind]), kind, False)


def crown(seed=0):
    """A pine crown for the forest wall round the map's edge: no trunk, since the next crown hides it."""
    return _made(_cut(CROWNS[seed % len(CROWNS)]), "crown", False)


def bush(seed=0):
    return _made(_cut(BUSH), "bush", True)


FOREST_TILE = 256
# The shadowed floor under a canopy, showing through wherever two crowns leave a gap.
FOREST_FLOOR = (18, 46, 30, 255)


def forest_tile():
    """A seamless square of dense pine canopy, for everything beyond the edge of the map.

    The map is only so big and the camera is not fenced in, so a player who pans
    or walks to an edge used to see the dark behind the world. This is laid
    behind the whole map, repeated far past every edge, so what lies beyond is
    forest. It wraps: every crown near an edge is drawn again one tile over, so
    the seams between repeats fall inside the canopy, not along a line. Crowns
    are staggered row by row, the way a real stand of pines grows, and drawn top
    row first so each one overlaps the one behind it.
    """
    n = FOREST_TILE
    tile = Image.new("RGBA", (n, n), FOREST_FLOOR)
    crowns = [_cut(box) for box in CROWNS]
    step_x, step_y = 64, 52
    spots = []
    for row in range(-1, n // step_y + 2):
        for col in range(-1, n // step_x + 2):
            x = col * step_x + (step_x // 2 if row % 2 else 0) + (row * 7 + col * 13) % 11 - 5
            y = row * step_y + (row * 5 + col * 3) % 9 - 4
            spots.append((y, x, (row + col) % len(crowns)))
    for y, x, k in sorted(spots):
        crown = crowns[k]
        for dx in (-n, 0, n):
            for dy in (-n, 0, n):
                _stamp(tile, crown, x + dx - crown.width // 2, y + dy - crown.height // 2)
    return tile


def _stamp(dst, src, left, top):
    """alpha_composite that allows `src` to hang off any edge of `dst`: the part inside is drawn, the rest dropped."""
    x0, y0 = max(0, left), max(0, top)
    x1, y1 = min(dst.width, left + src.width), min(dst.height, top + src.height)
    if x0 >= x1 or y0 >= y1:
        return
    dst.alpha_composite(src.crop((x0 - left, y0 - top, x1 - left, y1 - top)), (x0, y0))
