"""The City's buildings and the things drawn for it that the packs don't have, in the farm's building style
(gable_kit.py) and the City's kit (city_kit.py).

- The grocery, after Kayo's whiteboard sketch of 2026-09-27: a flat roof with a raised rim, a timber upper storey
  jettied out over the ground floor, a long sign board between the upper windows, arched double doors, a window
  either side, a produce stand out on the pavement, and its generator round the side.
- The town's landmarks: the market hall, the watermill and its wheel, the stone bridge, the market cross and
  stalls, the quay crane and the chapel.
- Small things: picket fences, gravestones, bollards, a hand cart, the churchyard's dry-stone wall and lych gate,
  allotment beds, a washing line, bean canes, flour sacks and a millstone.

Drawn at the pack's 32px per tile and handed to the export at half size, like gable_buildings.py.
"""
import math

import numpy as np
from PIL import Image

import city_ground as G
import city_kit as K
import gable_kit as B
from city_kit import lettering, mul, shade
from gable_buildings import APPLE, CABBAGE, CARROT, CORN, crate_stand, produce
from gable_kit import CREAM, DARKWOOD, GLASS, GREEN, PLASTER, SLATE_ROOF, STONE, WHITE, WOOD, Cv, hsh

BRICK = [(70, 28, 22), (104, 42, 30), (138, 58, 40), (160, 74, 50), (184, 98, 68)]
MOSS = [(52, 72, 40), (74, 98, 52), (98, 124, 64)]
IRON = [(24, 24, 30), (46, 46, 54), (74, 74, 84), (112, 112, 124)]
CANVAS = [(120, 36, 30), (176, 56, 44), (214, 84, 62)]
BRASS = [(110, 74, 22), (168, 124, 40), (226, 184, 80), (255, 236, 150)]


