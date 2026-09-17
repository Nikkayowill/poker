"""The Coastal Market's sprites at the rich bar: stalls, the pier, a hauled-up rowboat, lobster traps, buoys,
driftwood, a fish-drying rack, seagulls and fish. Same signatures, sizes and anchors as props.py and creatures.py."""
import math

from pal import Canvas, hash2, noise1

# Sprite-pixel light points, for the engine's night glow.
LIGHTS = {"stall": [(37, 19, "lamp")]}

AWNING = {"R": "red", "L": "blue", "v": "leaf2", "o": "orange", "C": "teal", "Y": "gold", "N": "wood"}
FISH = {"s": "stone", "o": "orange", "R": "red", "Y": "gold", "T": "tan", "N": "wood", "C": "teal"}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def weathered_planks(c, x0, y0, w, h, seed, base=4.2, board=4, nails=()):
    """Horizontal salt-silvered boards: a lit top edge, grain, a dark gap, the odd warmer board and nail heads."""
    for y in range(y0, y0 + h):
        row, ry = (y - y0) // board, (y - y0) % board
        warm = hash2(row, 0, seed) < 0.25
        ramp = "khaki" if warm else "greywood"
        b = base + (hash2(row, 1, seed) - 0.5) * 0.9 - (0.9 if warm else 0)
        for x in range(x0, x0 + w):
            if ry == board - 1:
                level = 0.9
            elif ry == 0:
                level = b + 1.1
            else:
                level = b + (noise1(x * 0.6, y * 3, 3, seed + row) - 0.5) * 1.2
            if x == x0:
                level += 0.8
            elif x == x0 + w - 1:
                level -= 1.0
            c.put(x, y, ramp, level)
        if ry == 1:
            for nx in nails:
                c.put(x0 + nx, y, "stone", 5.8)


# ------------------------------------------------------------------ stalls

