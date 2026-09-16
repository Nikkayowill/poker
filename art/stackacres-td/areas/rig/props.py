"""Places and gates: every built or blocking thing outside the Homestead's original set.

Same rules as kit.py: DawnBringer 16, light from the top-left, black silhouette outline on
objects, cluster shading. Each function returns (Sprite, anchor) where the anchor is the
base point in sprite pixels.
"""
import math

from kit import N4, Sprite, hash2


# ------------------------------------------------------------------ helpers

def shaded_ellipse(s, cx, cy, rx, ry, lit, mid, dark, hi_cut=0.7, lo_cut=-0.2):
    for y in range(s.h):
        for x in range(s.w):
            nx, ny = (x - cx) / rx, (y - cy) / ry
            if nx * nx + ny * ny <= 1:
                light = -(nx * 0.6 + ny * 0.8)
                s.put(x, y, lit if light > hi_cut else mid if light > lo_cut else dark)


def leaf_blobs(s, blobs, lit="v", mid="G", dark="B", hi_cut=0.35, lo_cut=-0.5):
    """Overlapping round bundles, the lower one owning the overlap, each lit from the top-left."""
    owner = {}
    for y in range(s.h):
        for x in range(s.w):
            best = None
            for i, (bx, by, r) in enumerate(blobs):
                if math.hypot(x - bx, y - by) <= r and (best is None or by > blobs[best][1]):
                    best = i
            if best is not None:
                owner[(x, y)] = best
    for (x, y), i in owner.items():
        bx, by, r = blobs[i]
        light = -((x - bx) * 0.6 + (y - by) * 0.8) / r
        k = lit if light > hi_cut else dark if light < lo_cut else mid
        if any(owner.get((x + dx, y + dy), i) != i and blobs[owner[(x + dx, y + dy)]][1] > by for dx, dy in N4):
            k = dark
        s.put(x, y, k)
    return owner


def planks(s, x, y, w, h, vertical=False, face="o", seam="N", top="T"):
    s.rect(x, y, w, h, face)
    if vertical:
        for px in range(x, x + w, 4):
            s.rect(px + 3, y, 1, h, seam)
        s.rect(x, y, w, 1, top)
    else:
        for py in range(y, y + h, 4):
            s.rect(x, py + 3, w, 1, seam)
        s.rect(x, y, w, 1, top)


