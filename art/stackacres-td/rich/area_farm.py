"""The Fold's and Cattle Pasture's sprites at the rich bar: the wallow's canopy, a fallen fence, hedges, puddles, the
cattle shed, a hitching post, sheep, cattle and a songbird. Same signatures, sizes and anchors as props.py and
creatures.py; animals are side views facing right, mirrored by `facing_left`."""
import math

from pal import Canvas, hash2, lambert, noise1
from trees import canopy as leaf_canopy


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _mirror(c):
    c.px = [row[::-1] for row in c.px]
    return c


# ------------------------------------------------------------------ animals

def _body_light(x, y, x0, x1, y0, y1):
    """Rounded-body light for a side-view animal: lit from the top-left, belly and rump in shade."""
    nx = (x - (x0 + x1) / 2) / max((x1 - x0) / 2, 1)
    ny = (y - (y0 + y1) / 2) / max((y1 - y0) / 2, 1)
    nz = math.sqrt(max(0.0, 1 - min(1, nx * nx * 0.6 + ny * ny)))
    return lambert(nx * 0.6, ny, nz)


def sheep(facing_left=False):
    """Curly wool in lit clumps, a dark face with a pale eye glint, a floppy ear, dark legs."""
    rows = [
        "...WWWWWWW....",
        "..WWWWWWWWWW..",
        ".WWWWWWWWWWKK.",
        ".WWWWWWWWWWKKK",
        ".WWWWWWWWWsKK.",
        "..WWWWWWsss...",
        "...gg..gg.....",
        "...gg..gg.....",
    ]
    c = Canvas(16, 10)
    wool = [(x + 1, y + 1) for y, r in enumerate(rows) for x, k in enumerate(r) if k in "Ws"]
    x0, x1 = min(p[0] for p in wool), max(p[0] for p in wool)
    y0, y1 = min(p[1] for p in wool), max(p[1] for p in wool)
    for y, row in enumerate(rows):
        for x, k in enumerate(row):
            px, py = x + 1, y + 1
            if k in "Ws":
                lit = _body_light(px, py, x0, x1, y0, y1)
                curl = noise1(px * 1.7, py * 1.7, 1.6, 11)
                level = 3.6 + lit * 2.4 + (curl - 0.5) * 1.4
                if (px + py) % 3 == 0 and curl < 0.45:
                    level -= 0.9                                   # the shadow between curls
                if k == "s":
                    level = min(level, 3.0)
                c.put(px, py, "linen", level)
            elif k == "K":
                c.put(px, py, "plum", 1.6 if y == 2 else 1.1 + (0.5 if x == 11 else 0))
            elif k == "g":
                c.put(px, py, "coal", 1.6 if x in (3, 7) else 0.9)
    c.put(13, 4, "linen", 5.6)                                     # eye glint
    c.put(12, 3, "plum", 2.8)                                      # ear catching light
    c.put(14, 5, "pink", 2.2)                                      # nose
    c.outline(rim_amount=0.4, lit_bonus=0.05)
    if facing_left:
        _mirror(c)
    return c.image(), (8, 9)


