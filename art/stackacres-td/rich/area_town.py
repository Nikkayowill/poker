"""Town Square's sprites at the rich bar: four townhouses, the fountain, the Town Contracts board, benches,
planters, lampposts, the market cart and Leo's beacon. Same signatures, sizes and anchors as props.py.
`LIGHTS` holds sprite-pixel light points for the engine's night glow (see rich/export_rich.py)."""
import math

from pal import TOP, Canvas, hash2, noise1


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def put(c, x, y, ramp, v):
    """Place a pixel by a 0..1 value on the ramp's own scale."""
    c.put(x, y, ramp, clamp(v, 0, 1) * TOP[ramp])


LIGHTS = {
    "lamppost": [(5, 5, "lamp")],
    "townhouse": [(17, 37, "window"), (59, 37, "window"), (59, 59, "window")],
}

# ------------------------------------------------------------------ townhouses

KINDS = {
    "store": {"wall": "boards", "wall_ramp": "tan", "trim": "wood", "roof": "barnred", "door": "wood",
              "curtain": "red", "sign": "coin"},
    "inn": {"wall": "timber", "wall_ramp": "linen", "trim": "stone", "roof": "slate", "door": "plum",
            "curtain": "pink", "sign": "mug"},
    "bakery": {"wall": "brick", "wall_ramp": "barnred", "trim": "wood", "roof": "orange", "door": "wood",
               "curtain": "straw", "sign": "bread"},
    "hall": {"wall": "stone", "wall_ramp": "stone", "trim": "white", "roof": "blue", "door": "plum",
             "curtain": "linen", "sign": None},
}


def _trim(c, x, y, spec, v):
    put(c, x, y, spec["trim"], v)


def _roof(c, w, spec, seed):
    ramp = spec["roof"]
    cx = w // 2
    for y in range(4, 26):
        hw = 24 + (y - 4) * 15 // 22
        r, ry = (y - 4) // 5, (y - 4) % 5
        off = 3 * (r % 2)
        for x in range(cx - hw, cx + hw + 1):
            col, tx = (x + off) // 6, (x + off) % 6
            rel = (x - (cx - hw)) / (2 * hw)
            v = 0.78 - r * 0.05 - rel * 0.26 + (hash2(col, r, seed) - 0.5) * 0.1
            if ry == 0:
                v -= 0.28 if tx in (2, 3) else 0.4
            elif ry == 1 and tx < 3:
                v += 0.1
            elif tx == 5:
                v -= 0.12
            if x > cx + hw - 3:
                v -= 0.2
            if x == cx - hw:
                v += 0.12
            put(c, x, y, ramp, v)
    for x in range(0, w):
        put(c, x, 25, ramp, 0.12)
        put(c, x, 26, ramp, 0.26)


