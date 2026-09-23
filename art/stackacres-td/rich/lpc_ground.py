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


def _with_inner_corner(patch, material, inner):
    """`patch` with one of the block's inner-corner tiles laid in.

    Where two roads meet, a tile can have road on all four sides and grass only
    at a diagonal. Picked by its sides alone it is a plain middle tile, and
    shows as a flat square cut into the road's darker rim. The pack draws an
    inner corner for this (the 2x2 above each 3x3 block, the grass showing in
    one corner of each). Taking the lower alpha and the darker colour of the
    two keeps both the corner's hole and its rim, and lets a tile with two
    missing diagonals, or an edge and a missing diagonal, carry both."""
    col, row = BLOCKS[material]
    corner = _tile(col + inner[0], row + inner[1])
    darker = corner[..., :3].sum(-1, keepdims=True) < patch[..., :3].sum(-1, keepdims=True)
    rgb = np.where(darker, corner[..., :3], patch[..., :3])
    return np.concatenate([rgb, np.minimum(patch[..., 3:4], corner[..., 3:4])], axis=-1)


def paint(tiles, w, h, water=None):
    """The whole ground as a float64 HxWx3 at SCALE * 16 px per map tile.

    `water` is the per-pixel water mask at map resolution (the pond and the
    stream, from rich/terrain.py's owner grid). Water is drawn from that shape
    by `_paint_water` rather than stamped as tiles -- see its own header.
    """
    img = np.zeros((h * TILE, w * TILE, 3), np.float64)
    base = _tile(*[c + 1 for c in BLOCKS["grass"]])[..., :3]
    for ty in range(h):
        for tx in range(w):
            img[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE] = base
    for ty in range(h):
        for tx in range(w):
            material = tiles[ty][tx]
            if material in ("grass", "water", "stream") or material not in BLOCKS:
                continue
            same = lambda dx, dy: (
                0 <= tx + dx < w and 0 <= ty + dy < h and tiles[ty + dy][tx + dx] == material
            )
            n, e, so, wst = same(0, -1), same(1, 0), same(0, 1), same(-1, 0)
            patch = _tile(*_nine(material, n, e, so, wst))
            for dx, dy, inner in ((1, 1, (1, -2)), (-1, 1, (2, -2)), (1, -1, (1, -1)), (-1, -1, (2, -1))):
                if same(dx, 0) and same(0, dy) and not same(dx, dy):
                    patch = _with_inner_corner(patch, material, inner)
            a = patch[..., 3:4] / 255.0
            y0, x0 = ty * TILE, tx * TILE
            under = img[y0:y0 + TILE, x0:x0 + TILE]
            img[y0:y0 + TILE, x0:x0 + TILE] = under * (1 - a) + patch[..., :3] * a
    _scatter(img, tiles, w, h)
    if water is not None:
        _paint_water(img, water)
    return img


# Small things lying in the grass, from the pack. Pixel boxes in the terrain atlas. Kept SPARSE: at
# half the squares the stones and leaves read as litter on a lawn (Kayo, 2026-09-23: "garbage"), and
# Stardew's open grass carries only the odd weed. Stones on the grass are the exception, not the rule.
STONES = [(493, 3, 17, 9), (489, 41, 19, 9), (585, 41, 19, 9), (515, 480, 16, 9), (523, 491, 18, 15)]
GREENERY = [
    (419, 453, 11, 7), (424, 465, 8, 13), (433, 467, 10, 10), (416, 481, 11, 9), (419, 497, 8, 12),
    (434, 497, 11, 13), (385, 577, 17, 15), (681, 42, 15, 13), (201, 810, 15, 13),
]
SCATTER_CHANCE = 0.06     # of a square with grass all round it getting something
STONE_SHARE = 0.25        # of those, the share that are stones


def _hash(x, y, salt):
    """A steady 0..1 for a spot: works on plain ints and on whole numpy arrays of them alike."""
    x = np.asarray(x, dtype=np.uint64)
    y = np.asarray(y, dtype=np.uint64)
    m = np.uint64(0xFFFFFFFF)
    h = (x * np.uint64(374761393) + y * np.uint64(668265263) + np.uint64(salt * 1442695041)) & m
    h = ((h ^ (h >> np.uint64(13))) * np.uint64(1274126177)) & m
    return (h ^ (h >> np.uint64(16))).astype(np.float64) / float(0xFFFFFFFF)


