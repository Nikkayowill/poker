"""The Homestead's sprites redrawn in the rich palette. Same sizes and anchors as kit.py, so the layout is untouched."""
import math

from pal import TOP, Canvas, hash2, lambert, noise1, sway_image


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ------------------------------------------------------------------ foliage

def canopy(c, blobs, ramp, seed, lo=1, hi=6, spacing=5, rmin=3.0, rmax=4.6):
    """Foliage as many small lit clumps inside the union of big blobs. Lower clumps sit in front."""
    inside = lambda x, y: any(math.hypot(x - bx, y - by) <= r for bx, by, r in blobs)
    top = min(by - r for bx, by, r in blobs)
    bottom = max(by + r for bx, by, r in blobs)
    left = min(bx - r for bx, by, r in blobs)
    right = max(bx + r for bx, by, r in blobs)
    clumps = []
    for gy in range(int(top) - 2, int(bottom) + 3, spacing - 1):
        for gx in range(int(left) - 2, int(right) + 3, spacing):
            x = gx + (hash2(gx, gy, seed) - 0.5) * spacing * 0.9 + (gy // (spacing - 1)) % 2 * spacing / 2
            y = gy + (hash2(gx, gy, seed + 1) - 0.5) * spacing * 0.6
            if inside(x, y):
                clumps.append((x, y, rmin + hash2(gx, gy, seed + 2) * (rmax - rmin)))
    clumps.sort(key=lambda k: k[1])
    height = max(bottom - top, 1)
    for cx, cy, r in clumps:
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                d = math.hypot(x - cx, y - cy)
                if d > r or not inside(x, y) and d > r * 0.7:
                    continue
                nx, ny = (x - cx) / r, (y - cy) / r
                nz = math.sqrt(max(0.0, 1 - nx * nx - ny * ny))
                lit = lambert(nx, ny, nz)
                glob = 1 - (y - top) / height                     # the crown catches more light than the skirt
                side = 1 - (x - left) / max(right - left, 1)
                v = 0.5 * lit + 0.32 * glob + 0.18 * side
                i = lo + v * (hi - lo + 0.6)
                if d > r - 1.1 and nx + ny > 0.35:
                    i = lo                                        # the clump's shaded underside separates it
                elif d > r - 1.2 and nx + ny < -0.7 and hash2(x, y, seed + 3) < 0.6:
                    i += 1
                c.put(x, y, ramp, clamp(i, lo, hi))
    for cx, cy, r in clumps:                                      # a few bright leaves on the lit clumps
        if hash2(int(cx * 3), int(cy * 3), seed + 4) < 0.5 and (cy - top) / height < 0.6:
            lx, ly = round(cx - r * 0.45), round(cy - r * 0.5)
            p = c.get(lx, ly)
            if p and p[0] == ramp:
                c.put(lx, ly, ramp, hi + 1)
                c.put(lx + 1, ly - 1, ramp, hi)


def round_tree(seed=0):
    w, h = 40, 44
    c, cx = Canvas(w, h), w // 2
    j = lambda i: round((hash2(seed, i, 3) - 0.5) * 4)
    for y in range(24, 41):                                       # trunk with bark streaks and a root flare
        flare = 1 if y > 37 else 0
        for x in range(cx - 2 - flare, cx + 2 + flare):
            rel = (x - (cx - 2 - flare)) / (3 + 2 * flare)
            i = 5 if rel < 0.25 else 4 if rel < 0.5 else 3 if rel < 0.75 else 2
            if hash2(x, y // 3, seed + 9) < 0.25:
                i -= 1
            c.put(x, y, "wood", i)
    for x in (cx - 4, cx + 3):
        c.put(x, 40, "wood", 3)
    blobs = [(cx + j(1), 13, 9.5), (cx - 9 + j(2), 18, 7.5), (cx + 9 + j(3), 18, 7.5),
             (cx + j(4), 22, 8.5), (cx - 5, 9 + j(5) // 2, 6.5), (cx + 5, 9, 6.5)]
    canopy(c, blobs, "leaf", seed * 7 + 11)
    for x in range(cx - 2, cx + 2):                               # the crown shades the top of the trunk
        for y in range(27, 30):
            p = c.get(x, y)
            if p and p[0] == "wood":
                c.put(x, y, "wood", 1)
    return c.outline().image(), (cx, h - 3)


def spruce(seed=0, big=False):
    w, h = (26, 44) if big else (22, 36)
    c, cx = Canvas(w, h), w // 2
    tiers = [(2, 12, 4), (7, 20, 6), (13, 28, 8)] + ([(20, 36, 11)] if big else [])
    trunk_top = tiers[-1][1] - 1
    for y in range(trunk_top, h - 2):
        for x in range(cx - 1, cx + 2):
            c.put(x, y, "wood", 4 - (x - cx + 1) - (1 if y < trunk_top + 2 else 0))
    for t, (top, bottom, half) in reversed(list(enumerate(tiers))):
        span = bottom - top
        for y in range(top, bottom + 3):
            prog = (y - top) / span
            hw = half * min(prog, 1) + (1 if (y - top) % 3 == 2 and y <= bottom else 0)
            for x in range(cx - math.ceil(hw) - 1, cx + math.ceil(hw) + 2):
                rel = (x - cx) / max(hw, 1)
                if abs(x - cx) > hw + 0.3:
                    continue
                edge_drop = bottom + round(abs(rel) * 2) - (1 if (x + seed + t) % 3 == 0 else 0)
                if y > edge_drop:
                    continue
                v = 0.62 - rel * 0.34 - prog * 0.22 + (0.08 if t == 0 else 0)
                i = 1 + v * 6
                if (x + (y if x < cx else -y)) % 3 == 0 and abs(rel) > 0.15:
                    i -= 1                                          # needle strokes slanting outward
                if y >= edge_drop - 1:
                    i = min(i, 2)
                if rel < -0.55 and hash2(x, y, seed + t) < 0.35:
                    i += 1
                c.put(x, y, "pine", clamp(i, 1, 6))
        for x in range(cx - half, cx + half + 1):                   # this tier shades the one below it
            by = bottom + round(abs((x - cx) / max(half, 1)) * 2) + 1
            for dy in (0, 1):
                p = c.get(x, by + dy)
                if p and p[0] == "pine":
                    c.put(x, by + dy, "pine", 1 if dy == 0 else max(1, p[1] - 1))
    c.put(cx, 1, "pine", 5)
    c.put(cx - 1, 4, "pine", 7)
    return c.outline().image(), (cx, h - 2)


def bush(seed=0, berries=False):
    c = Canvas(18, 14)
    canopy(c, [(6, 8, 5), (11, 8, 5), (9, 5, 4)], "leaf", seed * 5 + 3, lo=1, hi=6, spacing=4, rmin=2.4, rmax=3.4)
    if berries:
        for x, y in ((4, 7), (11, 9), (9, 4), (13, 6)):
            c.put(x, y, "red", 4)
            c.put(x + 1, y, "red", 3)
            c.put(x, y + 1, "red", 2)
            c.put(x + 1, y + 1, "red", 2)
            c.put(x, y, "red", 6)
    return c.outline().image(), (9, 12)


# ------------------------------------------------------------------ ground clutter

def faceted(c, cx, cy, rx, ry, seed, facets=7, lichen=0.25, flat_bottom=0.72):
    """A chiselled stone: a flat crown plus planar side facets, a lit bevel on each ridge, a crack, lichen.
    Returns the set of pixels it drew and their facet ids."""
    off = hash2(seed, 0, 5) * math.pi
    drawn = {}
    normals = {-1: (-0.12, -0.2, 0.97)}
    for k in range(facets):
        a = (k + 0.5) * 2 * math.pi / facets - math.pi + off
        tilt = 0.55 + hash2(seed, k, 6) * 0.25
        nx, ny = math.cos(a) * tilt, math.sin(a) * tilt * 0.9
        normals[k] = (nx, ny, math.sqrt(max(0.05, 1 - nx * nx - ny * ny)))
    for y in range(int(cy - ry) - 2, int(cy + ry) + 3):
        for x in range(int(cx - rx) - 2, int(cx + rx) + 3):
            ang = math.atan2(y - cy, x - cx)
            bump = 1 + 0.1 * math.sin(3 * ang + seed) + 0.05 * math.sin(5 * ang + seed * 1.7)
            nx, ny = (x - cx) / (rx * bump), (y - cy) / (ry * bump)
            d = nx * nx + ny * ny
            if d > 1 or ny > flat_bottom:
                continue
            r = math.sqrt(d)
            if r < 0.36 + hash2(seed, 1, 7) * 0.1 and ny < 0.3:
                fid = -1
            else:
                fid = int(((ang - off + math.pi) % (2 * math.pi)) / (2 * math.pi / facets)) % facets
            drawn[(x, y)] = fid
    for (x, y), fid in drawn.items():
        lam = lambert(*normals[fid])
        level = 1.2 + lam * 3.8
        right, below = drawn.get((x + 1, y)), drawn.get((x, y + 1))
        for other in (right, below):
            if other is not None and other != fid:
                if lam > lambert(*normals[other]):
                    level += 0.7                                  # the lit lip of a ridge
                else:
                    level -= 0.6
        ny = (y - cy) / ry
        if ny > flat_bottom - 0.25:
            level = min(level, 1.6)                               # the underside tucks into shade
        if hash2(x, y, seed + 40) < 0.14:
            level += 0.4 if hash2(x, y, seed + 41) < 0.5 else -0.4
        c.put(x, y, "stone", clamp(level, 0.5, 6.8))
    x, y = cx + rx * 0.1, cy - ry * 0.55                          # a crack running down the face
    for k in range(int(max(rx, ry) * 0.9)):
        if (round(x), round(y)) in drawn and (round(x), round(y) + 1) in drawn:
            c.put(x, y, "stone", 0.7)
            if (round(x) - 1, round(y)) in drawn:
                c.shift(round(x) - 1, round(y), 0.8)
        x += 0.45 + (hash2(seed, k, 8) - 0.5) * 0.8
        y += 0.8
    if lichen:
        for (x, y), fid in drawn.items():
            if (y < cy and lambert(*normals[fid]) > 0.45 and noise1(x, y, 2.2, seed + 50) < lichen
                    and hash2(x, y, seed + 53) < 0.55):
                c.put(x, y, "dry", 4.0 + hash2(x, y, seed + 52) * 1.0)
    return drawn


def rock(big=False, seed=0):
    w, h = (18, 13) if big else (12, 9)
    c = Canvas(w, h)
    if big:
        faceted(c, 8.0, 6.6, 6.6, 5.0, seed + 3, facets=8, lichen=0.28)
        faceted(c, 14.2, 10.0, 2.2, 1.6, seed + 9, facets=4, lichen=0)       # a pebble knocked off it
    else:
        faceted(c, 5.5, 4.4, 4.4, 3.4, seed + 3, facets=6, lichen=0.22)
    return c.outline().image(), (w // 2, h - 2)


def stump():
    c = Canvas(14, 12)
    for y in range(4, 11):                                        # bark: vertical plates split by fissures
        for x in range(2, 12):
            rel = (x - 2) / 9
            level = 4.6 - rel * 3.0
            plate = (x * 2 + (y // 3) % 2) % 5
            if plate == 0:
                level -= 1.6
            elif plate == 1:
                level += 0.6
            if y > 8:
                level -= 0.5
            c.put(x, y, "wood", level)
            if rel > 0.62 and 5 <= y <= 9 and hash2(x, y // 2, 3) < 0.55:
                c.put(x, y, "moss", 3.0 + (1 - rel) * 2.4)
    for x, y, lv in ((1, 9, 3.8), (1, 10, 3.0), (0, 10, 2.6), (12, 9, 2.0), (12, 10, 1.6), (13, 10, 1.4),
                     (5, 11, 2.4), (9, 11, 1.8)):
        c.put(x, y, "wood", lv)                                   # roots
    for y in range(0, 7):                                         # the saw cut: rings, pale sapwood, dark bark lip
        for x in range(2, 12):
            d = math.sqrt(((x - 6.5) / 5) ** 2 + ((y - 3.4) / 2.7) ** 2)
            if d > 1:
                continue
            if d > 0.84:
                level = 2.0 if (x > 6.5 or y > 3.4) else 3.2
                c.put(x, y, "wood", level)
                continue
            ring = int(d * 7) % 2
            level = (6.6 if ring else 5.8) - d * 0.6 - (x - 6.5) * 0.06
            if d < 0.16:
                level = 4.2
            c.put(x, y, "wood", level)
    for k, (x, y) in enumerate(((7, 4), (8, 4), (9, 5), (10, 5))):
        c.put(x, y, "wood", 3.2 + k * 0.2)                        # a drying crack from the heart
    return c.outline().image(), (7, 10)


def flowers(kind):
    c = Canvas(12, 8)
    ramp, hi, lo = {"W": ("white", 6.4, 4.2), "R": ("pink", 4.6, 2.8), "Y": ("straw", 5.8, 3.6)}[kind]
    centre = ("gold", 3.6) if kind != "Y" else ("wood", 3.0)
    dots = {"W": [(1, 3), (5, 1), (8, 4), (3, 6)], "R": [(2, 2), (7, 3), (4, 5)], "Y": [(1, 4), (6, 2), (9, 5)]}[kind]
    for i, (x, y) in enumerate(dots):
        c.put(x, y + 1, "grass", 2.6)
        c.put(x, y + 2, "grass", 2.0)
        side = -1 if hash2(x, y, 11) < 0.5 else 1
        c.put(x + side, y + 2, "grass", 4.4)
        c.put(x + side * 2, y + 1, "grass", 5.2)
    for x, y in dots:
        c.put(x, y - 1, ramp, hi)
        c.put(x - 1, y, ramp, hi - 0.4)
        c.put(x + 1, y, ramp, lo + 0.6)
        c.put(x, y + 1, ramp, lo)
        c.put(x, y, *centre)
        if kind == "W":
            c.put(x - 1, y - 1, ramp, lo + 0.9)
    return c.image(), (6, 7)


def reeds():
    c = Canvas(12, 16)
    for x, top, lean in ((1, 7, -1), (4, 4, 0), (6, 9, 1), (9, 6, 1), (11, 9, 0)):   # plain blades
        for y in range(top, 15):
            bend = lean if y < top + 3 else 0
            c.put(x + bend, y, "grass", 6.0 - (y - top) * 0.32)
            if y > top + 2 and x + 1 < 12 and hash2(x, y, 4) < 0.5:
                c.put(x + 1 + bend, y, "grass", 3.2 - (y - top) * 0.15)
    for x, top, lean in ((2, 3, -1), (5, 0, 0), (8, 2, 1)):                         # cattails
        hx = x + lean
        for y in range(top + 4, 15):
            c.put(x + (lean if y < top + 7 else 0), y, "grass", 5.0 - (y - top) * 0.22)
        c.put(hx, top, "dry", 5.6)
        for j in range(1, 4):
            c.put(hx, top + j, "wood", 4.8 - j * 0.3)
            c.put(hx + 1, top + j, "wood", 2.6 - j * 0.3)
        c.put(hx, top + 4, "grass", 3.4)
    for x in range(0, 12, 2):
        c.put(x, 15, "grass", 1.8)
        c.put(x + 1, 14, "grass", 2.6)
    return sway_image(c, lambda x, y, p: y < 12, rustle=True), (6, 15)


def lily_pad(flower=False):
    c = Canvas(10, 7)
    for y in range(7):
        for x in range(10):
            nx, ny = (x - 4.5) / 4.5, (y - 3) / 3
            d = nx * nx + ny * ny
            if d > 1 or (x >= 5 and 2 <= y <= 3 and x - 5 <= (y - 1) * 1.6):
                continue
            nz = math.sqrt(max(0, 1 - d))
            level = 2.8 + lambert(nx, ny, nz) * 2.6
            if d > 0.72 and ny > 0.1:
                level = 2.0                                       # the rim curls up, its underside dark
            elif d > 0.72 and ny < -0.1:
                level += 0.8
            ang = math.atan2(y - 3, x - 4.5)
            if d < 0.7 and d > 0.05 and int((ang + math.pi) / (math.pi / 4)) % 2 == 0 and abs(math.sin(ang * 4)) < 0.3:
                level -= 0.9                                      # veins from the notch
            c.put(x, y, "leaf", level)
    c.put(2, 2, "white", 6.0)                                     # a drop of water
    if flower:
        for x, y, r, lv in ((3, 1, "pink", 3.4), (2, 2, "pink", 4.4), (4, 2, "pink", 3.0), (3, 0, "white", 6.0),
                            (2, 1, "pink", 5.0), (4, 1, "pink", 4.0), (3, 2, "gold", 4.4)):
            c.put(x, y, r, lv)
    return c.image(), (5, 6)


# ------------------------------------------------------------------ farm objects

def planks_v(c, x0, y0, w, h, ramp, base, board=5, seed=0):
    """Vertical boards: a dark gap, a lit left edge, grain streaks."""
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            bx = (x - x0) % board
            level = base - 2 if bx == 0 else base + 1 if bx == 1 else base
            if bx > 1 and noise1(x * 3.3, y, 4, seed + (x - x0) // board) < 0.3:
                level -= 0.8
            c.put(x, y, ramp, level)


def hay_bale():
    c = Canvas(20, 14)
    for y in range(2, 12):
        for x in range(1, 19):
            if (x, y) in ((1, 2), (18, 2), (1, 11), (18, 11)):
                continue
            if y < 5:                                             # the top: strands lying along the bale
                level = 6.2 - (y - 2) * 0.3
                streak = noise1(x * 0.7, y * 3.1, 2.2, 81)
                level += 0.9 if streak > 0.68 else -0.8 if streak < 0.28 else 0
            else:                                                 # the face: cut ends, darker toward the ground
                level = 4.4 - (y - 5) * 0.4
                streak = noise1(x * 3.1, y * 0.8, 2.0, 83)
                level += 0.7 if streak > 0.7 else -0.9 if streak < 0.3 else 0
                if y == 5:
                    level -= 0.9                                  # the lip where top meets face
            if x == 1 or x == 18:
                level -= 0.6 if x == 18 else -0.3
            c.put(x, y, "straw", level)
    for tx in (6, 13):                                            # twine sinking into the straw
        for y in range(2, 12):
            c.put(tx, y, "wood", 2.4 if y % 2 else 3.4)
            c.shift(tx - 1, y, 0.6)
            c.shift(tx + 1, y, -1.0)
    for x, y, lv in ((4, 1, 5.8), (9, 1, 5.2), (15, 1, 5.6), (16, 0, 6.0), (0, 7, 4.2), (19, 9, 3.2), (11, 12, 3.4)):
        c.put(x, y, "straw", lv)                                  # loose strands
    return c.outline().image(), (10, 12)


def crate():
    c = Canvas(16, 16)
    for y in range(1, 4):                                         # the lid
        for x in range(1, 15):
            level = 6.2 if y == 1 else 5.4
            if x in (5, 10):
                level -= 1.6
            if noise1(x * 0.6, y * 3, 2.5, 90) < 0.3:
                level -= 0.5
            c.put(x, y, "wood", level)
    for x in range(1, 15):
        c.put(x, 4, "wood", 2.0)                                  # the lid's lip shading the front
    for y in range(5, 15):
        for x in range(1, 15):
            frame = x < 3 or x > 12 or y < 6 or y > 12
            if frame:
                level = 5.2 if x < 2 else 4.6 if x < 3 else 2.2 if x > 13 else 3.0 if x > 12 else 4.2
                if y > 13:
                    level = 2.2
                if y == 5 and 2 < x < 13:
                    level = 4.8
            else:
                row = (y - 6) % 3
                level = 1.2 if row == 2 else 3.8 if row == 0 else 3.2
                if y == 6 or x == 3:
                    level = min(level, 2.2)                       # recessed behind the frame
                if row != 2 and noise1(x * 0.5, y * 4, 2, 91) < 0.3:
                    level -= 0.6
            c.put(x, y, "wood", level)
    for k in range(10):                                           # diagonal brace with its shadow
        x, y = 3 + k, 12 - k
        c.put(x, y, "wood", 5.4)
        c.put(x + 1, y, "wood", 3.6)
        if 6 <= y + 1 <= 12 and 3 <= x + 1 <= 12:
            c.put(x + 1, y + 1, "wood", 1.4)
    for x, y in ((5, 7), (6, 7), (5, 8)):                         # a faded stencil mark
        c.put(x, y, "white", 3.2)
    for x, y in ((2, 6), (13, 6), (2, 12), (13, 12)):
        c.put(x, y, "stone", 6.2)
        c.put(x, y + 1, "wood", 1.8)
    return c.outline().image(), (8, 15)


def barrel():
    c = Canvas(14, 18)
    for y in range(1, 17):
        wid = 4.7 + 1.0 * math.sin(math.pi * (y - 1) / 15)
        for x in range(1, 13):
            nx = (x - 6.5) / wid
            if abs(nx) > 1:
                continue
            nz = math.sqrt(max(0.0, 1 - nx * nx))
            level = 1.4 + lambert(nx, -0.15, nz) * 5.0
            u = (nx + 1) / 2 * 5
            if u - int(u) < 0.2 and 0.1 < u < 4.9:
                level -= 1.2                                      # stave joints follow the bulge
            elif noise1(x * 3, y, 3, 95) < 0.28:
                level -= 0.5
            if y > 14:
                level -= 0.8
            c.put(x, y, "wood", level)
    for hy in (3, 12):                                            # iron hoops, bowed with the barrel
        for x in range(1, 13):
            wid = 4.7 + 1.0 * math.sin(math.pi * (hy - 1) / 15)
            nx = (x - 6.5) / wid
            if abs(nx) > 1:
                continue
            nz = math.sqrt(max(0.0, 1 - nx * nx))
            lam = lambert(nx, -0.2, nz)
            yy = hy + (1 if abs(nx) > 0.8 and hy > 8 else 0) - (1 if abs(nx) > 0.8 and hy < 8 else 0)
            c.put(x, yy, "stone", 2.4 + lam * 4.2)
            c.put(x, yy + 1, "stone", 1.2 + lam * 2.4)
            c.shift(x, yy + 2, -0.9)
        c.put(4, hy, "stone", 6.8)
    for x in range(3, 11):                                        # the lid: rim, boards, bung
        c.put(x, 1, "wood", 5.8 if x < 7 else 4.6)
        c.put(x, 2, "wood", 3.8 if 3 < x < 10 else 4.8)
    c.put(4, 1, "wood", 6.6)
    c.put(8, 2, "wood", 1.4)
    return c.outline().image(), (7, 17)


def woodpile():
    c = Canvas(30, 16)
    for y in range(3, 14):                                        # the dark spaces between logs
        for x in range(1, 30):
            if (y >= 9) or (4 <= x <= 26 and y >= 4):
                c.put(x, y, "wood", 0.7)
    for row_y, n, off in ((11, 5, 0), (6, 4, 3)):
        for i in range(n):
            cx = 3 + off + i * 6
            seed = cx * 7 + row_y
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    d = math.sqrt((dx / 2.7) ** 2 + (dy / 2.7) ** 2)
                    if d > 1:
                        continue
                    if d > 0.74:                                  # bark rim, lit top-left
                        c.put(cx + dx, row_y + dy, "wood", 3.0 if dx + dy < 0 else 1.2)
                        continue
                    level = (6.4 if d > 0.5 else 5.4 if d > 0.28 else 4.4) - (dx + dy) * 0.12
                    c.put(cx + dx, row_y + dy, "wood", level)
            ang = hash2(seed, 1, 2) * math.pi * 2
            for t in (1, 2):
                c.put(cx + round(math.cos(ang) * t), row_y + round(math.sin(ang) * t), "wood", 3.4)
    for dy in range(-3, 3):                                       # a split quarter log on top
        for dx in range(0, 4):
            if dx + max(dy, -dy) * 0.6 < 3.4 and not (dx == 0 and dy < -1):
                level = 6.2 - dx * 0.4 if dy < 0 else 5.0 - dx * 0.3
                if dx == 3 or dy == 2:
                    level = 1.8
                c.put(26 + dx, 5 + dy, "wood", level)
    for x, y, lv in ((0, 14, 5.6), (1, 14, 4.0), (28, 14, 5.2), (13, 15, 4.8)):
        c.put(x, y, "wood", lv)                                   # chips
    return c.outline().image(), (15, 14)


def trough():
    c = Canvas(26, 11)
    for x in range(1, 25):
        c.put(x, 2, "wood", 6.0 if x < 12 else 5.2)               # the rim
    for y in range(3, 6):
        for x in range(1, 25):
            if x < 3 or x > 22:
                c.put(x, y, "wood", 4.8 if x < 3 else 2.2)
                continue
            if y == 3:
                c.put(x, y, "water", 1.6)                         # the far wall's shade on the water
            else:
                level = 4.0 + (y - 4) * 0.8 + (noise1(x * 0.5, y * 2, 3, 97) - 0.5) * 0.9
                c.put(x, y, "water", level)
    for x, y, lv in ((5, 4, 7.0), (6, 4, 6.2), (7, 4, 5.4), (16, 5, 6.4), (17, 5, 5.6)):
        c.put(x, y, "water", lv)
    for x in (3, 4, 21, 22):
        c.put(x, 3, "moss", 3.0)
    for y in range(6, 9):                                         # front boards, darker where water slopped over
        for x in range(1, 25):
            level = (4.2, 3.4, 1.8)[y - 6]
            if y == 7 and x % 8 == 0:
                level = 1.2
            if y < 8 and noise1(x * 0.8, y, 2.5, 98) < 0.35:
                level -= 1.1
            c.put(x, y, "wood", level)
    for x in (6, 19):
        for y in range(2, 9):
            c.put(x, y, "stone", 5.2 if y < 4 else 3.0)
        c.put(x, 7, "stone", 6.4)
    for x, y, lv in ((2, 9, 3.2), (3, 9, 2.0), (2, 10, 2.4), (3, 10, 1.4), (22, 9, 2.6), (23, 9, 1.4),
                     (22, 10, 1.8), (23, 10, 1.0)):
        c.put(x, y, "wood", lv)
    return c.outline().image(), (13, 10)


def _post_foot_moss(c, xs, y):
    for x in xs:
        if hash2(x, y, 5) < 0.6:
            c.put(x, y, "moss", 3.6 if hash2(x, y, 6) < 0.5 else 2.8)


def fence(length, vertical=False):
    if vertical:
        c = Canvas(7, length + 8)
        for y in range(2, length + 6):
            grain = noise1(3, y * 0.7, 3, 110)
            c.put(2, y, "wood", 5.4 - (0.7 if grain < 0.3 else 0))
            c.put(3, y, "wood", 4.2 - (0.6 if grain > 0.7 else 0))
            c.put(4, y, "wood", 1.4)
            if hash2(y // 5, 0, 111) < 0.15 and y % 5 == 2:
                c.put(3, y, "wood", 2.0)                          # a split in the rail
        for y in range(0, length + 1, 16):
            for x in range(1, 6):
                c.put(x, y + 1, "wood", 6.6 - (x - 1) * 0.5)      # the cut top, lit
                c.put(x, y + 2, "wood", 5.6 - (x - 1) * 0.5)
                for yy in range(y + 3, y + 8):
                    level = 5.2 if x == 1 else 2.0 if x == 5 else 4.2
                    if x == 3 and noise1(x, yy, 2, y + 112) < 0.35:
                        level -= 1.0
                    c.put(x, yy, "wood", level)
            c.put(3, y + 4, "stone", 6.2)
            _post_foot_moss(c, (1, 2, 5), y + 7)
        return c.outline().image(), (3, length + 6)
    c = Canvas(length + 8, 12)
    for ry in (3, 7):
        for x in range(2, length + 6):
            grain = noise1(x * 0.4, ry, 3, 120 + ry)
            top = 5.4 + (0.6 if grain > 0.7 else -0.7 if grain < 0.28 else 0)
            c.put(x, ry, "wood", top)
            c.put(x, ry + 1, "wood", 3.8 - (0.8 if grain < 0.3 else 0))
            c.put(x, ry + 2, "wood", 1.4)
            if hash2(x // 6, ry, 121) < 0.12 and x % 6 == 3:
                c.put(x, ry + 1, "wood", 1.8)
                c.put(x + 1, ry + 1, "wood", 1.8)                 # a check in the rail
    for px in range(0, length + 1, 16):
        for y in range(1, 11):
            for i, x in enumerate(range(px + 2, px + 5)):
                level = (5.4, 4.4, 2.0)[i]
                if i == 1 and noise1(x, y * 0.6, 2, px + 130) < 0.3:
                    level -= 1.1
                if y == 1:
                    level = (6.8, 6.0, 4.4)[i]
                c.put(x, y, "wood", level)
        for ry in (3, 7):
            c.put(px + 3, ry + 1, "stone", 6.2)                   # nails
            c.shift(px + 5, ry, -1.2)                             # the post shades the rail beside it
            c.shift(px + 5, ry + 1, -1.2)
        _post_foot_moss(c, (px + 2, px + 3, px + 4), 10)
    return c.outline().image(), ((length + 8) // 2, 10)


def dock():
    w, h = 44, 22
    c = Canvas(w, h)
    for y in range(3, 15):
        for x in range(1, w - 1):
            board = (x - 1) // 5
            bx = (x - 1) % 5
            grey = hash2(board, 0, 140) < 0.15
            ramp = "greywood" if grey else "wood"
            base = 4.4 if not grey else 4.2
            if bx == 0:
                level = 0.6
            elif bx == 1:
                level = base + 1.1
            elif bx == 4:
                level = base - 0.7
            else:
                level = base + (-0.8 if noise1(x * 3, y * 0.5, 3, 141 + board) < 0.3 else 0)
            if y == 3:
                level = base + 1.8 if bx else 1.2
            elif y == 14:
                level = base - 1.4 if bx else 0.6
            c.put(x, y, ramp, level)
    for board in range(9):
        x = 3 + board * 5
        for y in (5, 12):
            c.put(x, y, "stone", 6.0)
            c.put(x, y + 1, "wood", 2.2)
    for y in range(15, 18):                                       # the front beam, wet and dark at the bottom
        for x in range(1, w - 1):
            level = (3.6, 2.4, 1.2)[y - 15] + (noise1(x * 0.5, y, 2, 142) - 0.5) * 0.8
            c.put(x, y, "wood", level)
            if y == 17 and hash2(x, y, 143) < 0.3:
                c.put(x, y, "moss", 2.6)
    for x in (3, 20, w - 5):                                      # piles
        for y in range(1, 21):
            wet = y > 16
            for i in range(3):
                level = (4.8, 3.6, 1.4)[i] - (1.4 if wet else 0)
                if y <= 2:
                    level = (6.4, 5.6, 4.2)[i] if y == 1 else (5.4, 4.6, 3.0)[i]
                c.put(x + i, y, "wood", level)
            if y == 18:
                c.put(x + 1, y, "moss", 3.2)
    for dy in range(-2, 3):                                       # a coiled rope, lying flat
        for dx in range(-3, 4):
            d = math.sqrt((dx / 3.2) ** 2 + (dy / 2.2) ** 2)
            if d > 1 or d < 0.3:
                continue
            lit = dx + dy < 0
            level = (4.0 if lit else 2.8) - (0.7 if (dx - dy) % 2 else 0)
            if d > 0.85:
                level -= 0.8
            c.put(37 + dx, 9 + dy, "khaki", level)
    for x, y, lv in ((34, 11, 3.4), (33, 12, 2.8)):
        c.put(x, y, "khaki", lv)
    c.outline()
    for x in (3, 20, w - 5):                                      # ripples at the piles, unoutlined
        c.put(x - 1, 21, "water", 7.0)
        c.put(x + 3, 21, "water", 6.2)
        c.put(x + 4, 21, "water", 5.2)
    return c.image(), (w // 2, 18)


def hen(facing_left=False, peck=False):
    """`peck` lowers the head two rows and forward one, over the body: the hen pecking at the ground."""
    rows = [
        "...RR....",
        "..WWW....",
        ".WKWWo...",
        "..WWWWWW.",
        "..WWWWWsW",
        "...WWWWs.",
        "....o.o..",
    ]
    c = Canvas(11, 9)
    order = [j for j in range(len(rows)) if j >= 3] + [0, 1, 2] if peck else range(len(rows))
    for j in order:
        row = rows[j]
        for i, k in enumerate(row):
            di, dj = (-1, 2) if peck and j < 3 else (0, 0)
            if k == ".":
                continue
            x = 1 + (8 - (i + di) if facing_left else i + di)
            y = 1 + j + dj
            if k == "W":
                level = 6.2 if j < 3 else 5.6 - (j - 3) * 0.6
                if j >= 3 and (i + j) % 2 == 0:
                    level -= 0.7                                  # feather rows
                if j == 4 and 3 <= i <= 6:
                    level = 4.4 if i < 6 else 3.2                 # the folded wing
                if i >= 7:
                    level = 6.0 if j == 3 else 3.6
                c.put(x, y, "white", level)
            elif k == "s":
                c.put(x, y, "white", 2.4)
            elif k == "R":
                c.put(x, y, "red", 4.8 if i == 3 else 3.4)
            elif k == "K":
                c.put(x, y, "ink", 0)
            elif k == "o":
                c.put(x, y, "gold", 4.6 if j < 6 else 3.0)
    wx = 1 + (8 - (4 if peck else 5) if facing_left else (4 if peck else 5))
    c.put(wx, 6 if peck else 4, "red", 3.2)                       # wattle
    return c.outline().image(), (5, 8)


def signpost():
    c = Canvas(20, 24)
    for y in range(6, 23):
        streak = noise1(9, y * 0.8, 2.5, 150)
        c.put(9, y, "wood", 5.0 - (0.9 if streak < 0.3 else 0))
        c.put(10, y, "wood", 2.4)
    for x, y, lv in ((8, 22, 3.0), (11, 22, 1.6), (9, 21, 3.4)):
        c.put(x, y, "moss", lv)
    for y in range(2, 8):                                         # two planks cut to an arrow
        right = 12 + (1 if 3 <= y <= 6 else 0) + (1 if 4 <= y <= 5 else 0)
        for x in range(3, right + 1):
            plank_row = (y - 2) % 3
            level = (6.0, 4.6, 3.0)[plank_row] if y < 5 else (5.2, 4.2, 1.8)[plank_row]
            if plank_row == 1 and noise1(x * 0.5, y * 3, 2, 151) < 0.3:
                level -= 0.6
            if x == right:
                level -= 0.8
            c.put(x, y, "wood", level)
    for x0, x1, y in ((5, 6, 3), (8, 10, 3), (5, 7, 6), (9, 9, 6), (11, 11, 6)):   # carved letters
        for x in range(x0, x1 + 1):
            c.put(x, y, "wood", 1.6)
            c.shift(x, y + 1, 0.8)
    for x, y in ((4, 3), (10, 3), (4, 6), (10, 6)):
        c.put(x, y, "stone", 6.2)
    return c.outline().image(), (10, 22)


def mailbox():
    c = Canvas(14, 20)
    for y in range(8, 19):
        c.put(6, y, "wood", 4.8 - (0.8 if noise1(6, y, 2, 160) < 0.3 else 0))
        c.put(7, y, "wood", 2.2)
    c.put(5, 18, "grass", 4.6)
    c.put(8, 18, "grass", 3.4)
    for y in range(2, 9):
        for x in range(2, 12):
            if y == 2 and x in (2, 11):
                continue
            level = (4.6, 4.2, 3.6, 3.2, 3.0, 2.4, 1.4)[y - 2]
            if x == 2:
                level -= 0.8                                      # the door end
            elif x == 11:
                level -= 0.4
            c.put(x, y, "blue", level)
    for x in range(4, 8):
        c.put(x, 3, "blue", 5.0)                                  # sheen on the curved top
    c.put(3, 3, "blue", 4.4)
    for x in (4, 7, 10):
        c.put(x, 7, "stone", 5.6)                                 # rivets
    c.put(2, 5, "stone", 6.0)                                     # door latch
    for y in range(3, 8):
        c.put(12, y, "stone", 3.8)                                # flag pole
    for x, y, lv in ((12, 2, 4.8), (13, 2, 4.2), (12, 3, 3.6), (13, 3, 3.0)):
        c.put(x, y, "red", lv)
    return c.outline().image(), (7, 18)


def fallen_log():
    w, h = 70, 22
    c = Canvas(w, h)
    for y in range(4, 18):
        for x in range(6, w - 6):
            level = (5.4, 5.0, 4.6, 4.2, 3.8, 3.6, 3.4, 3.2, 3.0, 2.6, 2.3, 2.0, 1.6, 1.2)[y - 4]
            c.put(x, y, "wood", level)
    for x in range(6, w - 6):                                     # bark plates split by fissures along the log
        for base in (6, 9, 12, 15):
            fy = round(base + (noise1(x, base, 7, 170) - 0.5) * 2.4)
            if 4 < fy < 17 and noise1(x, base * 5, 5, 175) > 0.3:
                c.shift(x, fy, -1.8)
                c.shift(x, fy - 1, 0.6)
        if hash2(x, 0, 171) < 0.09:                               # cross cracks
            for y in range(6 + int(hash2(x, 1, 171) * 6), 6 + int(hash2(x, 1, 171) * 6) + 3):
                c.shift(x, y, -1.4)
    moss = set()
    for x in range(8, w - 8):                                     # moss over the top, hanging down in places
        reach = 7 + (3 if noise1(x, 0, 4, 173) > 0.62 else 0)
        for y in range(4, reach):
            if noise1(x, y * 1.4, 6, 172) + (0.12 if y < 6 else 0) > 0.56:
                moss.add((x, y))
    for x, y in moss:
        level = 4.2 - (y - 4) * 0.25
        if (x, y - 1) not in moss:
            level += 1.3
        elif (x, y + 1) not in moss:
            level -= 1.4
        if noise1(x, y, 1.6, 174) > 0.66:
            level += 0.6
        c.put(x, y, "moss", level)
    for x, y in moss:
        if (x, y + 1) not in moss:
            c.shift(x, y + 1, -1.2)                               # moss sits proud of the bark
    for fx, fy in ((22, 12), (47, 11)):                           # shelf fungus with its shade below
        for dx, dy, lv in ((-1, 0, 6.6), (0, 0, 6.2), (1, 0, 5.6), (-3, 1, 6.4), (-2, 1, 5.8), (-1, 1, 5.2),
                           (0, 1, 4.8), (1, 1, 4.4), (2, 1, 3.6)):
            c.put(fx + dx, fy + dy, "wood", lv)
        for dx in range(-3, 3):
            c.put(fx + dx, fy + 2, "wood", 0.5)
    for ex, hollow in ((6, False), (w - 7, True)):                # cut ends: bark lip, rings, a rotted hollow
        for y in range(3, 19):
            for x in range(ex - 5, ex + 6):
                d = math.sqrt(((x - ex) / 5) ** 2 + ((y - 10.5) / 7.5) ** 2)
                if d > 1:
                    continue
                if d > 0.84:
                    level = 3.0 if (x < ex and y < 10.5) else 1.6
                elif hollow and d < 0.45:
                    level = 0.3 + (y - 7) * 0.08
                    if d > 0.36 and y > 10.5:
                        level = 4.6                               # the lit inner lip
                else:
                    ring = int(d * 8) % 2
                    level = (6.2 if ring else 5.4) - (x - ex) * 0.08 - (y - 10.5) * 0.05
                    if not hollow and d < 0.12:
                        level = 3.4
                c.put(x, y, "wood", level)
        if not hollow:
            for k in range(5):
                c.put(ex + k * 0.6, 10.5 + k, "wood", 2.4)
    for x, y, r, lv in ((31, 0, "red", 4.4), (32, 0, "red", 5.4), (30, 1, "red", 3.8), (31, 1, "red", 4.6),
                        (32, 1, "red", 4.0), (33, 1, "red", 2.8), (32, 0, "white", 6.2), (30, 1, "white", 5.4),
                        (31, 2, "white", 5.4), (32, 2, "white", 4.0), (31, 3, "white", 4.2)):
        c.put(x, y, r, lv)
    return c.outline().image(), (w // 2, 19)


# ------------------------------------------------------------------ buildings

def shingle_roof(c, x0, y0, x1, y1, ramp, top_i=6, bottom_i=3, row_h=4, width=6, seed=0, moss=True):
    """Rounded-bottom shingles: each row's tongues hang over a shadow line on the row below."""
    rows = max(1, (y1 - y0 + 1) // row_h)
    for y in range(y0, y1 + 1):
        r, ry = (y - y0) // row_h, (y - y0) % row_h
        bi = top_i - (top_i - bottom_i) * r / max(rows - 1, 1)
        off = (width // 2) * (r % 2)
        for x in range(x0, x1 + 1):
            col, cx = (x + off) // width, (x + off) % width
            var = hash2(col, r, seed)
            i = bi + (-1 if var < 0.22 else 0.6 if var > 0.9 else 0)
            if ry == 0:
                above = (x + (width // 2) * ((r + 1) % 2)) % width
                i = bi - 1 if above in (2, 3) else bi - 2.2
            elif ry == 1 and 1 <= cx <= 2:
                i += 1
            elif cx in (0, width - 1) and ry >= 2:
                i -= 0.8
            if x < x0 + 2:
                i += 1
            c.put(x, y, ramp, clamp(round(i), 0, TOP[ramp]))
            if moss and ry == 2 and 1 <= cx <= 3 and hash2(col, r, seed + 5) < 0.06:
                c.put(x, y, "leaf", 4 if cx != 1 else 5)


def window(c, wx, wy, shutters=True):
    if shutters:
        for sx in (wx - 3, wx + 11):
            for y in range(wy, wy + 11):
                for x in (sx, sx + 1):
                    i = 3 if y % 2 else 2
                    if x == sx:
                        i += 1
                    c.put(x, y, "shutter", i)
    for y in range(wy - 1, wy + 12):
        for x in range(wx - 1, wx + 11):
            i = 6 if y == wy - 1 or x == wx - 1 else 3 if y == wy + 11 or x == wx + 10 else 5
            c.put(x, y, "white", i)
    for y in range(wy, wy + 11):
        for x in range(wx, wx + 10):
            s = (x - wx) + (y - wy)
            i = 4 if s in (3, 4) else 3 if s in (6, 12, 13) else 2
            if y == wy:
                i = 1
            c.put(x, y, "glass", i)
    for y in range(wy, wy + 11):
        c.put(wx + 4, y, "white", 5)
    for x in range(wx, wx + 10):
        c.put(x, wy + 5, "white", 5)
    for x in range(wx - 1, wx + 11):
        c.put(x, wy + 11, "wood", 5)
        c.put(x, wy + 12, "wood", 3)
        c.put(x, wy + 13, "wood", 1)
    for fx in range(wx, wx + 10):
        c.put(fx, wy + 10, "leaf", 4 if fx % 2 else 3)
        k = fx % 3
        if k == 0:
            c.put(fx, wy + 9, "red", 5)
            c.put(fx, wy + 10, "red", 3)
        elif k == 1:
            c.put(fx, wy + 9, "leaf", 5)
        else:
            c.put(fx, wy + 9, "straw", 5)


def farmhouse():
    """The player's saltbox, same footprint as kit.farmhouse."""
    w, h = 86, 80
    c = Canvas(w, h)
    roof_top, eave, wall_bottom = 10, 46, 75
    for y in range(0, 14):                                        # stone chimney
        for x in range(58, 67):
            row = y // 3
            bx = (x + row % 2 * 2) % 4
            i = 5 if x < 60 else 3 if x > 64 else 4
            if y % 3 == 2 or bx == 3:
                i = 2
            c.put(x, y, "stone", i)
    c.rect(58, 0, 9, 1, "stone", 6)
    c.rect(59, 1, 7, 1, "ink", 0)
    shingle_roof(c, 1, roof_top + 2, w - 2, eave - 1, "slate", top_i=5, bottom_i=3, seed=4)
    for x in range(1, w - 1):                                     # ridge cap
        c.put(x, roof_top, "slate", 7 if x % 6 else 5)
        c.put(x, roof_top + 1, "slate", 4 if x % 6 else 3)
    for y in range(roof_top, eave):
        c.put(1, y, "slate", 7)
        c.put(w - 2, y, "slate", 2)
    shingle_roof(c, 1, eave + 1, 29, eave + 6, "slate", top_i=4, bottom_i=3, row_h=3, seed=9, moss=False)
    c.rect(1, eave, w - 2, 1, "white", 4)
    c.rect(1, eave + 7, 29, 1, "white", 4)
    for y in range(eave + 1, wall_bottom):                        # clapboard
        for x in range(4, w - 4):
            if x < 30 and y <= eave + 7:
                continue
            by = (y - eave - 1) % 3
            i = 2 if by == 0 else 5 if by == 1 else 4
            if x < 6:
                i = 6 if x == 4 else 5
            elif x > w - 7:
                i = 3 if x == w - 6 else 2
            if y <= eave + 2 or (x < 30 and y <= eave + 9):
                i = min(i, 2)
            if y > wall_bottom - 4:
                i -= 1
            c.put(x, y, "white", i)
    for x in range(4, w - 4):                                     # stone foundation
        seam = (x - 4) % 7 == 6
        c.put(x, wall_bottom - 2, "stone", 2 if seam else 5)
        c.put(x, wall_bottom - 1, "stone", 1 if seam else 3)
    for wx in (12, 60):
        window(c, wx, eave + 9)
    dx = w // 2 - 5
    for y in range(eave + 8, wall_bottom):                        # door and trim
        for x in range(dx - 1, dx + 11):
            c.put(x, y, "white", 6 if x == dx - 1 or y == eave + 8 else 3 if x == dx + 10 else 5)
    for y in range(eave + 9, wall_bottom):
        for x in range(dx, dx + 10):
            c.put(x, y, "red", 4 if x == dx else 2 if x == dx + 9 else 3)
    for px, py, pw, ph in ((dx + 1, eave + 11, 3, 6), (dx + 6, eave + 11, 3, 6), (dx + 1, eave + 19, 8, 6)):
        for y in range(py, py + ph):
            for x in range(px, px + pw):
                i = 1 if y == py or x == px else 5 if y == py + ph - 1 or x == px + pw - 1 else 3
                c.put(x, y, "red", i)
    c.put(dx + 8, eave + 18, "gold", 5)
    c.put(dx + 8, eave + 19, "gold", 2)
    c.rect(dx - 5, eave + 11, 2, 3, "gold", 4)                   # porch lamp
    c.put(dx - 5, eave + 11, "gold", 5)
    c.rect(dx - 5, eave + 10, 2, 1, "stone", 2)
    for y in range(wall_bottom, wall_bottom + 3):                 # stone step
        for x in range(dx - 2, dx + 12):
            c.put(x, y, "stone", 6 if y == wall_bottom else 4 if y == wall_bottom + 1 else 2)
    return c.outline().image(), (w // 2, wall_bottom + 2)


def barn():
    w, h = 96, 84
    c, cx = Canvas(w, h), w // 2
    peak, knee, eave, bottom = 3, 16, 32, 79

    def half(y):
        if y < knee:
            return 12 + (y - peak) * (32 - 12) / (knee - peak)
        return 32 + (y - knee) * (44 - 32) / (eave - knee)

    for y in range(peak, eave + 1):
        hw = round(half(y))
        for x in range(cx - hw, cx + hw + 1):
            edge = x - (cx - hw) < 4 or (cx + hw) - x < 4 or y - peak < 3
            if edge:
                i = 6 if x < cx else 3
                if y - peak < 3:
                    i = 6 if y == peak else 5
                if (y + (x // 3)) % 3 == 0:
                    i -= 1
                c.put(x, y, "slate", i)
            else:
                bx = (x - cx) % 5
                i = 1 if bx == 0 else 5 if bx == 1 else 3
                if bx > 1 and hash2((x - cx) // 5, y // 4, 30) < 0.25:
                    i = 2
                if y - peak < 6 or (x - (cx - hw) < 7) or ((cx + hw) - x < 7):
                    i = min(i, 2)
                c.put(x, y, "barnred", i)
    planks_v(c, cx - 44, eave, 89, bottom - eave, "barnred", 3, seed=31)
    for y in range(eave, bottom):
        for x in range(cx - 44, cx + 45):
            if y < eave + 5:
                c.shift(x, y, -1)
            if y > bottom - 4:
                c.shift(x, y, -1)
    for x in range(cx - 44, cx - 41):
        for y in range(eave, bottom):
            c.put(x, y, "white", 6 if x == cx - 44 else 5)
    for x in range(cx + 42, cx + 45):
        for y in range(eave, bottom):
            c.put(x, y, "white", 3 if x == cx + 42 else 2)
    c.rect(cx - 44, eave, 89, 1, "white", 6)
    c.rect(cx - 44, eave + 1, 89, 1, "white", 4)
    for y in range(14, 28):                                       # hayloft
        for x in range(cx - 8, cx + 8):
            c.put(x, y, "white", 6 if x == cx - 8 or y == 14 else 3 if x == cx + 7 or y == 27 else 5)
    c.rect(cx - 6, 16, 12, 10, "ink", 0)
    for y in range(21, 26):
        for x in range(cx - 6, cx + 6):
            c.put(x, y, "straw", 5 if y == 21 and hash2(x, y, 40) < 0.6 else 4 if y < 24 else 3)
    c.put(cx - 4, 20, "straw", 5)
    c.put(cx + 2, 20, "straw", 6)
    c.rect(cx - 2, 11, 4, 3, "wood", 3)
    c.rect(cx - 2, 11, 4, 1, "wood", 5)
    for y in range(46, bottom):                                   # door frame
        for x in range(cx - 20, cx + 20):
            c.put(x, y, "white", 6 if x == cx - 20 or y == 46 else 3 if x == cx + 19 else 5)
    for d in (-18, 1):
        x0 = cx + d
        planks_v(c, x0, 48, 17, bottom - 48, "barnred", 3, board=4, seed=32 + d)
        for i in range(17):
            y = 48 + round(i * (bottom - 49) / 16)
            y2 = 48 + (bottom - 49) - (y - 48)
            for yy, lit in ((y, True), (y2, False)):
                c.put(x0 + i, yy, "white", 5 if lit else 4)
                c.put(x0 + i, yy + 1, "white", 3)
                c.put(x0 + i, yy + 2, "barnred", 1)
        for x in range(x0, x0 + 17):
            c.put(x, 48, "white", 5)
            c.put(x, 49, "barnred", 1)
        for y in range(48, bottom):
            c.put(x0, y, "white", 5)
            c.put(x0 + 16, y, "white", 3)
    c.rect(cx - 1, 46, 2, bottom - 46, "ink", 0)
    c.put(cx - 3, 64, "gold", 5)
    c.put(cx + 2, 64, "gold", 4)
    for x in range(cx - 46, cx + 47):
        seam = (x - cx) % 8 == 0
        c.put(x, bottom, "stone", 2 if seam else 6)
        c.put(x, bottom + 1, "stone", 1 if seam else 4)
        c.put(x, bottom + 2, "stone", 2)
    c.rect(cx - 1, 0, 2, peak + 1, "stone", 3)
    c.rect(cx - 4, 0, 8, 1, "gold", 4)
    c.put(cx - 4, 0, "gold", 5)
    return c.outline().image(), (cx, bottom + 2)


def windmill():
    w, h = 64, 88
    c, cx = Canvas(w, h), w // 2
    top, bottom = 30, 84
    for y in range(top, bottom):
        hw = round(7 + (y - top) * 3 / (bottom - top))
        row = y // 4
        for x in range(cx - hw, cx + hw + 1):
            rel = (x - (cx - hw)) / (2 * hw)
            v = 0.85 - abs(rel - 0.22) * 1.35
            i = 2 + v * 4.5
            bx = (x + row % 2 * 2) % 4
            if y % 4 == 3 or bx == 3:
                i -= 1.6
            elif y % 4 == 0 and bx == 0:
                i += 0.8
            if hash2((x + row % 2 * 2) // 4, row, 60) < 0.2:
                i -= 0.7
            if y < top + 3:
                i -= 1.5
            c.put(x, y, "stone", clamp(round(i), 1, 7))
    for y in range(bottom - 12, bottom):                          # arched door
        for x in range(cx - 3, cx + 3):
            if y == bottom - 12 and x in (cx - 3, cx + 2):
                continue
            bx = (x - (cx - 3)) % 3
            c.put(x, y, "wood", 1 if bx == 2 else 4 if bx == 0 else 3)
    c.rect(cx - 4, bottom - 13, 8, 1, "stone", 6)
    c.rect(cx - 1, 44, 3, 4, "glass", 2)
    c.put(cx - 1, 44, "glass", 4)
    c.rect(cx - 2, 48, 5, 1, "stone", 6)
    for y in range(18, top + 2):                                  # wooden cap
        hw = round(3 + (y - 18) * 6 / (top + 2 - 18))
        for x in range(cx - hw, cx + hw + 1):
            rel = (x - (cx - hw)) / max(2 * hw, 1)
            i = 6 if rel < 0.25 else 4 if rel < 0.6 else 2
            if (y - 18) % 3 == 2:
                i -= 1
            c.put(x, y, "wood", i)
    c.rect(cx - 9, top + 1, 19, 1, "wood", 1)
    hub = (cx, 24)
    for (dx, dy), length in (((1, -1), 24), ((-1, -1), 24), ((-1, 1), 22), ((1, 1), 11)):
        broken = length < 20
        for t in range(3, length):
            if not broken and t > 6:
                for k in range(1, 5):
                    for sx in (0, 1):
                        x = hub[0] + dx * t - dy * k + sx
                        y = hub[1] + dy * t + dx * k
                        frame = k == 4 or t % 4 == 0
                        if frame:
                            c.put(x, y, "wood", 3)
                        else:
                            c.put(x, y, "white", 5 if dy < 0 else 4)
            for sx in (0, 1):
                c.put(hub[0] + dx * t + sx, hub[1] + dy * t, "wood", 4 if sx == 0 else 2)
        if broken:
            ex, ey = hub[0] + dx * length, hub[1] + dy * length
            c.put(ex, ey, "wood", 5)
            c.put(ex + 1, ey + 1, "wood", 3)
    c.rect(hub[0] - 1, hub[1] - 1, 3, 3, "stone", 2)
    c.put(hub[0] - 1, hub[1] - 1, "stone", 5)
    gx, gy = cx + 6, 52                                           # the jammed gear
    for a in range(12):
        ang = a * math.pi / 6
        c.put(gx + round(math.cos(ang) * 4), gy + round(math.sin(ang) * 4), "gold", 4 if a % 2 else 2)
    for y in range(gy - 2, gy + 3):
        for x in range(gx - 2, gx + 3):
            c.put(x, y, "gold", 4 if x - gx + y - gy < 0 else 3)
    c.put(gx, gy, "ink", 0)
    for x, y in ((gx + 3, gy + 3), (gx + 4, gy + 3), (gx + 4, gy + 4), (gx + 5, gy + 4)):
        c.put(x, y, "wood", 2)
    return c.outline().image(), (cx, bottom - 1)


def coop():
    """Hen Haven's coop: a shingled roof shading the plank walls, a little window, a nest box on the side,
    straw at the door and a cleated ramp."""
    from buildings import boards, shingles

    w, h = 36, 34
    c = Canvas(w, h)
    cx = w // 2
    boards(c, 5, 14, 26, 16, "wood", 3.8, width=4, seed=72)
    for x in range(5, 31):
        for k, amt in ((0, 1.9), (1, 1.2), (2, 0.5)):
            c.shift(x, 14 + k, -amt)
    for y in range(14, 30):
        c.put(5, y, "wood", 5.6)
        c.put(30, y, "wood", 2.0)
    for y in range(17, 22):                                       # little window
        for x in range(8, 12):
            edge = x in (8, 11) or y in (17, 21)
            if edge:
                c.put(x, y, "wood", 6.0 if (x == 8 or y == 17) else 2.4)
            else:
                c.put(x, y, "glass", 2.6 - (y - 18) * 0.6 + (1.8 if (x, y) == (9, 18) else 0))
    for y in range(18, 30):                                       # arched door, dark inside, straw nest
        for x in range(13, 23):
            frame = x in (13, 22) or y == 18
            if y == 18 and x in (13, 14, 21, 22):
                continue
            if frame:
                c.put(x, y, "wood", 5.8 if x == 13 or y == 18 else 2.0)
                continue
            if y == 19 and x in (14, 21):
                c.put(x, y, "wood", 5.0)
                continue
            level = 0.2 + (y - 19) * 0.06
            c.put(x, y, "wood", level)
    for y in range(26, 30):
        for x in range(14, 22):
            if y > 26 or hash2(x, y, 73) < 0.5:
                c.put(x, y, "straw", 3.0 + (29 - y) * -0.2 + hash2(x, y, 74) * 1.6)
    for y in range(20, 29):                                       # nest box on the right wall
        for x in range(31, 34):
            level = 4.8 if x == 31 else 3.6 if x == 32 else 1.8
            if (y - 20) % 3 == 2:
                level -= 1.0
            c.put(x, y, "wood", level)
    for x in range(30, 35):
        c.put(x, 19, "red", 5.0 - (x - 30) * 0.5)
        c.put(x, 20, "red", 2.6)
    c.put(32, 21, "straw", 5.2)
    for y in range(2, 14):                                        # the roof
        hw = 6 + (y - 2)
        for x in range(cx - hw, cx + hw + 1):
            c.put(x, y, "red", 1)
    shingles(c, 1, 3, 34, 12, "red", 5.2, 3.2, row_h=3, width=4, seed=71)
    for y in range(2, 14):
        hw = 6 + (y - 2)
        for x in range(0, w):
            if abs(x - cx) > hw and c.get(x, y) and c.get(x, y)[0] in ("red", "moss"):
                c.px[y][x] = None
        c.put(cx - hw, y, "red", 5.8)
        c.put(cx + hw, y, "red", 1.6)
    for x in range(cx - 6, cx + 7):
        c.put(x, 2, "red", 5.8 if x % 3 else 4.2)
    for x in range(cx - 17, cx + 18):
        c.put(x, 13, "wood", 1.0)
    for x in range(4, 32):                                        # foundation stones
        seam = x % 5 == 0
        c.put(x, 30, "stone", 2.4 if seam else 5.4)
        c.put(x, 31, "stone", 1.4 if seam else 3.0)
    for k in range(8):                                            # cleated ramp from the door
        x, y = 20 + k, 29 + round(k * 0.4)
        c.put(x, y, "wood", 5.8 if k % 2 else 4.6)
        c.put(x, y + 1, "wood", 2.8)
    for x, y in ((12, 31), (23, 32)):
        c.put(x, y, "straw", 5.2)
    return c.outline().image(), (w // 2, 31)


def well():
    w, h = 22, 30
    c = Canvas(w, h)
    for x in range(3, 19):
        c.put(x, 2, "wood", 6)
        c.put(x, 3, "wood", 4)
        c.put(x, 4, "wood", 2)
    for y in range(5, 19):
        for px in (4, 16):
            c.put(px, y, "wood", 5)
            c.put(px + 1, y, "wood", 2)
    c.rect(6, 8, 10, 1, "wood", 2)
    c.rect(11, 9, 1, 3, "straw", 3)
    for y in range(12, 16):
        for x in range(9, 13):
            c.put(x, y, "stone", 6 if y == 12 else 1 if y == 15 else 4 if x < 11 else 3)
    for y in range(15, 28):
        for x in range(2, 20):
            if ((x - 10.5) / 8.5) ** 2 + ((y - 21) / 6) ** 2 <= 1:
                inner = ((x - 10.5) / 6) ** 2 + ((y - 19) / 3) ** 2 <= 1
                if inner:
                    i = 0 if y < 18 else 1
                    c.put(x, y, "water" if i else "ink", i)
                else:
                    ang = math.atan2(y - 21, x - 10.5)
                    block = int((ang + math.pi) * 3) + (y // 3) % 2
                    nx = (x - 10.5) / 8.5
                    i = 4.2 - nx * 1.6 + (0.8 if y < 19 else 0) - (0.9 if y > 24 else 0)
                    if y % 3 == 0 or (int((ang + math.pi) * 6 * 3) % 6 == 0 and y > 19):
                        i -= 1.4
                    if hash2(block, y // 3, 80) < 0.2:
                        i -= 0.6
                    c.put(x, y, "stone", clamp(round(i), 1, 7))
    c.put(8, 19, "water", 5)
    c.put(9, 19, "water", 4)
    return c.outline().image(), (11, 27)
