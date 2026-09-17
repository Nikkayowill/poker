"""The Old Fields' own props at the rich bar: the weathered shed, Ray's rusting plough, the scarecrow and
the scrub that took the north field. Same sizes and anchors as props.py."""
import math

from pal import Canvas, hash2, noise1
from trees import canopy


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def shed_old():
    """Grey weathered boards, a sagging mossy roof, a door hanging by one hinge, a dark window."""
    w, h = 66, 56
    c = Canvas(w, h)
    for y in range(22, 52):                                        # walls: silvered boards
        for x in range(3, w - 3):
            board = (x - 3) // 4
            bx = (x - 3) % 4
            b = 4.4 + (hash2(board, 0, 1) - 0.5) * 1.2 + (noise1(x * 3, y, 7, board + 2) - 0.5) * 1.0
            level = 0.9 if bx == 3 else b + 0.8 if bx == 0 else b
            if y < 26:
                level -= (26 - y) * 0.55                          # under the eave
            if y > 46 and hash2(x, y, 3) < (y - 46) / 8:
                c.put(x, y, "moss" if hash2(x, y, 4) < 0.4 else "dirt", 2.6 + hash2(x, y, 5))
                continue
            if x > w - 7:
                level -= 1.2
            c.put(x, y, "greywood", level)
    for x, y in ((8, 30), (20, 44), (50, 28), (40, 40), (12, 38)):  # patches and nail rows
        for k in range(3):
            c.put(x + k, y, "greywood", 1.8)
        c.put(x, y - 1, "stone", 5.6)
    for y in range(4, 22):                                         # sagging roof, courses of shingles
        sag = round(2 * math.sin(math.pi * (y - 4) / 18))
        hw = 14 + (y - 4) * 19 // 18
        row = (y - 4) // 4
        for x in range(w // 2 - hw, w // 2 + hw + 1):
            ry = (y - 4) % 4
            col = (x + row * 3) // 5
            rel = (x - (w // 2 - hw)) / max(2 * hw, 1)
            b = 4.6 - rel * 2.0 + (hash2(col, row, 6) - 0.5) * 1.1
            level = b - 2.2 if ry == 0 else b + (0.6 if ry == 1 else 0)
            if (x + row * 3) % 5 == 4:
                level -= 0.8
            ramp = "slate"
            if noise1(x, y, 5, 7) > 0.66 and ry != 0:
                ramp, level = "moss", 2.8 + (1 - rel) * 1.8
            c.put(x, y + sag, ramp, level)
    for x in range(3, w - 3):
        p = c.get(x, 23)
        if p:
            c.put(x, 23, p[0], p[1] - 1.0)
    for y in range(30, 52):                                        # doorway and the hanging door
        for x in range(24, 40):
            c.put(x, y, "ink" if x > 31 else "wood", 0.4 if x <= 31 else 0)
    for y in range(31, 52):
        for x in range(25, 31):
            c.put(x, y, "greywood", 2.6 + (0.9 if x == 25 else 0) - (y - 31) * 0.03)
    for t in range(21):
        c.put(38 + t // 4, 31 + t, "greywood", 4.8)
        c.put(39 + t // 4, 31 + t, "greywood", 2.8)
    c.put(38, 33, "stone", 3.0)
    for y in range(30, 38):                                        # a dark window with a cracked pane
        for x in range(52, 60):
            edge = y == 30 or x in (52, 59) or y == 37
            c.put(x, y, "greywood" if edge else "glass", (5.0 if y == 30 or x == 52 else 2.4) if edge else 0.6 + (y - 31) * 0.15)
    for k in range(3):
        c.put(54 + k, 32 + k, "glass", 3.8)
    for x0 in (6, 44):                                             # weeds at the foot
        for k, (dx, tall) in enumerate(((0, 3), (2, 4), (4, 2))):
            for j in range(tall):
                c.put(x0 + dx, 51 - j, "grass", 3.2 + j * 1.1)
    for x in range(1, w - 1):
        c.put(x, 52, "stone", 4.6 if (x // 7) % 2 else 3.8)
        c.put(x, 53, "stone", 2.2)
    return c.outline().image(), (w // 2, 53)


def plough():
    """Two long wooden handles, a rust-streaked iron beam and share, a spoked wheel."""
    c = Canvas(44, 26)
    for t in range(30):
        x, y = 12 + t, 16 - t * 12 // 30
        for dy, (a, b) in ((0, (5.4, 3.0)), (4, (5.0, 2.6))):
            c.put(x, y + dy, "wood", a - t * 0.02)
            c.put(x, y + dy + 1, "wood", b)
    for y0 in (3, 7):
        for x in range(38, 43):
            c.put(x, y0, "wood", 5.6)
            c.put(x, y0 + 1, "wood", 2.8)
    for y in range(16, 19):                                        # iron beam with rust streaks
        for x in range(6, 26):
            level = (5.2, 3.6, 2.2)[y - 16]
            if hash2(x // 2, 0, 11) < 0.35:
                c.put(x, y, "orange", level - 1.4)
            else:
                c.put(x, y, "stone", level)
    for y in range(12, 24):                                        # the share, a curved blade
        hw = 2 + (y - 12) // 3
        x0 = 4 - (y - 12) // 4
        for x in range(x0, x0 + hw + 2):
            rel = (x - x0) / max(hw + 1, 1)
            level = 5.6 - rel * 2.8 - (y - 12) * 0.12
            ramp = "orange" if (y > 18 and hash2(x, y, 12) < 0.4) else "stone"
            c.put(x, y, ramp, level - (1.2 if ramp == "orange" else 0))
    c.put(4, 13, "stone", 6.6)
    c.put(2, 22, "dirt", 3.4)
    c.put(3, 23, "dirt", 2.4)
    for y in range(15, 20):                                        # the wheel, spokes and rim
        for x in range(26, 31):
            d = math.hypot(x - 28, y - 17)
            if d <= 2.6:
                rim = d > 1.6
                c.put(x, y, "stone" if rim else "wood", (5.2 if x + y < 45 else 2.6) if rim else 2.2)
    c.put(28, 17, "stone", 4.8)
    return c.outline().image(), (22, 24)


def scarecrow():
    """A sack-headed scarecrow in a straw hat, patched shirt and trousers, straw at the cuffs."""
    c = Canvas(24, 38)
    for y in range(14, 36):                                        # post
        c.put(11, y, "wood", 4.8)
        c.put(12, y, "wood", 2.4)
    for x in range(2, 22):                                         # crossbar
        c.put(x, 16, "wood", 5.0)
        c.put(x, 17, "wood", 2.6)
    for y in range(14, 20):                                        # plaid shirt on the crossbar
        for x in range(3, 21):
            level = 3.6 - (x - 3) * 0.06 + (0.6 if y == 14 else 0) - (0.9 if y == 19 else 0)
            if (x - 3) % 4 == 0 or y == 17:
                level -= 1.3
            c.put(x, y, "red", level)
    for x, y, lv in ((1, 15, 5.2), (2, 15, 4.6), (1, 16, 3.8), (21, 15, 5.0), (22, 15, 4.4), (22, 16, 3.6)):
        c.put(x, y, "straw", lv)
    for y in range(3, 13):                                         # sack head, stitched face
        for x in range(8, 16):
            level = 5.0 - (x - 8) * 0.25 - (y - 3) * 0.08
            if (x + y) % 3 == 0:
                level -= 0.5
            c.put(x, y, "tan", level)
    for x, y in ((10, 7), (13, 7)):
        c.put(x, y, "coal", 0.4)
    for x, y in ((10, 9), (11, 10), (12, 10), (13, 9)):
        c.put(x, y, "coal", 1.0)
    for x in range(6, 18):                                         # straw hat
        c.put(x, 1, "straw", 5.4 - (x - 6) * 0.12)
        c.put(x, 2, "straw", 4.2 - (x - 6) * 0.1 + (0.4 if x % 2 else 0))
        c.put(x, 3, "straw", 2.6)
    for x in range(9, 15):
        c.put(x, 0, "straw", 5.8 - (x - 9) * 0.2)
    for y in range(20, 28):                                        # patched trousers
        for x in range(4, 20):
            level = 3.4 - (x - 4) * 0.08 + (0.8 if y == 20 else 0)
            if (x - y) % 3 == 0:
                level -= 0.35
            c.put(x, y, "denim", level)
    for y in range(23, 25):
        for x in range(7, 9):
            c.put(x, y, "orange", 4.4 if y == 23 else 3.2)
    for x, y, lv in ((9, 28, 5.2), (10, 28, 4.4), (11, 28, 3.8), (9, 29, 3.6), (11, 29, 3.2)):
        c.put(x, y, "straw", lv)
    return c.outline().image(), (12, 36)


def wild_growth(seed=0):
    """Scrub gone to bush: a dark clump with dry seed heads and one thistle."""
    c = Canvas(28, 20)
    canopy(c, [(8, 14, 6), (18, 13, 7), (13, 9, 5), (23, 15, 4)], seed * 3 + 5, lo=0.4, hi=5.2, spacing=4,
           rmin=2.2, rmax=3.2, ramp="leaf", warm="leaf")
    for i in range(6):
        x = 4 + i * 4 + (hash2(seed, i, 1) > 0.5)
        top = 1 + round(hash2(seed, i, 2) * 5)
        for y in range(top, 10):
            c.put(x, y, "dry", 3.6 - (y - top) * 0.15)
        c.put(x, top, "straw", 4.8)
        c.put(x + (1 if i % 2 else -1), top + 1, "straw", 3.6)
    tx = 9 + round(hash2(seed, 0, 3) * 10)
    for y in range(4, 12):
        c.put(tx, y, "leaf2", 3.4)
    for x, y, ramp, lv in ((tx, 1, "pink", 4.6), (tx + 1, 1, "pink", 3.8), (tx - 1, 2, "pink", 4.2), (tx, 2, "pink", 3.4),
                          (tx + 1, 2, "pink", 2.8), (tx + 2, 2, "pink", 2.4), (tx, 3, "leaf2", 2.6), (tx + 1, 3, "leaf2", 2.2)):
        c.put(x, y, ramp, lv)
    return c.outline().image(), (14, 18)