def cattle(facing_left=False, patches=True):
    """A brown cow (with white patches unless `patches` is off): hide shading, a pale muzzle, horn tips, hooves."""
    rows = [
        "......................T.TT",
        ".....NNNNNNNNNNNNNN...TNNT",
        "....NNNNNNNNNNNNNNNNN.NNNN",
        "...NNNNNWWWNNNNNNNNNNNNNNN",
        "..NNNNNWWWWWNNNNNNNNNNKNNN",
        "..NNNNNNWWWNNNNNWWNNNNNTTT",
        "..NNNNNNNNNNNNNWWWNNNNNTTT",
        "..PNNNNNNNNNNNNNNNNNNN.TT.",
        "..P.NNNNNNNNNNNNNNNNN.....",
        "..P..NNN.....NNN..........",
        ".....NNN.....NNN..........",
        ".....PPP.....PPP..........",
    ]
    c = Canvas(28, 14)
    body = [(x + 1, y + 1) for y, r in enumerate(rows) for x, k in enumerate(r) if k in "NW" and x < 21]
    x0, x1 = min(p[0] for p in body), max(p[0] for p in body)
    y0, y1 = min(p[1] for p in body), 9
    for y, row in enumerate(rows):
        for x, k in enumerate(row):
            px, py = x + 1, y + 1
            if k in "NW":
                head = x >= 21
                lit = _body_light(px, py, x0, x1, y0, y1) if not head else 0.55 - (y - 2) * 0.12
                if y >= 9:                                         # legs: lit front edge, shaded back
                    lit = 0.5 if x in (5, 13) else 0.15
                level = 1.8 + lit * 3.2 + (hash2(px, py, 21) - 0.5) * 0.5
                if k == "W" and patches:
                    c.put(px, py, "linen", 2.6 + lit * 3.4)
                else:
                    c.put(px, py, "leather", level)
            elif k == "T":
                c.put(px, py, "tan", 5.0 if y < 2 else 4.2 if x == 23 else 3.4)
            elif k == "K":
                c.put(px, py, "coal", 0.2)
            elif k == "P":
                c.put(px, py, "coal", 1.2 if y < 11 else 0.8)
    c.put(23, 5, "leather", 4.6)                                    # brow
    c.put(24, 7, "pink", 2.8)                                       # nostril
    c.put(3, 11, "leather", 1.6)                                    # tail tuft
    c.put(3, 12, "coal", 1.4)
    c.outline(rim_amount=0.5, lit_bonus=0.05)
    if facing_left:
        _mirror(c)
    return c.image(), (14, 13)


def bird(facing_left=False):
    """A bluebird on the ground: blue back, pale breast, a tiny yellow beak."""
    rows = [
        "..LL...",
        ".LKLL..",
        "YLLLLL.",
        ".WWLL..",
        "..WW...",
        "..K.K..",
    ]
    c = Canvas(9, 8)
    for y, row in enumerate(rows):
        for x, k in enumerate(row):
            px, py = x + 1, y + 1
            if k == "L":
                c.put(px, py, "blue", 4.4 - y * 0.5 - x * 0.12 + (0.6 if y == 0 else 0))
            elif k == "W":
                c.put(px, py, "linen", 5.8 - y * 0.4)
            elif k == "Y":
                c.put(px, py, "gold", 4.4)
            elif k == "K":
                c.put(px, py, "coal", 0.3 if y == 1 else 1.4)
    c.put(3, 2, "blue", 5.2)
    c.outline(rim_amount=0.4, lit_bonus=0.05)
    if facing_left:
        _mirror(c)
    return c.image(), (4, 7)


# ------------------------------------------------------------------ the Fold