def flat_roof(cv, x0, x1, y0, y1, seed=0):
    """A flat roof seen from above: weathered slate tiles inside a stone parapet whose coping you can see the
    thickness of along the front, a brick chimney throwing its shadow across the tiles, and a hatch."""
    # tiles
    for y in range(y0 + 6, y1 - 8):
        for x in range(x0 + 6, x1 - 6):
            tx, ty = (x - x0 - 6 + ((y - y0 - 6) // 10 % 2) * 7) // 14, (y - y0 - 6) // 10
            lx, ly = (x - x0 - 6 + ((y - y0 - 6) // 10 % 2) * 7) % 14, (y - y0 - 6) % 10
            v = hsh(tx, ty, seed)
            base = 3 if v > 0.35 else 2 if v > 0.08 else 1
            col = SLATE_ROOF[base]
            if lx == 13 or ly == 9:
                col = SLATE_ROOF[0]
            elif ly == 0 or lx == 0:
                col = SLATE_ROOF[min(5, base + 1)]
            elif ly == 8:
                col = SLATE_ROOF[max(0, base - 1)]
            if hsh(tx * 3 + lx // 5, ty * 2 + ly // 4, seed + 9) < 0.05 and ly < 8:
                col = MOSS[int(hsh(x, y, seed) * 3)]              # lichen in the joints
            cv.put(x, y, col)
    # the parapet: coping along the sides and back seen from above, and along the front its face as well
    for y in range(y0, y1):
        for x in range(x0, x1):
            back, left, right = y < y0 + 6, x < x0 + 6, x >= x1 - 6
            front_top = y1 - 8 <= y < y1 - 5
            front_face = y >= y1 - 5
            if not (back or left or right or front_top or front_face):
                continue
            block = (x // 16 + (1 if y < y0 + 6 else 0)) % 2
            if front_face:
                col = STONE[3] if (x // 16) % 2 else STONE[2]
                if y == y1 - 1:
                    col = STONE[1]
                if x % 16 == 0:
                    col = STONE[1]
            else:
                col = STONE[5] if (y in (y0, y1 - 8) or x in (x0, x0 + 1)) else STONE[4] if block else STONE[3]
                if (x % 16 == 0 and (back or front_top)) or (y % 16 == 0 and (left or right)):
                    col = STONE[2]
                if right and x >= x1 - 2:
                    col = STONE[2]
            cv.put(x, y, col)
    # the coping throws a shadow onto the tiles below and right of it
    for x in range(x0 + 6, x1 - 6):
        for k in range(4):
            mul(cv, x, y0 + 6 + k, 0.55 + k * 0.1)
    for y in range(y0 + 6, y1 - 8):
        for k in range(3):
            mul(cv, x0 + 6 + k, y, 0.62 + k * 0.12)
    # the hatch, raised on its curb, with its shadow
    hx0, hy0 = x0 + 40, y0 + 24
    for k in range(1, 6):
        for x in range(hx0 + k + 2, hx0 + 28 + k):
            mul(cv, x, hy0 + 20 + k // 2, 0.6)
        for y in range(hy0 + k, hy0 + 22):
            mul(cv, hx0 + 26 + k, y, 0.6)
    for y in range(hy0, hy0 + 20):
        for x in range(hx0, hx0 + 26):
            col = WOOD[3] if (x - hx0) % 6 not in (0, 5) else WOOD[2]
            if (x - hx0) % 6 == 0:
                col = WOOD[4]
            if y >= hy0 + 17:
                col = DARKWOOD[2]                               # the curb's face
            if y == hy0 or x == hx0:
                col = WOOD[5]
            if x == hx0 + 25:
                col = DARKWOOD[1]
            cv.put(x, y, col)
    cv.put(hx0 + 20, hy0 + 8, IRON[3]); cv.put(hx0 + 20, hy0 + 9, IRON[1])
    # a skylight further along
    kx0, ky0 = x0 + 120, y0 + 30
    for y in range(ky0, ky0 + 18):
        for x in range(kx0, kx0 + 40):
            col = GLASS[2] if (x - kx0 + y - ky0) % 11 > 2 else GLASS[4]
            if (x - kx0) % 10 == 0 or y in (ky0, ky0 + 17):
                col = DARKWOOD[2]
            if y == ky0:
                col = WOOD[4]
            cv.put(x, y, col)
    for x in range(kx0 + 2, kx0 + 42):
        mul(cv, x, ky0 + 18, 0.55); mul(cv, x, ky0 + 19, 0.75)
    # the chimney stack: brick, a stone cap with its flues, and a long shadow down and right
    cx0, cx1, ctop, cfoot = x1 - 64, x1 - 40, y0 - 18, y0 + 26
    for k in range(0, 18):
        for y in range(cfoot - 8, cfoot + 4):
            mul(cv, cx1 + k, y + k // 2, 0.62)
        for x in range(cx0 + 4, cx1):
            mul(cv, x + k // 3, cfoot + k // 2 + 3, 0.75 if k > 3 else 0.62)
    for y in range(ctop + 8, cfoot):
        for x in range(cx0, cx1):
            row = (y - ctop) // 4
            lx = (x - cx0 + (row % 2) * 4) % 8
            col = BRICK[3] if hsh(x // 8, row, seed + 5) > 0.3 else BRICK[2]
            if (y - ctop) % 4 == 3 or lx == 7:
                col = BRICK[0]
            if x == cx0:
                col = BRICK[4]
            if x >= cx1 - 3:
                col = BRICK[1]
            cv.put(x, y, col)
    for y in range(ctop, ctop + 8):                            # the cap
        for x in range(cx0 - 3, cx1 + 3):
            col = STONE[4] if y < ctop + 4 else STONE[2]
            if y == ctop:
                col = STONE[5]
            cv.put(x, y, col)
    for fx in (cx0 + 3, cx0 + 13):                            # two clay pots
        for y in range(ctop - 7, ctop):
            for x in range(fx, fx + 7):
                col = (178, 96, 58) if x < fx + 4 else (128, 62, 38)
                if y == ctop - 7:
                    col = (40, 26, 22) if fx + 1 < x < fx + 5 else (204, 124, 80)
                cv.put(x, y, col)


def recess(cv, x, y, w, h, depth=3):
    """A window sunk into a thick wall: shadow along the top and left inside its frame, a sill shadow under."""
    for k in range(depth):
        for xx in range(x, x + w):
            mul(cv, xx, y + k, 0.62 + k * 0.1)
        for yy in range(y, y + h):
            mul(cv, x + k, yy, 0.7 + k * 0.08)
    for xx in range(x - 2, x + w + 5):
        mul(cv, xx, y + h + 4, 0.7)
        mul(cv, xx + 1, y + h + 5, 0.82)


def door_leaf(cv, x, y, w, h, R=GREEN, mirror=False):
    """One leaf of the double door, laid out in its own coordinates so the two leaves are exact mirrors: a
    round-headed glazed top with one upright and one cross bar, a raised panel below, a brass kick plate and a
    long brass pull by the meeting stiles."""
    r = w // 2
    for ly in range(h):
        for lx in range(w):
            mx = w - 1 - lx if mirror else lx                     # measured from the hinge side
            dx, dy = lx - (w - 1) / 2, ly - r
            if ly < r and dx * dx + dy * dy > r * r:
                continue
            col = R[3]
            edge = ly < r and dx * dx + dy * dy > (r - 2) ** 2
            if mx <= 1 or (edge and dx < 0):
                col = R[4]
            if mx >= w - 2 or (edge and dx >= 0):
                col = R[2]
            in_glass = 5 <= lx < w - 5 and ly < r + 18 and (ly >= r or dx * dx + dy * dy <= (r - 5) ** 2)
            if in_glass:
                col = GLASS[1] if ly < r else GLASS[2]
                if (lx + ly) % 10 in (0, 1) and ly < r + 10:
                    col = GLASS[4]                                 # the glint, same slant on both leaves
                if abs(dx) < 1 or ly == r + 4:
                    col = R[3]                                     # glazing bars
                if ly == r + 17 or (ly >= r and lx in (5, w - 6)):
                    col = R[1]
            panel = 7 <= lx < w - 7 and r + 24 <= ly < h - 16
            if panel:
                col = R[3]
                if lx == 7 or ly == r + 24:
                    col = R[1]
                elif lx == w - 8 or ly == h - 17:
                    col = R[4]
                elif lx == 8 or ly == r + 25:
                    col = R[4]
                elif 10 <= lx < w - 10 and r + 28 <= ly < h - 20:
                    col = R[3] if (lx + ly) % 23 else R[4]
            if h - 9 <= ly < h - 3 and 3 <= lx < w - 3:
                col = BRASS[2] if ly == h - 9 else BRASS[1] if ly < h - 4 else BRASS[0]   # kick plate
            cv.put(x + lx, y + ly, col)
    px = x + (w - 6 if not mirror else 5)                          # the pull, by the meeting stiles
    for yy in range(y + r + 8, y + r + 30):
        cv.put(px, yy, BRASS[2] if yy > y + r + 9 else BRASS[3])
        cv.put(px + (1 if not mirror else -1), yy, BRASS[0])
    cv.put(px, y + r + 8, BRASS[3])


def door_frame(cv, x0, x1, top, foot):
    """A dressed stone frame for the double door: jambs of alternating blocks and a lintel with a keystone,
    the opening dark behind the leaves."""
    cv.rect(x0, top, x1, foot, DARKWOOD[0])
    jw, lh = 8, 10
    cx = (x0 + x1) // 2
    for y in range(top - lh, foot):
        for x in list(range(x0 - jw, x0)) + list(range(x1, x1 + jw)):
            if y < top:
                col = STONE[4] if y > top - lh + 1 else STONE[5]
                if y == top - 1:
                    col = STONE[2]
            else:
                course = (y - top) // 12
                inner = x0 - x if x < x0 else x - x1 + 1
                if course % 2 and inner > jw - 3:
                    col = PLASTER[3]                               # the short blocks step back into the wall
                else:
                    col = STONE[4] if (y - top) % 12 else STONE[2]
                    if (y - top) % 12 == 1:
                        col = STONE[5]
                if x in (x0 - 1, x1):
                    col = STONE[1] if x == x0 - 1 else STONE[3]
            cv.put(x, y, col)
    for y in range(top - lh, top):
        for x in range(x0, x1):
            col = STONE[4] if (x - x0) % 16 else STONE[2]
            if y == top - lh:
                col = STONE[5]
            if y == top - 1:
                col = STONE[1]
            cv.put(x, y, col)
    for y in range(top - lh - 3, top + 2):                         # the keystone, standing proud
        half = 5 + (y - top + lh + 3) // 4
        for x in range(cx - half, cx + half):
            col = STONE[5] if x < cx else STONE[3]
            if y == top - lh - 3:
                col = STONE[5]
            if x in (cx - half, cx + half - 1) or y == top + 1:
                col = STONE[1]
            cv.put(x, y, col)


def downpipe(cv, x, top, foot):
    """An iron downpipe off the gutter, clipped to the wall, its shoe at the foot."""
    for y in range(top, foot):
        cv.put(x, y, IRON[3]); cv.put(x + 1, y, IRON[2]); cv.put(x + 2, y, IRON[1])
        if (y - top) % 30 == 0:
            cv.hline(x - 1, x + 4, y, IRON[0])
    cv.hline(x - 2, x + 5, foot - 2, IRON[2]); cv.hline(x - 2, x + 5, foot - 1, IRON[0])


def awning(cv, x0, x1, top, depth):
    """The grocery's striped canvas awning on iron arms, its scalloped hem and the shadow it throws on the wall."""
    for y in range(top + depth, top + depth + 12):
        for x in range(x0 + 2, x1 - 2):
            mul(cv, x, y, 0.62 + (y - top - depth) * 0.03)
    for y in range(top, top + depth):
        for x in range(x0, x1):
            stripe = ((x - x0) // 9) % 2
            f = 0.78 + 0.22 * (y - top) / depth                  # darker up under the wall, lit at the lip
            col = CREAM[5] if stripe else CANVAS[1]
            if y == top:
                col = CREAM[3] if stripe else CANVAS[0]
            c = tuple(int(v * f) for v in col)
            cv.put(x, y, c)
    for x in range(x0, x1):
        k = (x - x0) % 9
        drop = 3 if 2 <= k <= 6 else 2 if k in (1, 7) else 1
        stripe = ((x - x0) // 9) % 2
        for d in range(drop):
            cv.put(x, top + depth + d, CREAM[4] if stripe else CANVAS[2])
        cv.put(x, top + depth + drop, CREAM[2] if stripe else CANVAS[0])
    for ax in (x0 + 3, x1 - 4):
        for k in range(depth + 8):
            cv.put(ax, top + depth + 6 - k * 3 // 4, IRON[1])


def barrel_of_apples(cv, x, y):
    """A barrel by the door heaped with apples."""
    for yy in range(y, y + 20):
        for xx in range(x, x + 16):
            bulge = 1 if 5 <= yy - y <= 14 else 0
            if xx < x + 1 - bulge or xx > x + 14 + bulge:
                continue
            col = WOOD[3] if xx < x + 6 else WOOD[2] if xx < x + 11 else WOOD[1]
            if (yy - y) in (3, 16):
                col = IRON[1]
            if xx == x + 2:
                col = WOOD[4]
            cv.put(xx, yy, col)
    for i in range(7):
        produce(cv, x + 3 + (i % 4) * 3, y - 1 + (i // 4) * 2, APPLE, r=2)


def chalkboard(cv, x, y):
    """A sandwich board on the pavement, a few chalk marks for the day's prices."""
    for yy in range(y, y + 28):
        spread = (yy - y) // 7
        for xx in range(x - spread, x + 18 + spread):
            col = (46, 58, 50)
            if xx <= x - spread + 1 or xx >= x + 16 + spread or yy <= y + 1:
                col = WOOD[3] if xx < x + 9 else WOOD[2]
            cv.put(xx, yy, col)
    for row, n in ((6, 9), (11, 6), (16, 8), (21, 5)):
        for k in range(n):
            if hsh(k, row, 3) > 0.25:
                cv.put(x + 4 + k, y + row, (226, 230, 222))


def _front():
    """The grocery's front, after Kayo's sketch."""
    W, H = 344, 346
    cv = Cv(W, H)
    foot = 304
    flat_roof(cv, 14, W - 14, 30, 110, seed=41)
    # the cornice under the parapet: a moulded beam, lit on top, in shadow beneath
    for y in range(110, 118):
        for x in range(8, W - 8):
            col = (DARKWOOD[5], DARKWOOD[4], DARKWOOD[3], DARKWOOD[3], DARKWOOD[2], DARKWOOD[1], DARKWOOD[0], DARKWOOD[0])[y - 110]
            cv.put(x, y, col)
    # the jettied upper storey
    top, low = 118, 214
    B.vboards(cv, 6, top, W - 6, low, WOOD, bw=8, seed=42)
    for y, (c_top, c_mid) in ((top, (DARKWOOD[4], DARKWOOD[3])), (low - 7, (DARKWOOD[3], DARKWOOD[2]))):
        for yy in range(y, y + 7):
            for x in range(6, W - 6):
                cv.put(x, yy, c_top if yy == y else c_mid if yy < y + 6 else DARKWOOD[0])
        for x in range(6, W - 6, 44):                               # pegs through the beams
            cv.put(x + 20, y + 3, DARKWOOD[1])
    shade(cv, 6, top + 7, W - 6, low - 7, 0.72, 1.0, 1.04, 0.9)
    for x in (6, W - 7):                                         # corner posts
        for y in range(top, low):
            cv.put(x, y, DARKWOOD[4] if x == 6 else DARKWOOD[0])
            cv.put(x + (1 if x == 6 else -1), y, DARKWOOD[3] if x == 6 else DARKWOOD[1])
    # the underside of the jetty: joist ends poking out over the ground floor
    for k in range(10):
        for x in range(6 + k, W - 6 - k):
            cv.put(x, low + k, DARKWOOD[2] if k < 3 else DARKWOOD[1] if k < 8 else DARKWOOD[0])
    for jx in range(16, W - 20, 22):
        for y in range(low + 1, low + 8):
            for x in range(jx, jx + 6):
                col = WOOD[4] if y == low + 1 or x == jx else WOOD[2]
                if x == jx + 5 or y == low + 7:
                    col = DARKWOOD[1]
                cv.put(x, y, col)
    # One grid for both floors: the left window, the door bay under the sign, two windows on the right.
    cols = ((36, 44), (242, 32), (288, 30))
    for x, w in cols:
        B.window(cv, x, 140, w, 36, trim=WHITE, box=True, seed=43 + x)
        recess(cv, x, 140, w, 36)
    # the sign board: a bevelled frame on iron brackets, gilt edge, the name in cream
    bay = 164                                                     # the door bay's centre line
    sx0, sx1, sy0, sy1 = bay - 60, bay + 60, 136, 186
    for y in range(sy0 - 5, sy1 + 5):
        for x in range(sx0 - 5, sx1 + 5):
            ring = min(x - sx0 + 5, y - sy0 + 5, sx1 + 4 - x, sy1 + 4 - y)
            if ring >= 5:
                continue
            lit = (x - sx0 + 5) < 5 and (x - sx0 + 5) <= (sy1 + 4 - y) or (y - sy0 + 5) < 5 and (y - sy0 + 5) <= (sx1 + 4 - x)
            col = WOOD[4] if lit else DARKWOOD[1]
            if ring == 0:
                col = DARKWOOD[0]
            if ring == 4:
                col = (214, 176, 84) if lit else (150, 112, 44)
            cv.put(x, y, col)
    for y in range(sy0, sy1):
        for x in range(sx0, sx1):
            v = hsh(x // 4, y // 4, 51)
            col = GREEN[2] if v > 0.3 else GREEN[1]
            cv.put(x, y, col)
    shade(cv, sx0, sy0, sx1, sy1, 1.12, 0.84, 1.05, 0.92)
    lettering(cv, "GROCERY", (sx0 + sx1) // 2, sy0 + 17, CREAM[5], GREEN[0])
    for x in range(sx0, sx1):                                     # the letters' top edge catches the light
        for y in range(sy0 + 10, sy0 + 12):
            if cv.get(x, y) == CREAM[5]:
                cv.put(x, y, (255, 252, 236))
    for i, R in enumerate((APPLE, CARROT, CABBAGE, CORN, APPLE)):
        produce(cv, sx0 + 24 + i * 19, sy1 - 12, R, r=4)
    for bx in (sx0 + 14, sx1 - 18):
        for x in range(bx, bx + 5):
            mul(cv, x, sy1 + 5, 0.55); mul(cv, x + 1, sy1 + 6, 0.7)
    # the plastered ground floor, in the jetty's shadow up top and dark again at its foot
    for y in range(low + 10, foot):
        for x in range(18, W - 18):
            v = hsh(x // 3, y // 3, 46)
            col = PLASTER[4] if v > 0.22 else PLASTER[3]
            if hsh(x // 9, y // 7, 52) < 0.06:
                col = PLASTER[2]                                    # a patch where the plaster's worn
            cv.put(x, y, col)
    shade(cv, 18, low + 10, W - 18, low + 26, 0.55, 0.95)
    shade(cv, 18, foot - 8, W - 18, foot, 1.0, 0.8)
    K.quoins(cv, 18, low + 10, foot, w=8)
    K.quoins(cv, W - 19, low + 10, foot, w=8, flip=True)
    for x, w in cols:
        B.window(cv, x, 248, w, 32, trim=WHITE, box=False, seed=47 + x)
        recess(cv, x, 248, w, 32)
    # the double doors, centred under the sign in a stone frame, a lantern either side at the same distance
    dx0, dx1, dy0 = bay - 48, bay + 48, 234
    door_frame(cv, dx0, dx1, dy0, foot)
    leaf = (dx1 - dx0 - 2) // 2
    door_leaf(cv, dx0, dy0 + 2, leaf, foot - dy0 - 2)
    door_leaf(cv, dx1 - leaf, dy0 + 2, leaf, foot - dy0 - 2, mirror=True)
    for y in range(dy0, dy0 + 5):                                   # the lintel's shadow and the left reveal's
        for x in range(dx0, dx1):
            mul(cv, x, y, 0.55 + (y - dy0) * 0.09)
    for k in range(4):
        for y in range(dy0, foot):
            mul(cv, dx0 + k, y, 0.62 + k * 0.1)
    K.lantern(cv, dx0 - 16, 248)
    K.lantern(cv, dx1 + 15, 248)
    downpipe(cv, W - 10, 108, low + 9)                             # down the corner post to the jetty
    B.foundation(cv, 14, W - 14, foot, foot + 8, seed=50)
    shade(cv, 14, foot, W - 14, foot + 8, 0.8, 1.0)
    for i, (y0, inset) in enumerate(((foot + 8, 10), (foot + 12, 16))):   # two worn steps
        for y in range(y0, y0 + 4):
            for x in range(dx0 - inset + 2, dx1 + inset - 2):
                col = STONE[4] if y == y0 else STONE[3] if y < y0 + 3 else STONE[1]
                if hsh(x // 5, i, 60) < 0.1:
                    col = STONE[2]
                cv.put(x, y, col)
    barrel_of_apples(cv, 84, foot - 14)
    chalkboard(cv, 49, foot - 12)
    # the produce stand under a striped awning
    awning(cv, 232, W - 10, 222, 12)
    for x in (250, 324):
        for y in range(310, 334):
            cv.put(x, y, WOOD[3]); cv.put(x + 1, y, WOOD[2]); cv.put(x + 2, y, WOOD[1])
    crate_stand(cv, 244, 332, 316, seed=2)
    shade(cv, 244, 316, 332, 322, 0.85, 1.0)
    cv.outline()
    return cv.image()


STEEL = [(30, 40, 38), (48, 62, 58), (70, 88, 82), (96, 116, 108), (128, 148, 138), (168, 186, 176)]
CONCRETE = [(92, 90, 86), (124, 122, 116), (152, 150, 144), (178, 176, 170), (204, 202, 196)]


def generator():
    """The standby generator and chiller unit every grocery keeps round the side for its fridges: a steel housing
    on a concrete pad, fans in its lid, louvres and a control panel on its face, an exhaust stack with a rain cap,
    and its pipes running off behind the shop."""
    W, H = 112, 86
    cv = Cv(W, H)
    # the pad: its top, then its front edge
    for y in range(64, 80):
        for x in range(2, 104):
            col = CONCRETE[3] if y < 76 else CONCRETE[1]
            if y == 64 or x == 2:
                col = CONCRETE[4]
            if hsh(x // 3, y // 2, 70) < 0.08 and y < 76:
                col = CONCRETE[2]
            cv.put(x, y, col)
    # pipes off to the right, behind the shop: lagged chiller lines and a conduit
    for py, R in ((44, IRON), (50, STEEL), (56, IRON)):
        for x in range(80, W):
            cv.put(x, py, R[3]); cv.put(x, py + 1, R[2]); cv.put(x, py + 2, R[1])
        for x in range(84, W, 10):
            cv.hline(x, x + 2, py - 1, R[0])
    # the housing: lid seen from above, then the front face
    x0, x1, top, lid, foot = 10, 84, 20, 34, 68
    for y in range(top, lid):
        for x in range(x0, x1):
            col = STEEL[4] if (x - x0) % 12 else STEEL[3]
            if y == top or x == x0:
                col = STEEL[5]
            if x == x1 - 1:
                col = STEEL[2]
            cv.put(x, y, col)
    for fx in (x0 + 18, x0 + 50):                                     # two fan grilles in the lid
        for y in range(top + 1, lid - 1):
            for x in range(fx - 12, fx + 12):
                dx, dy = (x - fx + 0.5) / 12, (y - (top + lid) / 2 + 0.5) / 6.5
                d = dx * dx + dy * dy
                if d > 1:
                    continue
                col = STEEL[0] if d > 0.82 else STEEL[1] if (x + y) % 3 else STEEL[2]
                if d < 0.08:
                    col = STEEL[3]
                if abs(dx) < 0.06 or abs(dy) < 0.12:
                    col = STEEL[3]                                   # the guard's cross bars
                cv.put(x, y, col)
    for y in range(lid, foot):
        for x in range(x0, x1):
            col = STEEL[3]
            if y == lid:
                col = STEEL[1]
            if x == x0:
                col = STEEL[4]
            if x >= x1 - 2:
                col = STEEL[1]
            cv.put(x, y, col)
    for y in range(lid + 6, foot - 10):                               # louvres down the left of its face
        for x in range(x0 + 5, x0 + 38):
            ly = (y - lid - 6) % 4
            cv.put(x, y, STEEL[1] if ly == 0 else STEEL[4] if ly == 1 else STEEL[3])
    px0, py0 = x0 + 44, lid + 6                                       # the control panel
    for y in range(py0, py0 + 22):
        for x in range(px0, px0 + 24):
            col = STEEL[1]
            if y in (py0, py0 + 21) or x in (px0, px0 + 23):
                col = STEEL[0]
            cv.put(x, y, col)
    for y in range(py0 + 4, py0 + 11):                                # a dial
        for x in range(px0 + 4, px0 + 12):
            if (x - px0 - 7.5) ** 2 + (y - py0 - 7.5) ** 2 <= 12:
                cv.put(x, y, WHITE[5] if (x, y) != (px0 + 8, py0 + 6) else (190, 40, 30))
    cv.put(px0 + 17, py0 + 6, (90, 220, 110)); cv.put(px0 + 18, py0 + 6, (60, 170, 80))   # running lamp
    cv.put(px0 + 17, py0 + 10, (90, 40, 30)); cv.put(px0 + 18, py0 + 10, (60, 30, 24))
    for x in range(px0 + 4, px0 + 20, 3):
        cv.put(x, py0 + 16, STEEL[4])
    for y in range(foot - 8, foot):                                   # the hazard strip round its foot
        for x in range(x0, x1):
            cv.put(x, y, (232, 186, 40) if ((x + y) // 4) % 2 else (40, 36, 34))
    for x in range(x0 + 2, x1 - 2, 12):                               # rivets
        cv.put(x, lid + 2, STEEL[5]); cv.put(x, foot - 10, STEEL[5])
    # the exhaust stack, up the back corner, with its rain cap and a lick of soot
    for y in range(2, lid):
        for x in range(x1 - 14, x1 - 8):
            col = IRON[3] if x == x1 - 14 else IRON[2] if x < x1 - 10 else IRON[1]
            cv.put(x, y, col)
    for x in range(x1 - 17, x1 - 5):
        cv.put(x, 2, IRON[3]); cv.put(x, 3, IRON[1])
    cv.put(x1 - 12, 1, IRON[0]); cv.put(x1 - 11, 0, (60, 58, 60))
    cv.outline()
    return cv.image()


def market_grocery():
    """The City's grocery with its generator set back round the left side, sharing one base line."""
    front, gen = _front(), generator()
    ox = 74
    img = Image.new("RGBA", (front.width + ox, front.height))
    # the generator stands back from the shop's front line, half behind its corner
    img.alpha_composite(gen, (0, 304 - 12 - 76))
    img.alpha_composite(front, (ox, 0))
    img.info["base_x"] = ox + front.width // 2
    img.info["foot"] = 304 + 8
    img.info["door"] = ox + 164
    img.info["lights"] = [(ox + 58, 264, 'window'), (ox + 258, 264, 'window'), (ox + 303, 264, 'window'),
                          (ox + 164 - 64, 252, 'lantern'), (ox + 164 + 63, 252, 'lantern'),
                          (ox + 58, 158, 'window'), (ox + 256, 158, 'window'), (ox + 303, 158, 'window')]
    return img


def made(img, foot, base_x=None, depth=None, lights=(), door=None, chimneys=()):
    """A hires drawing as the export takes a building: a half-size stand-in with the drawing in
    info['hires'], its base point on the ground line under `base_x` (hires px; the middle by default), how far
    back its plan runs (`depth`, map px; the whole picture by default) and its night lights. Returns
    ((proxy, base), meta) with meta['door'] the door's x from the base point in map px, and meta['chimneys'] the
    tops of its chimneys from the base point."""
    l, t, r, b = img.getbbox()
    l, t, r, b = l - l % 2, t - t % 2, r + r % 2, b + b % 2
    full = img.crop((l, t, r, b))
    proxy = full.resize((full.width // 2, full.height // 2), Image.NEAREST)
    proxy.info['hires'] = {'img': full, 'scale': 0.5}
    base = (((base_x if base_x is not None else img.width // 2) - l) // 2, (foot - t) // 2)
    proxy.info['solid_h'] = depth if depth is not None else base[1] - 4
    proxy.info['lights'] = [((x - l) // 2, (y - t) // 2, k) for x, y, k in lights]
    meta = {'size': proxy.size, 'door': None if door is None else (door - l) // 2 - base[0],
            'chimneys': [((x - l) // 2 - base[0], (y - t) // 2 - base[1]) for x, y in chimneys]}
    return (proxy, base), meta


def kit(spec, depth_tiles=5):
    """A city_kit building ready to place: ((proxy, base), meta)."""
    img, info = K.building(spec)
    return made(img, info['foot'] + 7, depth=depth_tiles * 16, lights=info['lights'], door=info['door'],
                chimneys=info['chimneys'])


def market_hall():
    """The market hall on the square: an open arcade of round arches on stone piers where the stalls set out
    under cover, a timber-framed hall over it, a hipped slate roof and a white clock turret with a bell."""
    W, H = 288, 300
    cv = Cv(W, H)
    x0, x1 = 16, W - 16
    ridge, eave, foot = 70, 132, 280
    upper = eave + 58
    # the clock turret on the ridge, drawn first so the roof sits in front of its base
    tx = W // 2
    for y in range(12, ridge + 8):
        for x in range(tx - 16, tx + 16):
            col = WHITE[4] if x < tx + 6 else WHITE[2]
            if (x - tx + 16) % 8 == 0 and y > 40:
                col = WHITE[1]                                   # louvres
            cv.put(x, y, col)
    for y in range(20, 40):                                      # the clock face
        for x in range(tx - 10, tx + 10):
            d = ((x - tx + 0.5) ** 2 + (y - 30 + 0.5) ** 2) ** 0.5
            if d < 10:
                cv.put(x, y, K.IRON[1] if d > 8.6 else CREAM[5])
    for k in range(7):
        cv.put(tx, 30 - k, K.IRON[0])                             # hands at ten to two... near enough
    for k in range(5):
        cv.put(tx + k, 30 - k // 2, K.IRON[0])
    for k in range(14):                                          # its lead cap and the weather vane
        for x in range(tx - 18 + k, tx + 18 - k):
            cv.put(x, 12 - k // 2, K.IRON[3] if x < tx else K.IRON[1])
    cv.vline(tx, -2, 6, K.IRON[1])
    for x in range(tx - 6, tx + 7):
        cv.put(x, 1, K.BRASS[4])
    # the hipped roof
    K.roof_band(cv, x0 - 6, x1 + 6, ridge, eave, kind='slate', hip=46, seed=61)
    # the hall: timber-framed over the arcade, jettied a little
    K.wall(cv, x0, eave, x1, upper, 'timber', WHITE, seed=62)
    K.timbers(cv, x0, eave, x1, upper, 8)
    for i in range(4):
        cx = int(x0 + (x1 - x0) * (i * 2 + 1) / 8)
        K.sash(cv, cx - 12, eave + 12, 24, 30, frame=WHITE, lintel=None, panes=(2, 2), box=True, seed=63 + i)
    shade(cv, x0, eave + 3, x1, eave + 12, 0.62, 1.0)
    for k in range(6):
        for x in range(x0 + k, x1 - k):
            cv.put(x, upper + k, DARKWOOD[2] if k < 2 else DARKWOOD[1] if k < 5 else DARKWOOD[0])
    # the arcade: piers, round arches, the dim floor and the stalls under cover
    top = upper + 6
    for y in range(top, foot):
        for x in range(x0 + 4, x1 - 4):
            t = (y - top) / (foot - top)
            base = np.array(K.SANDSTONE[1], float) * (0.45 + 0.35 * t)
            cv.put(x, y, tuple(base.astype(int)))
    bays = 5
    bw = (x1 - x0 - 8) / bays
    for i in range(bays):
        bx0 = int(x0 + 4 + i * bw)
        cxb = bx0 + bw / 2
        # goods under this arch: a trestle of crates
        gy = foot - 22
        kinds = (APPLE, CARROT, CABBAGE, CORN)
        for j in range(3):
            gx = int(cxb - 18 + j * 13)
            for y in range(gy, gy + 8):
                for x in range(gx, gx + 11):
                    cv.put(x, y, WOOD[3] if y > gy + 2 else WOOD[4])
            for k in range(3):
                produce(cv, gx + 2 + k * 3, gy - 1, kinds[(i + j) % 4], r=2)
        for y in range(gy + 8, foot - 2):
            cv.put(int(cxb - 18), y, WOOD[1]); cv.put(int(cxb + 20), y, WOOD[1])
    for i in range(bays + 1):                                    # the piers
        px = int(x0 + i * bw)
        for y in range(top, foot):
            for x in range(px, px + 12):
                col = K.SANDSTONE[4] if (y - top) % 12 else K.SANDSTONE[2]
                if x == px:
                    col = K.SANDSTONE[5]
                if x >= px + 10:
                    col = K.SANDSTONE[1]
                cv.put(x, y, col)
    for i in range(bays):                                        # the arches springing between them
        ax0 = int(x0 + i * bw) + 12
        ax1 = int(x0 + (i + 1) * bw)
        acx, r = (ax0 + ax1) / 2, (ax1 - ax0) / 2
        for y in range(top, int(top + r + 4)):
            for x in range(ax0, ax1):
                d = ((x - acx + 0.5) ** 2 + (y - top - r - 2) ** 2) ** 0.5
                if d >= r:
                    ang = np.degrees(np.arctan2(top + r + 2 - y, x - acx))
                    col = K.SANDSTONE[4] if int(ang // 20) % 2 else K.SANDSTONE[3]
                    if d < r + 1.5:
                        col = K.SANDSTONE[1]
                    cv.put(x, y, col)
    shade(cv, x0, top, x1, top + 8, 0.7, 1.0)
    for y in range(foot, foot + 8):                              # the stone plinth and a step
        for x in range(x0 - 4, x1 + 4):
            col = STONE[4] if y == foot else STONE[3] if y < foot + 5 else STONE[1]
            cv.put(x, y, col)
    cv.outline()
    return cv.image()


def watermill():
    """The watermill down the river: rubble stone, a clay-tiled roof, a loading door with its hoist beam up in
    the gable, and a sack or two by the door. The wheel is a separate prop (`mill_wheel`) so it can turn."""
    W, H = 224, 290
    cv = Cv(W, H)
    x0, x1 = 14, W - 14
    ridge, eave, foot = 48, 104, 272
    K.chimney(cv, x0 + 30, ridge - 28, ridge + 10, w=16, R=K.SANDSTONE)
    K.roof_band(cv, x0 - 8, x1 + 8, ridge, eave, kind='tile', hip=0, seed=71)
    K.wall(cv, x0, eave, x1, foot, 'stone', K.SANDSTONE, seed=72)
    shade(cv, x0, eave + 3, x1, eave + 12, 0.62, 1.0)
    K.string_course(cv, x0, x1, eave + 72)
    for i, cx in enumerate((x0 + 36, x1 - 36)):
        K.sash(cv, cx - 14, eave + 16, 28, 42, frame=WHITE, lintel=STONE, panes=(2, 2), seed=73 + i)
    # the loading door up in the middle, and the hoist beam over it
    cx = (x0 + x1) // 2
    for y in range(eave + 10, eave + 64):
        for x in range(cx - 16, cx + 16):
            col = WOOD[3] if (x - cx) % 8 else WOOD[1]
            if y in (eave + 10, eave + 63) or x in (cx - 16, cx + 15):
                col = DARKWOOD[1]
            cv.put(x, y, col)
    for x in range(cx - 4, cx + 30):
        cv.put(x, eave + 4, DARKWOOD[4]); cv.put(x, eave + 5, DARKWOOD[2]); cv.put(x, eave + 6, DARKWOOD[0])
    for y in range(eave + 7, eave + 40):
        cv.put(cx + 26, y, (170, 150, 110))                     # the rope
    for y in range(eave + 38, eave + 48):                        # a sack on the hook
        for x in range(cx + 21, cx + 32):
            if (x - cx - 26.5) ** 2 / 30 + (y - eave - 43) ** 2 / 25 <= 1:
                cv.put(x, y, CREAM[3] if x < cx + 27 else CREAM[2])
    # the ground-floor door and windows
    K.front_door(cv, cx, foot, w=34, h=68, R=K.PAINT['wood'], fanlight=False, surround=K.SANDSTONE, steps=1)
    K.sash(cv, x0 + 22, eave + 96, 30, 48, frame=WHITE, lintel=STONE, panes=(2, 3), seed=75)
    for sx in (x1 - 40, x1 - 26):                                # sacks of flour by the door
        for y in range(foot - 14, foot):
            for x in range(sx, sx + 12):
                if (x - sx - 5.5) ** 2 / 36 + (y - foot + 7) ** 2 / 49 <= 1:
                    cv.put(x, y, CREAM[4] if x < sx + 6 else CREAM[2])
    K.foundation(cv, x0, x1, foot, R=K.SANDSTONE)
    cv.outline()
    return cv.image()


def mill_wheel(frames=4, R=52):
    """The undershot wheel on the mill's river side, turning: a rim of paddles on spokes, dripping, its foot in
    the race. One picture per frame, each turned a little further."""
    out = []
    S = 2 * R + 20
    for f in range(frames):
        cv = Cv(S, S)
        cx = cy = S // 2
        turn = f * (np.pi / 8) / frames * 2
        for y in range(S):
            for x in range(S):
                d = ((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2) ** 0.5
                ang = np.arctan2(y - cy + 0.5, x - cx + 0.5) - turn
                if R - 5 <= d <= R:                               # the rim
                    cv.put(x, y, WOOD[3] if y < cy else WOOD[2])
                    if d > R - 1:
                        cv.put(x, y, DARKWOOD[1])
                elif d < R - 5 and abs(((ang * 8 / np.pi) % 2) - 1) > 0.86:
                    cv.put(x, y, WOOD[2] if y < cy else WOOD[1])  # the spokes
                elif d < 7:
                    cv.put(x, y, K.IRON[2] if d > 3 else K.IRON[4])
        for k in range(16):                                      # paddles standing proud of the rim
            a = turn + k * np.pi / 8
            for t in range(0, 9):
                px, py = cx + (R + t - 2) * np.cos(a), cy + (R + t - 2) * np.sin(a)
                for s in (-2, -1, 0, 1, 2):
                    qx, qy = px - s * np.sin(a), py + s * np.cos(a)
                    cv.put(int(qx), int(qy), WOOD[4] if py < cy else WOOD[1])
        for x in range(S):                                       # water splashing off the paddles at the foot
            for y in range(S - 16, S):
                if hsh(x, y // 2 + f, 90) < 0.25 and cv.solid(x, y):
                    cv.put(x, y, GLASS[5])
        cv.outline()
        out.append(cv.image())
    return out


def stone_bridge(span):
    """A stone road bridge seen from above and a little in front, the way it stands: the north parapet's coping
    and the inner face of that wall toward us, the deck of setts between the parapets, the south parapet's coping,
    and below that the downstream face, its arch ringed in voussoirs with the river running through. Square piers
    close each parapet's ends. `span` is its length in hires px; the deck is three map squares wide, and
    info["deck"] says how far down the picture it starts (hires px)."""
    W = span
    coping, inner = 8, 16                                         # the north parapet: coping over its face
    deck0 = coping + inner
    deck1 = deck0 + 3 * K.TILE
    face = 52                                                     # the south coping, then the downstream face
    H = deck1 + 8 + face
    cv = Cv(W, H)
    SAND = K.SANDSTONE
    for y in range(deck0, deck1):                                 # the deck: the square's calm setts
        for x in range(W):
            row = (y - deck0) // 11
            ly = (y - deck0) % 11
            xx = x + int(hsh(row, 1, 83) * 18)
            k, lx = xx // 16, xx % 16
            v = hsh(k, row, 81)
            base = 3 if v > 0.25 else 2 if v > 0.06 else 4
            if abs((y - deck0) - 3 * K.TILE / 2) < 20 and hsh(k, row, 85) < 0.5:
                base = min(4, base + 1)                           # rubbed pale down the middle where the carts go
            pal = G.GRANITE
            if ly == 10 or lx == 15:
                col = tuple(int(c * 0.86) for c in pal[base - 1])
            elif ly == 0:
                col = pal[base + 1]
            elif ly == 9:
                col = pal[base - 1]
            else:
                col = pal[base]
            if y < deck0 + 6:                                     # the north parapet's shadow across the deck
                col = tuple(int(c * 0.8) for c in col)
            cv.put(x, y, col)

    def ashlar(y, x, y0, course=8, block=24, pal=SAND, lit=3):
        row = (y - y0) // course
        lx = (x + (row % 2) * (block // 2)) % block
        v = hsh((x + (row % 2) * (block // 2)) // block, row, 87)
        col = pal[lit] if v > 0.3 else pal[lit - 1]
        if (y - y0) % course == course - 1 or lx == block - 1:
            col = pal[max(0, lit - 2)]
        elif (y - y0) % course == 0:
            col = pal[min(5, lit + 1)]
        return col

    for y in range(0, deck0):                                     # the north parapet
        for x in range(W):
            if y < coping:
                col = SAND[5] if y == 0 else SAND[4] if y < coping - 2 else SAND[2]
                if x % 32 == 0:
                    col = SAND[2]
            else:
                col = ashlar(y, x, coping, lit=2)                 # its face toward us, a step darker
            cv.put(x, y, col)
    for y in range(deck1, deck1 + 8):                             # the south parapet's coping
        for x in range(W):
            col = SAND[5] if y == deck1 else SAND[4] if y < deck1 + 6 else SAND[2]
            if x % 32 == 0:
                col = SAND[2]
            cv.put(x, y, col)
    fy0 = deck1 + 8                                               # the downstream face and its arch
    cx, rx, ry = W / 2, W / 2 - 40, face - 8
    for y in range(fy0, H):
        for x in range(W):
            dy = H - y
            e = ((x - cx) / rx) ** 2 + (dy / ry) ** 2
            if e < 1:
                if e > 0.8 and dy > 6:
                    cv.put(x, y, SAND[0])                         # the underside of the arch, in shadow
                continue                                          # the river shows through
            ring = ((x - cx) / (rx + 10)) ** 2 + (dy / (ry + 10)) ** 2 < 1
            if ring:
                ang = math.degrees(math.atan2(dy, x - cx))
                col = SAND[4] if int(ang // 9) % 2 else SAND[3]
                if abs(ang - 90) < 4.5:
                    col = SAND[5]                                 # the keystone
            else:
                col = ashlar(y, x, fy0, lit=3)
            cv.put(x, y, col)
    for px in (0, W - 14):                                        # square piers closing each parapet
        for y0, y1 in ((0, deck0 + 2), (deck1 - 2, deck1 + 22)):
            for y in range(y0 - 4 if y0 == 0 else y0, y1):
                for x in range(px, px + 14):
                    if y < 0:
                        continue
                    top = y < y0 + 5
                    col = SAND[5] if top and y == max(0, y0 - 4) else SAND[4] if top else SAND[2] if x < px + 10 else SAND[1]
                    cv.put(x, y, col)
    cv.outline()
    img = cv.image()
    img.info["deck"] = deck0
    return img


def market_stall(cloth=K.CANVAS_RED, goods='fruit', seed=0):
    """A market stall: striped canvas on four poles, a trestle counter with its goods, a crate under it."""
    W, H = 104, 96
    cv = Cv(W, H)
    for px in (8, W - 12):
        for y in range(20, 90):
            cv.put(px, y, WOOD[4]); cv.put(px + 1, y, WOOD[3]); cv.put(px + 2, y, WOOD[1])
    for y in range(8, 30):                                       # the canvas, sloping toward us
        inset = max(0, 10 - (y - 8) // 2)
        for x in range(4 + inset, W - 4 - inset):
            stripe = ((x - 4) // 10) % 2
            f = 0.82 + 0.18 * (y - 8) / 22
            col = CREAM[5] if stripe else cloth[3]
            cv.put(x, y, tuple(int(c * f) for c in col))
    for x in range(4, W - 4):
        k = (x - 4) % 10
        drop = 4 if 2 <= k <= 7 else 2
        stripe = ((x - 4) // 10) % 2
        for d in range(drop):
            cv.put(x, 30 + d, CREAM[4] if stripe else cloth[4])
    for y in range(58, 66):                                      # counter
        for x in range(10, W - 10):
            cv.put(x, y, WOOD[5] if y == 58 else WOOD[3] if y < 64 else WOOD[1])
    for x in range(10, W - 10):
        mul(cv, x, 59, 0.75)
    ramps = {'fruit': (APPLE, CARROT, CORN), 'greens': (CABBAGE, CABBAGE, CORN), 'bread': None}[goods]
    for i in range(7):
        gx = 16 + i * 11
        if ramps:
            for k in range(3):
                produce(cv, gx + (k % 2) * 4, 55 - (k // 2) * 3, ramps[(i + k + seed) % 3], r=3)
        else:
            for y in range(50, 57):
                for x in range(gx, gx + 9):
                    if (x - gx - 4) ** 2 / 20 + (y - 54) ** 2 / 9 <= 1:
                        cv.put(x, y, (214, 160, 90) if y < 53 else (170, 112, 56))
    for y in range(66, 88):                                      # the trestle and a crate under it
        cv.put(16, y, WOOD[1]); cv.put(W - 17, y, WOOD[1])
    for y in range(74, 88):
        for x in range(34, 62):
            col = WOOD[3] if (y - 74) % 5 else WOOD[1]
            cv.put(x, y, col)
    cv.outline()
    return cv.image()


def market_cross():
    """The market cross: a slim stone shaft on three steps, a ball and cross at its head, where the market was
    proclaimed and people still meet."""
    W, H = 64, 140
    cv = Cv(W, H)
    cx = W // 2
    for hw, y0 in ((30, 124), (24, 116), (18, 108)):
        for y in range(y0, y0 + 8):
            for x in range(cx - hw, cx + hw):
                col = STONE[5] if y == y0 else STONE[3] if y < y0 + 6 else STONE[1]
                if x == cx - hw:
                    col = STONE[4]
                cv.put(x, y, col)
    for y in range(26, 108):
        for x in range(cx - 5, cx + 5):
            cv.put(x, y, STONE[4] if x < cx - 1 else STONE[2] if x < cx + 3 else STONE[1])
    for y in range(12, 26):
        for x in range(cx - 7, cx + 7):
            if (x - cx + 0.5) ** 2 + (y - 19) ** 2 <= 49:
                cv.put(x, y, STONE[4] if x < cx else STONE[2])
    for y in range(0, 12):
        cv.put(cx, y, K.IRON[2]); cv.put(cx - 1, y, K.IRON[3])
    for x in range(cx - 5, cx + 6):
        cv.put(x, 4, K.IRON[2])
    cv.outline()
    return cv.image()


def crane():
    """A wooden quay crane: a post, a jib, a rope and a crate swinging from its hook."""
    W, H = 90, 150
    cv = Cv(W, H)
    for y in range(20, 146):
        for x in range(20, 30):
            cv.put(x, y, WOOD[4] if x < 23 else WOOD[3] if x < 27 else WOOD[1])
    for t in range(0, 64):                                       # the jib
        x, y = 24 + t, 26 + t // 5
        for k in range(6):
            cv.put(x, y + k, WOOD[4] if k < 2 else WOOD[2] if k < 5 else WOOD[1])
    for t in range(40):                                          # its brace
        cv.put(26 + t, 90 - t * 3 // 2, WOOD[2]); cv.put(27 + t, 90 - t * 3 // 2, WOOD[1])
    for y in range(40, 104):
        cv.put(84, y, (176, 156, 116))
    for y in range(104, 126):
        for x in range(72, 96):
            col = WOOD[3] if (y - 104) % 6 else WOOD[1]
            if x in (72, 95):
                col = WOOD[1]
            cv.put(min(x, W - 1), y, col)
    for y in range(140, 148):
        for x in range(12, 38):
            cv.put(x, y, STONE[3] if y > 141 else STONE[5])
    cv.outline()
    return cv.image()


def chapel():
    """The chapel at the end of the green: a stone nave with its gable to the front, a lancet window over a
    pointed door, and a square tower beside it rising to a slate spire with a gilt weathercock."""
    W, H = 232, 360
    cv = Cv(W, H)
    foot = 340
    # the tower, left
    tx0, tx1, ttop = 12, 76, 120
    for y in range(12, ttop):                                    # the spire, lit on its left face
        half = (y - 12) * 34 / (ttop - 12)
        cxs = (tx0 + tx1) / 2
        for x in range(int(cxs - half), int(cxs + half) + 1):
            left = x < cxs
            row = (y - 12) // 5
            col = SLATE_ROOF[4 if left else 2] if (x + row * 3) % 7 else SLATE_ROOF[3 if left else 1]
            cv.put(x, y, col)
    cxs = (tx0 + tx1) // 2
    for y in range(0, 14):
        cv.put(cxs, y, K.BRASS[3])
    for x in range(cxs - 5, cxs + 6):
        cv.put(x, 3, K.BRASS[4])
    K.wall(cv, tx0, ttop, tx1, foot, 'stone', STONE, seed=91)
    for y in range(ttop, ttop + 6):                              # the parapet course
        for x in range(tx0 - 3, tx1 + 3):
            cv.put(x, y, STONE[5] if y == ttop else STONE[3])
    bx, by, bw, bh = cxs - 9, ttop + 18, 18, 30                   # the belfry opening, louvred
    for y in range(by, by + bh):
        for x in range(bx, bx + bw):
            dy = y - by
            if dy < bw // 2 and (x - bx - bw / 2 + 0.5) ** 2 + (dy - bw / 2) ** 2 > (bw / 2) ** 2:
                continue
            cv.put(x, y, DARKWOOD[1] if (y - by) % 4 else DARKWOOD[3])
    for y in range(ttop + 70, ttop + 92):                        # a clock-less round window lower down
        for x in range(cxs - 8, cxs + 8):
            if (x - cxs + 0.5) ** 2 + (y - ttop - 81) ** 2 <= 60:
                cv.put(x, y, GLASS[2] if (x + y) % 5 else GLASS[4])
    shade(cv, tx0, ttop, tx1, foot, 1.05, 0.9, 1.06, 0.86)
    # the nave, gable to the front
    nx0, nx1, eave = 74, 220, 190
    cxn = (nx0 + nx1) // 2
    peak = 110
    for y in range(peak, eave + 8):                              # the roof slopes either side of the gable
        t = (y - peak) / (eave + 8 - peak)
        half = 8 + t * ((nx1 - nx0) / 2 + 2)
        for x in range(int(cxn - half), int(cxn + half)):
            left = x < cxn
            col = SLATE_ROOF[4 if left else 2] if ((y - peak) // 5 + x // 9) % 2 else SLATE_ROOF[3 if left else 1]
            cv.put(x, y, col)
    for y in range(peak + 8, foot):                              # the gable wall in front
        t = (y - peak - 8) / max(1, eave - peak - 8)
        half = min((nx1 - nx0) / 2 - 4, 6 + t * ((nx1 - nx0) / 2 - 10)) if y < eave else (nx1 - nx0) / 2 - 4
        for x in range(int(cxn - half), int(cxn + half)):
            row = (y - peak) // 10
            lx = (x + (row % 2) * 12) % 24
            col = STONE[3] if hsh((x + (row % 2) * 12) // 24, row, 92) > 0.3 else STONE[4]
            if (y - peak) % 10 == 9 or lx == 23:
                col = STONE[1]
            cv.put(x, y, col)
    for y in range(peak + 8, eave):                              # the coping up the gable's edge
        t = (y - peak - 8) / max(1, eave - peak - 8)
        half = 6 + t * ((nx1 - nx0) / 2 - 10)
        for k in range(4):
            cv.put(int(cxn - half) + k, y, STONE[5] if k < 2 else STONE[3])
            cv.put(int(cxn + half) - 1 - k, y, STONE[2] if k < 2 else STONE[1])
    for y in range(peak - 6, peak + 10):                         # a stone cross on the apex
        cv.put(cxn, y, STONE[4]); cv.put(cxn + 1, y, STONE[2])
    for x in range(cxn - 5, cxn + 7):
        cv.put(x, peak - 1, STONE[4])

    def lancet(x, y, w, h):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                dy = yy - y
                cx = x + w / 2
                if dy < w and ((xx - x) ** 2 + (dy - w) ** 2 > w * w and xx < cx or (x + w - xx) ** 2 + (dy - w) ** 2 > w * w and xx >= cx):
                    continue
                col = GLASS[2] if (xx + yy) % 6 else GLASS[4]
                if (xx - x) == w // 2 or (yy - y) % 12 == 0:
                    col = K.IRON[1]                                # leading
                if (xx + yy * 3) % 17 == 0:
                    col = (200, 60, 60)                          # a chip of coloured glass
                cv.put(xx, yy, col)
        for yy in range(y + h, y + h + 3):
            for xx in range(x - 3, x + w + 3):
                cv.put(xx, yy, STONE[5] if yy == y + h else STONE[2])
    lancet(cxn - 14, 176, 28, 70)
    for yy in range(270, foot):                                  # the pointed door in its arch
        for xx in range(cxn - 18, cxn + 18):
            dy = yy - 270
            if dy < 36 and ((xx - cxn + 18) ** 2 + (dy - 36) ** 2 > 36 * 36 and xx < cxn or (cxn + 18 - xx) ** 2 + (dy - 36) ** 2 > 36 * 36 and xx >= cxn):
                continue
            col = K.PAINT['wood'][3] if (xx - cxn) % 6 else K.PAINT['wood'][1]
            if abs(xx - cxn) >= 16:
                col = STONE[5] if xx < cxn else STONE[1]
            cv.put(xx, yy, col)
    for yy in range(300, 306):
        for xx in range(cxn - 14, cxn + 14):
            cv.put(xx, yy, K.IRON[2] if yy in (300, 305) else K.IRON[1])      # the strap hinges
    shade(cv, nx0, eave, nx1, foot, 1.0, 0.86, 1.04, 0.9)
    for y in range(foot, foot + 8):
        for x in range(tx0 - 4, nx1 + 4):
            cv.put(x, y, STONE[4] if y == foot else STONE[3] if y < foot + 5 else STONE[1])
    cv.outline()
    return cv.image()


def picket(length, gate_at=None):
    """A white picket fence along a front garden, a gate in it at `gate_at` (hires px from its left)."""
    W, H = length, 34
    cv = Cv(W, H)
    for x in range(W):
        in_gate = gate_at is not None and gate_at <= x < gate_at + 28
        if in_gate:
            continue
        for y in (12, 22):                                        # rails
            cv.put(x, y, WHITE[4]); cv.put(x, y + 1, WHITE[2])
        if x % 7 in (0, 1, 2, 3):
            for y in range(4, 31):
                col = WHITE[5] if x % 7 == 0 else WHITE[4] if x % 7 < 3 else WHITE[2]
                if y < 7 and (x % 7 in (0, 3)):
                    continue                                      # the pointed tops
                cv.put(x, y, col)
    if gate_at is not None:                                      # the gate, swung half open
        for y in range(6, 30):
            for x in range(gate_at + 2, gate_at + 14):
                if (x - gate_at) % 4 < 2 or y in (12, 22):
                    cv.put(x, y, WHITE[4] if (x - gate_at) % 4 == 0 else WHITE[3])
        for y in range(2, 32):
            for x in (gate_at - 1, gate_at + 28):
                cv.put(x, y, WHITE[5]); cv.put(x + 1, y, WHITE[2])
    cv.outline()
    return cv.image()


def gravestone(kind=0):
    """A weathered headstone, a little moss at its foot."""
    W, H = 22, 30
    cv = Cv(W, H)
    for y in range(2, 26):
        for x in range(3, 19):
            if kind == 0 and y < 10 and (x - 10.5) ** 2 + (y - 10) ** 2 > 64:
                continue
            if kind == 1 and y < 6 and abs(x - 10.5) > (y - 1) * 1.8:
                continue
            col = STONE[4] if x < 8 else STONE[3] if x < 15 else STONE[2]
            if hsh(x, y, 95 + kind) < 0.06:
                col = K.MOSS[3]
            cv.put(x, y, col)
    for x in range(7, 15):
        cv.put(x, 13, STONE[1])
    for x in range(8, 13):
        cv.put(x, 16, STONE[1])
    for x in range(1, 21):
        for y in range(25, 29):
            cv.put(x, y, K.MOSS[2] if (x + y) % 3 else K.MOSS[4])
    cv.outline()
    return cv.image()


def bollard():
    """An iron mooring bollard on the quay edge, a turn of rope round it."""
    W, H = 18, 22
    cv = Cv(W, H)
    for y in range(4, 20):
        for x in range(4, 14):
            w = 5 if y > 8 else 4
            if abs(x - 8.5) <= w:
                cv.put(x, y, K.IRON[3] if x < 8 else K.IRON[1])
    for x in range(2, 16):
        cv.put(x, 4, K.IRON[4])
    for x in range(3, 15):
        cv.put(x, 12, (180, 158, 112)); cv.put(x, 13, (140, 118, 80))
    cv.outline()
    return cv.image()


def hand_cart():
    """A two-wheeled delivery hand cart loaded with crates, parked by the grocery's side door."""
    W, H = 64, 44
    cv = Cv(W, H)
    for y in range(14, 30):
        for x in range(6, 54):
            col = WOOD[3] if (x - 6) % 8 else WOOD[1]
            if y == 14:
                col = WOOD[5]
            cv.put(x, y, col)
    for i, R in enumerate((APPLE, CABBAGE, CARROT)):
        for y in range(4, 14):
            for x in range(10 + i * 14, 22 + i * 14):
                cv.put(x, y, WOOD[4] if y < 6 else WOOD[2])
        for k in range(3):
            produce(cv, 13 + i * 14 + k * 3, 3, R, r=2)
    for t in range(18):
        cv.put(54 + t // 2, 26 + t // 3, WOOD[2])                    # the handles
    for y in range(24, 44):
        for x in range(18, 42):
            d = ((x - 30 + 0.5) ** 2 + (y - 32) ** 2) ** 0.5
            if 9 <= d <= 11:
                cv.put(x, y, DARKWOOD[1])
            elif d < 9 and abs(((np.arctan2(y - 32, x - 30) * 4 / np.pi) % 2) - 1) > 0.8:
                cv.put(x, y, DARKWOOD[2])
    cv.outline()
    return cv.image()


def low_wall(length):
    """A dry-stone wall, `length` map px long, capped with upright coping stones, as a stand-in with its base at its
    bottom left."""
    W, H = length * 2, 30
    cv = Cv(W, H)
    for y in range(8, 28):
        row = (y - 8) // 6
        for x in range(W):
            k = (x + (row % 2) * 7) // 14
            lx = (x + (row % 2) * 7) % 14
            v = hsh(k, row, 97)
            col = STONE[3] if v > 0.35 else STONE[2] if v > 0.1 else STONE[4]
            if (y - 8) % 6 == 5 or lx == 13:
                col = STONE[0]
            elif (y - 8) % 6 == 0:
                col = STONE[min(5, 4 if v > 0.35 else 3)]
            if hsh(x // 3, y // 3, 98) < 0.04:
                col = K.MOSS[3]
            cv.put(x, y, col)
    for x in range(W):                                           # the coping, stones on edge
        for y in range(2, 8):
            col = STONE[4] if x % 6 < 4 else STONE[2]
            if y == 2:
                col = STONE[5] if x % 6 < 4 else STONE[3]
            cv.put(x, y, col)
    shade(cv, 0, 20, W, 28, 1.0, 0.8)
    cv.outline()
    return stand_in(cv.image(), (0, H - 2))


def lychgate():
    """The roofed gate into the churchyard: two oak posts on stone, a little tiled roof, the gate between."""
    W, H = 72, 70
    cv = Cv(W, H)
    for px in (12, W - 18):
        for y in range(24, 64):
            for x in range(px, px + 6):
                cv.put(x, y, DARKWOOD[4] if x == px else DARKWOOD[3] if x < px + 4 else DARKWOOD[1])
        for y in range(60, 68):
            for x in range(px - 3, px + 9):
                cv.put(x, y, STONE[4] if y == 60 else STONE[2])
    K.roof_band(cv, 4, W - 4, 6, 26, kind='tile', hip=10, seed=99)
    for y in range(40, 60):                                      # the gate
        for x in range(18, W - 18):
            if (x - 18) % 5 < 2 or y in (42, 50, 58):
                cv.put(x, y, WOOD[3] if (x - 18) % 5 == 0 else WOOD[2])
    cv.outline()
    return stand_in(cv.image(), (W // 2, H - 4))


def raised_bed(w_tiles, h_tiles=2, seed=0):
    """An allotment bed: a timber-edged box of dark dug earth in ridged rows, drawn flat into the ground."""
    W, H = w_tiles * 32, h_tiles * 32
    cv = Cv(W, H)
    SOIL = [(46, 30, 22), (68, 46, 32), (92, 64, 44), (116, 84, 58)]
    for y in range(H):
        for x in range(W):
            if x < 4 or x >= W - 4 or y < 4 or y >= H - 4:
                col = WOOD[3] if (y < 4 or x < 4) else WOOD[1]
                if y == 0 or x == 0:
                    col = WOOD[4]
                if (x + y) % 23 == 0:
                    col = WOOD[2]
            else:
                ridge = (y - 4) % 10
                col = SOIL[3] if ridge in (1, 2) else SOIL[2] if ridge < 6 else SOIL[1] if ridge < 9 else SOIL[0]
                if hsh(x // 2, y // 2, seed) < 0.06:
                    col = SOIL[0]
            cv.put(x, y, col)
    return cv.image()


def stand_in(img, base):
    """A hires drawing as a half-size stand-in carrying the full picture, with its base point at `base` (hires px)."""
    proxy = img.resize((img.width // 2, img.height // 2), Image.NEAREST)
    proxy.info["hires"] = {"img": img, "scale": 0.5}
    return proxy, (base[0] // 2, base[1] // 2)


def washing_line(length=112):
    """A back-yard washing line between two T-posts: a sheet, a shirt, a striped towel and a pair of socks."""
    W, H = length, 62
    cv = Cv(W, H)
    posts = (4, W - 9)
    for px in posts:
        for y in range(8, 58):
            for x in range(px, px + 4):
                cv.put(x, y, WOOD[4] if x == px else WOOD[2] if x < px + 3 else WOOD[1])
        for y in range(8, 11):
            for x in range(px - 5, px + 9):
                cv.put(x, y, WOOD[4] if y == 8 else WOOD[2])

    def line_y(x):
        t = (x - W / 2) / (W / 2 - 8)
        return 12 + round(5 * (1 - t * t))

    SHIRT = [(34, 52, 90), (52, 78, 128), (74, 104, 160), (98, 130, 186)]
    DRESS = [(120, 92, 20), (170, 132, 40), (206, 170, 64), (232, 204, 110)]
    TOWEL = [(110, 30, 26), (170, 48, 40), (236, 226, 210)]
    items = ((12, 28, 32, "sheet"), (44, 18, 20, "shirt"), (65, 12, 22, "towel"), (80, 14, 26, "dress"), (95, 3, 8, "sock"))
    for x0, w, h, kind in items:
        if x0 + w > W - 8:
            continue
        top = line_y(x0 + w // 2) + 1
        for y in range(top, top + h):
            for x in range(x0, x0 + w):
                u, v = (x - x0) / max(1, w - 1), (y - top) / max(1, h - 1)
                if kind == "sheet":
                    fold = ((x - x0) // 7) % 2
                    col = WHITE[5 if fold == 0 else 4] if u < 0.85 else WHITE[3]
                    if v > 0.9:
                        col = WHITE[3]
                elif kind == "shirt":
                    if v > 0.35 and (u < 0.2 or u > 0.8):
                        continue                                     # below the sleeves
                    col = SHIRT[3] if u < 0.4 else SHIRT[2]
                    if abs(u - 0.5) < 0.06 and v > 0.1:
                        col = SHIRT[1]                               # the button band
                elif kind == "towel":
                    col = TOWEL[2] if (y - top) % 6 < 3 else TOWEL[1]
                    if u > 0.75:
                        col = TOWEL[0] if (y - top) % 6 >= 3 else WHITE[3]
                elif kind == "dress":
                    if v < 0.14 and abs(abs(u - 0.5) - 0.2) > 0.07:
                        continue                                     # the shoulder straps
                    half = 0.24 if v < 0.42 else 0.24 + 0.28 * (v - 0.42) / 0.58
                    if abs(u - 0.5) > half:
                        continue
                    col = DRESS[3] if u < 0.45 else DRESS[2]
                    if v > 0.92:
                        col = DRESS[1]
                else:
                    col = (200, 60, 60) if (y - top) < h - 3 else (150, 40, 40)
                cv.put(x, y, col)
        for x in (x0 + 1, x0 + w - 2):                              # the pegs
            cv.put(x, top - 1, DARKWOOD[4]); cv.put(x, top, DARKWOOD[3])
        if kind == "sock":
            for y in range(top, top + h):
                for x in range(x0 + 5, x0 + 8):
                    cv.put(x, y, (200, 60, 60) if (y - top) < h - 3 else (150, 40, 40))
    cv.outline()
    for x in range(posts[0] + 4, posts[1]):                          # the line itself, thin, after the outline
        if cv.a[line_y(x), x, 3] == 0 or x < 12:
            cv.put(x, line_y(x), (200, 196, 184))
    return stand_in(cv.image(), (W // 2, H - 4))


def bean_canes(seed=0):
    """A wigwam of canes tied at the top with runner beans climbing it: scarlet flowers and green pods."""
    W, H = 36, 66
    cv = Cv(W, H)
    top = (18, 5)
    feet = (4, 11, 18, 25, 32)
    LEAF = [(dx, dy) for dy, row in enumerate(("..##..", ".####.", "######", ".####.", "..##..")) for dx, c in enumerate(row) if c == "#"]
    extras = []
    for i, fx in enumerate(feet):                                    # the beans climbing each cane, a leaf each side in turn
        for k, t in enumerate(range(8, 88, 9)):
            x = fx + (top[0] - fx) * t / 100
            y = 62 + (top[1] - 62) * t / 100
            side = -6 if (k + i) % 2 else 1
            if hsh(i, k, seed + 3) < 0.2:
                continue
            for dx, dy in LEAF:
                cv.put(int(x) + side + dx, int(y) - 2 + dy, GREEN[5] if dx + dy < 3 else GREEN[4] if dx + dy < 6 else GREEN[3])
            r = hsh(i, k, seed + 7)
            if r < 0.3 or r > 0.75:
                extras.append((int(x) + (2 if side < 0 else -2), int(y), r < 0.3))
    cv.outline()
    for fx in feet:                                                  # the canes, seen between the leaves
        for t in range(0, 101):
            x = round(fx + (top[0] - fx) * t / 100)
            y = round(62 + (top[1] - 62) * t / 100)
            if cv.a[y, x, 3] == 0:
                cv.put(x, y, (190, 162, 104) if t % 9 else (150, 124, 72))
    for x, y, flower in extras:                                      # scarlet flowers and hanging pods, over the leaves
        if flower:
            for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
                cv.put(x + dx, y - 3 + dy, (246, 110, 76) if dy == 0 else (206, 50, 36))
        else:
            for q in range(5):
                cv.put(x, y + q, GREEN[5] if q < 3 else GREEN[3])
    for x in range(15, 22):                                          # the twine at the top
        cv.put(x, 8, (220, 208, 170))
    return stand_in(cv.image(), (W // 2, 63))


def flour_sacks():
    """Three sacks of flour off the mill: two standing, one laid across them, necks tied with twine."""
    W, H = 54, 42
    cv = Cv(W, H)
    SACK = [(96, 80, 56), (140, 120, 86), (186, 166, 124), (216, 200, 160), (236, 224, 192)]

    def sack(x0, y0, w, h, lying=False):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                u, v = (x - x0) / (w - 1), (y - y0) / (h - 1)
                if lying:
                    if (u - 0.5) ** 2 / 0.25 + (v - 0.5) ** 2 / 0.3 > 1.0 and not (u > 0.8 and abs(v - 0.5) < 0.2):
                        continue
                else:
                    neck = v < 0.18
                    if neck and abs(u - 0.5) > 0.12 + v:
                        continue
                    if not neck and (u - 0.5) ** 2 / 0.27 + (v - 0.62) ** 2 / 0.22 > 1.0:
                        continue
                col = SACK[4] if u < 0.3 else SACK[3] if u < 0.7 else SACK[2]
                if v > 0.88:
                    col = SACK[1]
                if (x + y * 2) % 11 == 0:
                    col = SACK[2]
                cv.put(x, y, col)
        if not lying:
            for x in range(x0 + w // 2 - 3, x0 + w // 2 + 4):
                cv.put(x, y0 + int(h * 0.18), (120, 96, 60))            # the twine at the neck
            for x in range(x0 + 4, x0 + w - 4):
                cv.put(x, y0 + int(h * 0.6), (70, 100, 150))           # the miller's blue stripe
    sack(4, 10, 22, 30)
    sack(26, 12, 22, 28)
    sack(10, 2, 34, 16, lying=True)
    cv.outline()
    return stand_in(cv.image(), (W // 2, H - 3))


def millstone():
    """A spare millstone stood on its edge against the wall, its eye and the furrows dressed into its face."""
    W, H = 46, 48
    cv = Cv(W, H)
    cx, cy, rx, ry = 22, 24, 19, 21
    for y in range(H):
        for x in range(W):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            edge = ((x - cx - 3) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d > 1.0 and edge <= 1.0 and x > cx:
                cv.put(x, y, STONE[1])                              # its thickness, turned from the light
                continue
            if d > 1.0:
                continue
            ang = math.atan2(y - cy, x - cx)
            col = STONE[4] if x < cx - 4 else STONE[3] if x < cx + 8 else STONE[2]
            if 0.08 < d < 0.9 and abs(((ang * 10 / math.pi) % 2) - 1) < 0.14:
                col = STONE[1]                                      # the dressed furrows
            if d < 0.05:
                col = STONE[0]                                      # the eye
            if hsh(x // 3, y // 3, 61) < 0.025:
                col = K.MOSS[3]
            cv.put(x, y, col)
    cv.outline()
    return stand_in(cv.image(), (W // 2, H - 3))
