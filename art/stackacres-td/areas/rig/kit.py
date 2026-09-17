"""Shared tiles and sprites for every StackAcres area, in DawnBringer 16.

Terrain is corner-based autotiling: grass is the base, and water, tilled soil and dirt
path are overlays whose 16 corner combinations each make one reusable 16x16 tile.
Objects follow the character rig's rules: black silhouette outline, light from the
top-left, cluster shading instead of per-pixel noise.
"""
import math

from PIL import Image

T = 16
DB16 = {
    "K": "#140C1C", "P": "#442434", "B": "#30346D", "g": "#4E4A4E", "N": "#854C30",
    "G": "#346524", "R": "#D04648", "O": "#757161", "L": "#597DCE", "o": "#D27D2C",
    "s": "#8595A1", "v": "#6DAA2C", "T": "#D2AA99", "C": "#6DC2CA", "Y": "#DAD45E",
    "W": "#DEEED6",
}
RGB = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) for k, v in DB16.items()}
KEY = {rgb: k for k, rgb in RGB.items()}
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
# What a cast shadow turns each ground color into.
SHADE = {"v": "G", "Y": "G", "G": "G", "W": "s", "T": "O", "O": "g", "N": "P", "o": "N", "P": "K",
         "L": "B", "C": "L", "B": "B", "s": "g", "g": "K", "K": "K", "R": "P"}


def hash2(x, y, seed=0):
    h = (x * 374761393 + y * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296


class Sprite:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]

    def put(self, x, y, k):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = k

    def get(self, x, y):
        return self.px[y][x] if 0 <= x < self.w and 0 <= y < self.h else None

    def rect(self, x, y, w, h, k):
        for j in range(h):
            for i in range(w):
                self.put(x + i, y + j, k)

    def stamp(self, rows, x, y):
        for j, row in enumerate(rows):
            for i, k in enumerate(row):
                if k != ".":
                    self.put(x + i, y + j, k)

    def outline(self, key="K"):
        out = [row[:] for row in self.px]
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] is None and any(self.get(x + dx, y + dy) for dx, dy in N4):
                    out[y][x] = key
        self.px = out
        return self

    def image(self):
        img = Image.new("RGBA", (self.w, self.h))
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x]:
                    img.putpixel((x, y), RGB[self.px[y][x]] + (255,))
        return img


# ------------------------------------------------------------------ terrain

GRASS_MOTIFS = {
    "tuft": ["G.G", ".G."],
    "tuft_tall": [".G.G", "G.G.", ".G.."],
    "spark": ["Y"],
    "daisy": [".W.", "WYW", ".W."],
    "clover": ["GvG", ".G."],
}
GRASS_TILES = [  # (weight, motifs)
    (30, []),
    (25, [("tuft", 3, 4), ("tuft", 10, 11)]),
    (20, [("tuft", 11, 3), ("spark", 5, 12)]),
    (17, [("tuft_tall", 4, 9), ("clover", 11, 2)]),
    (8, [("daisy", 6, 6), ("tuft", 11, 12)]),
]


def grass_tile(variant):
    grid = [["v"] * T for _ in range(T)]
    for name, x, y in GRASS_TILES[variant][1]:
        for j, row in enumerate(GRASS_MOTIFS[name]):
            for i, k in enumerate(row):
                if k != ".":
                    grid[y + j][x + i] = k
    return grid


def grass_variant(tx, ty):
    roll = hash2(tx, ty, 11) * 100
    for i, (weight, _) in enumerate(GRASS_TILES):
        if roll < weight:
            return i
        roll -= weight
    return 0


# A gentle periodic wobble (period 16) so an edge crossing a tile seam lines up on both sides.
WOB = [0.06 * math.sin(2 * math.pi * i / T + 0.7) + 0.025 * math.sin(6 * math.pi * i / T) for i in range(T)]
# Full interior tiles come in variants so pebbles and ripples never form a visible grid.
PEBBLES = [[(3, 4), (11, 9)], [(12, 3)], [(6, 12), (13, 13)], []]
SPECKS = [[(8, 7), (14, 2)], [(4, 10)], [(10, 4)], [(2, 3), (11, 12)]]
WAVES = [[(3, 5, 3)], [], [(10, 11, 3)], [], [(2, 12, 2), (11, 3, 2)], []]
VARIANTS = {"path": len(PEBBLES), "water": len(WAVES), "soil": 1}


def coverage(bits):
    tl, tr, bl, br = bits

    def inside(x, y):
        u, v = (x + 0.5) / T, (y + 0.5) / T
        f = tl * (1 - u) * (1 - v) + tr * u * (1 - v) + bl * (1 - u) * v + br * u * v
        du = (1 - v) * (tr - tl) + v * (br - bl)
        dv = (1 - u) * (bl - tl) + u * (br - tr)
        return f + (WOB[y % T] if abs(du) > abs(dv) else WOB[x % T]) > 0.5

    return inside