def puddle(w=22, h=9):
    """Standing water on mud, ground level: a dark wet rim, the sky's light in the middle, one glint."""
    c = Canvas(w, h)
    cx, cy, rx, ry = w / 2 - 0.5, h / 2 - 0.5, w / 2 - 0.5, h / 2 - 0.5
    for y in range(h):
        for x in range(w):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d > 1:
                continue
            if d > 0.72:
                c.put(x, y, "soil", 1.2 if y < cy else 2.6)           # the wet lip, dark on the far side
            else:
                sky = 1 - (y / h)
                level = 3.4 + sky * 1.8 + (noise1(x, y * 2, 4, 31) - 0.5) * 0.8
                if y == int(cy) and abs(x - cx) < rx * 0.5 and (x % 4) < 2:
                    level += 0.9                                      # a ripple line
                c.put(x, y, "water", level)
    gx, gy = int(w / 3), int(h / 3)
    c.put(gx, gy, "water", 7.0)
    c.put(gx + 1, gy, "water", 6.2)
    return c.image(), (w // 2, h - 1)


def canopy():
    """A sagging striped canvas roof on four posts over the wallow, with rope ties and a shaded underside."""
    w, h = 74, 44
    c = Canvas(w, h)
    for x in (4, w - 7):                                             # corner posts
        for y in range(16, 42):
            c.put(x, y, "wood", 5.0 - (y - 16) * 0.03)
            c.put(x + 1, y, "wood", 3.8)
            c.put(x + 2, y, "wood", 1.8)
    for x in (20, w - 23):                                           # inner posts, half hidden
        for y in range(14, 28):
            c.put(x, y, "wood", 4.2)
            c.put(x + 1, y, "wood", 3.0)
            c.put(x + 2, y, "wood", 1.4)
    for x in range(1, w - 1):
        sag = round(3 * math.sin(math.pi * (x - 1) / (w - 2)))
        stripe = (x // 6) % 2
        across = (x - 1) / (w - 2)
        for y in range(2 + sag, 16 + sag):
            fold = math.sin((x - 1) / (w - 2) * math.pi * 6)          # soft folds between the posts
            level = 5.8 - across * 1.2 + fold * 0.5 - (y - 2 - sag) * 0.08
            if y == 2 + sag:
                level += 0.6
            if stripe:
                c.put(x, y, "linen", level)
            else:
                c.put(x, y, "khaki", level - 0.9)
        c.put(x, 16 + sag, "linen" if stripe else "khaki", 2.0)      # hem
        c.put(x, 17 + sag, "coal", 1.4)                              # the shade line under the hem
        if x % 12 == 0:
            c.put(x, 18 + sag, "khaki", 3.0)                          # tassel
    for x in (5, w - 6):                                             # rope ties at the corners
        for y in range(1, 5):
            c.put(x, y, "khaki", 4.4 - y * 0.4)
    c.outline()
    return c.image(), (w // 2, 41)


def hedge(length):
    """A clipped hedge of leafy clumps, a few flowers catching the light."""
    c = Canvas(length + 6, 18)
    blobs = [(x, 10 + (x // 7) % 2 * 2, 6) for x in range(4, length + 4, 7)]
    leaf_canopy(c, blobs, 17 + length, lo=0.5, hi=5.0, spacing=4, rmin=2.4, rmax=3.6, warm="leaf")
    for x in range(6, length, 11):
        y = 7 + (x // 11) % 3
        c.put(x, y, "straw", 5.6)
        c.put(x + 1, y, "straw", 4.2)
        c.put(x, y + 1, "gold", 2.6)
    for x in range(1, length + 5):                                   # dark foot where the hedge meets the ground
        for y in range(15, 18):
            p = c.get(x, y)
            if p and p[0] in ("leaf", "leaf2"):
                c.put(x, y, "leaf", min(p[1], 0.8 + (17 - y) * 0.3))
    c.outline()
    return c.image(), ((length + 6) // 2, 16)


def fallen_fence():
    """The Fold's far edge: a fence section on its side, one post still up, grass growing through."""
    c = Canvas(62, 20)
    for y in range(2, 17):                                           # the post still standing
        c.put(4, y, "wood", 5.2)
        c.put(5, y, "wood", 3.6 - (0.8 if hash2(5, y // 3, 1) < 0.3 else 0))
        c.put(6, y, "wood", 1.6)
    for x in (4, 5, 6):
        c.put(x, 2, "wood", 6.4 if x < 6 else 5.0)
    for t in range(48):                                              # two rails sliding to the ground
        x, y = 8 + t, 5 + t // 6
        grain = -0.9 if hash2(t // 3, 0, 2) < 0.25 else 0
        c.put(x, y, "wood", 5.6 + grain)
        c.put(x, y + 1, "wood", 2.4)
        y2 = y + 5 + t // 12
        c.put(x, y2, "wood", 5.2 + grain)
        c.put(x, y2 + 1, "greywood" if t > 30 else "wood", 2.2)
    for y in range(12, 18):                                          # a toppled post
        c.put(52, y, "wood", 4.6)
        c.put(53, y, "wood", 3.2)
        c.put(54, y, "wood", 1.4)
    c.put(52, 12, "wood", 6.0)
    for bx, by in ((20, 15), (40, 16), (30, 14)):                    # grass through the rails
        for k, (dx, tall) in enumerate(((0, 3), (2, 4), (4, 2))):
            for j in range(tall):
                c.put(bx + dx, by + 1 - j, "grass", 3.0 + j * 1.3)
    c.put(46, 13, "moss", 4.0)
    c.put(47, 13, "moss", 3.2)
    c.outline()
    return c.image(), (31, 18)


# ------------------------------------------------------------------ Cattle Pasture

def cattle_shed():
    """An open-front pole shed: a corrugated tin roof streaked with rust, dark inside, hay kept dry."""
    w, h = 90, 62
    c = Canvas(w, h)
    for y in range(2, 24):                                           # corrugated roof, low pitch
        hw = 30 + (y - 2) * 14 // 22
        for x in range(w // 2 - hw, w // 2 + hw + 1):
            ridge = (x - w // 2 + hw) % 4
            level = (5.8, 4.8, 3.2, 2.4)[ridge] - (y - 2) * 0.06 - (x - (w // 2 - hw)) / (2 * hw) * 0.8
            if y < 4:
                level += 0.7
            ramp = "stone"
            if noise1(x, y * 0.4, 5, 7) > 0.76 and ridge == 1:
                ramp, level = "orange", level - 1.2                   # rust running down the grooves
            c.put(x, y, ramp, level)
    for x in range(1, w - 1):
        c.put(x, 24, "stone", 5.2)
        c.put(x, 25, "stone", 2.2)
    for y in range(26, 56):                                          # dark interior, lighter toward the open front
        for x in range(3, w - 3):
            c.put(x, y, "wood", 0.2 + (y - 26) * 0.045 + (0.6 if y > 50 else 0))
    for x in range(3, w - 3):
        for y in range(52, 56):
            c.put(x, y, "dirt", 1.6 + (y - 52) * 0.4 + (hash2(x, y, 5) - 0.5) * 0.6)
    for bx, by, bw, bh in ((6, 40, 22, 16), (60, 44, 24, 12)):      # hay bales stacked inside
        for y in range(by, by + bh):
            for x in range(bx, bx + bw):
                top = y < by + 2
                level = 5.4 if top else 3.8 - (y - by) * 0.08
                if hash2(x, (y + x) // 2, 9) < 0.2:
                    level -= 0.9
                if (x - bx) % 11 == 5:
                    c.put(x, y, "wood", 2.6)                           # twine
                    continue
                c.put(x, y, "straw", level)
    for x in (3, 30, 57, w - 6):                                     # posts
        for y in range(24, 58):
            c.put(x, y, "wood", 5.0)
            c.put(x + 1, y, "wood", 3.4)
            c.put(x + 2, y, "wood", 1.6)
    for x in range(1, w - 1):
        c.put(x, 56, "stone", 5.0 if (x // 7) % 2 else 4.2)
        c.put(x, 57, "stone", 3.2)
        c.put(x, 58, "stone", 1.8)
    c.outline()
    return c.image(), (w // 2, 57)


def hitching_post():
    """Two weathered posts and a rail worn pale where ropes rub, one rope still tied on."""
    c = Canvas(12, 26)
    for px in (2, 8):
        for y in range(4, 24):
            c.put(px, y, "wood", 5.2 - (0.8 if hash2(px, y // 3, 3) < 0.3 else 0))
            c.put(px + 1, y, "wood", 3.6)
            c.put(px + 2, y, "wood", 1.6)
        c.put(px, 3, "wood", 6.4)
        c.put(px + 1, 3, "wood", 5.6)
        c.put(px + 2, 3, "wood", 4.2)
    for x in range(1, 11):
        c.put(x, 9, "wood", 6.0 if 4 <= x <= 7 else 5.2)
        c.put(x, 10, "wood", 4.0)
        c.put(x, 11, "wood", 1.8)
    for x, y, lv in ((6, 12, 4.4), (6, 13, 3.8), (5, 14, 3.4), (6, 15, 3.0)):
        c.put(x, y, "khaki", lv)
    for x in (1, 3, 9):
        c.put(x, 23, "grass", 4.2)
        c.put(x, 22, "grass", 5.4)
    c.outline()
    return c.image(), (6, 24)
