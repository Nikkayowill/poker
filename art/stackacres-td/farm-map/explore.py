"""The player-built Homestead: the house in a clearing in the woods, with more clearings
round it to find, a stream with a footbridge, a pond and a landmark at every far end.
No barn, no workshop, no paths on day one. LPC pack art plus the gable buildings, at
32px per game tile, the same kit as farm_map.py.

    python3 explore.py                # day one
    STAGE=later python3 explore.py    # one player's farm a while later
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_dilation, distance_transform_edt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'rich'))

import lpc_ground  # noqa: E402
import lpc_trees   # noqa: E402
import gable_kit as K  # noqa: E402
import gable_buildings as GB  # noqa: E402

T = 32
TW, TH = 64, 44
W, H = TW * T, TH * T
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.environ.get('OUT', os.path.join(HERE, 'previews'))
os.makedirs(OUT, exist_ok=True)
ATLAS = Image.open(os.path.join(HERE, '..', 'lpc', 'terrain', 'terrain_atlas.png')).convert('RGBA')
hsh = K.hsh


def cut(box):
    x, y, w, h = box
    return ATLAS.crop((x, y, x + w, y + h))


# ------------------------------------------------------------------ sprites
TREE = {k: cut(v) for k, v in lpc_trees.TREES.items()}
CROWNS = [cut(b) for b in lpc_trees.CROWNS]
BIGBUSH = cut(lpc_trees.BUSH)
ROCKS = [cut(b) for b in [(768, 676, 31, 22), (928, 772, 31, 22), (674, 675, 28, 27), (451, 740, 23, 19), (422, 742, 20, 21)]]
BIGROCK = cut((962, 686, 29, 44))
BOULDERS = [cut((834, 686, 60, 44)), cut((896, 690, 62, 40))]
BUSH_S = cut((289, 448, 31, 30))
BERRY = cut((390, 779, 19, 16))
MUSH = [cut((866, 898, 28, 28)), cut((834, 994, 28, 28))]
SUNFLOWER = cut((484, 788, 25, 41))
STUMP = cut((740, 582, 25, 19))
CATTAIL = cut((836, 929, 24, 53))
LILY = cut((194, 964, 30, 28))
LILY_F = cut((226, 964, 30, 28))
TALL_S = cut((292, 808, 26, 26))   # a grass tuft; the pack's tall grass reads as green pillars out here
FERN = cut((392, 836, 22, 26))
SPROUT = cut((357, 809, 18, 21))
CROP = {
    'corn': cut((482, 897, 28, 62)), 'tomato': cut((354, 921, 26, 36)), 'lettuce': cut((322, 871, 24, 23)),
    'artichoke': cut((384, 873, 31, 20)), 'potato': cut((293, 970, 22, 21)), 'sprout': SPROUT,
    'pepper': cut((417, 925, 31, 33)), 'melon': cut((454, 900, 25, 25)),
}
PAVE = cut((32, 512, 64, 64))
WALLS = [cut((736, 830, 128, 64))]
PILLAR = cut((768, 732, 18, 92))

fence = Image.open(os.path.join(REPO, 'public', 'stackacres-td', 'common', 'fence.png')).convert('RGBA')
fence = fence.resize((fence.width * 2, fence.height * 2), Image.NEAREST)
FENCE = [fence.crop((i * 32, 0, i * 32 + 32, 64)) for i in range(8)]


def fruit_tree(seed, fruit=True):
    t = TREE['broadleaf'].copy()
    if fruit:
        for fx, fy in ((14, 20), (30, 32), (22, 44), (40, 26), (8, 36))[: 3 + seed % 3]:
            t.alpha_composite(BERRY, (fx, fy))
    return t


# ------------------------------------------------------------------ flowers (as in farm_map.py)
FLOWER_COLS = {
    'red': ['#6e1224', '#c32b3d', '#f05c58', '#ffb3a0'], 'pink': ['#6e2254', '#cc4b8c', '#f58cc2', '#ffd6ea'],
    'yellow': ['#6e4e0c', '#dca21c', '#ffd548', '#fff6b0'], 'purple': ['#342060', '#6644ae', '#9a7ae0', '#d6c8ff'],
    'white': ['#5c5c6c', '#cfd0da', '#f4f4fa', '#ffffff'], 'blue': ['#18356e', '#3a66cc', '#6c9cff', '#c4dcff'],
    'orange': ['#6e2c0c', '#d8601c', '#ff9a3c', '#ffd49a'],
}
STEM = [K.hx(c) for c in ('#173318', '#2b6128', '#48973a', '#79c24e')]


def flower_clump(kind, seed):
    P = [K.hx(c) for c in FLOWER_COLS[kind]]
    cv = K.Cv(18, 20)
    n = 3 + int(hsh(seed, 1, 90) * 4)
    heads = [(3 + int(hsh(seed, i, 91) * 12), 3 + int(hsh(seed, i, 92) * 8)) for i in range(n)]
    for i in range(5):
        lx = 3 + int(hsh(seed, i, 93) * 12)
        for k in range(3):
            cv.put(lx + (k if i % 2 else -k), 18 - k, STEM[1 + (k % 2)])
        cv.put(lx, 19, STEM[0])
    for hx_, hy_ in heads:
        for y in range(hy_ + 2, 19):
            cv.put(hx_, y, STEM[2]); cv.put(hx_ + 1, y, STEM[1])
    for hx_, hy_ in sorted(heads, key=lambda h: h[1]):
        if kind == 'purple':
            for k in range(6):
                cv.put(hx_, hy_ - 2 + k, P[2 if k % 2 else 1]); cv.put(hx_ + 1, hy_ - 2 + k, P[1 if k % 2 else 2])
            cv.put(hx_, hy_ - 3, P[3])
            continue
        petals = [(0, -1), (-1, 0), (1, 0), (0, 1), (-1, -1), (1, -1)] if kind == 'red' else [(0, -1), (-1, 0), (1, 0), (0, 1)]
        for dx, dy in [(a, b) for a in range(-2, 3) for b in range(-2, 3)]:
            if abs(dx) + abs(dy) <= 2 and (dx, dy) not in petals and (dx, dy) != (0, 0):
                if any((dx - a, dy - b) in petals or (dx - a, dy - b) == (0, 0) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    cv.put(hx_ + dx, hy_ + dy, P[0])
        for dx, dy in petals:
            cv.put(hx_ + dx, hy_ + dy, P[2])
        cv.put(hx_ - 1, hy_ - 1 if kind == 'red' else hy_, P[3])
        cv.put(hx_, hy_ - 1, P[3])
        cv.put(hx_, hy_, K.hx('#ffd23c') if kind in ('white', 'blue', 'pink') else P[1])
        if kind in ('white', 'blue', 'pink'):
            cv.put(hx_ + 1, hy_ + 1, P[1])
    return cv.image()


KINDS = list(FLOWER_COLS)
FLOWERS = {(k, i): flower_clump(k, i * 7 + j) for j, k in enumerate(KINDS) for i in range(4)}


# ================================================================== the land, as places to find
# Rooms are clearings in the woods, joined by narrow gaps. Tile units.
ROOMS = {
    'home': (31.0, 20.5, 11.0, 7.2),
    'woods': (10.5, 20.5, 8.5, 9.0),
    'meadow': (54.0, 15.0, 8.8, 7.0),
    'pondside': (49.0, 29.5, 8.0, 5.4),
    'thicket': (55.0, 37.2, 7.0, 4.6),
    'stones': (14.5, 36.0, 10.0, 5.2),
    'glade': (34.0, 38.6, 5.4, 3.8),
    'cove': (11.5, 10.8, 6.0, 3.8),
}
PASSES = [
    ([(21.5, 21.0), (17.0, 20.0)], 2.0),                     # home to the oak woods
    ([(39.5, 20.5), (44.0, 19.0), (48.0, 17.0)], 1.6),       # home, over the footbridge, to the meadow
    ([(25.5, 25.5), (21.0, 29.5), (18.0, 33.0)], 1.9),       # home down to the stone field
    ([(32.5, 26.5), (33.2, 31.0), (33.8, 35.0)], 1.3),       # the narrow gap to the hidden glade
    ([(38.5, 24.0), (42.0, 26.0), (44.5, 28.0)], 1.9),       # home to the pond
    ([(52.0, 31.5), (55.0, 34.5)], 1.9),                     # pond to the thicket, over stepping stones
    ([(12.0, 13.5), (11.0, 15.5)], 1.7),                     # woods up to the cove
    ([(29.5, 15.5), (27.5, 11.0)], 1.5),                     # home up to the shore and the dock
]
PENINSULA = (26.0, 6.4, 2.3, 2.6)
POND = (48.8, 29.2, 3.6, 2.3)
STREAM_IN = [(66.0, 25.0), (61.0, 26.6), (57.0, 27.2), (52.2, 28.6)]
STREAM_OUT = [(45.8, 28.0), (44.8, 24.5), (46.2, 20.5), (45.4, 16.0), (44.6, 12.0), (45.0, 6.0)]
BRIDGE = (45.7, 18.6)
STEPS = (56.4, 27.2)

STAGE = os.environ.get('STAGE', 'day1')
LATER = STAGE == 'later'
# what one player has made of it a while later (tile rects, x0 y0 x1 y1 exclusive)
FLOORS = [('path', 26, 12, 28, 23),                      # the dock down to the yard
          ('path', 16, 22, 27, 24), ('path', 22, 19, 24, 22),   # west to the woods, and the workshop door
          ('path', 20, 24, 22, 32),                      # down to the stone-field gate
          ('path', 36, 22, 44, 24), ('path', 42, 19, 44, 22), ('path', 38, 20, 41, 22),   # east to the bridge, and the barn door
          ('cobble', 31, 24, 33, 30)] if LATER else []   # south toward the standing stones
PAVE_RECTS = [(27, 22, 36, 24)] if LATER else []
BUILT_AT = [('workshop', 23 * T + 8, 19 * T + 8), ('barn', 39 * T + 8, 19 * T + 20)] if LATER else []
FIELDS = [(14, 32, 23, 39, ['corn', 'tomato', None, 'lettuce', 'potato', 'melon'], {(20, 32), (21, 32)}),
          (46, 32, 55, 36, ['pepper', 'artichoke', None, 'sprout'], {(46, 33), (46, 34)})] if LATER else []
ORCHARD = [(7, 10), (10, 10), (13, 10), (16, 11), (8, 13), (11, 13), (14, 13)] if LATER else []
SAPLINGS = [(36, 12), (38, 12), (40, 13)] if LATER else []
CLEARED = [(34.5, 12.5, 4.0, 3.0)] if LATER else []           # a bite taken out of the woods behind the barn

U = 16                                                    # map units per tile (the water mask's resolution)
uy, ux = np.mgrid[0:TH * U, 0:TW * U]
tyu, txu = (uy + 0.5) / U, (ux + 0.5) / U                 # every unit's position, in tiles


def blob(cx, cy, rx, ry, seed):
    """An ellipse whose edge wanders, so no clearing is a clean oval."""
    dx, dy = (txu - cx) / rx, (tyu - cy) / ry
    a = np.arctan2(dy, dx)
    r = 1 + 0.13 * np.sin(a * 3 + seed) + 0.08 * np.sin(a * 5 + seed * 1.7) + 0.05 * np.sin(a * 9 + seed * 0.3)
    return dx * dx + dy * dy <= r * r


def near_line(pts, hw):
    m = np.zeros(txu.shape, bool)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        vx, vy = x1 - x0, y1 - y0
        t = np.clip(((txu - x0) * vx + (tyu - y0) * vy) / (vx * vx + vy * vy), 0, 1)
        d = np.hypot(txu - (x0 + t * vx), tyu - (y0 + t * vy))
        wob = hw * (1 + 0.25 * np.sin(txu * 1.3 + tyu * 0.7))
        m |= d <= wob
    return m


lake_u = uy < (116 + 16 * np.sin(ux * 0.029) + 9 * np.sin(ux * 0.083 + 1.0)) * np.clip(np.minimum(ux - 96, 952 - ux) / 90.0, 0, 1) ** 0.5
pen = blob(*PENINSULA, seed=4)
stream = near_line(STREAM_IN, 0.8) | near_line(STREAM_OUT, 0.75)
pond = blob(*POND, seed=2)
water = (lake_u & ~pen) | stream | pond

land = np.zeros(txu.shape, bool)
for i, (name, r) in enumerate(ROOMS.items()):
    land |= blob(*r, seed=i * 1.9)
for pts, hw in PASSES:
    land |= near_line(pts, hw)
land |= near_line(STREAM_OUT[1:-1], 2.2) & (tyu > 9)          # the stream's banks
# the shore: a strip of open ground below the lake, broken where the woods come down to the water
shore_u = (~lake_u) & np.roll(lake_u, 16 * 4, axis=0) & (txu > 7) & (txu < 58)
shore_gaps = (np.sin(txu * 0.5) + np.sin(txu * 0.23 + 2)) < -1.1
land |= shore_u & ~shore_gaps
land |= pen
for c in CLEARED:
    land |= blob(*c, seed=7)
land &= ~water

pass_u = np.zeros(txu.shape, bool)
for pts, hw in PASSES:
    pass_u |= near_line(pts, hw + 0.6)
pass_px = np.repeat(np.repeat(pass_u, 2, 0), 2, 1)
LAND_T = land[U // 2::U, U // 2::U][:TH, :TW]
WATER_T = water[U // 2::U, U // 2::U][:TH, :TW]
inner = np.repeat(np.repeat(land | water, 2, 0), 2, 1)       # render px
lake_px = np.repeat(np.repeat(water, 2, 0), 2, 1)


def room_of(tx, ty):
    best, bd = 'pass', 1.6
    for name, (cx, cy, rx, ry) in ROOMS.items():
        d = ((tx + 0.5 - cx) / rx) ** 2 + ((ty + 0.5 - cy) / ry) ** 2
        if d < bd:
            best, bd = name, d
    if best == 'pass' and ty < 13:
        return 'shore'
    return best


# ================================================================== ground
tiles = [['grass'] * TW for _ in range(TH)]
near_water = binary_dilation(WATER_T, iterations=2)
for mat, x0, y0, x1, y1 in FLOORS:
    for ty in range(y0, y1):
        for tx in range(x0, x1):
            tiles[ty][tx] = mat
for x0, y0, x1, y1, *_ in FIELDS:
    for ty in range(y0 + 1, y1):
        for tx in range(x0 + 1, x1):
            tiles[ty][tx] = 'soil'
ground = lpc_ground.paint(tiles, TW, TH, water=water)
img = Image.fromarray(np.clip(ground, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')

ov = Image.new('RGBA', (W, H))
od = ImageDraw.Draw(ov)
for x0, y0, x1, y1 in PAVE_RECTS:
    for ty in range(y0, y1):
        for tx in range(x0, x1):
            tile = np.asarray(PAVE.crop(((tx % 2) * 32, (ty % 2) * 32, (tx % 2) * 32 + 32, (ty % 2) * 32 + 32))).astype(np.float64).copy()
            tile[..., :3] *= 0.93 + 0.12 * hsh(tx, ty, 61)
            ov.alpha_composite(Image.fromarray(tile.clip(0, 255).astype(np.uint8), 'RGBA'), (tx * T, ty * T))
    od.rectangle([x0 * T - 2, y0 * T - 2, x1 * T + 1, y1 * T + 1], outline=(58, 62, 66, 255), width=3)
img.alpha_composite(ov)

objs, shadows = [], []


def place(im, fx, fy, ax=None, ay=None, shadow=None):
    ax = im.width // 2 if ax is None else ax
    ay = im.height if ay is None else ay
    objs.append((fy, im, fx - ax, fy - ay))
    if shadow:
        shadows.append((fx, fy, shadow))


def flower_at(x, y, kind=None):
    k_ = kind or KINDS[int(hsh(x, y, 94) * len(KINDS))]
    place(FLOWERS[(k_, int(hsh(x, y, 95) * 4))], x, y)


def on_land(x, y):
    return 0 <= x < W and 0 <= y < H and inner[int(y), int(x)] and not lake_px[int(y), int(x)]


# the woods: single trees, each a little different, so nothing repeats in a grid

def tinted(im, bright, warm, seed):
    """The same tree in another green: leaves only, the trunk stays bark-brown."""
    a = np.asarray(im).astype(np.float64).copy()
    leaf = (a[..., 3] > 0) & (a[..., 1] > a[..., 0] + 8)
    mul = np.array([1 + 0.07 * warm, 1 + 0.02 * warm, 1 - 0.09 * warm]) * bright
    a[leaf, :3] *= mul
    out = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
    return out.transpose(Image.FLIP_LEFT_RIGHT) if seed % 2 else out


KINDS_T = {'pine': TREE['pine'], 'oak': TREE['oak'], 'broadleaf': TREE['broadleaf'],
           'crownA': CROWNS[0], 'crownB': CROWNS[1], 'bush': BIGBUSH, 'small': BUSH_S}
VARIANTS = {k: [tinted(im, b_, w_, i) for i, (b_, w_) in enumerate(
    [(1.0, 0), (0.9, -1), (1.05, 1), (0.84, -0.5), (0.96, 0.6), (0.9, 1.2)])] for k, im in KINDS_T.items()}

land_px = np.repeat(np.repeat(land, 2, 0), 2, 1)
open_px = inner                                        # land or water: somewhere a tree can't stand
D = distance_transform_edt(~open_px)                   # how deep into the woods each pixel is
ga = np.asarray(img).astype(np.float64).copy()
f_ = np.clip(D / 28, 0, 1)
f_ = f_ * f_ * (3 - 2 * f_)
ga[..., 0] *= 1 - 0.55 * f_
ga[..., 1] *= 1 - 0.42 * f_
ga[..., 2] *= 1 - 0.38 * f_
img = Image.fromarray(ga.clip(0, 255).astype(np.uint8), 'RGBA')
sat = np.pad(land_px.astype(np.int32), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
psat = np.pad((pass_px & land_px).astype(np.int32), ((1, 0), (1, 0))).cumsum(0).cumsum(1)


def covered(S_, x0, y0, x1, y1):
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(W, x1), min(H, y1)
    if x0 >= x1 or y0 >= y1:
        return 0.0
    n = S_[y1, x1] - S_[y0, x1] - S_[y1, x0] + S_[y0, x0]
    return n / ((x1 - x0) * (y1 - y0))


SHORTER = {'pine': 'crownA', 'oak': 'broadleaf', 'broadleaf': 'bush', 'crownA': 'bush', 'crownB': 'bush', 'bush': 'small', 'small': None}
for gy in range(-40, H + 150, 22):
    for gx in range(-40, W + 40, 26):
        x = gx + int(hsh(gx, gy, 1) * 20) - 10
        y = gy + int(hsh(gx, gy, 2) * 16) - 8
        xi, yi = min(W - 1, max(0, x)), min(H - 1, max(0, y))
        if open_px[yi, xi]:
            continue
        d = D[yi, xi]
        v = hsh(gx, gy, 3)
        if d < 70:
            kind = 'oak' if v < 0.22 else 'broadleaf' if v < 0.44 else 'pine' if v < 0.7 else 'bush' if v < 0.86 else 'crownA'
            if hsh(gx, gy, 4) < 0.15:
                continue                                  # the edge is uneven: gaps where you see into the woods
        else:
            kind = 'pine' if v < 0.42 else 'crownA' if v < 0.66 else 'crownB' if v < 0.9 else 'oak'
        while kind:
            im = VARIANTS[kind][int(hsh(gx, gy, 5) * 6)]
            box = (x - im.width // 2, y - im.height, x + im.width // 2, y)
            if covered(psat, *box) < 0.02 and covered(sat, *box) < 0.22:
                break
            kind = SHORTER[kind]
        if not kind:
            continue
        place(im, x, y + (im.height // 2 - 8 if kind.startswith('crown') else 0),
              shadow=('tree', im.width * 0.55) if d < 90 and kind in ('oak', 'broadleaf', 'pine') else None)

# undergrowth where a clearing meets the trees, so the edge is ragged, not cut
Dl = distance_transform_edt(land_px)                   # for land pixels: how far to the woods
for gy in range(0, H, 22):
    for gx in range(0, W, 24):
        x = gx + int(hsh(gx, gy, 11) * 16) - 8
        y = gy + int(hsh(gx, gy, 12) * 14) - 7
        if not (0 <= x < W and 0 <= y < H) or not land_px[y, x] or lake_px[y, x]:
            continue
        if Dl[y, x] > 30 or pass_px[y, x] and Dl[y, x] > 12:
            continue
        v = hsh(gx, gy, 13)
        if v < 0.22:
            b = BUSH_S.copy()
            if hsh(gx, gy, 14) < 0.25:
                b.alpha_composite(BERRY, (6, 4))
            place(tinted(b, 0.9 + hsh(gx, gy, 15) * 0.15, hsh(gx, gy, 16) - 0.5, int(v * 100)), x, y)
        elif v < 0.40:
            place(FERN, x, y)
        elif v < 0.56:
            place(TALL_S, x, y)
        elif v < 0.64:
            flower_at(x, y)

# ================================================================== landmarks: a reason to go everywhere
HOUSE = (31 * T + 16, 21 * T + 20)
house = GB.farmhouse()
place(house, *HOUSE, shadow=('bld', house))

# the old dock off the point, and a rowboat by the cove
px, py = PENINSULA[0] * T, (PENINSULA[1] - PENINSULA[3] + 0.6) * T
dock = K.Cv(52, 150)
for y in range(138):
    for x in range(52):
        ly2 = y % 7
        c = K.WOOD[3] if ly2 < 6 else K.WOOD[1]
        if ly2 == 0: c = K.WOOD[4]
        if x in (0, 51): c = K.DARKWOOD[1]
        if hsh(x, y, 81) < 0.04 and ly2 not in (0, 6): c = K.WOOD[2]
        dock.put(x, y, c)
for x in range(52):
    for y in range(138, 142):
        dock.put(x, y, K.DARKWOOD[1 if y < 140 else 0])
for pyy in range(6, 138, 40):
    for pxx in (-2, 50):
        for y in range(pyy, pyy + 10):
            for kk in range(4):
                dock.put(pxx + kk, y, K.DARKWOOD[[3, 2, 1, 0][kk]])
dock.outline(0.5)
objs.append((int(py) + 2, dock.image(), int(px) - 26, int(py) - 142))
boat = K.Cv(30, 52)
for y in range(52):
    for x in range(30):
        e = ((x - 14.5) / 14.5) ** 2 + ((y - 26) / 26) ** 4
        if e > 1:
            continue
        c = K.WOOD[4] if x < 12 else K.WOOD[2]
        if e > 0.6: c = K.DARKWOOD[2]
        inside_ = ((x - 14.5) / 11.5) ** 2 + ((y - 26) / 22) ** 4 <= 1
        if inside_ and e <= 0.6:
            c = K.DARKWOOD[3] if (y // 5) % 2 else K.DARKWOOD[4]
        boat.put(x, y, c)
for x in range(4, 26):
    boat.put(x, 18, K.WOOD[5]); boat.put(x, 19, K.WOOD[3]); boat.put(x, 34, K.WOOD[5]); boat.put(x, 35, K.WOOD[3])
boat.outline(0.45)
objs.append((1, boat.image(), 14 * T, 6 * T))

# the ancient oak with a fairy ring of mushrooms in the woods
ox_, oy_ = 10 * T + 16, 19 * T + 28
place(TREE['oak'], ox_, oy_, shadow=('tree', 70))
for i in range(11):
    a = i / 11 * 2 * np.pi
    place(MUSH[1] if i % 3 == 0 else MUSH[i % 2], int(ox_ + np.cos(a) * 92), int(oy_ - 30 + np.sin(a) * 58))

# the old greenhouse: broken stone walls and pillars in the meadow
gx0, gy0 = 51 * T, 11 * T
for i, (wx, wy) in enumerate(((10, 0), (150, 0), (40, 150), (200, 150))):
    wall = WALLS[0] if i % 2 == 0 else WALLS[0].transpose(Image.FLIP_LEFT_RIGHT)
    place(wall, gx0 + wx + wall.width // 2, gy0 + wy + wall.height)
for i in range(7):
    r_ = ROCKS[int(hsh(i, 3, 44) * 3)]
    place(r_, gx0 + 20 + int(hsh(i, 4, 44) * 260), gy0 + 90 + int(hsh(i, 5, 44) * 150))
for pxx, pyy in ((-10, 40), (300, 40), (-10, 190), (300, 190)):
    place(PILLAR, gx0 + pxx + 9, gy0 + pyy)
for i in range(18):
    flower_at(gx0 + 30 + int(hsh(i, 1, 44) * 240), gy0 + 60 + int(hsh(i, 2, 44) * 110), ['white', 'purple', 'yellow'][i % 3])

# the hidden glade's ring of standing stones
sx_, sy_ = 34 * T, 38 * T + 8
for i in range(7):
    a = i / 7 * 2 * np.pi + 0.3
    place(BIGROCK, int(sx_ + np.cos(a) * 78), int(sy_ + np.sin(a) * 50), shadow=('tree', 22))
place(ROCKS[2], sx_, sy_ + 6)
for i in range(26):
    a, r = hsh(i, 1, 45) * 2 * np.pi, 20 + hsh(i, 2, 45) * 120
    flower_at(int(sx_ + np.cos(a) * r * 1.2), int(sy_ + np.sin(a) * r * 0.7), ['blue', 'white', 'purple'][i % 3])

# an arched footbridge over the stream, and stepping stones further up
bridge = cut((513, 527, 95, 63))
bx_, by_ = int(BRIDGE[0] * T), int(BRIDGE[1] * T) + 34
objs.append((by_, bridge, bx_ - bridge.width // 2, by_ - bridge.height))
for i, dx in enumerate((-22, 0, 22)):
    s = ROCKS[3 + i % 2]
    objs.append((1, s, int(STEPS[0] * T) + dx - s.width // 2, int(STEPS[1] * T) + (i % 2) * 8 - 6))

# ================================================================== the lake shore, the pond and the stream banks
for gx in range(120, W - 120, 24):
    ly_ = float((116 + 16 * np.sin(gx / 2 * 0.029) + 9 * np.sin(gx / 2 * 0.083 + 1.0)) * np.clip(min(gx / 2 - 96, 952 - gx / 2) / 90.0, 0, 1) ** 0.5) * 2
    if ly_ < 40 or not on_land(gx, ly_ + 14) or abs(gx - PENINSULA[0] * T) < 80:
        continue
    v = hsh(gx, 1, 80)
    if v < 0.35:
        place(CATTAIL, gx, int(ly_) + 10)
    elif v < 0.5:
        place(ROCKS[3 + int(hsh(gx, 2, 80) * 2)], gx, int(ly_) + 12)
    if hsh(gx, 3, 80) < 0.45:
        lp = LILY_F if hsh(gx, 4, 80) < 0.4 else LILY
        objs.append((0, lp, gx + int(hsh(gx, 5, 80) * 20) - 10, int(ly_) - 44 - int(hsh(gx, 6, 80) * 60)))
for i in range(40):
    a = hsh(i, 1, 46) * 2 * np.pi
    x = int((POND[0] + np.cos(a) * (POND[2] + 0.6)) * T); y = int((POND[1] + np.sin(a) * (POND[3] + 0.5)) * T) + 16
    if on_land(x, y) and hsh(i, 2, 46) < 0.55:
        place(CATTAIL if hsh(i, 3, 46) < 0.6 else ROCKS[4], x, y)
for i in range(7):
    a = hsh(i, 4, 46) * 2 * np.pi
    objs.append((0, LILY_F if i % 3 == 0 else LILY, int((POND[0] + np.cos(a) * POND[2] * 0.5) * T) - 15, int((POND[1] + np.sin(a) * POND[3] * 0.5) * T) - 14))
for j, (x0, y0) in enumerate(STREAM_OUT[1:-1] + STREAM_IN[1:]):
    for side in (-1, 1):
        x, y = int((x0 + side * 1.4) * T), int(y0 * T) + 20
        if on_land(x, y) and hsh(j, side, 47) < 0.7:
            place(CATTAIL, x, y)

# ================================================================== the wild in each clearing
claimed = np.zeros((TH, TW), bool)
for _, x0, y0, x1, y1 in FLOORS:
    claimed[max(0, y0 - 1):y1 + 1, max(0, x0 - 1):x1 + 1] = True
for x0, y0, x1, y1 in PAVE_RECTS:
    claimed[max(0, y0 - 1):y1 + 1, max(0, x0 - 1):x1 + 1] = True
for x0, y0, x1, y1, *_ in FIELDS:
    claimed[max(0, y0 - 1):y1 + 2, max(0, x0 - 1):x1 + 2] = True
for name, bx, by in BUILT_AT:
    claimed[by // T - 5:by // T + 2, bx // T - 4:bx // T + 4] = True
for tx, ty in ORCHARD + SAPLINGS:
    claimed[ty - 1:ty + 2, tx - 1:tx + 2] = True
for cx, cy, rx, ry in CLEARED:
    claimed[int(cy - ry):int(cy + ry) + 1, int(cx - rx):int(cx + rx) + 1] = True
if LATER:
    claimed[28:34, 30:36] = True                                   # the glade gap, opened up
for gy in range(0, H, 28):
    for gx in range(0, W, 32):
        x = gx + int(hsh(gx, gy, 70) * 22) - 11
        y = gy + int(hsh(gx, gy, 71) * 18) - 9
        tx, ty = x // T, y // T
        if not (0 <= tx < TW and 0 <= ty < TH) or not LAND_T[ty, tx] or not on_land(x, y):
            continue
        if near_water[ty, tx] and hsh(gx, gy, 90) < 0.8:
            continue
        if claimed[ty, tx]:
            if hsh(gx, gy, 91) < 0.08 and tiles[ty][tx] == 'grass':
                flower_at(x, y)
            continue
        r = room_of(tx, ty)
        # keep the house's yard, the landmarks and the bridge clear
        if abs(x - HOUSE[0]) < 190 and -200 < y - HOUSE[1] < 110:
            continue
        if (abs(x - ox_) < 120 and abs(y - oy_ + 30) < 80) or (abs(x - sx_) < 130 and abs(y - sy_) < 80):
            continue
        if gx0 - 30 < x < gx0 + 330 and gy0 - 20 < y < gy0 + 220:
            continue
        if abs(x - BRIDGE[0] * T) < 110 and abs(y - BRIDGE[1] * T) < 50:
            continue
        v = hsh(gx, gy, 72)
        glade = (np.sin(tx * 0.45 + 1.3) + np.sin(ty * 0.6 + tx * 0.2) + np.sin((tx + ty) * 0.33)) > 0.9
        im = None
        if r in ('glade', 'cove') or (glade and r not in ('meadow', 'thicket')):
            if hsh(gx, gy, 73) < (0.35 if r == 'glade' else 0.16):
                flower_at(x, y, 'blue' if r == 'glade' and hsh(gx, gy, 74) < 0.5 else None)
            continue
        if r == 'home':
            if v < 0.07: im = BUSH_S
            elif v < 0.11: im = ROCKS[int(hsh(gx, gy, 74) * 3)]
            elif v < 0.14: im = STUMP
            elif v < 0.30:
                flower_at(x, y); continue
        elif r == 'woods':
            if v < 0.20: im = TREE['oak' if hsh(gx, gy, 75) < 0.5 else 'broadleaf']
            elif v < 0.36: im = FERN
            elif v < 0.46: im = MUSH[int(hsh(gx, gy, 76) * 2)]
            elif v < 0.58: im = BUSH_S
            elif v < 0.66: im = STUMP
        elif r == 'meadow':
            if v < 0.70:
                band = ['yellow', 'white', 'purple', 'pink', 'blue', 'orange'][int(tx / 2.5 + ty / 3) % 6]
                flower_at(x, y, band); flower_at(x + 12, y + 9, band); continue
            elif v < 0.78: im = TALL_S
            elif v < 0.83: im = SUNFLOWER
            elif v < 0.88: im = BUSH_S
            elif v < 0.90: im = TREE['broadleaf']
        elif r == 'pondside':
            if v < 0.18: im = BUSH_S
            elif v < 0.26: im = TREE['broadleaf']
            elif v < 0.50:
                flower_at(x, y, ['yellow', 'white'][int(v * 10) % 2]); continue
            elif v < 0.58: im = TALL_S
        elif r == 'stones':
            if v < 0.22: im = ROCKS[int(hsh(gx, gy, 74) * 3)]
            elif v < 0.32: im = BIGROCK
            elif v < 0.42: im = BOULDERS[int(hsh(gx, gy, 77) * 2)]
            elif v < 0.52: im = STUMP
            elif v < 0.64: im = BUSH_S
            elif v < 0.70: im = TALL_S
        elif r == 'thicket':
            if v < 0.36:
                b = BUSH_S.copy()
                if hsh(gx, gy, 78) < 0.5:
                    b.alpha_composite(BERRY, (6, 4))
                im = b
            elif v < 0.50: im = BIGBUSH
            elif v < 0.64: im = TREE['pine']
            elif v < 0.70: im = TALL_S
        else:  # shore and the gaps between clearings
            if v < 0.10: im = BUSH_S
            elif v < 0.16: im = TALL_S
            elif v < 0.36:
                flower_at(x, y); continue
        if im is None:
            if hsh(gx, gy, 79) < 0.1:
                flower_at(x, y)
            continue
        place(im, x, y, shadow=('tree', im.width * 0.6) if im.width > 26 else None)

# the gap to the hidden glade is half-hidden: two bushes you squeeze between
for bx, by in (() if LATER else ((32.3, 30.2), (34.3, 31.6))):
    b = BIGBUSH
    place(b, int(bx * T), int(by * T), shadow=('tree', 50))


def fence_ring(x0, y0, x1, y1, gaps=()):
    fs = set()
    for tx in range(x0, x1 + 1):
        for ty in (y0, y1):
            if (tx, ty) not in gaps:
                fs.add((tx, ty))
    for ty in range(y0, y1 + 1):
        for tx in (x0, x1):
            if (tx, ty) not in gaps:
                fs.add((tx, ty))
    for tx, ty in fs:
        n, e, w = (tx, ty - 1) in fs, (tx + 1, ty) in fs, (tx - 1, ty) in fs
        objs.append((ty * T + 24, FENCE[(1 if n else 0) + (2 if e else 0) + (4 if w else 0)], tx * T, ty * T + 24 - 48))


def dirt_ring(tx, ty, r=18):
    ring = Image.new('RGBA', (r * 2 + 4, r + 4))
    ImageDraw.Draw(ring).ellipse([2, 2, r * 2 + 1, r + 1], fill=(92, 58, 34, 230), outline=(62, 38, 22, 255), width=2)
    objs.append((0, ring, tx * T + 16 - r - 2, ty * T + 24 - r // 2 - 2))


BUILT = {'barn': GB.barn, 'workshop': GB.workshop}
for name, bx, by in BUILT_AT:
    b = BUILT[name]()
    place(b, bx, by, shadow=('bld', b))
for x0, y0, x1, y1, rows_, gaps in FIELDS:
    fence_ring(x0, y0, x1, y1, gaps)
    for j in range(y1 - y0 - 1):
        kind = rows_[j % len(rows_)]
        if kind:
            for i in range(x1 - x0 - 1):
                place(CROP[kind], (x0 + 1 + i) * T + 16, (y0 + 1 + j) * T + 28)
for i, (tx, ty) in enumerate(ORCHARD):
    dirt_ring(tx, ty)
    place(fruit_tree(i), tx * T + 16, ty * T + 26, shadow=('tree', 44))
for tx, ty in SAPLINGS:
    dirt_ring(tx, ty, 14)
    place(SPROUT, tx * T + 16, ty * T + 26)
for cx, cy, rx, ry in CLEARED:                                     # stumps where the woods were cut back
    for i in range(6):
        place(STUMP, int((cx - rx + 0.8 + hsh(i, 1, 48) * (rx * 2 - 1.6)) * T), int((cy - ry + 0.8 + hsh(i, 2, 48) * (ry * 2 - 1.6)) * T), shadow=('tree', 20))
for x0, y0, x1, y1 in PAVE_RECTS:
    for tx in range(x0, x1):
        if tx % 3 == 0:
            flower_at(tx * T + 16, y1 * T + 22, ['pink', 'white', 'yellow', 'purple'][tx % 4])

# ================================================================== people
def person(name, frame):
    sheet_ = Image.open(os.path.join(REPO, 'public', 'stackacres-td', 'characters', f'{name}.png')).convert('RGBA')
    cols = sheet_.width // 48
    f = sheet_.crop(((frame % cols) * 48, (frame // cols) * 48, (frame % cols) * 48 + 48, (frame // cols) * 48 + 48))
    return f.resize((96, 96), Image.NEAREST)


place(person('farmer', 96), HOUSE[0] + 10, HOUSE[1] + 44, ay=88, shadow=('tree', 26))
place(person('ray', 104), HOUSE[0] - 70, HOUSE[1] + 56, ay=88, shadow=('tree', 26))

# ================================================================== shadows, then everything by its foot
sh = Image.new('RGBA', (W, H))
sd = ImageDraw.Draw(sh)
for fx, fy, (kind, p) in shadows:
    if kind == 'tree':
        w2 = p / 2
        sd.ellipse((fx - w2 + 4, fy - 6, fx + w2 + 6, fy + 6), fill=(10, 30, 16, 90))
    else:
        m = np.asarray(p)[..., 3] > 0
        s = Image.fromarray((m * 95).astype(np.uint8), 'L').resize((p.width, p.height // 3))
        col = Image.new('RGBA', s.size, (10, 26, 18, 0)); col.putalpha(s)
        sh.alpha_composite(col, (fx - p.width // 2 + 18, fy - s.height + 14))
img.alpha_composite(sh)
for fy, im, x, y in sorted(objs, key=lambda o: o[0]):
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + im.width), min(H, y + im.height)
    if x0 < x1 and y0 < y1:
        img.alpha_composite(im.crop((x0 - x, y0 - y, x1 - x, y1 - y)), (x0, y0))

# ================================================================== light
Y, X = np.mgrid[0:H, 0:W]
arr = np.asarray(img.convert('RGB')).astype(np.float64)
t_ = np.clip((D - 14) / 240, 0, 1)
t_ = t_ * t_ * (3 - 2 * t_)                              # smoothstep: no line where the shade begins
shade = 1 - 0.5 * t_
arr[..., 0] *= shade * (1 - 0.06 * t_)
arr[..., 1] *= shade
arr[..., 2] *= shade * (1 + 0.1 * t_)
th = np.radians(24)
q = X * np.cos(th) - Y * np.sin(th)
beam = np.zeros((H, W))
for i in range(9):
    c = -300 + i * 330 + hsh(i, 1, 100) * 160
    w = 40 + hsh(i, 2, 100) * 80
    beam = np.maximum(beam, np.exp(-((q - c) / w) ** 2) * (0.55 + 0.45 * hsh(i, 3, 100)))
fade = np.clip(1.3 - Y / (H * 1.25), 0, 1) ** 0.7
level = np.floor(beam * fade * 3.2) / 3.0
alpha = (level * 0.2)[..., None]
arr = 255 - (255 - arr) * (1 - alpha * np.array([255, 236, 176]) / 255)
lum = arr.mean(-1, keepdims=True)
arr = lum + (arr - lum) * 1.14
arr[..., 0] *= 1.025; arr[..., 2] *= 0.965
r2 = ((X - W / 2) / (W / 2)) ** 2 + ((Y - H / 2) / (H / 2)) ** 2
arr *= (1 - 0.16 * np.clip(r2 - 0.35, 0, 1))[..., None]
img = Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')
img.save(os.path.join(OUT, f'explore-{STAGE}.png'))
if not LATER:
    # what a phone shows at once: 18 x 8 tiles
    for name, (vx, vy) in {'bridge': (37, 14), 'glade-gap': (26, 27)}.items():
        img.crop((vx * T, vy * T, (vx + 18) * T, (vy + 8) * T)).resize((18 * T * 2, 8 * T * 2), Image.NEAREST).save(os.path.join(OUT, f'explore-view-{name}.png'))
print('ok', img.size)