def _chimney(c, w):
    for y in range(0, 5):
        for x in range(w // 2 - 3, w // 2 + 3):
            seam = y % 2 == 1 or (x + y // 2 * 2) % 3 == 2
            v = 0.62 - (x - (w // 2 - 3)) * 0.06 - (0.25 if seam else 0)
            if y == 0:
                v = 0.2
            put(c, x, y, "stone", v)


def _wall(c, w, spec, seed):
    kind, ramp = spec["wall"], spec["wall_ramp"]
    for y in range(27, 71):
        for x in range(7, w - 7):
            if kind == "boards":
                by = (y - 27) % 3
                v = (0.42, 0.78, 0.68)[by] + (noise1(x, (y - 27) // 3 * 5, 9, seed) - 0.5) * 0.08
            elif kind == "timber":
                v = 0.8 + (noise1(x, y, 5, seed) - 0.5) * 0.08
            elif kind == "brick":
                row, bx = (y - 27) // 3, (x + 3 * ((y - 27) // 3 % 2)) % 6
                if (y - 27) % 3 == 2 or bx == 5:
                    put(c, x, y, "khaki", 0.5 + (hash2(x, y, seed) - 0.5) * 0.06)
                    continue
                v = 0.5 + (hash2((x + 3 * (row % 2)) // 6, row, seed) - 0.5) * 0.14 + (0.06 if (y - 27) % 3 == 0 else 0)
            else:
                row, bx = (y - 27) // 4, (x + 4 * ((y - 27) // 4 % 2)) % 8
                if (y - 27) % 4 == 3 or bx == 7:
                    v = 0.38
                else:
                    v = 0.66 + (hash2((x + 4 * (row % 2)) // 8, row, seed) - 0.5) * 0.12
                    if (y - 27) % 4 == 0 or bx == 0:
                        v += 0.08
            if y < 31:
                v -= (31 - y) * 0.07                               # the eave's shade
            if y > 66:
                v -= (y - 66) * 0.03
            put(c, x, y, ramp, v)
    if kind == "timber":                                           # half-timbering on the upper storey
        for bx in (26, 50):
            for y in range(28, 48):
                put(c, bx, y, "wood", 0.38)
                put(c, bx + 1, y, "wood", 0.22)
        for x in range(28, 50):
            put(c, x, 37, "wood", 0.36)
            put(c, x, 38, "wood", 0.2)
        for (x0, y0), (x1, y1) in (((28, 47), (35, 40)), ((48, 47), (41, 40)), ((28, 29), (34, 36)), ((48, 29), (42, 36))):
            n = max(abs(x1 - x0), abs(y1 - y0))
            for i in range(n + 1):
                x = round(x0 + (x1 - x0) * i / n)
                y = round(y0 + (y1 - y0) * i / n)
                put(c, x, y, "wood", 0.36)
                put(c, x, y + 1, "wood", 0.2)
    for y in range(27, 71):                                        # corner trims
        for i, x in enumerate((4, 5, 6)):
            _trim(c, x, y, spec, (0.88, 0.74, 0.58)[i])
        for i, x in enumerate((71, 72, 73)):
            _trim(c, x, y, spec, (0.46, 0.34, 0.24)[i])
    for x in range(4, w - 4):
        _trim(c, x, 27, spec, 0.9)
        _trim(c, x, 48, spec, 0.8)
        _trim(c, x, 49, spec, 0.46)
        p = c.get(x, 50)
        if p and p[0] == ramp:
            c.put(x, 50, p[0], p[1] - TOP[ramp] * 0.12)
    if spec["wall"] == "boards":                                   # the store's pilasters
        for x in range(12, w - 8, 10):
            if 13 <= x <= 26:
                continue
            for y in range(50, 71):
                _trim(c, x, y, spec, 0.72)
                p = c.get(x + 1, y)
                if p and p[0] == ramp:
                    c.put(x + 1, y, p[0], p[1] - TOP[ramp] * 0.15)


def _window(c, wx, wy, spec, seed, box):
    for y in range(wy - 1, wy + 11):
        for x in range(wx - 1, wx + 12):
            lit = y == wy - 1 or x == wx - 1
            dark = y == wy + 10 or x == wx + 11
            _trim(c, x, y, spec, 0.9 if lit else 0.4 if dark else 0.7)
    for y in range(wy, wy + 10):
        for x in range(wx, wx + 11):
            v = 0.62 - (y - wy) * 0.045
            s = (x - wx) + (y - wy)
            if s in (3, 4):
                v += 0.25
            elif s in (8, 13):
                v += 0.12
            if y == wy or x == wx:
                v = 0.08                                           # recess
            ramp = "glass"
            if (x - wx) in (1, 9) and y > wy:
                ramp, v = spec["curtain"], (0.62 if (y - wy) % 2 else 0.5) - (0.12 if x - wx == 9 else 0)
            if y > wy + 5 and 3 <= x - wx <= 7 and hash2(x, y, seed) < 0.55:
                ramp, v = "lamp", 0.42 + (y - wy - 5) * 0.06
            put(c, x, y, ramp, v)
    for y in range(wy, wy + 10):
        _trim(c, wx + 5, y, spec, 0.86)
    for x in range(wx, wx + 11):
        _trim(c, x, wy + 4, spec, 0.86)
        put(c, x, wy + 5, "glass", 0.15)
    if box:
        for x in range(wx - 1, wx + 12):
            put(c, x, wy + 11, "wood", 0.72)
            put(c, x, wy + 12, "wood", 0.3)
        for x in range(wx, wx + 11):
            k = int(hash2(x, wy, seed + 1) * 4)
            put(c, x, wy + 10, "leaf", 0.45 if x % 2 else 0.32)
            if k == 0:
                put(c, x, wy + 9, "red", 0.72)
            elif k == 1:
                put(c, x, wy + 9, "pink", 0.8)
            elif k == 2:
                put(c, x, wy + 9, "leaf2", 0.7)
            if hash2(x, wy, seed + 2) < 0.3:
                put(c, x, wy + 12, "leaf", 0.4)


def _door(c, spec):
    dx = 14
    for y in range(52, 71):
        for x in range(dx - 1, dx + 13):
            _trim(c, x, y, spec, 0.9 if (x == dx - 1 or y == 52) else 0.4 if x == dx + 12 else 0.7)
    ramp = spec["door"]
    for y in range(53, 71):
        for x in range(dx, dx + 12):
            v = 0.5 + (noise1(x * 3, y, 6, 3) - 0.5) * 0.1
            if x == dx or y == 53:
                v = 0.15                                           # set back in its frame
            elif x == dx + 11:
                v = 0.32
            elif (x - dx) == 6:
                v = 0.25
            put(c, x, y, ramp, v)
    for px in (dx + 1, dx + 7):                                    # glass panes with the shop lit behind
        for y in range(55, 61):
            for x in range(px, px + 4):
                edge = y == 55 or x == px
                put(c, x, y, "glass" if edge else "lamp", 0.2 if edge else 0.45 + (y - 55) * 0.05)
    for y in (63, 64, 65, 66, 67, 68):
        for px in (dx + 1, dx + 7):
            for x in range(px, px + 4):
                inset = y == 63 or x == px
                put(c, x, y, ramp, 0.2 if inset else 0.62 if (y == 68 or x == px + 3) else 0.48)
    put(c, dx + 9, 62, "gold", 0.95)
    put(c, dx + 9, 63, "gold", 0.4)
    for y in range(71, 74):
        for x in range(dx - 2, dx + 14):
            v = 0.86 if y == 71 else 0.6 if y == 72 else 0.34
            if y == 71 and dx + 1 <= x <= dx + 10:
                v = 0.76
            put(c, x, y, "stone", v)


def _sign(c, spec):
    for x in range(33, 44):
        put(c, x, 51, "coal", 0.4 if x > 34 else 0.7)
    put(c, 33, 52, "coal", 0.5)
    for y in (52, 53, 54, 55):
        put(c, 36, y, "stone", 0.55 if y % 2 else 0.35)
        put(c, 40, y, "stone", 0.55 if y % 2 else 0.35)
    for y in range(56, 63):
        for x in range(33, 44):
            edge = y in (56, 62) or x in (33, 43)
            v = (0.72 if (y == 56 or x == 33) else 0.3) if edge else 0.55 + (noise1(x * 3, y, 4, 7) - 0.5) * 0.12
            put(c, x, y, "wood", v)
    icon = spec["sign"]
    if icon == "coin":
        for (x, y), v in {(37, 58): 0.9, (38, 58): 0.8, (39, 58): 0.7, (36, 59): 0.8, (37, 59): 0.95,
                          (38, 59): 0.6, (39, 59): 0.55, (40, 59): 0.4, (37, 60): 0.55, (38, 60): 0.45, (39, 60): 0.35}.items():
            put(c, x, y, "gold", v)
    elif icon == "mug":
        for x in range(36, 40):
            put(c, x, 58, "linen", 0.95)
            for y in (59, 60):
                put(c, x, y, "khaki", 0.7 - (x - 36) * 0.1)
        put(c, 40, 59, "khaki", 0.45)
        put(c, 40, 60, "khaki", 0.35)
    elif icon == "bread":
        for (x, y), (ramp, v) in {(36, 59): ("orange", 0.7), (37, 58): ("straw", 0.85), (38, 58): ("straw", 0.8),
                                  (39, 58): ("orange", 0.72), (37, 59): ("orange", 0.66), (38, 59): ("orange", 0.6),
                                  (39, 59): ("orange", 0.5), (40, 59): ("orange", 0.42), (37, 60): ("orange", 0.36),
                                  (38, 60): ("orange", 0.3), (39, 60): ("orange", 0.26), (38, 57): ("straw", 0.95)}.items():
            put(c, x, y, ramp, v)


def _emblem(c):
    """The hall's gilded star over the door."""
    star = {(38, 53): 0.95, (37, 54): 0.8, (38, 54): 0.9, (39, 54): 0.7, (36, 55): 0.75, (37, 55): 0.85,
            (38, 55): 0.8, (39, 55): 0.6, (40, 55): 0.45, (37, 56): 0.6, (39, 56): 0.4, (36, 57): 0.5, (40, 57): 0.3}
    for (x, y), v in star.items():
        put(c, x, y, "gold", v)


def townhouse(kind="store"):
    """A shopfront on the square: two storeys, a hanging sign, its own colours and wall."""
    spec = KINDS[kind]
    w, h = 78, 76
    c = Canvas(w, h)
    seed = sum(map(ord, kind))
    _chimney(c, w)
    _roof(c, w, spec, seed)
    _wall(c, w, spec, seed)
    for wx, wy, box in ((12, 32, True), (w - 24, 32, True), (w - 24, 54, False)):
        _window(c, wx, wy, spec, seed + wx + wy, box)
    _door(c, spec)
    if spec["sign"]:
        _sign(c, spec)
    else:
        _emblem(c)
    return c.outline().image(), (w // 2, 72)


# ------------------------------------------------------------------ the square's furniture

def fountain():
    w, h = 46, 40
    c = Canvas(w, h)
    for y in range(20, 38):                                        # basin: rim, inner wall, water
        for x in range(w):
            nx, ny = (x - 22.5) / 22, (y - 29) / 9
            d = nx * nx + ny * ny
            if d > 1:
                continue
            inner = ((x - 22.5) / 18) ** 2 + ((y - 27) / 6) ** 2
            if inner <= 1:
                ripple = math.hypot((x - 22.5) / 3, (y - 27) * 1.0)
                v = 0.48 - inner * 0.14
                if int(ripple) % 3 == 0 and inner > 0.08:
                    v += 0.14
                if inner > 0.82 and y < 27:
                    v = 0.18                                       # the rim's shade on the water
                put(c, x, y, "water", v)
            elif y < 25:
                put(c, x, y, "stone", 0.9 - abs(nx) * 0.25 - (0.15 if nx > 0.5 else 0))
            else:
                v = 0.66 - nx * 0.2 - (y - 25) * 0.025
                if (x + (y // 3) * 3) % 6 == 0 or y % 3 == 2:
                    v -= 0.16
                put(c, x, y, "stone", v)
    for x, y in ((9, 26), (15, 29), (30, 29), (36, 26), (22, 31)):
        put(c, x, y, "water", 0.95)
        put(c, x + 1, y, "water", 0.8)
    for y in range(10, 26):                                        # column
        for x in range(20, 26):
            v = (0.9, 0.78, 0.66, 0.56, 0.44, 0.3)[x - 20]
            if y % 4 == 3:
                v -= 0.1
            put(c, x, y, "stone", v)
    for x in range(20, 26):
        put(c, x, 25, "water", 0.3)
    for x in range(14, 32):                                        # upper bowl with water
        rel = (x - 14) / 17
        put(c, x, 8, "stone", 0.95 - rel * 0.3)
        put(c, x, 11, "stone", 0.5 - rel * 0.25)
        for y in (9, 10):
            ramp = "water" if 15 < x < 30 else "stone"
            put(c, x, y, ramp, (0.55 if y == 9 else 0.4) - rel * 0.1 if ramp == "water" else 0.7 - rel * 0.3)
    for y in range(12, 25):                                        # thin falls from the bowl
        put(c, 15, y, "water", 0.85 if y % 3 else 0.6)
        put(c, 30, y, "water", 0.72 if (y + 1) % 3 else 0.5)
    for y in range(1, 8):                                          # the jet
        put(c, 22, y, "water", 0.95)
        put(c, 23, y, "water", 0.75)
    for (x, y), v in {(21, 0): 0.9, (24, 0): 0.9, (22, 0): 0.7, (12, 12): 0.85, (33, 13): 0.85, (17, 15): 0.8,
                      (28, 16): 0.8, (19, 3): 0.7, (26, 4): 0.7}.items():
        put(c, x, y, "water", v)
    return c.outline().image(), (23, 36)


def notice_board():
    """The Town Contracts board: papers pinned to cork under a little shingled roof."""
    c = Canvas(30, 32)
    for x0 in (6, 21):                                             # posts
        for y in range(24, 31):
            put(c, x0, y, "wood", 0.62)
            put(c, x0 + 1, y, "wood", 0.46)
            put(c, x0 + 2, y, "wood", 0.26)
    for y in range(4, 24):                                         # frame and cork
        for x in range(4, 26):
            frame = x < 6 or x > 23 or y < 6 or y > 21
            if frame:
                v = 0.7 if (x < 6 or y < 6) else 0.32
                put(c, x, y, "wood", v)
            else:
                v = 0.5 + (hash2(x, y, 11) - 0.5) * 0.16
                if y < 8:
                    v -= 0.14                                      # the roof's shade
                put(c, x, y, "orange", v * 0.8)
    for y in range(1, 5):                                          # roof
        for x in range(2, 28):
            v = 0.8 - (y - 1) * 0.12 - (x - 2) * 0.012
            if (x + y * 2) % 4 == 0 and y > 1:
                v -= 0.18
            put(c, x, y, "slate", v)
    for x in range(2, 28):
        put(c, x, 5, "slate", 0.22)
    papers = ((7, 8, "linen"), (16, 7, "linen"), (8, 15, "straw"), (17, 15, "linen"))
    for i, (px, py, ramp) in enumerate(papers):
        for y in range(py, py + 6):
            for x in range(px, px + 6):
                v = 0.92 - (y - py) * 0.03 - (0.1 if x == px + 5 else 0)
                put(c, x, y, ramp, v if ramp != "straw" else v * 0.9)
        for k, (ly, n) in enumerate(((py + 2, 4), (py + 3, 3), (py + 4, 4))):
            for x in range(px + 1, px + 1 + n):
                if hash2(x, ly, i) < 0.8:
                    put(c, x, ly, "stone", 0.45)
        put(c, px + 5, py + 5, "stone", 0.55)                      # a curled corner
        put(c, px + 2, py, "red", 0.75)
        put(c, px + 2, py - 1, "red", 0.9)
    put(c, 10, 18, "gold", 0.9)                                    # a contract's gold seal
    put(c, 11, 18, "gold", 0.6)
    return c.outline().image(), (15, 30)


def bench():
    c = Canvas(26, 14)
    for y, top in ((2, True), (3, False), (4, False), (6, True), (7, False), (8, False)):
        for x in range(2, 24):
            v = 0.82 if top else 0.6 if y in (3, 7) else 0.38
            if hash2(x // 4, y, 21) < 0.3 and not top:
                v -= 0.08
            put(c, x, y, "wood", v)
    for x0 in (3, 21):                                             # iron legs and arms
        for y in range(3, 13):
            put(c, x0, y, "coal", 0.62)
            put(c, x0 + 1, y, "coal", 0.3)
    for x in (2, 3, 4, 5):
        put(c, x, 12, "coal", 0.45)
    for x in (20, 21, 22, 23):
        put(c, x, 12, "coal", 0.35)
    for x in range(2, 24):
        put(c, x, 5, "coal", 0.15)
    return c.outline().image(), (13, 12)


def planter(kind="R"):
    c = Canvas(20, 14)
    for y in range(6, 12):
        for x in range(2, 18):
            v = 0.9 if y == 6 else 0.66 - (x - 2) * 0.012 - (y - 7) * 0.03
            if x >= 16:
                v = 0.4 if y > 6 else 0.6
            if y > 6 and (x + (y // 2) * 3) % 5 == 0:
                v -= 0.1
            put(c, x, y, "stone", v)
    for x in range(3, 17):
        put(c, x, 5, "soil", 0.5 if x % 3 else 0.3)
        put(c, x, 4, "leaf", 0.5 if x % 2 else 0.38)
    petal = {"R": ("red", 0.72, 0.5), "Y": ("straw", 0.9, 0.7)}[kind]
    for i, x in enumerate((4, 8, 12)):
        y = 1 + i % 2
        ramp, hi, lo = petal
        put(c, x + 1, y, ramp, hi)
        put(c, x, y + 1, ramp, hi)
        put(c, x + 2, y + 1, ramp, lo)
        put(c, x + 1, y + 1, "gold", 0.85 if kind == "R" else 0.45)
        put(c, x + 1, y + 2, "leaf", 0.55)
        put(c, x + 2, y + 2, "leaf2", 0.62)
    return c.outline().image(), (10, 12)


def lamppost(lit=True):
    c = Canvas(12, 38)
    for y in range(8, 34):                                         # post
        put(c, 5, y, "coal", 0.62)
        put(c, 6, y, "coal", 0.3)
    for y in range(34, 37):                                        # base
        for x in range(3, 9):
            put(c, x, y, "coal", 0.75 if y == 34 else 0.45 - (x - 3) * 0.04)
    for x in range(3, 9):
        put(c, x, 9, "coal", 0.6 if x < 6 else 0.35)
    for y in range(2, 9):                                          # lantern
        for x in range(3, 9):
            frame = x in (3, 8) or y in (2, 8)
            if frame:
                put(c, x, y, "coal", 0.6 if x == 3 else 0.35)
            elif lit:
                put(c, x, y, "lamp", 0.95 - abs(x - 5.5) * 0.12 - abs(y - 5) * 0.06)
            else:
                put(c, x, y, "glass", 0.35 if x < 6 else 0.2)
    for x in range(2, 10):
        put(c, x, 1, "coal", 0.72 if x < 6 else 0.45)
    put(c, 5, 0, "gold", 0.8)
    put(c, 6, 0, "gold", 0.5)
    return c.outline().image(), (6, 36)


def market_cart():
    c = Canvas(38, 28)
    for y in range(8, 18):                                         # body: vertical boards
        for x in range(4, 32):
            bx = (x - 4) % 4
            v = 0.2 if bx == 3 else 0.72 if bx == 0 else 0.56
            if y == 8:
                v = 0.88
            v += (noise1(x * 4, y, 5, 31) - 0.5) * 0.1
            put(c, x, y, "wood", v)
    for x in range(4, 32):
        put(c, x, 17, "wood", 0.3)
        put(c, x, 18, "wood", 0.18)
    heaps = (("red", 0.72), ("straw", 0.9), ("orange", 0.74), ("red", 0.66), ("leaf2", 0.62))
    for i, x0 in enumerate(range(6, 30, 5)):                       # produce heaped in the bed
        ramp, v = heaps[i]
        for (dx, dy), dv in {(1, 0): 0.1, (2, 0): 0.02, (0, 1): 0.04, (1, 1): 0.0, (2, 1): -0.08, (3, 1): -0.16,
                             (0, 2): -0.1, (1, 2): -0.14, (2, 2): -0.2, (3, 2): -0.26}.items():
            put(c, x0 + dx, 5 + dy, ramp, v + dv)
        put(c, x0 + 1, 5, "linen", 0.95) if ramp != "leaf2" else put(c, x0 + 1, 4, "leaf", 0.5)
    for x in range(32, 37):                                        # handle
        put(c, x, 10, "wood", 0.72)
        put(c, x, 11, "wood", 0.36)
    for a in range(24):                                            # spoked wheel
        ang = a * math.pi / 12
        v = 0.36 + 0.3 * -math.cos(ang + 0.8)
        put(c, 12 + round(math.cos(ang) * 5), 21 + round(math.sin(ang) * 5), "wood", v)
    for a in range(4):
        ang = a * math.pi / 4
        for t in (1, 2, 3, 4):
            put(c, 12 + round(math.cos(ang) * t), 21 + round(math.sin(ang) * t), "wood", 0.5)
    for x in range(11, 14):
        for y in range(20, 23):
            put(c, x, y, "gold", 0.6 if (x, y) == (11, 20) else 0.35)
    for y in range(19, 26):                                        # leg
        for i, x in enumerate((24, 25, 26)):
            put(c, x, y, "wood", (0.62, 0.46, 0.26)[i])
    return c.outline().image(), (19, 26)


def beacon():
    """Leo's beacon: a stepped stone plinth, a column and a brass dish, a crystal waiting for its light."""
    w, h = 44, 52
    c = Canvas(w, h)
    cx = w // 2
    for i, (hw, top) in enumerate(((21, 42), (16, 36), (11, 30))):
        height = 8 if i < 2 else 6
        for y in range(top, top + height):
            for x in range(cx - hw, cx + hw):
                ry = y - top
                if ry == 0:
                    v = 0.92 - (x - (cx - hw)) * 0.004
                else:
                    row = (ry - 1) // 3
                    bx = (x + row * 3) % 7
                    v = 0.66 - (x - (cx - hw)) / (2 * hw) * 0.22 + (hash2((x + row * 3) // 7, row + i * 5, 41) - 0.5) * 0.1
                    if (ry - 1) % 3 == 2 or bx == 6:
                        v -= 0.2
                if x >= cx + hw - 3:
                    v -= 0.22
                put(c, x, y, "stone", v)
    for y in range(14, 30):                                        # column
        for i, x in enumerate(range(cx - 2, cx + 2)):
            put(c, x, y, "stone", (0.86, 0.66, 0.5, 0.32)[i] - (0.08 if y % 4 == 3 else 0))
    for y in range(6, 14):                                         # the brass dish
        hw = 4 + (13 - y) * 8 // 7
        for x in range(cx - hw, cx + hw):
            rel = (x - (cx - hw)) / max(2 * hw, 1)
            v = 0.9 - rel * 0.45 - (y - 6) * 0.045
            if y in (6, 7):
                v += 0.05
            put(c, x, y, "gold", v)
    for x in range(cx - 12, cx + 12):
        put(c, x, 5, "gold", 1.0 if x < cx else 0.8)
    for x in range(cx - 10, cx + 10):
        put(c, x, 9, "gold", 0.3)
    for (x, y), (ramp, v) in {(cx, 0): ("teal", 0.8), (cx - 1, 1): ("teal", 0.7), (cx, 1): ("linen", 0.98),
                              (cx + 1, 1): ("teal", 0.5), (cx, 2): ("teal", 0.4)}.items():
        put(c, x, y, ramp, v)
    for x in range(1, w - 1):
        put(c, x, 50, "stone", 0.35)
    return c.outline().image(), (cx, 49)