def stones(s, x, y, w, h, lit="W", mid="s", dark="g", size=4):
    for py in range(y, y + h):
        for px in range(x, x + w):
            row = (py - y) // size
            sx, sy = (px - x + row % 2 * (size // 2)) % size, (py - y) % size
            k = dark if sx == size - 1 or sy == size - 1 else lit if sx == 0 and sy == 0 else mid
            s.put(px, py, k)


# ------------------------------------------------------------------ gates

def brambles():
    """The west trail's block: a thorny mound with a few dark berries. Nothing to climb."""
    s = Sprite(46, 24)
    leaf_blobs(s, [(10, 15, 7), (20, 13, 8), (31, 15, 7), (38, 17, 5), (15, 9, 5), (26, 8, 5)],
               lit="G", mid="G", dark="B", hi_cut=2, lo_cut=-0.35)
    for x0, y0, dx in ((2, 20, 1), (44, 21, -1), (8, 4, 1), (36, 3, -1)):        # arched thorny canes
        for t in range(16):
            x = x0 + dx * t
            y = round(y0 - 12 * math.sin(math.pi * t / 16)) if y0 > 12 else round(y0 + 10 * math.sin(math.pi * t / 16))
            s.put(x, y, "P")
            if t % 4 == 2:
                s.put(x, y - 1, "T")
    for x, y in ((14, 12), (23, 16), (29, 10), (35, 14), (9, 17)):
        s.put(x, y, "P")
        s.put(x + 1, y, "P")
        s.put(x, y - 1, "R")
    return s.outline(), (23, 22)


def rockfall():
    """The hill trail's block: a heap of boulders with a dusty skirt."""
    s = Sprite(54, 30)
    for cx, cy, rx, ry in ((14, 20, 12, 7), (38, 21, 13, 7), (26, 12, 11, 8), (44, 10, 7, 5), (8, 10, 6, 4)):
        for y in range(s.h):
            for x in range(s.w):
                nx, ny = (x - cx) / rx, (y - cy) / ry
                if nx * nx + ny * ny <= 1:
                    light = -(nx * 0.6 + ny * 0.8)
                    s.put(x, y, "W" if light > 0.7 else "s" if light > -0.2 else "g")
        s.put(cx - rx + 1, cy, "K")
    for x, y in ((6, 27), (20, 28), (33, 27), (49, 28), (27, 25)):
        s.stamp(["ss", "sg"], x, y)
    return s.outline(), (27, 28)


def hedge_overgrown():
    """Hen Haven's back gate, lost in a hedge: two posts and a rail still show through."""
    s = Sprite(38, 32)
    leaf_blobs(s, [(8, 22, 8), (19, 20, 9), (30, 22, 8), (13, 12, 7), (25, 11, 7), (19, 6, 5)])
    s.rect(3, 6, 3, 24, "N")
    s.rect(32, 6, 3, 24, "N")
    s.rect(3, 6, 3, 1, "T")
    s.rect(32, 6, 3, 1, "T")
    for x in range(7, 32, 3):
        s.put(x, 16, "o")
    leaf_blobs(s, [(9, 26, 5), (27, 27, 5), (18, 15, 4), (6, 12, 3), (31, 13, 3)])
    return s.outline(), (19, 30)


def boardwalk_washed():
    """The shore road's block: a boardwalk over a tide creek, half its planks gone."""
    s = Sprite(48, 28)
    s.rect(0, 10, 48, 12, "B")
    for x in range(2, 46, 7):
        s.put(x, 14 + (x // 7) % 3, "L")
        s.put(x + 1, 14 + (x // 7) % 3, "L")
    for x in (2, 44):
        s.rect(x, 4, 2, 22, "P")
    for i, x in enumerate(range(4, 44, 5)):                    # planks, some missing, one sunk
        gone = i in (2, 5)
        if gone:
            continue
        dy = 3 if i == 4 else 0
        s.rect(x, 6 + dy, 4, 16, "o" if i != 4 else "N")
        s.put(x + 3, 6 + dy, "N")
        s.rect(x, 6 + dy, 4, 1, "T" if i != 4 else "o")
    s.stamp(["oo", "N."], 15, 20)
    s.stamp([".N", "oo"], 30, 3)
    return s.outline(), (24, 26)


def fallen_fence():
    """The Fold's far edge: a fence section on its side, one post still up."""
    s = Sprite(62, 20)
    s.rect(4, 2, 3, 15, "N")
    s.rect(4, 2, 3, 1, "T")
    s.rect(5, 3, 1, 14, "P")
    for t in range(48):                                         # two rails sliding to the ground
        x = 8 + t
        y = 5 + t // 6
        s.put(x, y, "o")
        s.put(x, y + 1, "N")
        s.put(x, y + 5 + (t // 12), "o")
        s.put(x, y + 6 + (t // 12), "N")
    s.rect(52, 12, 3, 6, "N")
    s.stamp(["v.v", ".G."], 20, 15)
    s.stamp(["v.v", ".G."], 40, 16)
    return s.outline(), (31, 18)


# ------------------------------------------------------------------ the Old Fields

def scarecrow():
    s = Sprite(24, 38)
    s.rect(11, 14, 2, 22, "N")
    s.rect(2, 16, 20, 2, "N")
    s.rect(3, 14, 18, 6, "R")                                   # shirt on the crossbar
    for x in range(3, 21, 4):
        s.rect(x, 14, 1, 6, "P")
    s.rect(6, 17, 12, 1, "P")
    s.stamp(["YY", "Y."], 1, 15)
    s.stamp(["YY", ".Y"], 21, 15)
    s.rect(8, 3, 8, 10, "T")                                    # sack head
    s.put(10, 7, "K")
    s.put(13, 7, "K")
    s.stamp(["K.K", ".K."], 10, 9)
    s.rect(6, 1, 12, 2, "Y")
    s.rect(9, 0, 6, 1, "Y")
    s.rect(6, 3, 12, 1, "o")
    s.rect(4, 20, 16, 8, "L")                                   # patched trousers
    s.rect(4, 20, 16, 1, "B")
    s.stamp(["oo", "oo"], 7, 23)
    s.stamp(["YYY", "Y.Y"], 9, 28)
    return s.outline(), (12, 36)


def shed_old():
    """A weathered field shed: grey boards, a sagging roof, a door that no longer shuts."""
    w, h = 66, 56
    s = Sprite(w, h)
    for y in range(4, 22):                                      # sagging shingle roof
        sag = round(2 * math.sin(math.pi * (y - 4) / 18))
        hw = 14 + (y - 4) * 19 // 18
        for x in range(w // 2 - hw, w // 2 + hw + 1):
            k = "g" if (y - 4) % 4 else "K"
            if (x // 6 + y // 4) % 5 == 0 and (y - 4) % 4:
                k = "O"
            s.put(x, y + sag, k)
    s.rect(3, 22, w - 6, 30, "s")
    for x in range(3, w - 3, 4):
        s.rect(x + 3, 22, 1, 30, "g")
    s.rect(3, 22, w - 6, 1, "W")
    s.rect(w - 5, 22, 2, 30, "g")
    for x, y in ((8, 30), (20, 44), (50, 28), (40, 40)):
        s.rect(x, y, 3, 1, "O")
    s.rect(24, 30, 16, 22, "K")                                 # doorway, door hanging by one hinge
    s.rect(25, 31, 6, 21, "P")
    for t in range(20):
        s.put(38 + t // 4, 31 + t, "N")
        s.put(39 + t // 4, 31 + t, "o")
    s.rect(52, 30, 8, 8, "K")
    s.rect(52, 30, 8, 1, "g")
    s.stamp(["G.G", ".G."], 6, 50)
    s.stamp(["G.G", ".G."], 44, 51)
    s.rect(1, 52, w - 2, 2, "O")
    return s.outline(), (w // 2, 53)


def wild_growth(seed=0):
    """Gone to bush: a dark scrubby clump with dry seed heads and one thistle, outlined so it reads on grass."""
    s = Sprite(28, 20)
    leaf_blobs(s, [(8, 14, 6), (18, 13, 7), (13, 9, 5), (23, 15, 4)], lit="G", mid="G", dark="B", hi_cut=2, lo_cut=-0.3)
    for i in range(6):
        x = 4 + i * 4 + (hash2(seed, i, 1) > 0.5)
        top = 1 + round(hash2(seed, i, 2) * 5)
        for y in range(top, 10):
            s.put(x, y, "G")
        s.put(x, top, "o")
        s.put(x + (1 if i % 2 else -1), top + 1, "o")
    tx = 9 + round(hash2(seed, 0, 3) * 10)
    s.rect(tx, 4, 1, 8, "G")
    s.stamp([".LL.", "LLLL", ".PP."], tx - 1, 1)
    return s.outline(), (14, 18)


def plough():
    """Ray's old walking plough, rusting where he left it: two long handles, a beam, the share in the dirt."""
    s = Sprite(44, 26)
    for t in range(30):                                         # handles rising to the right
        x, y = 12 + t, 16 - t * 12 // 30
        s.put(x, y, "o")
        s.put(x, y + 1, "N")
        s.put(x, y + 4, "o")
        s.put(x, y + 5, "N")
    s.rect(38, 3, 5, 2, "N")
    s.rect(38, 7, 5, 2, "N")
    s.rect(6, 16, 20, 3, "g")                                   # beam
    s.rect(6, 16, 20, 1, "s")
    for y in range(12, 24):                                     # the share, a curved blade
        hw = 2 + (y - 12) // 3
        s.rect(4 - (y - 12) // 4, y, hw + 2, 1, "s" if y < 15 else "g")
    s.put(2, 22, "o")
    s.put(3, 23, "N")
    s.stamp([".sss.", "sgggs", "sgsgs", "sgggs", ".sss."], 26, 15)   # the wheel
    return s.outline(), (22, 24)


# ------------------------------------------------------------------ the Fold

def canopy():
    """A sagging canvas roof on four posts: shade over the wallow."""
    w, h = 74, 44
    s = Sprite(w, h)
    for x in (4, w - 7):
        s.rect(x, 16, 3, 26, "N")
        s.rect(x + 2, 16, 1, 26, "P")
    for x in (20, w - 23):
        s.rect(x, 14, 3, 14, "N")
    for x in range(1, w - 1):                                   # cloth, sagging between the posts
        sag = round(3 * math.sin(math.pi * (x - 1) / (w - 2)))
        for y in range(2 + sag, 16 + sag):
            s.put(x, y, "W" if ((x // 6) % 2) else "s")
        s.put(x, 16 + sag, "g")
        if x % 12 == 0:
            s.put(x, 17 + sag, "g")
    s.rect(1, 2, 1, 14, "K")
    s.rect(w - 2, 2, 1, 14, "K")
    return s.outline(), (w // 2, 41)


def hedge(length):
    s = Sprite(length + 6, 18)
    blobs = [(x, 10 + (x // 7) % 2 * 2, 6) for x in range(4, length + 4, 7)]
    leaf_blobs(s, blobs)
    for x in range(6, length, 11):
        s.put(x, 8 + (x // 11) % 3, "Y")
    return s.outline(), ((length + 6) // 2, 16)


# ------------------------------------------------------------------ Cattle Pasture

def cattle_shed():
    """An open-front pole shed with the hay kept dry inside."""
    w, h = 90, 62
    s = Sprite(w, h)
    for y in range(2, 24):                                      # corrugated roof, low pitch
        hw = 30 + (y - 2) * 14 // 22
        for x in range(w // 2 - hw, w // 2 + hw + 1):
            s.put(x, y, "W" if (x - w // 2 + hw) % 6 == 0 else "s" if y < 4 else "s" if (x // 3) % 2 else "g")
    s.rect(w // 2 - 45, 24, 90, 2, "g")
    s.rect(3, 26, w - 6, 30, "P")                               # dark interior
    s.rect(3, 26, w - 6, 3, "K")
    for x in (3, 30, 57, w - 6):                                # posts
        s.rect(x, 24, 3, 34, "N")
        s.rect(x, 24, 1, 34, "o")
    s.rect(6, 40, 22, 16, "Y")                                  # hay
    s.rect(6, 40, 22, 2, "W")
    s.rect(6, 52, 22, 4, "o")
    s.rect(60, 44, 24, 12, "Y")
    s.rect(60, 44, 24, 2, "W")
    s.rect(60, 52, 24, 4, "o")
    s.rect(1, 56, w - 2, 3, "O")
    return s.outline(), (w // 2, 57)


def hitching_post():
    s = Sprite(12, 26)
    s.rect(2, 4, 3, 20, "N")
    s.rect(2, 4, 1, 20, "o")
    s.rect(2, 3, 3, 1, "T")
    s.rect(1, 9, 10, 2, "o")
    s.rect(1, 11, 10, 1, "N")
    s.rect(8, 4, 3, 20, "N")
    s.rect(8, 3, 3, 1, "T")
    s.rect(10, 4, 1, 20, "P")
    return s.outline(), (6, 24)


# ------------------------------------------------------------------ Coastal Market

def stall(color="R", goods="fish"):
    """A market stall: striped awning, plank counter, something on the counter."""
    w, h = 46, 46
    s = Sprite(w, h)
    for y in range(2, 14):                                      # awning
        hw = 18 + (y - 2) * 4 // 12
        for x in range(w // 2 - hw, w // 2 + hw + 1):
            s.put(x, y, color if ((x - w // 2 + hw) // 5) % 2 else "W")
    for x in range(w // 2 - 22, w // 2 + 23, 5):
        s.put(x, 14, color if (x // 5) % 2 else "W")
    s.rect(w // 2 - 22, 13, 45, 1, "K")
    for x in (3, w - 6):
        s.rect(x, 14, 3, 28, "N")
        s.rect(x + 2, 14, 1, 28, "P")
    planks(s, 5, 28, w - 10, 14, face="o", seam="N", top="T")
    s.rect(5, 41, w - 10, 2, "N")
    s.rect(7, 22, w - 14, 6, "T")                               # counter top
    s.rect(7, 22, w - 14, 1, "W")
    if goods == "fish":
        for x in range(10, 34, 8):
            s.stamp([".sss.", "CssCs", ".sss."], x, 23)
    elif goods == "fruit":
        for i, x in enumerate(range(9, 35, 5)):
            s.stamp([".%s." % "RYo"[i % 3], "%s%s%s" % (("RYo"[i % 3],) * 3)], x, 24)
    elif goods == "bread":
        for x in range(9, 33, 8):
            s.stamp([".oooo.", "oYYYYo", ".oooo."], x, 23)
    elif goods == "cloth":
        for i, x in enumerate(range(9, 35, 6)):
            s.rect(x, 23, 5, 5, "LRCv"[i % 4])
            s.rect(x, 23, 5, 1, "W")
    return s.outline(), (w // 2, 42)


def pier(length):
    """A plank pier running out to sea, posts along both sides."""
    w = 30
    s = Sprite(w, length + 10)
    planks(s, 3, 2, w - 6, length + 4, face="o", seam="N", top="T")
    s.rect(3, 2, 1, length + 4, "T")
    s.rect(w - 4, 2, 1, length + 4, "N")
    for y in range(0, length + 4, 14):
        for x in (1, w - 4):
            s.rect(x, y, 3, 8, "P")
            s.rect(x, y, 3, 1, "N")
    s.rect(3, length + 6, w - 6, 2, "N")
    return s.outline(), (w // 2, length + 7)


def boat():
    """A rowboat hauled up on the sand, bow to the left, seen a little from above."""
    s = Sprite(44, 24)
    for y in range(3, 21):                                      # hull: pointed bow, square stern
        t = abs(y - 11) / 8
        left = round(2 + 14 * t * t)
        s.rect(left, y, 40 - left, 1, "N" if y > 15 else "o")
    for y in range(6, 17):                                      # the inside
        t = abs(y - 11) / 6
        left = round(6 + 12 * t * t)
        s.rect(left, y, 34 - left, 1, "T")
    for x in (16, 26):                                          # thwarts
        s.rect(x, 6, 3, 11, "o")
        s.rect(x + 2, 6, 1, 11, "N")
    s.rect(38, 4, 2, 16, "P")
    s.rect(2, 16, 38, 1, "P")
    s.rect(8, 8, 4, 2, "N")                                     # oars shipped
    s.rect(12, 9, 20, 1, "N")
    s.stamp(["ss", "sg"], 34, 12)
    return s.outline(), (21, 20)


def lamppost(lit=True):
    s = Sprite(12, 38)
    s.rect(5, 8, 2, 28, "g")
    s.rect(3, 34, 6, 3, "g")
    s.rect(3, 34, 6, 1, "s")
    s.rect(3, 2, 6, 7, "Y" if lit else "s")
    s.rect(3, 2, 6, 1, "g")
    s.rect(2, 1, 8, 1, "K")
    s.put(5, 0, "g")
    s.rect(4, 3, 1, 5, "W" if lit else "W")
    s.rect(3, 9, 6, 1, "g")
    return s.outline(), (6, 36)


def lobster_trap():
    s = Sprite(18, 13)
    for y in range(2, 11):
        hw = 7 - (2 if y in (2, 10) else 0)
        for x in range(8 - hw, 9 + hw):
            s.put(x, y, "s" if (x + y) % 3 else "N")
    s.rect(1, 6, 16, 1, "o")
    s.rect(4, 2, 1, 9, "N")
    s.rect(12, 2, 1, 9, "N")
    return s.outline(), (9, 12)


def buoy():
    s = Sprite(10, 16)
    s.rect(4, 0, 2, 5, "g")
    for y in range(4, 14):
        hw = 4 - (1 if y < 6 or y > 11 else 0)
        for x in range(5 - hw, 5 + hw):
            s.put(x, y, "R" if y < 9 else "W")
    s.put(2, 6, "W")
    return s.outline(), (5, 14)


def driftwood():
    s = Sprite(30, 10)
    for x in range(2, 28):
        top = 3 + (x > 20) + (x < 6)
        for y in range(top, 8):
            s.put(x, y, "W" if y == top else "T" if y < 6 else "s")
    s.put(24, 2, "T")
    s.put(25, 1, "T")
    return s.outline(), (15, 8)


def fish_rack():
    """A drying rack of split fish, the way a Nova Scotia shore keeps them."""
    s = Sprite(32, 28)
    s.rect(2, 4, 2, 22, "N")
    s.rect(28, 4, 2, 22, "N")
    s.rect(2, 6, 28, 1, "o")
    s.rect(2, 15, 28, 1, "o")
    for x in range(5, 26, 6):
        for y in (7, 16):
            s.stamp([".sss.", "sTTTs", ".sss.", "..s.."], x, y)
    return s.outline(), (16, 26)


# ------------------------------------------------------------------ the Ancestral Oak

def oak_tree():
    """The Ancestral Oak: a crown eight tiles wide on a trunk you could hide in."""
    w, h = 136, 140
    s, cx = Sprite(w, h), w // 2
    s.rect(cx - 12, 92, 24, 40, "N")                            # trunk with buttress roots
    s.rect(cx - 12, 92, 5, 40, "o")
    s.rect(cx + 6, 92, 6, 40, "P")
    for t in range(14):
        s.rect(cx - 12 - t, 118 + t, 3, 14 - t, "N")
        s.rect(cx + 10 + t, 118 + t, 3, 14 - t, "P")
        s.put(cx - 12 - t, 118 + t, "o")
    s.rect(cx - 30, 130, 60, 5, "N")
    s.rect(cx - 30, 130, 60, 1, "o")
    for y in range(96, 130, 6):                                 # bark
        s.put(cx - 4, y + (y // 6) % 3, "P")
        s.put(cx + 2, y + 3 - (y // 6) % 2, "P")
    s.rect(cx - 5, 104, 10, 13, "K")                            # the hollow
    s.rect(cx - 4, 103, 8, 1, "P")
    blobs = [(cx, 46, 30), (cx - 38, 56, 24), (cx + 38, 56, 24), (cx - 20, 30, 20), (cx + 22, 28, 20),
             (cx - 52, 74, 16), (cx + 54, 72, 16), (cx, 72, 26), (cx - 30, 84, 14), (cx + 32, 86, 14),
             (cx - 8, 14, 12), (cx + 10, 12, 10), (cx - 58, 60, 10), (cx + 60, 58, 10)]
    leaf_blobs(s, blobs)
    for bx, by, r in blobs[:6]:                                 # sun on the upper crowns
        s.put(bx - r // 2, by - r // 2 - 1, "Y")
        s.put(bx - r // 2 + 1, by - r // 2 - 2, "Y")
    return s.outline(), (cx, 133)


def mural():
    """Skye's wall: boards painted with a running figure, mid-frame, in every colour she had."""
    w, h = 58, 38
    s = Sprite(w, h)
    for x in (2, w - 5):
        s.rect(x, 2, 3, 34, "N")
    planks(s, 5, 4, w - 10, 30, face="T", seam="s", top="W")
    for x in range(5, w - 5, 6):
        s.rect(x + 5, 4, 1, 30, "s")
    s.rect(8, 8, 42, 22, "B")                                   # night-blue ground
    for x, y in ((12, 11), (20, 24), (40, 12), (44, 26), (30, 9)):
        s.put(x, y, "W")
    fig = ["...RR....", "..RRRR...", "...TT....", "..YYYY...", ".YYYYYYo.", "..YYYY...", ".LL..LL..", "LL....LL."]
    s.stamp(fig, 22, 12)
    for i, k in enumerate("RoYvCL"):                            # spray arcs behind
        for t in range(8):
            s.put(10 + i * 2 + t // 2, 26 - i * 2 - t % 3, k)
    s.stamp(["RRR", "R.R"], 44, 18)
    s.stamp(["CC", "CC"], 12, 20)
    return s.outline(), (w // 2, 36)


def beehive():
    s = Sprite(18, 22)
    for i, y in enumerate((4, 10, 15)):
        s.rect(3, y, 12, 6, "W")
        s.rect(3, y, 12, 1, "s")
        s.rect(13, y, 2, 6, "s")
    s.rect(2, 2, 14, 3, "g")
    s.rect(2, 2, 14, 1, "s")
    s.rect(6, 18, 6, 2, "K")
    s.rect(3, 20, 12, 1, "N")
    for x, y in ((0, 7), (16, 3), (1, 15)):
        s.put(x, y, "Y")
        s.put(x + 1, y, "K")
    return s.outline(), (9, 21)


def mushrooms(seed=0):
    s = Sprite(14, 10)
    for i, (x, y) in enumerate(((2, 4), (7, 2), (10, 5))):
        cap = "R" if (seed + i) % 3 else "o"
        s.stamp([".%s%s." % (cap, cap), "%s%sW%s" % (cap, cap, cap), ".TT."], x, y)
        s.put(x + 1, y + 3, "T")
        s.put(x + 2, y + 3, "T")
        s.put(x + 1, y + 4, "s")
        s.put(x + 2, y + 4, "s")
    return s.outline(), (7, 9)


def log_bench():
    s = Sprite(34, 14)
    s.rect(3, 4, 28, 6, "N")
    s.rect(3, 4, 28, 2, "T")
    s.rect(3, 6, 28, 1, "o")
    s.rect(3, 9, 28, 1, "P")
    for x in (6, 24):
        s.rect(x, 10, 4, 3, "N")
    s.stamp(["oo", "o."], 1, 5)
    s.stamp(["oo", ".o"], 31, 5)
    return s.outline(), (17, 12)


def standing_stone():
    s = Sprite(20, 30)
    for y in range(2, 27):
        hw = 5 + (y - 2) * 3 // 25
        for x in range(10 - hw, 10 + hw + 1):
            s.put(x, y, "W" if x < 10 - hw + 2 and y < 20 else "g" if x > 10 + hw - 3 else "s")
    for x, y in ((6, 14), (11, 20), (8, 24)):
        s.stamp(["GG", ".G"], x, y)
    s.stamp(["K..K", ".KK.", "K..K"], 8, 8)
    return s.outline(), (10, 28)


# ------------------------------------------------------------------ Mine Entrance

def rock_face(s, x0, y0, w, h, seed=0):
    """Irregular strata: rows of uneven height, blocks of uneven width, a lit top edge and a dark seam."""
    y = y0
    row = 0
    while y < y0 + h:
        rh = 6 + round(hash2(row, seed, 70) * 5)
        rh = min(rh, y0 + h - y)
        x = x0 - round(hash2(row, seed, 71) * 12)
        while x < x0 + w:
            bw = 9 + round(hash2(x, row, 72 + seed) * 10)
            tone = hash2(x, row, 73 + seed)
            mid = "O" if tone < 0.25 else "s"
            for py in range(y, y + rh):
                for px in range(max(x, x0), min(x + bw, x0 + w)):
                    if py == y + rh - 1 or px == x + bw - 1:
                        s.put(px, py, "g")
                    elif py == y and px < x + bw - 2:
                        s.put(px, py, "W" if mid == "s" else "s")
                    else:
                        s.put(px, py, mid)
            if hash2(x, row, 74) < 0.3:                                # a crack
                cx = x + 3 + round(hash2(x, row, 75) * (bw - 6))
                for t in range(rh - 2):
                    s.put(min(max(cx + (t // 2) % 2, x0), x0 + w - 1), y + 1 + t, "g")
            x += bw
        y += rh
        row += 1


def cliff(width, height=44, seed=0):
    """A rock face seen from below: grass lip, uneven strata, rubble at the foot."""
    s = Sprite(width, height)
    s.rect(0, 0, width, 3, "v")
    s.rect(0, 3, width, 1, "G")
    rock_face(s, 0, 4, width, height - 8, seed)
    for x in range(0, width, 6):
        s.rect(x, 4, 1, 2, "g")
    s.rect(0, height - 4, width, 4, "g")
    for x in range(0, width, 5):
        s.stamp(["s"], x + (x // 5) % 3, height - 3)
    return s, (width // 2, height)


def puddle(w=22, h=9):
    """Standing water on mud, ground level: grey sky in it, one glint."""
    s = Sprite(w, h)
    shaded_ellipse(s, w / 2 - 0.5, h / 2 - 0.5, w / 2 - 0.5, h / 2 - 0.5, "s", "s", "g", hi_cut=2, lo_cut=-0.6)
    s.put(w // 3, h // 3, "W")
    s.put(w // 3 + 1, h // 3, "W")
    return s, (w // 2, h - 1)


def cave_mouth():
    """The way in: a timbered opening in the rock, rails running out of the dark."""
    w, h = 70, 64
    s = Sprite(w, h)
    rock_face(s, 0, 4, w, h - 8, seed=3)
    s.rect(0, 0, w, 3, "v")
    s.rect(0, 3, w, 1, "G")
    for y in range(14, 60):                                     # the opening
        hw = 16 if y > 22 else 8 + (y - 14)
        s.rect(w // 2 - hw, y, hw * 2 + 1, 1, "K")
    s.rect(w // 2 - 17, 22, 35, 3, "P")
    s.rect(w // 2 - 22, 10, 44, 6, "N")                         # lintel and posts
    s.rect(w // 2 - 22, 10, 44, 1, "o")
    s.rect(w // 2 - 22, 15, 44, 1, "P")
    for x in (w // 2 - 22, w // 2 + 17):
        s.rect(x, 16, 5, 44, "N")
        s.rect(x, 16, 1, 44, "o")
        s.rect(x + 4, 16, 1, 44, "P")
    s.rect(w // 2 - 17, 42, 35, 1, "g")
    s.rect(w // 2 - 6, 30, 2, 30, "s")                          # rails
    s.rect(w // 2 + 4, 30, 2, 30, "s")
    for y in range(34, 60, 6):
        s.rect(w // 2 - 8, y, 16, 2, "N")
    s.stamp(["Y"], w // 2 - 20, 20)
    s.stamp(["o"], w // 2 - 20, 21)
    s.rect(0, h - 4, w, 4, "g")
    return s, (w // 2, h)


def rails(length):
    s = Sprite(20, length)
    for y in range(0, length, 6):
        s.rect(2, y + 1, 16, 2, "N")
        s.rect(2, y + 1, 16, 1, "o")
    s.rect(5, 0, 2, length, "s")
    s.rect(13, 0, 2, length, "s")
    s.rect(6, 0, 1, length, "g")
    s.rect(14, 0, 1, length, "g")
    return s, (10, length)


def mine_cart(full=True):
    s = Sprite(30, 24)
    for y in range(4, 18):
        inset = (y - 4) // 5
        s.rect(3 + inset, y, 24 - inset * 2, 1, "g" if (y - 4) % 5 == 4 else "s")
    s.rect(3, 4, 24, 1, "W")
    s.rect(4, 5, 2, 12, "W")
    if full:
        for x, y, k in ((7, 2, "O"), (12, 1, "O"), (17, 2, "O"), (22, 3, "O"), (10, 3, "Y"), (19, 1, "C")):
            s.stamp([".%s%s." % (k, k), "%s%s%s%s" % (k, k, k, k)], x, y)
    for x in (7, 19):
        s.stamp([".KK.", "KgKK", "KKgK", ".KK."], x, 18)
    return s.outline(), (15, 22)


def lantern_post():
    s = Sprite(12, 30)
    s.rect(5, 6, 2, 22, "N")
    s.rect(2, 5, 8, 1, "N")
    s.rect(2, 2, 5, 6, "Y")
    s.rect(2, 2, 5, 1, "g")
    s.rect(3, 4, 1, 3, "W")
    s.rect(2, 7, 5, 1, "g")
    s.rect(3, 27, 6, 2, "N")
    return s.outline(), (6, 28)


def tent():
    """Brayden's canvas tent, the flap tied back."""
    w, h = 46, 34
    s = Sprite(w, h)
    for y in range(4, 30):
        hw = 2 + (y - 4) * 20 // 26
        for x in range(w // 2 - hw, w // 2 + hw + 1):
            k = "T" if x < w // 2 - hw + 3 else "o" if x > w // 2 + hw - 5 else "T" if (y // 3) % 2 else "T"
            if x > w // 2 + hw - 5:
                k = "o"
            s.put(x, y, k)
    s.rect(w // 2 - 3, 2, 6, 2, "N")
    s.rect(w // 2, 2, 1, 28, "N")
    for y in range(12, 30):                                     # the opening
        hw = (y - 12) * 6 // 18
        s.rect(w // 2 - hw, y, hw * 2 + 1, 1, "K")
    s.rect(w // 2 - 5, 22, 3, 2, "o")
    s.rect(1, 30, w - 2, 2, "O")
    return s.outline(), (w // 2, 31)


def campfire(lit=True):
    s = Sprite(20, 16)
    for a in range(10):
        ang = a * math.pi / 5
        s.stamp(["ss", "sg"], 9 + round(math.cos(ang) * 7), 10 + round(math.sin(ang) * 3.5))
    s.rect(4, 9, 12, 2, "N")
    s.rect(6, 11, 8, 2, "P")
    if lit:
        s.stamp(["...R...", "..RoR..", ".RoYoR.", ".RoYoR.", "RRoYoRR"], 6, 3)
    else:
        s.stamp(["..g...", ".ggg..", "gggsg."], 6, 6)
    return s.outline(), (10, 13)


def ore_rock(vein="Y"):
    s = Sprite(16, 12)
    shaded_ellipse(s, 7.5, 6, 6.5, 4.5, "W", "s", "g")
    for x, y in ((4, 5), (8, 7), (10, 4), (6, 8)):
        s.put(x, y, vein)
    return s.outline(), (8, 10)


def warning_sign():
    s = Sprite(20, 26)
    s.rect(9, 12, 2, 12, "N")
    s.rect(2, 2, 16, 10, "Y")
    s.rect(2, 2, 16, 1, "W")
    s.rect(2, 11, 16, 1, "o")
    s.stamp(["K..K", ".KK.", "K..K"], 8, 5)
    return s.outline(), (10, 24)


# ------------------------------------------------------------------ Town Square

TOWNHOUSES = {
    "store": {"wall": "T", "trim": "N", "roof": ("R", "P"), "door": "N", "sign": ["ooooo", "oYYYo", "ooooo"]},
    "inn": {"wall": "W", "trim": "s", "roof": ("g", "B"), "door": "P", "sign": ["ooooo", "oWWWo", "ooooo"]},
    "bakery": {"wall": "s", "trim": "g", "roof": ("o", "N"), "door": "N", "sign": ["ooooo", "oTYTo", "ooooo"]},
    "hall": {"wall": "s", "trim": "W", "roof": ("B", "K"), "door": "P", "sign": None},
}


def townhouse(kind="store"):
    """A shopfront on the square: two storeys, a hanging sign, its own colours."""
    spec = TOWNHOUSES[kind]
    w, h = 78, 76
    s = Sprite(w, h)
    roof_lit, roof_dark = spec["roof"]
    for y in range(4, 26):                                      # roof
        hw = 24 + (y - 4) * 15 // 22
        for x in range(w // 2 - hw, w // 2 + hw + 1):
            k = roof_dark if (y - 4) % 5 == 4 or x > w // 2 + hw - 3 else roof_lit
            if (y - 4) % 5 == 0 and (x // 6 + (y - 4) // 5) % 2 == 0:
                k = roof_dark if k == roof_lit and (x // 6) % 3 == 0 else k
            s.put(x, y, k)
    s.rect(w // 2 - 39, 25, 78, 2, roof_dark)
    s.rect(4, 27, w - 8, 44, spec["wall"])                      # wall
    s.rect(4, 27, w - 8, 1, "W")
    s.rect(w - 7, 27, 3, 44, spec["trim"])
    s.rect(4, 27, 3, 44, spec["trim"])
    s.rect(4, 48, w - 8, 2, spec["trim"])                       # storey band
    if kind == "store":
        for x in range(12, w - 8, 10):
            s.rect(x, 50, 1, 21, spec["trim"])
    for wx, wy in ((12, 32), (w - 24, 32), (w - 24, 54)):       # windows
        s.rect(wx - 1, wy - 1, 13, 12, spec["trim"])
        s.rect(wx, wy, 11, 10, "B")
        s.rect(wx + 5, wy, 1, 10, "W")
        s.rect(wx, wy + 4, 11, 1, "W")
        s.rect(wx + 1, wy + 1, 2, 2, "C")
    dx = 14                                                     # door and step
    s.rect(dx - 1, 52, 14, 19, spec["trim"])
    s.rect(dx, 53, 12, 18, spec["door"])
    s.rect(dx + 1, 55, 4, 6, "K")
    s.rect(dx + 7, 55, 4, 6, "K")
    s.put(dx + 9, 63, "Y")
    s.rect(dx - 2, 71, 16, 3, "O")
    s.rect(dx - 2, 71, 16, 1, "s")
    if spec["sign"]:
        s.rect(38, 52, 1, 6, "g")
        s.rect(34, 51, 9, 1, "g")
        s.stamp(spec["sign"], 36, 57)
    else:
        s.stamp([".Y.", "YYY", ".Y."], 36, 55)
    s.rect(w // 2 - 3, 0, 6, 5, "s")                            # chimney
    s.rect(w // 2 - 3, 0, 6, 1, "K")
    return s.outline(), (w // 2, 72)


def fountain():
    w, h = 46, 40
    s = Sprite(w, h)
    for y in range(20, 38):                                     # basin
        for x in range(w):
            nx, ny = (x - 22.5) / 22, (y - 29) / 9
            if nx * nx + ny * ny <= 1:
                inner = ((x - 22.5) / 18) ** 2 + ((y - 27) / 6) ** 2 <= 1
                s.put(x, y, "L" if inner else "W" if y < 24 else "s" if y < 34 else "g")
    for x in range(8, 38, 6):
        s.put(x, 27, "C")
        s.put(x + 1, 27, "C")
    s.rect(20, 10, 6, 16, "s")                                  # column and bowl
    s.rect(20, 10, 2, 16, "W")
    s.rect(25, 10, 1, 16, "g")
    s.rect(14, 8, 18, 4, "s")
    s.rect(14, 8, 18, 1, "W")
    s.rect(16, 9, 14, 2, "L")
    s.rect(22, 1, 2, 7, "W")
    s.stamp(["C.C", ".C."], 21, 0)
    for x, y in ((12, 12), (33, 13), (17, 15), (28, 16)):
        s.put(x, y, "C")
    return s.outline(), (23, 36)


def notice_board():
    """The Town Contracts board: papers under a little roof."""
    s = Sprite(30, 32)
    s.rect(4, 4, 22, 20, "N")
    s.rect(6, 6, 18, 16, "T")
    s.rect(2, 2, 26, 3, "g")
    s.rect(2, 2, 26, 1, "s")
    for x, y in ((7, 8), (16, 7), (8, 15), (17, 15)):
        s.rect(x, y, 6, 6, "W")
        s.rect(x + 1, y + 2, 4, 1, "s")
        s.rect(x + 1, y + 4, 3, 1, "s")
        s.put(x + 2, y, "R")
    s.rect(6, 24, 3, 7, "N")
    s.rect(21, 24, 3, 7, "N")
    return s.outline(), (15, 30)


def bench():
    s = Sprite(26, 14)
    s.rect(2, 2, 22, 3, "o")
    s.rect(2, 2, 22, 1, "T")
    s.rect(2, 6, 22, 3, "o")
    s.rect(2, 6, 22, 1, "T")
    s.rect(2, 8, 22, 1, "N")
    for x in (3, 21):
        s.rect(x, 3, 2, 10, "g")
    s.rect(2, 12, 4, 1, "g")
    s.rect(20, 12, 4, 1, "g")
    return s.outline(), (13, 12)


def planter(kind="R"):
    s = Sprite(20, 14)
    s.rect(2, 6, 16, 6, "s")
    s.rect(2, 6, 16, 1, "W")
    s.rect(16, 6, 2, 6, "g")
    s.rect(3, 4, 14, 2, "G")
    for i, x in enumerate((4, 8, 12)):
        s.stamp([".%s." % kind, "%sY%s" % (kind, kind), ".G."], x, 1 + i % 2)
    return s.outline(), (10, 12)


def beacon():
    """Leo's beacon: a stepped stone plinth and a brass dish, waiting for its light."""
    w, h = 44, 52
    s = Sprite(w, h)
    for i, (hw, top) in enumerate(((21, 42), (16, 36), (11, 30))):
        s.rect(w // 2 - hw, top, hw * 2, 8 if i < 2 else 6, "s")
        s.rect(w // 2 - hw, top, hw * 2, 1, "W")
        s.rect(w // 2 + hw - 3, top, 3, 8 if i < 2 else 6, "g")
    s.rect(w // 2 - 2, 14, 4, 16, "g")
    s.rect(w // 2 - 2, 14, 1, 16, "s")
    for y in range(6, 14):                                      # the dish
        hw = 4 + (13 - y) * 8 // 7
        s.rect(w // 2 - hw, y, hw * 2, 1, "Y" if y < 8 else "o")
    s.rect(w // 2 - 12, 5, 24, 1, "W")
    s.rect(w // 2 - 10, 9, 20, 1, "N")
    s.stamp([".C.", "CWC", ".C."], w // 2 - 1, 0)
    s.rect(1, 50, w - 2, 1, "O")
    return s.outline(), (w // 2, 49)


# ------------------------------------------------------------------ water and weather (animated: lists of frames)

FRAMES = 4


def bridge(length=32):
    """Planks across a stream with a rail each side; the deck runs left to right."""
    w, h = length + 8, 22
    s = Sprite(w, h)
    s.rect(2, 6, w - 4, 10, "o")
    for x in range(2, w - 2, 4):
        s.rect(x + 3, 6, 1, 10, "N")
    s.rect(2, 6, w - 4, 1, "T")
    s.rect(2, 15, w - 4, 2, "N")
    for y in (2, 18):
        s.rect(1, y, w - 2, 2, "o")
        s.rect(1, y + 2, w - 2, 1, "N")
    for x in range(1, w - 1, 12):
        s.rect(x, 1, 2, 6, "N")
        s.rect(x, 17, 2, 5, "N")
    return s.outline(), (w // 2, 20)


def waterfall(height=60, width=22):
    """A sheet of falling water with foam at the foot. Four frames; the streaks run down."""
    frames = []
    w = width + 8
    for f in range(FRAMES):
        s = Sprite(w, height + 12)
        for y in range(height):
            for x in range(4, width + 4):
                k = "L"
                if (x * 3 + y - f * 3) % 9 in (0, 1):
                    k = "C"
                if (x * 5 + y - f * 3) % 13 == 0:
                    k = "W"
                if x in (4, width + 3):
                    k = "B"
                s.put(x, y, k)
        for x in range(w):
            d = abs(x - (w - 1) / 2) / (w / 2)
            for y in range(height - 2, height + 10):
                if y - height + 2 < 9 * (1 - d * d):
                    r = hash2(x, y, 90 + f)
                    s.put(x, y, "W" if r < 0.45 else "C" if r < 0.8 else "L")
        for i in range(7):
            x = 1 + round(hash2(i, f, 91) * (w - 3))
            y = height - 5 - round(hash2(i, f, 92) * 12)
            s.put(x, y, "W")
        frames.append((s, (w // 2, height + 8)))
    return frames


def smoke():
    """Chimney smoke: three puffs rising and spreading, on a loop."""
    frames = []
    for f in range(FRAMES):
        s = Sprite(16, 26)
        for i in range(3):
            t = (i * 4 + f) % 12
            y = 22 - t * 1.6
            x = 7 + round(2 * math.sin(t * 0.8 + i * 2))
            r = 1 + t // 4
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if dx * dx + dy * dy <= r * r:
                        s.put(x + dx, round(y) + dy, "W" if dy < 0 and dx <= 0 else "s")
        frames.append((s, (8, 24)))
    return frames


def campfire_lit():
    """The campfire with its flame flickering over four frames."""
    flames = [
        ["...R...", "..RoR..", ".RoYoR.", ".RoYoR.", "RRoYoRR"],
        ["..R....", "..RoR..", ".RoYoR.", "RRoYoR.", "RRoYoRR"],
        ["....R..", "..RoRR.", ".RoYoR.", ".RoYoRR", "RRoYoRR"],
        ["...R...", "..RYR..", ".RoYoR.", ".RoYoR.", "RRoYoRR"],
    ]
    frames = []
    for f in range(FRAMES):
        s = Sprite(20, 16)
        for a in range(10):
            ang = a * math.pi / 5
            s.stamp(["ss", "sg"], 9 + round(math.cos(ang) * 7), 10 + round(math.sin(ang) * 3.5))
        s.rect(4, 9, 12, 2, "N")
        s.rect(6, 11, 8, 2, "P")
        s.stamp(flames[f], 6, 3)
        frames.append((s.outline(), (10, 13)))
    return frames


def market_cart():
    s = Sprite(38, 28)
    planks(s, 4, 8, 28, 10, face="o", seam="N", top="T")
    s.rect(4, 17, 28, 2, "N")
    for i, x in enumerate(range(6, 30, 5)):
        k = "RYoRv"[i % 5]
        s.stamp([".%s%s." % (k, k), "%s%s%s%s" % (k, k, k, k)], x, 4)
    s.rect(32, 10, 5, 2, "N")
    for a in range(12):
        ang = a * math.pi / 6
        s.put(12 + round(math.cos(ang) * 5), 21 + round(math.sin(ang) * 5), "N")
    s.rect(11, 20, 3, 3, "o")
    s.rect(24, 19, 3, 7, "N")
    return s.outline(), (19, 26)
