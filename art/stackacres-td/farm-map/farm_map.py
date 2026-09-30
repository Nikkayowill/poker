"""The whole farm design: the homestead in the middle where every player starts,
overgrown land all round it to clear and build on, and a lake along the north
that runs off the map. LPC pack art plus the gable buildings, at 32px per tile.

    python3 farm_map.py              # day one
    STAGE=later python3 farm_map.py  # one player's farm later on
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'rich'))
sys.path.insert(0, HERE)

import lpc_ground  # noqa: E402
import lpc_trees   # noqa: E402
import lpc_props   # noqa: E402
import gable_kit as buildings    # noqa: E402
import gable_buildings as buildings2  # noqa: E402

T = 32
TW, TH = 64, 44
W, H = TW * T, TH * T
STAGE = os.environ.get('STAGE', 'day1')
OXT, OYT = 14, 8                 # where the homestead sits, in tiles
OX, OY = OXT * T, OYT * T
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(HERE, 'previews')
ATLAS = Image.open(os.path.join(HERE, '..', 'lpc', 'terrain', 'terrain_atlas.png')).convert('RGBA')


def cut(box):
    x, y, w, h = box
    return ATLAS.crop((x, y, x + w, y + h))


hsh = buildings.hsh

# ------------------------------------------------------------------ ground
tiles = [['grass'] * TW for _ in range(TH)]


def lay(material, x0, y0, x1, y1, core=True):
    dx, dy = (OXT, OYT) if core else (0, 0)
    for ty in range(y0 + dy, y1 + dy):
        for tx in range(x0 + dx, x1 + dx):
            if 0 <= tx < TW and 0 <= ty < TH:
                tiles[ty][tx] = material


# the homestead's roads (its own tile coordinates)
lay('path', 1, 11, 18, 13)
lay('path', 16, 13, 26, 15)
lay('path', 24, 11, 36, 13)
lay('path', 24, 13, 26, 15)
lay('path', 16, 9, 18, 13)
lay('path', 7, 9, 9, 11)
lay('path', 25, 9, 27, 11)
lay('path', 16, 15, 18, 18)
lay('path', 17, 17, 19, 25)
lay('path', 9, 13, 11, 14)
lay('path', 19, 18, 24, 20)
lay('mud', 3, 14, 14, 20)
lay('path', 11, -3, 13, 11)                    # up between the workshop and the house to the lake
# trails out into the wild land (whole-map tiles)
lay('path', 5, 19, 15, 21, core=False)       # west, to the cleared garden
lay('path', 5, 21, 7, 27, core=False)
lay('path', 31, 32, 33, 38, core=False)      # south, winding
lay('path', 32, 37, 34, 44, core=False)
lay('path', 49, 19, 58, 21, core=False)      # east
lay('path', 56, 21, 58, 30, core=False)
# cleared garden plots already won back from the scrub
lay('mud', 2, 27, 11, 32, core=False)
lay('mud', 52, 30, 60, 34, core=False)
if STAGE == 'later':
    lay('mud', 2, 11, 12, 17, core=False)             # a big west field
    lay('mud', 36, 34, 46, 39, core=False)            # a south field
    lay('path', 12, 13, 15, 15, core=False)
    lay('path', 26, 37, 31, 39, core=False)           # to the shed
    lay('path', 33, 35, 36, 37, core=False)
    lay('path', 51, 16, 56, 19, core=False)           # to the second barn

water = np.zeros((TH * 16, TW * 16), bool)
yy, xx = np.mgrid[0:TH * 16, 0:TW * 16]
# the lake: runs off the top of the map, so its far shore is never seen
taper = np.clip(np.minimum(xx - 96, 952 - xx) / 90.0, 0, 1) ** 0.5
lake_line = (116 + 16 * np.sin(xx * 0.029) + 9 * np.sin(xx * 0.083 + 1.0)) * taper
water |= yy < lake_line
LAKE_LINE = lambda x_px: float((116 + 16 * np.sin(x_px / 2 * 0.029) + 9 * np.sin(x_px / 2 * 0.083 + 1.0))
                               * np.clip(min(x_px / 2 - 96, 952 - x_px / 2) / 90.0, 0, 1) ** 0.5) * 2
DOCK_X = 26 * T                                   # where the lake path meets the water

ground = lpc_ground.paint(tiles, TW, TH, water=water)
img = Image.fromarray(np.clip(ground, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')

# ------------------------------------------------------------------ forest round the west, east and south
forest = lpc_trees.forest_tile()
Y, X = np.mgrid[0:H, 0:W]
wob = lambda a, s: 12 * np.sin(a * 0.017 + s) + 8 * np.sin(a * 0.049 + s * 2.3)
lake_px = np.repeat(np.repeat(water, 2, 0), 2, 1)
inner = (X > 60 + wob(Y, 1)) & (X < W - 60 + wob(Y, 2)) & (Y < H - 56 + wob(X, 4)) & ((Y > 64 + wob(X, 3)) | lake_px)
inner |= (X >= 32 * T - 8) & (X < 34 * T + 8) & (Y > H - 120)      # the south trail out
fl = Image.new('RGBA', (W, H))
for oy in range(0, H, 256):
    for ox in range(0, W, 256):
        fl.alpha_composite(forest, (ox, oy))
fa = np.asarray(fl).copy()
fa[inner, 3] = 0
img.alpha_composite(Image.fromarray(fa, 'RGBA'))

objs = []
shadows = []


def place(im, fx, fy, ax=None, ay=None, shadow=None, core=True):
    if core:
        fx, fy = fx + OX, fy + OY
    ax = im.width // 2 if ax is None else ax
    ay = im.height if ay is None else ay
    objs.append((fy, im, fx - ax, fy - ay))
    if shadow:
        shadows.append((fx, fy, shadow))


crowns = [cut(b) for b in lpc_trees.CROWNS]
k = 0
for gy in range(0, H + 40, 38):
    for gx in range(-20, W + 40, 46):
        x = gx + int(hsh(gx, gy, 1) * 16) - 8
        y = gy + int(hsh(gx, gy, 2) * 12) - 6
        if not (0 <= x < W and 0 <= y < H) or inner[y, x]:
            continue
        if inner[max(0, y - 60):y + 60, max(0, x - 60):x + 60].any():
            c = crowns[k % 2]; k += 1
            place(c, x, y + c.height // 2, core=False)

# ------------------------------------------------------------------ the homestead (its own coordinates)
farm, barn, shop = buildings2.farmhouse(), buildings2.barn(), buildings2.workshop()
place(farm, 540, 336, shadow=('bld', farm))
place(barn, 832, 306, shadow=('bld', barn))
place(shop, 252, 300, shadow=('bld', shop))

TREE = {kk: cut(v) for kk, v in lpc_trees.TREES.items()}
BIGBUSH = cut(lpc_trees.BUSH)
for fx, fy, kind in ((96, 250, 'oak'), (680, 236, 'broadleaf'), (1010, 300, 'pine'), (1060, 560, 'oak'),
                     (720, 470, 'broadleaf'), (660, 690, 'broadleaf'), (760, 640, 'oak')):
    t = TREE[kind]
    place(t, fx, fy, shadow=('tree', t.width * 0.7))
ROCKS = [cut(b) for b in [(768, 676, 31, 22), (928, 772, 31, 22), (674, 675, 28, 27), (451, 740, 23, 19), (422, 742, 20, 21)]]
BIGROCK = cut((962, 686, 29, 44))
BUSH_S = cut((289, 448, 31, 30))
BERRY = cut((390, 779, 19, 16))
MUSH = [cut((866, 898, 28, 28)), cut((834, 994, 28, 28))]
FLOWER = cut((484, 788, 25, 41))
STUMP = cut((740, 582, 25, 19))
CATTAIL = cut((836, 929, 24, 53))
LILY = cut((194, 964, 30, 28))
TALL = cut((292, 532, 88, 96))
TALL_S = cut((258, 532, 30, 96))
for fx, fy in ((370, 300), (700, 330), (150, 330), (960, 470), (1000, 470)):
    b = BUSH_S.copy()
    if hsh(fx, fy, 3) < 0.5:
        b.alpha_composite(BERRY, (6, 4))
    place(b, fx, fy, shadow=('tree', 22))
for fx, fy, i in ((330, 380, 3), (620, 480, 4)):
    place(ROCKS[i], fx, fy, shadow=('tree', ROCKS[i].width * 0.8))
for fx, fy in ((1054, 572), (484, 652), (400, 262)):
    place(MUSH[int(hsh(fx, fy, 4) * 2)], fx + 14, fy + 4)
for fx, fy in ((470, 330), (628, 330), (300, 330), (700, 400), (820, 470)):
    place(FLOWER, fx, fy)
place(STUMP, 300, 420, shadow=('tree', 20))

# ------------------------------------------------------------------ the lake's shore
SMALL = [cut((451, 740, 23, 19)), cut((422, 742, 20, 21)), cut((674, 675, 28, 27))]
LILY_F = cut((226, 964, 30, 28))
for gx in range(120, W - 120, 26):
    ly_ = LAKE_LINE(gx)
    if ly_ < 40 or abs(gx - DOCK_X) < 70:
        continue
    v = hsh(gx, 1, 80)
    if v < 0.35:
        place(CATTAIL, gx, int(ly_) + 10, core=False)
    elif v < 0.5:
        r = SMALL[int(hsh(gx, 2, 80) * 3)]
        place(r, gx, int(ly_) + 12, core=False)
    if hsh(gx, 3, 80) < 0.45:                                  # lily pads in the shallows
        lp = LILY_F if hsh(gx, 4, 80) < 0.4 else LILY
        objs.append((0, lp, gx + int(hsh(gx, 5, 80) * 20) - 10, int(ly_) - 44 - int(hsh(gx, 6, 80) * 60)))
# the dock, running out from the path's end
shore = int(LAKE_LINE(DOCK_X))
dock = buildings.Cv(52, shore - 70 + 20)
for y in range(dock.h - 12):
    for x in range(52):
        ly2 = y % 7
        c = buildings.WOOD[3] if ly2 < 6 else buildings.WOOD[1]
        if ly2 == 0: c = buildings.WOOD[4]
        if x in (0, 51): c = buildings.DARKWOOD[1]
        if hsh(x, y, 81) < 0.04 and ly2 not in (0, 6): c = buildings.WOOD[2]
        dock.put(x, y, c)
for x in range(52):
    for y in range(dock.h - 12, dock.h - 8):
        dock.put(x, y, buildings.DARKWOOD[1 if y < dock.h - 10 else 0])
for py in range(6, dock.h - 12, 40):
    for px in (-2, 50):
        for y in range(py, py + 10):
            for k in range(4):
                dock.put(px + k, y, buildings.DARKWOOD[[3, 2, 1, 0][k]])
dock.outline(0.5)
dock_img = dock.image()
objs.append((shore + 6, dock_img, DOCK_X - 26, 70))
# a rowboat tied to the dock
boat = buildings.Cv(30, 52)
for y in range(52):
    for x in range(30):
        e = ((x - 14.5) / 14.5) ** 2 + ((y - 26) / 26) ** 4
        if e > 1:
            continue
        c = buildings.WOOD[4] if x < 12 else buildings.WOOD[2]
        if e > 0.6: c = buildings.DARKWOOD[2]
        if 0.25 < e < 0.6 and (y - 26) % 9 == 0: c = buildings.WOOD[1]
        inside_ = ((x - 14.5) / 11.5) ** 2 + ((y - 26) / 22) ** 4 <= 1
        if inside_ and e <= 0.6:
            c = buildings.DARKWOOD[3] if (y // 5) % 2 else buildings.DARKWOOD[4]
        boat.put(x, y, c)
for x in range(4, 26):
    boat.put(x, 18, buildings.WOOD[5]); boat.put(x, 19, buildings.WOOD[3]); boat.put(x, 34, buildings.WOOD[5]); boat.put(x, 35, buildings.WOOD[3])
boat.outline(0.45)
objs.append((1, boat.image(), DOCK_X + 30, 120))

# ------------------------------------------------------------------ flowers
FLOWER_COLS = {
    'red': ['#6e1224', '#c32b3d', '#f05c58', '#ffb3a0'], 'pink': ['#6e2254', '#cc4b8c', '#f58cc2', '#ffd6ea'],
    'yellow': ['#6e4e0c', '#dca21c', '#ffd548', '#fff6b0'], 'purple': ['#342060', '#6644ae', '#9a7ae0', '#d6c8ff'],
    'white': ['#5c5c6c', '#cfd0da', '#f4f4fa', '#ffffff'], 'blue': ['#18356e', '#3a66cc', '#6c9cff', '#c4dcff'],
    'orange': ['#6e2c0c', '#d8601c', '#ff9a3c', '#ffd49a'],
}
STEM = [buildings.hx(c) for c in ('#173318', '#2b6128', '#48973a', '#79c24e')]


def flower_clump(kind, seed, n=None):
    P = [buildings.hx(c) for c in FLOWER_COLS[kind]]
    cv = buildings.Cv(18, 20)
    n = n or 3 + int(hsh(seed, 1, 90) * 4)
    heads = []
    for i in range(n):
        hx_ = 3 + int(hsh(seed, i, 91) * 12)
        hy_ = 3 + int(hsh(seed, i, 92) * 8)
        heads.append((hx_, hy_))
    # leaves at the foot
    for i in range(5):
        lx = 3 + int(hsh(seed, i, 93) * 12)
        for k in range(3):
            cv.put(lx + (k if i % 2 else -k), 18 - k, STEM[1 + (k % 2)])
        cv.put(lx, 19, STEM[0])
    for hx_, hy_ in heads:
        for y in range(hy_ + 2, 19):
            cv.put(hx_, y, STEM[2]); cv.put(hx_ + 1, y, STEM[1])
    for hx_, hy_ in sorted(heads, key=lambda h: h[1]):
        if kind == 'purple':                              # lavender: a spike, not a cup
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
        cv.put(hx_, hy_, buildings.hx('#ffd23c') if kind in ('white', 'blue', 'pink') else P[1])
        if kind in ('white', 'blue', 'pink'):
            cv.put(hx_ + 1, hy_ + 1, P[1])
    return cv.image()


KINDS = list(FLOWER_COLS)
FLOWERS = {(k, i): flower_clump(k, i * 7 + j) for j, k in enumerate(KINDS) for i in range(4)}


def flower_at(x, y, kind=None, core=False):
    k_ = kind or KINDS[int(hsh(x, y, 94) * len(KINDS))]
    place(FLOWERS[(k_, int(hsh(x, y, 95) * 4))], x, y, core=core)


# a flower meadow where the pond used to be
for i in range(70):
    a = hsh(i, 1, 96) * 2 * np.pi
    r = np.sqrt(hsh(i, 2, 96))
    x = int(908 + np.cos(a) * r * 130); y = int(580 + np.sin(a) * r * 80)
    band = ['yellow', 'white', 'purple', 'pink', 'blue', 'red', 'orange'][int((x - 778) / 40) % 7]
    flower_at(x + OX, y + OY, band)
# beds either side of the porch steps
for x in list(range(452, 520, 12)) + list(range(574, 640, 12)):
    flower_at(x + OX, 352 + OY, 'red' if x < 540 else 'pink')
    flower_at(x + OX + 6, 364 + OY, 'yellow' if x < 540 else 'white')

# ------------------------------------------------------------------ crops and fences
CROP = {
    'corn': cut((482, 897, 28, 62)), 'tomato': cut((354, 921, 26, 36)), 'lettuce': cut((322, 871, 24, 23)),
    'artichoke': cut((384, 873, 31, 20)), 'potato': cut((293, 970, 22, 21)), 'sprout': cut((357, 809, 18, 21)),
    'pepper': cut((417, 925, 31, 33)), 'melon': cut((454, 900, 25, 25)),
}


def plant(rows_, tx0, ty0, cols, core=True):
    for j, kind in enumerate(rows_):
        if kind is None:
            continue
        for i in range(cols):
            place(CROP[kind], (tx0 + i) * T + 16, (ty0 + j) * T + 28, core=core)


plant(['corn', 'tomato', 'artichoke', 'lettuce', 'potato', 'sprout'], 3, 14, 11)
plant(['pepper', 'melon', None, 'sprout', None], 2, 27, 9, core=False)
plant(['lettuce', None, 'potato', None], 52, 30, 8, core=False)

fence = Image.open(os.path.join(REPO, 'public', 'stackacres-td', 'common', 'fence.png')).convert('RGBA')
fence = fence.resize((fence.width * 2, fence.height * 2), Image.NEAREST)
frames = [fence.crop((i * 32, 0, i * 32 + 32, 64)) for i in range(8)]


def fence_ring(x0, y0, x1, y1, gaps=()):
    fs = set()
    for tx in range(x0, x1 + 1):
        if (tx, y0) not in gaps:
            fs.add((tx, y0))
        if (tx, y1) not in gaps:
            fs.add((tx, y1))
    for ty in range(y0, y1 + 1):
        fs.add((x0, ty)); fs.add((x1, ty))
    for tx, ty in fs:
        n, e, w = (tx, ty - 1) in fs, (tx + 1, ty) in fs, (tx - 1, ty) in fs
        fr = frames[(1 if n else 0) + (2 if e else 0) + (4 if w else 0)]
        objs.append((ty * T + 24, fr, tx * T, ty * T + 24 - 48))


fence_ring(OXT + 2, OYT + 13, OXT + 14, OYT + 20, gaps={(OXT + 9, OYT + 13), (OXT + 10, OYT + 13)})
fence_ring(1, 26, 11, 32, gaps={(5, 26), (6, 26)})

# ------------------------------------------------------------------ what a player has built later
if STAGE == 'later':
    plant(['corn', 'pepper', 'melon', 'tomato', 'lettuce', 'potato'], 2, 11, 10, core=False)
    fence_ring(1, 10, 12, 17, gaps={(12, 13), (12, 14)})
    plant(['artichoke', 'tomato', 'lettuce', 'melon', 'sprout'], 36, 34, 10, core=False)
    fence_ring(35, 33, 46, 39, gaps={(35, 35), (35, 36)})
    shed = buildings2.workshop()
    place(shed, 24 * T, 39 * T, shadow=('bld', shed), core=False)
    barn_b = buildings2.barn()
    place(barn_b, 54 * T, 16 * T + 8, shadow=('bld', barn_b), core=False)
    fruit = TREE['broadleaf'].copy()
    for fx_, fy_ in ((14, 20), (30, 32), (22, 44), (40, 26)):
        fruit.alpha_composite(BERRY, (fx_, fy_))
    for tx_ in range(2, 13, 3):                      # orchard in the south-west
        for ty_ in (35, 38, 41):
            place(fruit, tx_ * T + 16, ty_ * T + 20, shadow=('tree', 44), core=False)
    for tx_ in (51, 54, 60):                         # and a row east of the trail
        for ty_ in (23, 26):
            place(fruit, tx_ * T + 16, ty_ * T + 20, shadow=('tree', 44), core=False)
    for fx_ in range(15 * T, 30 * T, 70):
        place(FLOWER, fx_, 21 * T + 2, core=False)

# ------------------------------------------------------------------ the wild land to clear
clear = np.zeros((TH, TW), bool)
if STAGE == 'later':
    clear[9:43, 1:31] = True                       # west and south-west won back
    clear[9:30, 49:63] = True                      # the east
    clear[31:42, 33:49] = True                     # the south field

clear[OYT + 1:OYT + 23, OXT + 1:OXT + 35] = True          # the homestead yard
clear[25:33, 1:12] = True                                  # west garden clearing
clear[28:35, 51:61] = True                                 # east garden clearing
for ty in range(TH):
    for tx in range(TW):
        if tiles[ty][tx] != 'grass':
            clear[max(0, ty - 1):ty + 2, max(0, tx - 1):tx + 2] = True
wmask = water[8::16, 8::16][:TH, :TW]
from scipy.ndimage import binary_dilation
clear |= binary_dilation(wmask, iterations=2)          # an open shore to walk and fish from
wild = []
for gy in range(0, H, 30):
    for gx in range(0, W, 34):
        x = gx + int(hsh(gx, gy, 70) * 22) - 11
        y = gy + int(hsh(gx, gy, 71) * 18) - 9
        tx, ty = x // T, y // T
        if not (0 <= tx < TW and 0 <= ty < TH) or clear[ty, tx] or not inner[min(H - 1, y), min(W - 1, x)]:
            continue
        v = hsh(gx, gy, 72)
        if v < 0.12:
            im = TALL_S
        elif v < 0.50:
            im = BUSH_S
        elif v < 0.62:
            im = BIGBUSH
        elif v < 0.72:
            im = ROCKS[int(hsh(gx, gy, 74) * 3)]
        elif v < 0.78:
            im = BIGROCK
        elif v < 0.86:
            im = STUMP
        elif v < 0.95:
            im = TREE['broadleaf' if hsh(gx, gy, 75) < 0.6 else 'pine']
        else:
            im = MUSH[int(hsh(gx, gy, 76) * 2)]
        place(im, x, y, shadow=('tree', im.width * 0.6) if im.width > 26 else None, core=False)

# ------------------------------------------------------------------ wildflowers
roadside = np.zeros((TH, TW), bool)
for ty in range(TH):
    for tx in range(TW):
        if tiles[ty][tx] == 'grass' and any(0 <= ty + b < TH and 0 <= tx + a < TW and tiles[ty + b][tx + a] == 'path'
                                            for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            roadside[ty, tx] = True
for gy in range(8, H, 22):
    for gx in range(8, W, 22):
        x = gx + int(hsh(gx, gy, 97) * 14) - 7
        y = gy + int(hsh(gx, gy, 98) * 14) - 7
        tx, ty = x // T, y // T
        if not (0 <= tx < TW and 0 <= ty < TH) or not inner[min(H - 1, y), min(W - 1, x)] or water[min(TH * 16 - 1, y // 2), min(TW * 16 - 1, x // 2)]:
            continue
        if tiles[ty][tx] != 'grass':
            continue
        yard = clear[ty, tx]
        p = 0.34 if roadside[ty, tx] else (0.13 if yard else 0.06)
        if hsh(gx, gy, 99) < p:
            flower_at(x, y)

# ------------------------------------------------------------------ people
def person(name, frame):
    sheet_ = Image.open(os.path.join(REPO, 'public', 'stackacres-td', 'characters', f'{name}.png')).convert('RGBA')
    cols = sheet_.width // 48
    f = sheet_.crop(((frame % cols) * 48, (frame // cols) * 48, (frame % cols) * 48 + 48, (frame // cols) * 48 + 48))
    return f.resize((96, 96), Image.NEAREST)


place(person('farmer', 96), 548, 378, ay=88, shadow=('tree', 26))
place(person('ray', 104), 360, 420, ay=88, shadow=('tree', 26))

# ------------------------------------------------------------------ shadows, then everything by its foot
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

# ------------------------------------------------------------------ light: warm shafts from the top left, then a grade
arr = np.asarray(img.convert('RGB')).astype(np.float64)
th = np.radians(24)
q = X * np.cos(th) - Y * np.sin(th)                       # distance across the shafts
beam = np.zeros((H, W))
for i in range(9):
    c = -300 + i * 330 + hsh(i, 1, 100) * 160
    w = 40 + hsh(i, 2, 100) * 80
    beam = np.maximum(beam, np.exp(-((q - c) / w) ** 2) * (0.55 + 0.45 * hsh(i, 3, 100)))
fade = np.clip(1.3 - Y / (H * 1.25), 0, 1) ** 0.7
level = np.floor(beam * fade * 3.2) / 3.0                # three flat steps, not a smooth gradient
warm = np.array([255, 236, 176])
alpha = (level * 0.2)[..., None]
arr = 255 - (255 - arr) * (1 - alpha * warm / 255)         # screen toward warm light
lum = arr.mean(-1, keepdims=True)
arr = lum + (arr - lum) * 1.14                             # more colour
arr[..., 0] *= 1.025; arr[..., 2] *= 0.965                  # a touch warmer
r2 = ((X - W / 2) / (W / 2)) ** 2 + ((Y - H / 2) / (H / 2)) ** 2
arr *= (1 - 0.16 * np.clip(r2 - 0.35, 0, 1))[..., None]      # soft vignette
img = Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')
img = img.convert('RGB')
img.save(os.path.join(OUT, f'farm-{STAGE}.png'))
# the in-game view at the lake dock: 16 x 10 tiles
vx, vy = DOCK_X - 8 * T, 0
if STAGE == 'day1':
    img.crop((vx, vy, vx + 16 * T, vy + 10 * T)).resize((16 * T * 2, 10 * T * 2), Image.NEAREST).save(os.path.join(OUT, 'lake-dock-view.png'))
print(img.size)