def path_px(x, y, inside, variant):
    # A brown rim and olive grit keep DB16's tan reading as trodden dirt, not pink sand.
    if any(not inside(x + dx, y + dy) for dx, dy in N4) or not inside(x, y - 2):
        return "N"
    for px, py in PEBBLES[variant]:
        if (x, y) in ((px, py), (px + 1, py), (px, py + 1)):
            return "O"
    return "O" if (x, y) in SPECKS[variant] else "T"


def soil_px(x, y, inside, variant):
    # Dug soil sits below the grass: the north and west inner edges are in shadow.
    if not inside(x, y - 1) or not inside(x - 1, y):
        return "P"
    if not inside(x, y + 1) or not inside(x + 1, y):
        return "o"
    if y % 4 == 2 and x % 6:
        return "P"
    return "N"


FRAMES = 4  # animated materials cycle through this many frames


def water_px(x, y, inside, variant, frame=0):
    """Still water. The highlight dashes drift right one pixel a frame, wrapping inside the tile."""
    if any(not inside(x + dx, y + dy) for dx, dy in N4) or not inside(x, y - 2) or not inside(x - 2, y):
        return "B"
    for wx, wy, n in WAVES[variant]:
        if y == wy and (x - wx - frame) % T < n:
            return "C"
    return "L"


RIPPLES = [[(2, 3), (9, 10)], [(12, 6)], [(5, 12), (13, 1)], [(7, 7)]]


def stream_px(x, y, inside, variant, frame=0):
    """Running water: lighter than the pond, short bright ripples that slide along, foam at the banks."""
    edge = any(not inside(x + dx, y + dy) for dx, dy in N4)
    if edge:
        return "W" if (x * 7 + y * 3 + frame * 5) % 11 == 0 else "B"
    if not inside(x, y - 2) or not inside(x - 2, y) or not inside(x + 2, y) or not inside(x, y + 2):
        return "C" if (x + y + frame) % 7 == 0 else "L"
    for rx, ry in RIPPLES[variant]:
        if y == ry and (x - rx - frame * 2) % T < 3:
            return "C" if (x - rx - frame * 2) % T else "W"
    return "L"


SHELLS = [[(4, 11)], [], [(12, 5)], [(7, 2), (2, 13)]]
COBBLE_GLINTS = [[(1, 1), (9, 5)], [(5, 9)], [(13, 1), (1, 13)], []]
GRIT = [[(3, 3), (9, 12)], [(12, 6)], [(6, 8), (14, 14)], [(2, 10)]]
PUDDLES = [[(4, 9, 5, 3)], [], [(10, 5, 4, 2)], []]


def sand_px(x, y, inside, variant):
    """Dry beach: warm yellow with pale glare and the odd shell. The edge is a damp brown lip."""
    if any(not inside(x + dx, y + dy) for dx, dy in N4):
        return "o"
    for sx, sy in SHELLS[variant]:
        if (x, y) in ((sx, sy), (sx + 1, sy)):
            return "T" if x == sx else "W"
    return "W" if (x * 7 + y * 3) % 23 == 0 else "Y"


def cobble_px(x, y, inside, variant):
    """Town cobbles: 4x4 stones in running bond, mortar on the right and bottom, a few darker stones and glints."""
    row = y // 4
    col = (x + (row % 2) * 2) // 4
    sx = (x + (row % 2) * 2) % 4
    sy = y % 4
    if any(not inside(x + dx, y + dy) for dx, dy in N4):
        return "g"
    if sx == 3 or sy == 3:
        return "g"
    stone = hash2(col, row, 50 + variant)
    if sx == 0 and sy == 0 and stone > 0.94:
        return "W"
    return "O" if stone < 0.22 else "s"


def mud_px(x, y, inside, variant):
    """The wallow: churned brown, dark clods, the odd wet glint. Puddles are placed by the area (kit.puddle)."""
    if not inside(x, y - 1) or not inside(x - 1, y):
        return "P"
    r = hash2(x, y, 60 + variant)
    if r < 0.08:
        return "o"
    return "P" if r < 0.26 else "N"


def gravel_px(x, y, inside, variant):
    """Mine spoil: grey grit with darker and paler chips."""
    if any(not inside(x + dx, y + dy) for dx, dy in N4):
        return "g"
    for gx, gy in GRIT[variant]:
        if (x, y) == (gx, gy):
            return "s"
        if (x, y) == (gx + 1, gy + 1):
            return "g"
    return "O"


# Later materials paint over earlier ones, so the sea cuts into sand and a path crosses cobbles.
MATERIALS = {"sand": sand_px, "gravel": gravel_px, "mud": mud_px, "cobble": cobble_px, "path": path_px,
             "soil": soil_px, "water": water_px, "stream": stream_px}