def _scatter(img, tiles, w, h):
    """Stones, leaves and low plants lying in the grass, painted into the ground itself.

    What gives open grass some life without adding a single thing for the
    engine to draw: it is part of the ground picture. A bed dug on a square is
    drawn over the ground, so it simply covers whatever was lying there.

    Only on grass with grass all round it, so nothing lands half on a road or
    at the water's edge, and never more than one to a square. Placed by a hash
    of the square, so the same square always has the same pebble.
    """
    stones = [_tile_box(box) for box in STONES]
    greenery = [_tile_box(box) for box in GREENERY]
    for ty in range(1, h - 1):
        for tx in range(1, w - 1):
            if any(tiles[ty + dy][tx + dx] != "grass" for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                continue
            if _hash(tx, ty, 1) > SCATTER_CHANCE:
                continue
            pool = stones if _hash(tx, ty, 5) < STONE_SHARE else greenery
            piece = pool[int(_hash(tx, ty, 2) * len(pool)) % len(pool)]
            ph, pw = piece.shape[:2]
            x0 = tx * TILE + int(_hash(tx, ty, 3) * max(1, TILE - pw))
            y0 = ty * TILE + int(_hash(tx, ty, 4) * max(1, TILE - ph))
            a = piece[..., 3:4] / 255.0
            under = img[y0:y0 + ph, x0:x0 + pw]
            img[y0:y0 + ph, x0:x0 + pw] = under * (1 - a) + piece[..., :3] * a


def _tile_box(box):
    x, y, bw, bh = box
    return atlas()[y:y + bh, x:x + bw]


# The pack's pond-in-grass set (terrain_atlas tiles 6..8 x 11..13). Its middle tile is open water;
# the four around it are the shoreline, one per side the grass is on, with the row or column where
# each turns from shore to water (measured off the tiles: where half of that row or column is water).
WATER_FILL = (7, 12)
SHORES = {
    # side the grass is on: (tile, shoreline row/column, "row" or "col", +1 if water lies at larger indices)
    "north": ((7, 11), 16, "row", +1),
    "south": ((7, 13), 13, "row", -1),
    "west": ((6, 12), 18, "col", +1),
    "east": ((8, 12), 13, "col", -1),
}
SHORE_OUT, SHORE_IN = 10, 18     # how far either side of the waterline the pack's shoreline is laid, in px
RIPPLE = np.array([0.0, 207.0, 223.0])


def _classify_shore(tile):
    """How much of each shoreline pixel to lay over the ground on the GRASS side of the waterline: the
    fringe of dark grass hanging over the edge, the earth bank, the foam and ripples, all of it; the
    plain grass of the pack's pond tile, none, so the farm's own grass shows there instead of a band of
    a slightly different green round every pond."""
    r, g, b = tile[..., 0], tile[..., 1], tile[..., 2]
    watery = b > r + 30
    bank = (r > 80) & (r > g - 10) & (b < 100)
    fringe = (g < 115) & (r < 40)
    return np.where(watery | bank | fringe, 1.0, 0.0)


def _paint_water(img, water):
    """The pond and the stream: their own smooth shape, the pack's water, and the pack's shoreline.

    WHY NOT TILES. Water is the one thing a 3x3 tile set cannot draw: it has square corners and no
    diagonal, so a round pond comes out as a staircase, and a stream one square wide is shore on both
    sides with no water in it. So the SHAPE comes from rich/terrain.py's per-pixel owner grid, which
    draws both as smooth, wandering curves.

    WHY THE PACK'S SHORELINE ANYWAY. A curve filled with flat blue is a hole in the grass. What makes the
    pack's pond read as water is its shoreline: dark grass hanging over the edge, an earth bank on the
    far shore, bright ripples along the rim. So every pixel near the waterline is taken from the pack's
    own shoreline tile for whichever side the grass is on, at the row that is the same distance from
    that tile's waterline. Round a curve the side changes smoothly, so the samples are blended by how
    much the shore faces each way. The bank shows on a north shore and not a south one because that is
    how the pack drew it: from above, you see the far bank, not the near one.
    """
    from scipy.ndimage import distance_transform_edt, gaussian_filter

    mask = np.repeat(np.repeat(water.astype(np.float64), SCALE, axis=0), SCALE, axis=1)
    inside = gaussian_filter(mask, 1.2) > 0.5            # smooth the doubled steps off the outline
    if not inside.any():
        return
    d = np.where(inside, distance_transform_edt(inside) - 0.5, -(distance_transform_edt(~inside) - 0.5))
    field = gaussian_filter(inside.astype(np.float64), 3.0)
    gy, gx = np.gradient(field)
    norm = np.hypot(gx, gy) + 1e-9
    nx, ny = gx / norm, gy / norm                          # points from the grass into the water

    H, W = mask.shape
    ys, xs = np.mgrid[0:H, 0:W]

    # Open water: the pack's water, with the odd short ripple across it the way the pack draws them.
    fill = _tile(*WATER_FILL)[..., :3]
    tex = np.tile(fill, (H // TILE + 1, W // TILE + 1, 1))[:H, :W]
    ripple = (_hash(xs // 7, ys // 3, 51) < 0.035) & (d > 4)
    tex = np.where(ripple[..., None], tex * 0.35 + RIPPLE * 0.65, tex)
    img[:] = np.where(inside[..., None], tex, img)

    # The shoreline, sampled from the pack's four shore tiles and blended by which way the shore faces.
    band = (d > -SHORE_OUT) & (d < SHORE_IN)
    di = np.round(d).astype(int)
    weights = {"north": np.maximum(ny, 0), "south": np.maximum(-ny, 0), "west": np.maximum(nx, 0), "east": np.maximum(-nx, 0)}
    total = sum(weights.values()) + 1e-9
    colour = np.zeros((H, W, 3))
    cover = np.zeros((H, W))
    for side, ((tc, tr), line, axis, sign) in SHORES.items():
        tile = _tile(tc, tr)
        keep = _classify_shore(tile)
        across = np.clip(line + sign * di, 0, TILE - 1)
        if axis == "row":
            rows, cols = across, xs % TILE
        else:
            rows, cols = ys % TILE, across
        sample = tile[rows, cols, :3]
        # On the water side everything the pack drew is meant: blades over the water, foam, ripples.
        a = np.where(d > 0, tile[rows, cols, 3] / 255.0, keep[rows, cols] * tile[rows, cols, 3] / 255.0)
        w = weights[side] / total
        colour += sample * w[..., None]
        cover += a * w
    cover = np.where(band, cover, 0.0)[..., None]
    img[:] = img * (1 - cover) + colour * cover


def bed_tile(mask, material="path"):
    """One hoed square: the road's own dirt, with a bed's edge rather than a road's.

    `mask` is the scene's 4-bit neighbour mask (1 N, 2 E, 4 S, 8 W: that side
    is another bed).

    The dirt is the fill tile of the same 3x3 block the road is painted from,
    so a hoed square is the road's ground, texel for texel. The EDGE is not the
    road's, on purpose. A road's edge pieces are mostly transparent margin with
    pebbles scattered across it -- right for a lane four squares wide, wrong for
    a bed one square wide, which came out as a ring of pebbles with no dirt in
    it. A bed wants what a tilled square in Stardew has: solid dirt to within a
    few pixels of the grass, a soft uneven rim, and rounded outside corners.

    So each open side eats a few pixels of the square, by a depth that wanders
    along the edge so it is never a ruled line, with a darker band just inside
    it where the turned earth meets the grass. A side with a bed beyond it is
    left alone, which is what lets a row of beds join into one strip.

    Returns a TILE x TILE RGBA image, drawn at half size like the ground.
    """
    col0, row0 = BLOCKS[material]
    fill = _tile(col0 + 1, row0 + 1)
    n, e, s, w = bool(mask & 1), bool(mask & 2), bool(mask & 4), bool(mask & 8)

    ys, xs = np.mgrid[0:TILE, 0:TILE].astype(np.float64) + 0.5
    far = np.full((TILE, TILE), 99.0)
    dist = far.copy()
    # Distance in from each OPEN side, pushed in and out a little along it.
    def wander(along, seed):
        return 1.2 * np.sin(along * 0.9 + seed) + 0.8 * np.sin(along * 0.37 + seed * 2.1)
    if not n:
        dist = np.minimum(dist, ys - wander(xs, 1.0))
    if not s:
        dist = np.minimum(dist, (TILE - ys) - wander(xs, 2.0))
    if not w:
        dist = np.minimum(dist, xs - wander(ys, 3.0))
    if not e:
        dist = np.minimum(dist, (TILE - xs) - wander(ys, 4.0))
    # Round an outside corner: where both sides meeting there are open.
    radius = 9.0
    for open_v, open_h, cx, cy in ((not n, not w, 0, 0), (not n, not e, TILE, 0),
                                   (not s, not w, 0, TILE), (not s, not e, TILE, TILE)):
        if not (open_v and open_h):
            continue
        ox = cx + (radius if cx == 0 else -radius)
        oy = cy + (radius if cy == 0 else -radius)
        inside = ((xs - ox) * (1 if cx == 0 else -1) < 0) & ((ys - oy) * (1 if cy == 0 else -1) < 0)
        round_d = radius - np.hypot(xs - ox, ys - oy)
        dist = np.where(inside, np.minimum(dist, round_d), dist)

    CUT = 3.0        # px of grass left showing at an open edge
    RIM = 2.5        # px of darker earth just inside it
    alpha = np.clip(dist - CUT + 0.5, 0, 1)
    shade = np.where(dist < CUT + RIM, 0.74, 1.0)
    rgb = fill[..., :3] * shade[..., None]
    out = np.dstack([rgb, alpha * 255.0])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")