def stall(color="R", goods="fish"):
    """A market stall: scalloped striped awning, weathered plank counter, its goods, a lantern for evenings."""
    w, h = 46, 46
    c, cx = Canvas(w, h), w // 2
    cloth = AWNING.get(color, "red")
    for y in range(2, 14):                                        # awning, sloping toward us
        hw = 18 + (y - 2) * 4 // 12
        for x in range(cx - hw, cx + hw + 1):
            stripe = (x - cx + hw) // 5
            sx = (x - cx + hw) % 5
            coloured = stripe % 2 == 1
            ramp, base = (cloth, 3.6) if coloured else ("linen", 5.3)
            level = base + 0.9 - (y - 2) * 0.12 - (x - (cx - hw)) / (2 * hw) * 0.8
            if sx == 0:
                level += 0.5
            elif sx == 4:
                level -= 0.7
            if y == 2:
                level += 0.6
            c.put(x, y, ramp, level)
    for x in range(cx - 22, cx + 23):                             # scalloped valance
        sx = (x - (cx - 22)) % 5
        coloured = ((x - (cx - 22)) // 5) % 2 == 1
        ramp, base = (cloth, 2.8) if coloured else ("linen", 4.4)
        c.put(x, 14, ramp, base)
        if sx in (1, 2, 3):
            c.put(x, 15, ramp, base - 0.8 - (0.4 if sx != 2 else 0))
    for px in (3, w - 6):                                         # posts
        for y in range(14, 42):
            for i in range(3):
                level = (5.0, 3.8, 2.0)[i] - (1.6 if y < 18 else 0) + (noise1(px + i, y, 4, 7) - 0.5) * 0.6
                c.put(px + i, y, "greywood", level)
    weathered_planks(c, 5, 28, w - 10, 13, seed=11 + len(goods), base=4.0, nails=(2, w - 13))
    for x in range(5, w - 5):
        c.put(x, 41, "greywood", 1.8)
        c.put(x, 42, "greywood", 0.8)
    for y in range(22, 28):                                       # counter top
        for x in range(7, w - 7):
            level = 6.2 if y == 22 else 1.4 if y == 27 else 4.6 - (y - 23) * 0.25
            c.put(x, y, "tan", level - (x - 7) / (w - 14) * 0.6)
    for x in range(7, w - 7):                                     # the awning's shade on the counter
        c.shift(x, 23, -0.6)
    if goods == "fish":
        for fx in range(10, 34, 8):
            for x, y in ((fx + 1, 26), (fx + 3, 26)):
                c.put(x, y, "linen", 6.0)                          # crushed ice
            for i, (dx, dy, ramp, lv) in enumerate((
                    (1, 0, "stone", 6.0), (2, 0, "stone", 5.4), (3, 0, "stone", 4.8),
                    (0, 1, "stone", 4.4), (1, 1, "coal", 0.6), (2, 1, "teal", 4.4), (3, 1, "stone", 3.6), (4, 1, "stone", 5.0),
                    (1, 2, "stone", 3.2), (2, 2, "stone", 2.8), (3, 2, "stone", 2.6), (5, 0, "stone", 3.4), (5, 2, "stone", 3.0))):
                c.put(fx + dx, 23 + dy, ramp, lv)
    elif goods == "fruit":
        tones = (("red", 4.0), ("straw", 4.6), ("orange", 4.2))
        for i, fx in enumerate(range(9, 35, 5)):
            ramp, lv = tones[i % 3]
            for dx, dy, d in ((1, 0, 0.8), (0, 1, 0.2), (1, 1, 0), (2, 1, -0.8), (1, 2, -1.4), (0, 2, -0.8), (2, 2, -1.8)):
                c.put(fx + dx, 23 + dy, ramp, lv + d)
            c.put(fx, 23, "leaf2", 4.2)
    elif goods == "bread":
        for bx in range(9, 33, 8):
            for dx in range(6):
                for dy in range(3):
                    edge = dy == 2 or dx in (0, 5)
                    c.put(bx + dx, 23 + dy, "wood", (5.6 - dx * 0.25) if dy == 0 else (3.0 if edge else 4.6 - dx * 0.2))
            c.put(bx + 2, 23, "straw", 5.6)
            c.put(bx + 4, 24, "wood", 2.6)                         # the scored crust
    elif goods == "cloth":
        tones = ("blue", "red", "teal", "leaf2")
        for i, bx in enumerate(range(9, 35, 6)):
            ramp = tones[i % 4]
            for dx in range(5):
                for dy in range(5):
                    level = 4.6 if dy == 0 else 3.0 - dx * 0.12
                    if dy in (2, 4):
                        level -= 0.9                               # folds
                    c.put(bx + dx, 22 + dy, ramp, level + (0.6 if dx == 0 else 0))
    c.put(37, 15, "stone", 2.2)                                   # a lantern hung under the awning
    c.put(37, 16, "stone", 2.2)
    for x, lv in ((36, 2.6), (37, 1.8), (38, 1.2)):
        c.put(x, 17, "coal", lv)
    for y in (18, 19, 20):
        c.put(36, y, "coal", 1.6)
        c.put(38, y, "coal", 0.8)
        c.put(37, y, "lamp", 4.6 if y == 19 else 3.2)
    for x in (36, 37, 38):
        c.put(x, 21, "coal", 1.2)
    return c.outline().image(), (cx, 42)


# ------------------------------------------------------------------ pier, boat and shore clutter

def pier(length):
    """Salt-silvered planks running out to sea, wet dark posts with weed at the waterline."""
    w = 30
    c = Canvas(w, length + 10)
    weathered_planks(c, 3, 2, w - 6, length + 4, seed=23, base=4.4, nails=(2, w - 9))
    for y in range(0, length + 4, 14):
        for px in (1, w - 4):
            for dy in range(8):
                for i in range(3):
                    level = (4.4, 3.0, 1.4)[i] - dy * 0.12
                    ramp = "moss" if dy >= 6 and hash2(px + i, y + dy, 3) < 0.5 else "leather"
                    c.put(px + i, y + dy, ramp, level if ramp == "leather" else 2.4)
            for i in range(3):
                c.put(px + i, y, "greywood", 5.8 - i)
            c.put(px + 1, y + 3, "straw", 4.0)                     # a turn of rope
    for x in range(3, w - 3):
        c.put(x, length + 6, "leather", 2.2)
        c.put(x, length + 7, "leather", 1.0)
    return c.outline().image(), (w // 2, length + 7)


def boat():
    """A clinker-built rowboat hauled up on the sand, bow to the left: teal paint worn to wood, a puddle in the bilge."""
    c = Canvas(44, 24)
    for y in range(3, 21):                                        # hull, lapped strakes
        t = abs(y - 11) / 8
        left = round(2 + 14 * t * t)
        for x in range(left, 42):
            below = y > 15
            level = (2.6 if below else 3.8) - (y - 3) * 0.05 + (0.9 if x == left else 0)
            if (y - 3) % 3 == 2:
                level -= 1.0
            worn = noise1(x, y, 4, 31) > 0.62
            c.put(x, y, "wood" if worn or below else "teal", level + (0.4 if worn else 0))
    for y in range(6, 17):                                        # the inside, with ribs
        t = abs(y - 11) / 6
        left = round(6 + 12 * t * t)
        for x in range(left, 38):
            level = 4.8 - (x - left) * 0.03 - (0.9 if y == 6 else 0)
            if (x - 7) % 4 == 0:
                level -= 1.2
            c.put(x, y, "tan", level)
    for x in range(20, 30):                                       # bilge water
        c.put(x, 15, "water", 3.6)
        c.put(x, 14, "water", 4.6 if x % 3 else 6.2)
    for x0 in (16, 26):                                           # thwarts
        for y in range(6, 17):
            c.put(x0, y, "wood", 5.6)
            c.put(x0 + 1, y, "wood", 4.4)
            c.put(x0 + 2, y, "wood", 2.4)
    for y in range(4, 20):                                        # transom
        c.put(38, y, "leather", 2.4)
        c.put(39, y, "leather", 1.4)
    for x in range(2, 40):
        c.put(x, 16, "leather", 1.6)
    for x in range(8, 32):                                        # oars shipped
        c.put(x, 9, "wood", 5.0 if x > 11 else 5.8)
        if x < 12:
            c.put(x, 8, "wood", 4.6)
    c.put(34, 12, "stone", 6.0)
    c.put(35, 12, "stone", 4.4)
    c.put(34, 13, "stone", 4.0)
    c.put(35, 13, "stone", 2.6)
    return c.outline().image(), (21, 20)


def lobster_trap():
    """A slatted wooden trap with netting you can see through, lashed with rope, a red tag."""
    c = Canvas(18, 13)
    for y in range(2, 11):
        hw = 7 - (2 if y in (2, 10) else 0)
        for x in range(8 - hw, 9 + hw):
            net = (x + y) % 3 == 0 or (x - y) % 3 == 0
            c.put(x, y, "stone" if net else "coal", (5.4 - (x - 1) * 0.12) if net else 1.4)
    for x in range(3, 14):                                        # top and bottom rails
        c.put(x, 2, "wood", 5.0)
        c.put(x, 10, "wood", 2.6)
    for x in range(1, 17):                                        # rope lashing
        c.put(x, 6, "straw", 4.4 - x * 0.05)
    for sx in (4, 12):
        for y in range(2, 11):
            c.put(sx, y, "wood", 4.4 if sx == 4 else 3.0)
    c.put(14, 7, "red", 4.2)
    c.put(14, 8, "red", 2.8)
    return c.outline().image(), (9, 12)


def buoy():
    """A red-and-white float riding the swell, a steel pole, a little ripple ring on the water."""
    c = Canvas(10, 16)
    for y in range(0, 5):
        c.put(4, y, "stone", 5.6)
        c.put(5, y, "stone", 3.0)
    for y in range(4, 14):
        hw = 4 - (1 if y < 6 or y > 11 else 0)
        for x in range(5 - hw, 5 + hw):
            rel = (x - (5 - hw)) / max(2 * hw - 1, 1)
            shade = 1.2 - abs(rel - 0.3) * 2.2
            if y < 9:
                c.put(x, y, "red", 3.6 + shade)
            else:
                c.put(x, y, "linen", 4.8 + shade - (0.9 if y > 11 else 0))
        if y == 9:
            for x in range(5 - hw, 5 + hw):
                c.put(x, y, "red", 1.8)
    c.put(2, 6, "linen", 6.4)
    c.outline()
    for x, lv in ((0, 6.4), (1, 5.2), (8, 5.4), (9, 6.2)):
        c.put(x, 14, "water", lv)
    for x in range(2, 8):
        c.put(x, 15, "water", 6.6 if x % 2 else 5.4)
    return c.image(), (5, 14)


def driftwood():
    """A sun-bleached silver log with long grain, a knot and a broken branch."""
    c = Canvas(30, 10)
    for x in range(2, 28):
        top = 3 + (x > 20) + (x < 6)
        for y in range(top, 8):
            level = 6.4 if y == top else 5.2 - (y - top) * 0.55
            if noise1(x * 0.35, y * 2.2, 2, 41) < 0.3:
                level -= 1.2
            c.put(x, y, "greywood", level)
    for x, y, lv in ((13, 5, 2.0), (14, 5, 3.2), (13, 6, 3.0)):
        c.put(x, y, "greywood", lv)
    c.put(24, 2, "greywood", 5.6)
    c.put(25, 1, "greywood", 6.0)
    c.put(25, 2, "greywood", 3.6)
    return c.outline().image(), (15, 8)


def fish_rack():
    """A drying rack of split salt cod, the way a Nova Scotia shore keeps them."""
    c = Canvas(32, 28)
    for px in (2, 28):
        for y in range(4, 26):
            c.put(px, y, "greywood", 5.2 + (noise1(px, y, 3, 51) - 0.5))
            c.put(px + 1, y, "greywood", 2.6)
    for by in (6, 15):
        for x in range(2, 30):
            c.put(x, by, "wood", 4.8 - x * 0.03)
        for px in (2, 28):
            c.put(px, by - 1, "straw", 4.4)
            c.put(px + 1, by + 1, "straw", 3.4)
    for fx in range(5, 26, 6):
        for by in (7, 16):
            for dx, dy, ramp, lv in ((1, 0, "stone", 5.0), (2, 0, "stone", 4.4), (3, 0, "stone", 3.8),
                                     (0, 1, "stone", 4.6), (1, 1, "linen", 6.0), (2, 1, "tan", 5.4), (3, 1, "tan", 4.6),
                                     (4, 1, "stone", 3.0), (1, 2, "linen", 5.0), (2, 2, "tan", 4.4), (3, 2, "stone", 3.4),
                                     (2, 3, "stone", 2.6), (1, 4, "stone", 2.0), (3, 4, "stone", 2.0)):
                c.put(fx + dx, by + dy, ramp, lv)
    return c.outline().image(), (16, 26)


# ------------------------------------------------------------------ creatures

SEAGULL = [
    "........W..",
    ".......WWW.",
    ".sssWWWWKY.",
    "..sWWWWWW..",
    "...WWWWW...",
    ".....Y.Y...",
]


def seagull(facing_left=False):
    """A herring gull: white head and breast, grey back, black wingtips, a yellow bill and orange legs."""
    rows = [r[::-1] for r in SEAGULL] if facing_left else SEAGULL
    w, h = len(rows[0]) + 2, len(rows) + 2
    c = Canvas(w, h)
    for j, row in enumerate(rows):
        for i, k in enumerate(row):
            x, y = 1 + i, 1 + j
            src = len(row) - 1 - i if facing_left else i
            if k == "W":
                c.put(x, y, "white", 6.2 - j * 0.45 - (0.5 if src < 5 and j >= 3 else 0))
            elif k == "s":
                c.put(x, y, "coal" if src == 1 else "stone", 1.4 if src == 1 else 4.4 - j * 0.4)
            elif k == "K":
                c.put(x, y, "coal", 0.4)
            elif k == "Y":
                c.put(x, y, "gold" if j < 5 else "orange", 4.6 if j < 5 else 3.6)
    return c.outline().image(), (w // 2, h - 1)


def fish(kind="s"):
    """A fish out of water, for racks and counters: lit back, pale belly, a dark eye."""
    c = Canvas(7, 5)
    ramp = FISH.get(kind, "stone")
    for i, (dx, dy, lv) in enumerate(((2, 1, 5.6), (3, 1, 5.0), (4, 1, 4.4), (2, 2, 4.4), (3, 2, 4.0), (5, 2, 3.4),
                                      (2, 3, 3.0), (3, 3, 2.6), (4, 3, 2.4))):
        c.put(dx, dy, ramp, lv)
    c.put(1, 2, "teal", 4.6)
    c.put(4, 2, "coal", 0.6)
    c.put(5, 1, ramp, 3.0)
    c.put(5, 3, ramp, 2.6)
    return c.outline(ramp="blue", idx=0.8, rim=False).image(), (3, 4)