ANIMATED = {"water", "stream"}
VARIANTS.update({"sand": len(SHELLS), "cobble": len(COBBLE_GLINTS), "mud": len(PUDDLES), "gravel": len(GRIT),
                 "stream": len(RIPPLES)})
# The lip drawn on the outside of an overlay's edge depends on what it is cut into.
RIM = {"grass": "G", "sand": "o", "gravel": "g", "mud": "P", "cobble": "g", "path": "N", "soil": "P", "water": "B",
       "stream": "B"}
_tiles = {}


def overlay_tile(material, bits, variant=0, frame=0):
    if material not in ANIMATED:
        frame = 0
    key = (material, bits, variant, frame)
    if key not in _tiles:
        inside = coverage(bits)
        paint = MATERIALS[material]
        grid = [[None] * T for _ in range(T)]
        for y in range(T):
            for x in range(T):
                if inside(x, y):
                    grid[y][x] = paint(x, y, inside, variant, frame) if material in ANIMATED else paint(x, y, inside, variant)
                elif any(inside(x + dx, y + dy) for dx, dy in N4):
                    grid[y][x] = "G"
        _tiles[key] = grid
    return _tiles[key]


def tileset_image():
    """Grass variants, then each overlay: its full-tile variants and every edge/corner combination."""
    tiles = [grass_tile(i) for i in range(len(GRASS_TILES))]
    bits_all = [((m >> 3) & 1, (m >> 2) & 1, (m >> 1) & 1, m & 1) for m in range(1, 16)]
    for material in MATERIALS:
        shapes = [(b, 0) for b in bits_all] + [((1, 1, 1, 1), v) for v in range(1, VARIANTS[material])]
        for bits, variant in shapes:
            base = grass_tile(0)
            for y, row in enumerate(overlay_tile(material, bits, variant)):
                for x, k in enumerate(row):
                    if k:
                        base[y][x] = k
            tiles.append(base)
    cols = 8
    img = Image.new("RGBA", (cols * T, math.ceil(len(tiles) / cols) * T))
    for i, grid in enumerate(tiles):
        for y, row in enumerate(grid):
            for x, k in enumerate(row):
                img.putpixel((i % cols * T + x, i // cols * T + y), RGB[k] + (255,))
    return img


def interior_variant(material, tx, ty):
    return hash2(tx, ty, 31 + len(material)) * VARIANTS[material]


def render_terrain(width, height, verts, frame=0, with_owner=False):
    """verts: material -> set of (vx, vy) corner points that are that material. `frame` moves the water.
    `with_owner` also returns the per-pixel material map (what export.py turns into collision)."""
    img = Image.new("RGBA", (width * T, height * T))
    owner = [["grass"] * (width * T) for _ in range(height * T)]
    for ty in range(height):
        for tx in range(width):
            for y, row in enumerate(grass_tile(grass_variant(tx, ty))):
                for x, k in enumerate(row):
                    img.putpixel((tx * T + x, ty * T + y), RGB[k] + (255,))
    for material in MATERIALS:
        corners = verts.get(material, set())
        for ty in range(height):
            for tx in range(width):
                bits = tuple(int(p in corners) for p in ((tx, ty), (tx + 1, ty), (tx, ty + 1), (tx + 1, ty + 1)))
                if any(bits):
                    variant = int(interior_variant(material, tx, ty)) if all(bits) else 0
                    inside = coverage(bits)
                    for y, row in enumerate(overlay_tile(material, bits, variant, frame)):
                        for x, k in enumerate(row):
                            if not k:
                                continue
                            px, py = tx * T + x, ty * T + y
                            if inside(x, y):
                                owner[py][px] = material
                            else:
                                k = RIM[owner[py][px]]
                            img.putpixel((px, py), RGB[k] + (255,))
    return (img, owner) if with_owner else img


def cast_shadow(img, cx, cy, rx, ry):
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            if (dx / rx) ** 2 + (dy / ry) ** 2 <= 1:
                x, y = cx + dx, cy + dy
                if 0 <= x < img.width and 0 <= y < img.height:
                    k = KEY.get(img.getpixel((x, y))[:3])
                    if k:
                        img.putpixel((x, y), RGB[SHADE[k]] + (255,))


# ------------------------------------------------------------------ nature

def spruce(seed=0, big=False):
    """Nova Scotia spruce: stacked jagged tiers, lit edge left, blue-green shade right."""
    w, h = (26, 44) if big else (22, 36)
    s, cx = Sprite(w, h), w // 2
    tiers = [(2, 12, 4), (7, 20, 6), (13, 28, 8)] + ([(20, 36, 11)] if big else [])
    trunk_top = tiers[-1][1] - 1
    s.rect(cx - 1, trunk_top, 3, h - trunk_top - 2, "N")
    s.rect(cx + 1, trunk_top, 1, h - trunk_top - 2, "P")
    for t, (top, bottom, half) in enumerate(tiers):
        for y in range(top, bottom + 1):
            hw = max(1, round(half * (y - top) / (bottom - top)))
            for x in range(cx - hw, cx + hw + 1):
                rel = (x - cx) / hw
                k = "v" if rel < -0.45 else "B" if rel > 0.5 else "G"
                if y >= bottom - 1 and rel > -0.3:
                    k = "B"
                s.put(x, y, k)
        for x in range(cx - half, cx + half + 1, 2):
            s.put(x + (t + seed) % 2, bottom + 1, "B")
        s.put(cx - half // 2, top + (bottom - top) // 2, "v")
        s.put(cx - half // 2 + 1, top + (bottom - top) // 2 - 1, "Y" if t == 0 else "v")
    s.put(cx, 1, "G")
    return s.outline(), (cx, h - 2)


def round_tree(seed=0):
    """Broadleaf tree: overlapping foliage bundles, each lit from the top-left."""
    w, h = 40, 44
    s, cx = Sprite(w, h), w // 2
    j = lambda i: round((hash2(seed, i, 3) - 0.5) * 4)
    blobs = [(cx + j(1), 13, 9), (cx - 9 + j(2), 18, 7), (cx + 9 + j(3), 18, 7),
             (cx + j(4), 22, 8), (cx - 5, 9 + j(5) // 2, 6), (cx + 5, 9, 6)]
    s.rect(cx - 2, 26, 4, 14, "N")
    s.rect(cx - 2, 26, 1, 14, "o")
    s.rect(cx + 1, 26, 1, 14, "P")
    s.stamp(["N....N", ".NNNN."], cx - 3, 39)
    owner = {}
    for y in range(h):
        for x in range(w):
            best = None
            for i, (bx, by, r) in enumerate(blobs):
                d = math.hypot(x - bx, y - by)
                if d <= r and (best is None or by > blobs[best][1] or (by == blobs[best][1] and r - d > 0)):
                    best = i
            if best is not None:
                owner[(x, y)] = best
    for (x, y), i in owner.items():
        bx, by, r = blobs[i]
        light = -((x - bx) * 0.6 + (y - by) * 0.8) / r
        k = "v" if light > 0.3 else "B" if light < -0.45 else "G"
        if any(owner.get((x + dx, y + dy), i) != i and blobs[owner[(x + dx, y + dy)]][1] > by for dx, dy in N4):
            k = "B"
        s.put(x, y, k)
    top = blobs[0]
    s.put(top[0] - 4, top[1] - 5, "Y")
    s.put(top[0] - 3, top[1] - 6, "Y")
    return s.outline(), (cx, h - 3)


def bush(seed=0, berries=False):
    s = Sprite(18, 14)
    blobs = [(6, 8, 5), (11, 8, 5), (9, 5, 4)]
    for y in range(14):
        for x in range(18):
            inside = [b for b in blobs if math.hypot(x - b[0], y - b[1]) <= b[2]]
            if inside:
                b = max(inside, key=lambda b: b[1])
                light = -((x - b[0]) * 0.6 + (y - b[1]) * 0.8) / b[2]
                s.put(x, y, "v" if light > 0.35 else "B" if light < -0.5 else "G")
    if berries:
        for x, y in ((5, 7), (11, 9), (9, 5)):
            s.put(x, y, "R")
    return s.outline(), (9, 12)


def rock(big=False):
    w, h = (18, 13) if big else (12, 9)
    s = Sprite(w, h)
    cx, cy, rx, ry = w / 2 - 0.5, h / 2, w / 2 - 1.5, h / 2 - 1.5
    for y in range(h):
        for x in range(w):
            nx, ny = (x - cx) / rx, (y - cy) / ry
            if nx * nx + ny * ny <= 1:
                light = -(nx * 0.6 + ny * 0.8)
                s.put(x, y, "W" if light > 0.75 else "s" if light > -0.2 else "g")
    return s.outline(), (w // 2, h - 2)


def stump():
    s = Sprite(14, 12)
    s.rect(2, 5, 10, 5, "N")
    s.rect(2, 5, 2, 5, "o")
    s.rect(10, 5, 2, 5, "P")
    for x in range(2, 12):
        for y in range(1, 6):
            if ((x - 6.5) / 5) ** 2 + ((y - 3.5) / 2.6) ** 2 <= 1:
                s.put(x, y, "T")
    s.stamp([".oo.", "o..o", ".oo."], 5, 2)
    return s.outline(), (7, 10)


def flowers(kind):
    s = Sprite(12, 8)
    dots = {"W": [(1, 3), (5, 1), (8, 4), (3, 6)], "R": [(2, 2), (7, 3), (4, 5)], "Y": [(1, 4), (6, 2), (9, 5)]}[kind]
    for x, y in dots:
        s.put(x, y + 1, "G")
        s.stamp([".%s." % kind, "%sY%s" % (kind, kind) if kind != "Y" else "YoY", ".%s." % kind], x - 1, y - 1)
    return s, (6, 7)


def reeds():
    """Cattails at the waterline: light blades, brown heads, no black outline."""
    s = Sprite(12, 16)
    for x, top, lean in ((2, 5, -1), (5, 1, 0), (8, 3, 1), (10, 7, 1)):
        for y in range(top + 3, 15):
            s.put(x + (lean if y < top + 6 else 0), y, "v" if y < top + 7 else "G")
        s.rect(x + (lean if lean else 0), top, 1, 3, "N")
        s.put(x + (lean if lean else 0), top, "o")
    for x in (1, 4, 7, 11):
        s.put(x, 14, "G")
        s.put(x, 13, "v")
    return s, (6, 15)


def hay_bale():
    s = Sprite(20, 14)
    s.rect(1, 2, 18, 10, "Y")
    s.rect(1, 2, 18, 2, "W")
    s.rect(1, 9, 18, 3, "o")
    for x in (6, 13):
        s.rect(x, 2, 1, 10, "N")
    for x, y in ((3, 6), (9, 5), (16, 7), (11, 8)):
        s.put(x, y, "o")
    return s.outline(), (10, 12)


def crate():
    s = Sprite(16, 16)
    s.rect(1, 1, 14, 14, "o")
    s.rect(1, 1, 14, 2, "T")
    s.rect(1, 12, 14, 3, "N")
    s.rect(1, 1, 2, 14, "N")
    s.rect(13, 1, 2, 14, "N")
    for i in range(10):
        s.put(3 + i, 3 + i, "N")
    return s.outline(), (8, 15)


def barrel():
    s = Sprite(14, 18)
    for y in range(1, 17):
        for x in range(1, 13):
            if abs(x - 6.5) <= 5.5 - (0 if 3 < y < 14 else 1):
                s.put(x, y, "o" if x < 5 else "P" if x > 9 else "N")
    for y in (4, 12):
        s.rect(1, y, 12, 1, "g")
    s.rect(3, 1, 8, 2, "P")
    return s.outline(), (7, 17)


def woodpile():
    s = Sprite(30, 16)
    for row, (y, n, off) in enumerate(((10, 5, 0), (5, 4, 3))):
        for i in range(n):
            cx = 3 + off + i * 6
            for dy in range(5):
                for dx in range(5):
                    d = ((dx - 2) / 2.5) ** 2 + ((dy - 2) / 2.5) ** 2
                    if d <= 1:
                        s.put(cx + dx - 2, y + dy - 2, "T" if d < 0.3 else "o" if d < 0.75 else "N")
    return s.outline(), (15, 14)


def trough():
    s = Sprite(26, 11)
    s.rect(1, 2, 24, 7, "N")
    s.rect(1, 2, 24, 1, "o")
    s.rect(3, 3, 20, 3, "L")
    s.rect(3, 3, 20, 1, "C")
    s.rect(2, 9, 2, 2, "P")
    s.rect(22, 9, 2, 2, "P")
    return s.outline(), (13, 10)


def lily_pad(flower=False):
    s = Sprite(10, 7)
    for y in range(7):
        for x in range(10):
            if ((x - 4.5) / 4.5) ** 2 + ((y - 3) / 3) ** 2 <= 1 and not (x >= 5 and y == 3):
                s.put(x, y, "v" if x < 4 and y < 3 else "G")
    if flower:
        s.stamp([".W.", "WRW"], 2, 1)
    return s, (5, 6)


# ------------------------------------------------------------------ farm

def farmhouse():
    """Ray's saltbox: white clapboard, slate roof with the long rear slope, red door, green shutters."""
    w, h = 86, 80
    s = Sprite(w, h)
    roof_top, eave, wall_bottom = 10, 46, 75
    s.rect(58, 0, 9, 14, "s")                                   # stone chimney
    for y in range(0, 14, 3):
        s.rect(58, y, 9, 1, "g")
    s.rect(58, 0, 9, 1, "K")
    for y in range(roof_top, eave + 1):
        for x in range(1, w - 1):
            band = (y - roof_top) % 5
            k = "B" if band == 4 else "g"
            if band == 0 and (x // 7 + (y - roof_top) // 5) % 2 == 0:
                k = "s"
            if y <= roof_top + 1:
                k = "s"
            s.put(x, y, k)
    for x in range(1, 30):                                       # saltbox lean-to hangs lower over the left wall
        for y in range(eave + 1, eave + 7):
            s.put(x, y, "B" if (y - eave) % 3 == 0 else "g")
    s.rect(1, eave, w - 2, 1, "B")
    for y in range(eave + 1, wall_bottom):
        for x in range(4, w - 4):
            if x < 30 and y <= eave + 6:
                continue
            s.put(x, y, "s" if (y - eave) % 3 == 0 else "W")
    s.rect(4, eave + 1, 2, wall_bottom - eave - 1, "T")
    s.rect(w - 6, eave + 1, 2, wall_bottom - eave - 1, "T")
    s.rect(4, wall_bottom - 2, w - 8, 2, "O")
    for wx in (12, 60):                                          # windows with shutters and a flower box
        wy = eave + 9
        s.rect(wx - 3, wy, 2, 11, "G")
        s.rect(wx + 11, wy, 2, 11, "G")
        s.rect(wx - 1, wy - 1, 12, 13, "T")
        s.rect(wx, wy, 10, 11, "B")
        s.rect(wx + 1, wy + 1, 3, 1, "C")
        s.rect(wx + 1, wy + 1, 1, 3, "C")
        s.rect(wx + 4, wy, 1, 11, "W")
        s.rect(wx, wy + 5, 10, 1, "W")
        s.rect(wx - 1, wy + 12, 12, 3, "N")
        for fx in range(wx, wx + 10, 3):
            s.put(fx, wy + 11, "R" if fx % 2 else "Y")
    dx = w // 2 - 5                                              # red door
    s.rect(dx - 1, eave + 8, 12, wall_bottom - eave - 8, "T")
    s.rect(dx, eave + 9, 10, wall_bottom - eave - 9, "R")
    s.rect(dx + 1, eave + 11, 3, 6, "P")
    s.rect(dx + 6, eave + 11, 3, 6, "P")
    s.rect(dx + 1, eave + 19, 8, 6, "P")
    s.put(dx + 7, eave + 18, "Y")
    s.rect(dx - 2, wall_bottom, 14, 3, "O")                      # stone step
    s.rect(dx - 2, wall_bottom, 14, 1, "s")
    return s.outline(), (w // 2, wall_bottom + 2)


def barn():
    """Red gambrel barn facing the yard: white trim, X-braced doors, hayloft."""
    w, h = 96, 84
    s, cx = Sprite(w, h), w // 2
    peak, knee, eave, bottom = 3, 16, 32, 79

    def half(y):
        if y < knee:
            return 12 + (y - peak) * (32 - 12) / (knee - peak)
        return 32 + (y - knee) * (44 - 32) / (eave - knee)

    for y in range(peak, eave + 1):
        hw = round(half(y))
        for x in range(cx - hw, cx + hw + 1):
            edge = x - (cx - hw) < 3 or (cx + hw) - x < 3 or y - peak < 3
            if edge:
                k = "s" if x < cx else "g"
            else:
                k = "P" if (x - cx) % 5 == 0 else "R"
            s.put(x, y, k)
    s.rect(cx - 44, eave, 89, bottom - eave, "R")
    for x in range(cx - 44, cx + 45):
        if (x - cx) % 5 == 0:
            s.rect(x, eave, 1, bottom - eave, "P")
    s.rect(cx - 44, eave, 3, bottom - eave, "W")
    s.rect(cx + 42, eave, 3, bottom - eave, "W")
    s.rect(cx - 44, eave, 89, 2, "W")
    s.rect(cx - 8, 14, 16, 14, "W")                              # hayloft
    s.rect(cx - 6, 16, 12, 10, "K")
    s.rect(cx - 6, 22, 12, 4, "Y")
    s.rect(cx - 6, 22, 12, 1, "o")
    s.rect(cx - 20, 46, 40, bottom - 46, "W")                    # doors
    for d in (-18, 1):
        x0 = cx + d
        s.rect(x0, 48, 17, bottom - 48, "R")
        for i in range(17):
            y = 48 + round(i * (bottom - 49) / 16)
            s.put(x0 + i, y, "W")
            s.put(x0 + i, 48 + (bottom - 49) - (y - 48), "W")
        s.rect(x0, 48, 17, 1, "P")
    s.rect(cx - 1, 46, 2, bottom - 46, "W")
    s.rect(cx - 46, bottom, 93, 3, "O")
    s.rect(cx - 1, 0, 2, peak + 1, "g")                          # weathervane
    s.rect(cx - 3, 0, 6, 1, "K")
    return s.outline(), (cx, bottom + 2)


def windmill():
    """The old mill: stone tower, one broken sail, and the jammed gear on its side."""
    w, h = 64, 88
    s, cx = Sprite(w, h), w // 2
    top, bottom = 30, 84
    for y in range(top, bottom):
        hw = round(7 + (y - top) * 3 / (bottom - top))
        for x in range(cx - hw, cx + hw + 1):
            block = ((y // 4) + (x + (y // 4) % 2 * 2) // 4) % 2
            k = "W" if x - (cx - hw) < 2 else "g" if (cx + hw) - x < 3 else ("s" if block else "T")
            if y % 4 == 0:
                k = "g" if k != "W" else "s"
            s.put(x, y, k)
    s.rect(cx - 3, bottom - 12, 6, 12, "N")
    s.rect(cx - 3, bottom - 12, 6, 1, "o")
    for y in range(18, top + 2):                                 # wooden cap
        hw = round(3 + (y - 18) * 6 / (top + 2 - 18))
        for x in range(cx - hw, cx + hw + 1):
            s.put(x, y, "o" if x < cx - hw // 2 else "P" if x > cx + hw // 2 else "N")
    hub = (cx, 24)
    for (dx, dy), length in (((1, -1), 24), ((-1, -1), 24), ((-1, 1), 22), ((1, 1), 11)):
        for t in range(3, length):
            x, y = hub[0] + dx * t, hub[1] + dy * t
            s.put(x, y, "N")
            if t > 6 and t % 2 == 0:
                for k in range(1, 4):
                    s.put(x - dy * k * dx * dx, y + dx * k * dy * dy, "T" if k < 3 else "O")
    s.rect(hub[0] - 1, hub[1] - 1, 3, 3, "K")
    gx, gy = cx + 6, 52                                          # the jammed gear
    for a in range(12):
        ang = a * math.pi / 6
        s.put(gx + round(math.cos(ang) * 4), gy + round(math.sin(ang) * 4), "Y" if a % 2 else "o")
    s.rect(gx - 2, gy - 2, 5, 5, "o")
    s.put(gx, gy, "K")
    s.stamp(["NN.", ".NN"], gx + 3, gy + 3)
    return s.outline(), (cx, bottom - 1)


# The DB16 pass is a comparison render only (see build.py's own header) --
# the shipped building is rich/buildings.py's `workshop()`, wired in by
# `patch_kit()`. This alias just keeps the unpatched DB16 render (and
# `homestead.py`'s own `kit.workshop()` call) from breaking.
workshop = windmill


def coop():
    w, h = 36, 34
    s = Sprite(w, h)
    for y in range(2, 14):
        hw = round(6 + (y - 2) * 11 / 11)
        for x in range(w // 2 - hw, w // 2 + hw + 1):
            s.put(x, y, "R" if (y % 3) else "P")
    s.rect(3, 13, w - 6, 1, "P")
    s.rect(5, 14, w - 10, 16, "o")
    for x in range(5, w - 5, 4):
        s.rect(x, 14, 1, 16, "N")
    s.rect(w // 2 - 4, 19, 8, 11, "K")
    s.stamp(["oo..", "..oo"], w // 2 + 3, 29)
    s.rect(4, 30, w - 8, 2, "O")
    return s.outline(), (w // 2, 31)


def well():
    w, h = 22, 30
    s = Sprite(w, h)
    s.rect(3, 2, 16, 3, "N")
    s.rect(3, 2, 16, 1, "o")
    s.rect(4, 5, 2, 14, "N")
    s.rect(16, 5, 2, 14, "N")
    s.rect(6, 8, 10, 1, "P")
    s.rect(10, 9, 3, 4, "g")
    for y in range(15, 28):
        for x in range(2, 20):
            if ((x - 10.5) / 8.5) ** 2 + ((y - 21) / 6) ** 2 <= 1:
                inner = ((x - 10.5) / 6) ** 2 + ((y - 19) / 3) ** 2 <= 1
                s.put(x, y, "K" if inner else ("s" if (x + y // 2) % 4 else "g"))
    s.rect(7, 19, 7, 1, "B")
    return s.outline(), (11, 27)


def fence(length, vertical=False):
    if vertical:
        s = Sprite(7, length + 8)
        s.rect(2, 2, 2, length + 4, "o")
        s.rect(4, 2, 1, length + 4, "N")
        for y in range(0, length + 1, 16):
            s.rect(1, y + 1, 5, 7, "N")
            s.rect(1, y + 1, 5, 1, "T")
        return s.outline(), (3, length + 6)
    s = Sprite(length + 8, 12)
    for y in (3, 7):
        s.rect(2, y, length + 4, 2, "o")
        s.rect(2, y + 2, length + 4, 1, "N")
    for x in range(0, length + 1, 16):
        s.rect(x + 2, 1, 3, 10, "N")
        s.rect(x + 2, 1, 3, 1, "T")
        s.rect(x + 4, 2, 1, 9, "P")
    return s.outline(), ((length + 8) // 2, 10)


def dock():
    w, h = 44, 22
    s = Sprite(w, h)
    s.rect(1, 3, w - 2, 12, "o")
    for x in range(1, w - 1, 5):
        s.rect(x, 3, 1, 12, "N")
    s.rect(1, 3, w - 2, 1, "T")
    s.rect(1, 15, w - 2, 3, "N")
    s.rect(1, 17, w - 2, 1, "P")
    for x in (3, 20, w - 5):
        s.rect(x, 1, 3, 20, "P")
        s.rect(x, 1, 3, 1, "N")
    return s.outline(), (w // 2, 18)


def fallen_log():
    w, h = 70, 22
    s = Sprite(w, h)
    for y in range(4, 18):
        for x in range(6, w - 6):
            k = "o" if y < 7 else "P" if y > 14 else "N"
            if (x * 3 + y * 5) % 17 == 0 and 6 < y < 15:
                k = "P"
            s.put(x, y, k)
    for ex in (6, w - 7):
        for y in range(3, 19):
            for x in range(ex - 5, ex + 6):
                d = ((x - ex) / 5) ** 2 + ((y - 10.5) / 7.5) ** 2
                if d <= 1:
                    s.put(x, y, "o" if d > 0.55 else "T" if d > 0.2 else "N")
    for x, y in ((18, 3), (19, 3), (20, 4), (40, 3), (41, 3), (52, 4)):
        s.put(x, y, "v")
    s.stamp([".RR.", "RWRR", ".TT."], 30, 0)
    return s.outline(), (w // 2, 19)


def broken_cart():
    w, h = 50, 32
    s = Sprite(w, h)
    for y in range(8, 22):
        tilt = (y - 8) // 3
        s.rect(4 + tilt, y, 30, 1, "o" if y < 11 else "N")
    for x in range(4, 36, 6):
        s.rect(x, 11, 1, 11, "P")
    s.rect(30, 22, 16, 2, "N")                                   # snapped shaft
    cx, cy = 14, 24                                              # wheel on its side
    for a in range(16):
        ang = a * math.pi / 8
        s.put(cx + round(math.cos(ang) * 6), cy + round(math.sin(ang) * 3), "N")
    for a in range(4):
        ang = a * math.pi / 4
        s.put(cx + round(math.cos(ang) * 3), cy + round(math.sin(ang) * 1.5), "o")
    s.stamp(["oooo", "oNNo", "oooo"], 38, 26)
    s.stamp(["YY.Y", ".YYY"], 22, 26)
    return s.outline(), (24, 29)


def greenhouse_ruin():
    """Where the greenhouse will be raised: a stone footing gone to weeds. Ground-level, no shadow."""
    w, h = 82, 58
    s = Sprite(w, h)
    for x in range(2, w - 2):
        for y in (2, 3, h - 4, h - 3):
            if (x // 9) % 4 != 3:
                s.put(x, y, "s" if y in (2, h - 4) else "g")
    for y in range(2, h - 2):
        for x in (2, 3, w - 4, w - 3):
            if (y // 9) % 3 != 2:
                s.put(x, y, "s" if x in (2, w - 4) else "g")
    for x, y in ((14, 12), (30, 30), (55, 18), (64, 40), (22, 44)):
        s.stamp([".G.G", "G.G."], x, y)
    for x, y in ((40, 8), (61, 49)):
        s.stamp(["CW", "C."], x, y)
    return s, (w // 2, h - 2)


def signpost():
    s = Sprite(20, 24)
    s.rect(9, 6, 2, 17, "N")
    s.rect(9, 6, 1, 17, "o")
    s.stamp(["oooooooooo.", "oNNoNNNooo.", "ooooooooooo", "oNoNNoooo..", "oooooooo..."], 3, 2)
    return s.outline(), (10, 22)


def mailbox():
    s = Sprite(14, 20)
    s.rect(6, 8, 2, 11, "N")
    s.rect(2, 2, 10, 7, "L")
    s.rect(2, 2, 10, 1, "C")
    s.rect(2, 8, 10, 1, "B")
    s.rect(11, 3, 2, 4, "R")
    return s.outline(), (7, 18)


def loose_board():
    s = Sprite(8, 18)
    s.rect(2, 1, 4, 16, "o")
    s.rect(5, 1, 1, 16, "N")
    s.put(3, 4, "g")
    s.put(3, 13, "g")
    return s.outline(), (4, 17)


def hen(facing_left=False):
    rows = [
        "...RR....",
        "..WWW....",
        ".WKWWo...",
        "..WWWWWW.",
        "..WWWWWsW",
        "...WWWWs.",
        "....o.o..",
    ]
    if facing_left:
        rows = [r[::-1] for r in rows]
    s = Sprite(11, 9)
    s.stamp(rows, 1, 1)
    return s.outline(), (5, 8)


def crop(stage, seed=0):
    rows = {
        0: ["v.v", ".G."],
        1: [".v.v.", "vGvG.", "..G.."],
        2: [".vGv.", "vGvGv", ".GoG.", "..o.."],
    }[stage]
    s = Sprite(len(rows[0]) + 2, len(rows) + 2)
    s.stamp(rows, 1, 1)
    return s.outline("P"), (s.w // 2, s.h - 1)
