"""Flower clumps and the lake's dock, rowboat and mooring post, for the Homestead.

Drawn at the pack's 32px per tile and handed to the export at half size with the
full drawing attached, like lpc_trees.py.
"""
from PIL import Image

import gable_kit as K
from gable_kit import hsh, hx

FLOWER_COLS = {
    'red': ['#6e1224', '#c32b3d', '#f05c58', '#ffb3a0'], 'pink': ['#6e2254', '#cc4b8c', '#f58cc2', '#ffd6ea'],
    'yellow': ['#6e4e0c', '#dca21c', '#ffd548', '#fff6b0'], 'purple': ['#342060', '#6644ae', '#9a7ae0', '#d6c8ff'],
    'white': ['#5c5c6c', '#cfd0da', '#f4f4fa', '#ffffff'], 'blue': ['#18356e', '#3a66cc', '#6c9cff', '#c4dcff'],
    'orange': ['#6e2c0c', '#d8601c', '#ff9a3c', '#ffd49a'],
}
KINDS = list(FLOWER_COLS)
STEM = [hx(c) for c in ('#173318', '#2b6128', '#48973a', '#79c24e')]


def _half(img, base):
    proxy = img.resize((img.width // 2, img.height // 2), Image.NEAREST)
    proxy.info['hires'] = {'img': img, 'scale': 0.5}
    return proxy, (base[0] // 2, base[1] // 2)


def flower_clump_image(kind, seed):
    P = [hx(c) for c in FLOWER_COLS[kind]]
    cv = K.Cv(18, 20)
    n = 3 + int(hsh(seed, 1, 90) * 4)
    heads = [(3 + int(hsh(seed, i, 91) * 12), 3 + int(hsh(seed, i, 92) * 8)) for i in range(n)]
    for i in range(5):                                   # leaves at the foot
        lx = 3 + int(hsh(seed, i, 93) * 12)
        for k in range(3):
            cv.put(lx + (k if i % 2 else -k), 18 - k, STEM[1 + (k % 2)])
        cv.put(lx, 19, STEM[0])
    for hx_, hy_ in heads:
        for y in range(hy_ + 2, 19):
            cv.put(hx_, y, STEM[2]); cv.put(hx_ + 1, y, STEM[1])
    for hx_, hy_ in sorted(heads, key=lambda h: h[1]):
        if kind == 'purple':                             # lavender is a spike, not a cup
            for k in range(6):
                cv.put(hx_, hy_ - 2 + k, P[2 if k % 2 else 1]); cv.put(hx_ + 1, hy_ - 2 + k, P[1 if k % 2 else 2])
            cv.put(hx_, hy_ - 3, P[3])
            continue
        petals = [(0, -1), (-1, 0), (1, 0), (0, 1), (-1, -1), (1, -1)] if kind == 'red' else [(0, -1), (-1, 0), (1, 0), (0, 1)]
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                if abs(dx) + abs(dy) <= 2 and (dx, dy) not in petals and (dx, dy) != (0, 0):
                    if any((dx - a, dy - b) in petals or (dx - a, dy - b) == (0, 0) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                        cv.put(hx_ + dx, hy_ + dy, P[0])
        for dx, dy in petals:
            cv.put(hx_ + dx, hy_ + dy, P[2])
        cv.put(hx_ - 1, hy_ - 1 if kind == 'red' else hy_, P[3])
        cv.put(hx_, hy_ - 1, P[3])
        cv.put(hx_, hy_, hx('#ffd23c') if kind in ('white', 'blue', 'pink') else P[1])
        if kind in ('white', 'blue', 'pink'):
            cv.put(hx_ + 1, hy_ + 1, P[1])
    return cv.image()


def flower_clump(kind, seed=0):
    img = flower_clump_image(kind, seed)
    return _half(img, (img.width // 2, img.height))


def dock(length):
    """A plank pier running north into the lake, `length` map px long. Laid flat as ground so it walks."""
    h = length * 2
    cv = K.Cv(52, h + 12)
    for y in range(h):
        for x in range(52):
            ly = y % 7
            c = K.WOOD[3] if ly < 6 else K.WOOD[1]
            if ly == 0: c = K.WOOD[4]
            if x in (0, 51): c = K.DARKWOOD[1]
            if hsh(x, y, 81) < 0.04 and ly not in (0, 6): c = K.WOOD[2]
            cv.put(x, y, c)
    for py in range(6, h - 8, 40):                       # piles down into the water
        for px in (-2, 50):
            for y in range(py, py + 10):
                for k in range(4):
                    cv.put(px + k, y, K.DARKWOOD[[3, 2, 1, 0][k]])
    cv.outline(0.5)
    img = cv.image()
    return _half(img, (26, h))


def boat():
    cv = K.Cv(30, 52)
    for y in range(52):
        for x in range(30):
            e = ((x - 14.5) / 14.5) ** 2 + ((y - 26) / 26) ** 4
            if e > 1:
                continue
            c = K.WOOD[4] if x < 12 else K.WOOD[2]
            if e > 0.6: c = K.DARKWOOD[2]
            if 0.25 < e < 0.6 and (y - 26) % 9 == 0: c = K.WOOD[1]
            if ((x - 14.5) / 11.5) ** 2 + ((y - 26) / 22) ** 4 <= 1 and e <= 0.6:
                c = K.DARKWOOD[3] if (y // 5) % 2 else K.DARKWOOD[4]
            cv.put(x, y, c)
    for x in range(4, 26):
        cv.put(x, 18, K.WOOD[5]); cv.put(x, 19, K.WOOD[3]); cv.put(x, 34, K.WOOD[5]); cv.put(x, 35, K.WOOD[3])
    cv.outline(0.45)
    img = cv.image()
    return _half(img, (15, 52))


def mooring_post():
    """The post at the end of the dock, with a coil of rope: what a player taps to fish."""
    cv = K.Cv(16, 34)
    for y in range(4, 34):
        for x in range(5, 11):
            cv.put(x, y, K.DARKWOOD[4] if x < 7 else (K.DARKWOOD[3] if x < 10 else K.DARKWOOD[1]))
    for x in range(4, 12):
        cv.put(x, 3, K.DARKWOOD[5]); cv.put(x, 4, K.DARKWOOD[4])
    rope = hx('#d9c08a'), hx('#a88a52')
    for y in (12, 14, 16):
        for x in range(3, 13):
            cv.put(x, y, rope[0] if (x + y) % 3 else rope[1])
    cv.outline(0.45)
    img = cv.image()
    return _half(img, (8, 34))
