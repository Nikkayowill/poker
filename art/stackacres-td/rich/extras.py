"""The Homestead's remaining sprites in the rich palette: gates, the bridge, smoke, the cart, the greenhouse
footing, the loose board and the four crops. Same signatures, canvas sizes and anchors as the rig originals
(props.py, kit.py, crops.py), so they drop into the same layout."""
import math

import crops as rig_crops
from pal import TOP, Canvas, hash2, lambert
from sprites import faceted


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ------------------------------------------------------------------ helpers

def clumps(c, blobs, ramp, seed, lo=1.0, hi=5.5, spacing=5, rmin=2.6, rmax=4.2, jag=0.0, keep=None):
    """Foliage built from small lit clumps inside the union of `blobs`; lower clumps sit in front.
    `jag` nibbles the clump rims into pointed leaves. `keep(x, y)` limits where leaves may go."""
    inside = lambda x, y: any(math.hypot(x - bx, y - by) <= r for bx, by, r in blobs)
    top = min(by - r for bx, by, r in blobs)
    bottom = max(by + r for bx, by, r in blobs)
    left = min(bx - r for bx, by, r in blobs)
    right = max(bx + r for bx, by, r in blobs)
    found = []
    for gy in range(int(top) - 2, int(bottom) + 3, spacing - 1):
        for gx in range(int(left) - 2, int(right) + 3, spacing):
            x = gx + (hash2(gx, gy, seed) - 0.5) * spacing * 0.9 + (gy // (spacing - 1)) % 2 * spacing / 2
            y = gy + (hash2(gx, gy, seed + 1) - 0.5) * spacing * 0.6
            if inside(x, y):
                found.append((x, y, rmin + hash2(gx, gy, seed + 2) * (rmax - rmin)))
    found.sort(key=lambda k: k[1])
    height = max(bottom - top, 1)
    for cx, cy, r in found:
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                d = math.hypot(x - cx, y - cy)
                if d > r or (not inside(x, y) and d > r * 0.7):
                    continue
                if keep and not keep(x, y):
                    continue
                if jag and d > r - 1.2 and hash2(x, y, seed + 7) < jag:
                    continue
                nx, ny = (x - cx) / r, (y - cy) / r
                nz = math.sqrt(max(0.0, 1 - nx * nx - ny * ny))
                glob = 1 - (y - top) / height
                v = 0.52 * lambert(nx, ny, nz) + 0.3 * glob + 0.18 * (1 - (x - left) / max(right - left, 1))
                level = lo + v * (hi - lo + 0.6)
                if d > r - 1.1 and nx + ny > 0.35:
                    level = lo - 0.3
                elif d > r - 1.3 and nx + ny < -0.7 and hash2(x, y, seed + 3) < 0.6:
                    level += 0.9
                c.put(x, y, ramp, clamp(level, 0.3, TOP[ramp]))
    return found


def boulder(c, cx, cy, rx, ry, seed, moss=True):
    """A chiselled boulder: facet-flattened normals, a crack, moss on the lit crown."""
    for y in range(int(cy - ry) - 2, int(cy + ry) + 3):
        for x in range(int(cx - rx) - 2, int(cx + rx) + 3):
            ang = math.atan2(y - cy, x - cx)
            bump = 1 + 0.09 * math.sin(3 * ang + seed) + 0.05 * math.sin(5 * ang + seed * 2)
            nx, ny = (x - cx) / (rx * bump), (y - cy) / (ry * bump)
            d = nx * nx + ny * ny
            if d > 1:
                continue
            facet = round(ang / (math.pi / 3)) * (math.pi / 3)
            fx, fy = math.cos(facet), math.sin(facet)
            k = min(1.0, math.sqrt(d) * 1.25)
            mx, my = nx * (1 - 0.55 * k) + fx * 0.55 * k * math.sqrt(d), ny * (1 - 0.55 * k) + fy * 0.55 * k * math.sqrt(d)
            nz = math.sqrt(max(0.0, 1 - mx * mx - my * my))
            level = 1.6 + lambert(mx, my * 1.25, nz) * 4.6
            if ny > 0.62:
                level = min(level, 1.6)
            if hash2(x, y, seed + 40) < 0.12:
                level += 0.45 if hash2(x, y, seed + 41) < 0.5 else -0.45
            c.put(x, y, "stone", clamp(level, 0.6, 6.6))
    for k in range(int(rx * 0.5)):
        c.put(cx + 1 + k, cy - ry * 0.3 + k * 0.6, "stone", 1.0)
        c.put(cx + k, cy - ry * 0.3 + k * 0.6, "stone", 5.2)
    if moss:
        for y in range(int(cy - ry), int(cy - ry * 0.25)):
            for x in range(int(cx - rx), int(cx + rx * 0.3)):
                p = c.get(x, y)
                if p and p[0] == "stone" and hash2(x // 2, y // 2, seed + 50) < 0.42:
                    c.put(x, y, "moss", 3.4 + hash2(x, y, seed + 51) * 1.8)


def wood_board(c, x0, y0, w, h, seed, base=4.2, ramp="wood", vertical=True):
    """One board: lit leading edge, shaded trailing edge, grain streaks and the odd knot."""
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            across = (x - x0) if vertical else (y - y0)
            span = w if vertical else h
            level = base + (1.1 if across == 0 else -1.6 if across == span - 1 else 0)
            along = y if vertical else x
            if 0 < across < span - 1 and hash2(across + seed * 3, along // 3, seed) < 0.3:
                level -= 0.6
            if hash2(x, y, seed + 9) < 0.06:
                level += 0.5
            c.put(x, y, ramp, level)
    if w * h > 30 and hash2(seed, 1, 99) < 0.6:
        kx = x0 + (w // 2 if vertical else int(hash2(seed, 2, 99) * (w - 2)) + 1)
        ky = y0 + (int(hash2(seed, 3, 99) * (h - 2)) + 1 if vertical else h // 2)
        c.put(kx, ky, ramp, base - 2.2)
        c.put(kx - 1, ky - 1, ramp, base + 0.8)


# ------------------------------------------------------------------ gates

def brambles():
    """The west trail's block: a dark mound of bramble leaves, a few arched thorny canes, blackberry clusters."""
    c = Canvas(46, 24)
    clumps(c, [(10, 15, 7), (20, 13, 8), (31, 15, 7), (38, 17, 5), (15, 9, 5), (26, 8, 5)],
           "leaf", 211, lo=0.6, hi=4.4, spacing=5, rmin=3.0, rmax=4.4, jag=0.15)
    for x0, peak, x1, base in ((4, 3, 17, 13), (15, 1, 30, 10), (27, 4, 42, 14)):   # canes arching over the mound
        n = (x1 - x0) * 2
        for t in range(n + 1):
            u = t / n
            x = x0 + (x1 - x0) * u
            y = base - (base - peak) * math.sin(math.pi * u) * (1.1 - 0.2 * u)
            c.put(x, y, "barnred", 2.6)
            c.put(x, y + 1, "barnred", 0.9)
            if t % 6 == 3:
                c.put(x, y - 1 if (t // 6) % 2 else y + 2, "dry", 5.4)             # thorns
    for i, (x, y) in enumerate(((12, 12), (22, 16), (30, 11), (36, 16), (8, 17), (19, 8))):
        ripe = i not in (2, 5)
        r = "blue" if ripe else "red"
        for dx, dy, lv in ((0, 0, 1.6), (1, 0, 1.2), (0, 1, 1.0), (1, 1, 0.6), (-1, 1, 1.3), (0, 2, 0.8)):
            c.put(x + dx, y + dy, r, lv if ripe else lv + 1.8)
        c.put(x, y, "white" if ripe else r, 5.4 if ripe else 4.8)
        c.put(x + 1, y - 1, "leaf", 4.0)
    for x, y in ((25, 13), (40, 13)):                                                 # two white flowers
        for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
            c.put(x + dx, y + dy, "white", 6.0 if dx + dy < 0 else 5.0)
        c.put(x, y, "gold", 4.2)
    return c.outline().image(), (23, 22)


def rockfall():
    """The hill trail's block: chiselled boulders heaped back to front, dark crevices, scree at the foot."""
    c = Canvas(54, 30)
    stones = ((44, 10, 7, 5), (8, 11, 6, 4.5), (26, 12, 11, 8), (14, 20, 12, 7), (38, 21, 13, 7))
    owner = {}
    for i, (cx, cy, rx, ry) in enumerate(stones):
        drawn = faceted(c, cx, cy, rx, ry, seed=17 + i * 5, facets=7, lichen=0.3 if i < 3 else 0.12, flat_bottom=0.8)
        for p in drawn:
            owner[p] = i
    for (x, y), i in list(owner.items()):                       # crevices: the back stone darkens where a front one meets it
        for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1)):
            j = owner.get((x + dx, y + dy))
            if j is not None and j > i:
                c.put(x, y, "stone", 0.3)
                bx, by = x - dx, y - dy
                if owner.get((bx, by)) == i:
                    p = c.get(bx, by)
                    c.put(bx, by, p[0], max(0.6, p[1] - 1.6))
                break
    for x, y, big in ((3, 25, True), (25, 26, False), (29, 24, False), (51, 26, True), (20, 27, False), (46, 27, False)):
        cells = ((0, 0, 5.8), (1, 0, 4.6), (0, 1, 3.4), (1, 1, 1.6)) if not big else \
            ((0, 0, 6.0), (1, 0, 5.2), (2, 0, 3.8), (0, 1, 4.0), (1, 1, 3.0), (2, 1, 1.4))
        for dx, dy, lv in cells:
            c.put(x + dx, y + dy, "stone", lv)
    for i in range(18):                                          # dust and grit spilling out
        x, y = 2 + int(hash2(i, 0, 61) * 50), 26 + int(hash2(i, 1, 61) * 3)
        if not c.get(x, y) and c.get(x, y - 1):
            c.put(x, y, "dirt", 4.2 + hash2(i, 2, 61) * 1.4)
    return c.outline().image(), (27, 28)


def hedge_overgrown():
    """Hen Haven's back gate, swallowed by a hedge: two old posts and a broken rail show through."""
    c = Canvas(38, 32)
    clumps(c, [(8, 22, 8), (19, 20, 9), (30, 22, 8), (13, 12, 7), (25, 11, 7), (19, 6, 5)],
           "lush", 301, lo=1.0, hi=5.4, spacing=5, rmin=2.6, rmax=3.8, jag=0.25)
    for px in (3, 32):
        wood_board(c, px, 6, 3, 24, seed=px, base=3.6, ramp="greywood")
        c.put(px, 6, "greywood", 6.2)
        c.put(px + 1, 6, "greywood", 5.4)
        c.put(px + 2, 6, "greywood", 4.0)
        for y in range(9, 28, 5):                               # ivy climbing the post
            c.put(px + (y // 5) % 3, y, "leaf", 4.6)
            c.put(px + (y // 5 + 1) % 3, y + 1, "leaf", 3.2)
    for x in range(6, 32):
        if 12 < x < 17 or 23 < x < 26:
            continue
        c.put(x, 15, "greywood", 5.4)
        c.put(x, 16, "greywood", 3.8)
        c.put(x, 17, "greywood", 1.6)
    clumps(c, [(9, 26, 5), (27, 27, 5), (18, 15, 4), (6, 12, 3), (31, 13, 3)],
           "lush", 303, lo=1.2, hi=5.6, spacing=4, rmin=2.2, rmax=3.2, jag=0.2)
    for i, (x, y) in enumerate(((11, 9), (24, 18), (15, 24), (29, 12), (20, 4))):
        c.put(x, y, "white", 6.0)
        c.put(x + 1, y, "white", 4.6)
        c.put(x, y + 1, "white", 4.2)
        c.put(x + 1, y + 1, "gold", 4.0)
    return c.outline().image(), (19, 30)


def boardwalk_washed():
    """The shore road's block: a boardwalk over a tide creek with two planks gone and one sunk."""
    c = Canvas(48, 28)
    planks = [(i, x) for i, x in enumerate(range(4, 44, 5)) if i not in (2, 5)]
    covered = set()
    for i, x in planks:
        dy = 3 if i == 4 else 0
        for y in range(6 + dy, 22 + dy):
            for xx in range(x, x + 4):
                covered.add((xx, y))
    for y in range(10, 22):                                     # the creek
        for x in range(48):
            level = 3.4 + (1.2 if y == 10 else 0.5 if y == 11 else 0) - (0.9 if y > 19 else 0)
            if (x - 1, y) in covered or (x - 2, y) in covered or (x - 1, y - 1) in covered:
                level -= 1.6                                    # planks shade the water to their right
            cell = (x + int(hash2(y, 0, 88) * 7)) // 7
            if y in (13, 16, 19) and hash2(cell, y, 89) < 0.45 and (x + int(hash2(y, 0, 88) * 7)) % 7 < 3:
                level += 1.3
            c.put(x, y, "water", level)
    for x in (2, 44):
        wood_board(c, x, 4, 2, 22, seed=x + 40, base=2.8)
        c.put(x, 4, "wood", 5.4)
        for y in range(18, 26):
            c.shift(x, y, -1.1)
        c.put(x - 1, 12, "water", 7)
        c.put(x + 2, 12, "water", 6.2)
        c.put(x, 21, "moss", 4.2)
    for i, x in planks:
        sunk = i == 4
        dy = 3 if sunk else 0
        wood_board(c, x, 6 + dy, 4, 16, seed=i * 7 + 3, base=2.6 if sunk else 4.3)
        for xx in range(x, x + 4):
            c.put(xx, 6 + dy, "wood", 3.6 if sunk else 6.0)
            c.put(xx, 21 + dy, "wood", 1.2)
        for ny in (8, 19):
            c.put(x + 1, ny + dy, "stone", 5.8 if not sunk else 3.6)
        if not sunk:
            c.put(x - 1, 10, "water", 7)
            c.put(x + 4, 21, "water", 6.6)
        else:
            for xx in range(x, x + 4):
                if 10 <= 17 + (xx - x) % 2 < 22:
                    c.put(xx, 18 + (xx - x) % 2, "water", 5.6)
    for (x, y), level in (((15, 20), 5.4), ((16, 20), 4.2), ((15, 21), 1.8)):
        c.put(x, y, "wood", level)
    for (x, y), level in (((31, 3), 2.0), ((30, 4), 5.6), ((31, 4), 4.0)):
        c.put(x, y, "wood", level)
    return c.outline().image(), (24, 26)


# ------------------------------------------------------------------ bridge, smoke

def bridge(length=32):
    """Planks across a stream with a rail each side; the deck runs left to right."""
    w, h = length + 8, 22
    c = Canvas(w, h)
    for i, x in enumerate(range(2, w - 2, 4)):
        wood_board(c, x, 6, min(4, w - 2 - x), 10, seed=i * 5 + 11, base=4.3 + (hash2(i, 0, 77) - 0.5) * 0.9)
        for ny in (7, 14):
            c.put(x + 1, ny, "stone", 5.8)
            c.put(x + 1, ny + 1, "wood", 2.4)
    for x in range(2, w - 2):
        c.put(x, 6, "wood", 2.0)                                # the top rail's shadow on the deck
        c.put(x, 7, "wood", c.get(x, 7)[1] - 0.8 if c.get(x, 7)[0] == "wood" else 3.0)
        c.put(x, 15, "wood", 2.4)
        c.put(x, 16, "wood", 1.2)
    for y in (2, 18):
        for x in range(1, w - 1):
            grain = -0.5 if hash2(x // 3, y, 81) < 0.25 else 0
            c.put(x, y, "wood", 6.0 + grain)
            c.put(x, y + 1, "wood", 4.4 + grain)
            c.put(x, y + 2, "wood", 1.6)
    for x in range(1, w - 1, 12):
        for y in list(range(1, 7)) + list(range(17, 22)):
            c.put(x, y, "wood", 4.6)
            c.put(x + 1, y, "wood", 2.2)
        c.put(x, 1, "wood", 6.4)
        c.put(x + 1, 1, "wood", 5.0)
        c.put(x, 17, "wood", 6.2)
    return c.outline().image(), (w // 2, 20)


FRAMES = 4


def smoke():
    """Chimney smoke: three puffs rising, swelling and thinning, on a four-frame loop."""
    frames = []
    for f in range(FRAMES):
        c = Canvas(16, 26)
        for i in range(3):
            t = (i * 4 + f) % 12
            y = 22 - t * 1.6
            x = 7 + 2 * math.sin(t * 0.8 + i * 2)
            r = 1.8 + t / 3.2
            thin = max(0.0, (t - 8) / 10)
            for py in range(int(y - r) - 1, int(y + r) + 2):
                for px in range(int(x - r) - 1, int(x + r) + 2):
                    d = math.hypot(px - x, py - y)
                    if d > r:
                        continue
                    if thin and d > r * 0.72 and hash2(px, py + t, 90 + i) < thin:
                        continue
                    nx, ny = (px - x) / r, (py - y) / r
                    lit = lambert(nx, ny, math.sqrt(max(0.0, 1 - nx * nx - ny * ny)))
                    level = 3.4 + lit * 2.6 - thin * 0.6
                    c.put(px, py, "white" if level > 3.6 else "stone", level if level > 3.6 else level + 1.2)
        frames.append((c.image(), (8, 24)))
    return frames


# ------------------------------------------------------------------ farm leftovers

def broken_cart():
    """Town Square's block: a tipped cart with a wheel off, a snapped shaft and spilled grain."""
    w, h = 50, 32
    c = Canvas(w, h)
    for y in range(8, 22):                                      # the bed's rim, then the side panel, tilting
        tilt = (y - 8) // 3
        for x in range(4 + tilt, 34 + tilt):
            if y < 11:
                level = 6.0 if y == 8 else 4.8 if y == 9 else 3.0
            else:
                board = (y - 11) // 4
                ry = (y - 11) % 4
                level = 4.2 - board * 0.5 + (0.8 if ry == 0 else -1.8 if ry == 3 else 0)
                if 0 < ry < 3 and hash2((x - tilt) // 5 + board * 7, ry, 71) < 0.3:
                    level -= 0.7
            c.put(x, y, "wood", level)
    for x in (4, 18, 32):                                       # three uprights
        for y in range(8, 22):
            tilt = (y - 8) // 3
            c.put(x + tilt, y, "wood", 5.2)
            c.put(x + tilt + 1, y, "wood", 3.6)
            c.put(x + tilt + 2, y, "wood", 1.6)
    for (x, y) in ((5, 11), (33, 11), (8, 20), (36, 20)):       # iron corner straps
        c.put(x, y, "stone", 4.6)
        c.put(x, y + 1, "stone", 2.6)
    for x in range(30, 46):                                     # the snapped shaft
        c.put(x, 22, "wood", 5.4)
        c.put(x, 23, "wood", 2.6)
    for x, y in ((46, 21), (46, 22), (47, 23)):
        c.put(x, y, "dry", 6.0)
    cx, cy = 14, 24                                             # the wheel on its side
    for y in range(cy - 4, cy + 5):
        for x in range(cx - 7, cx + 8):
            d = ((x - cx) / 6.5) ** 2 + ((y - cy) / 3.4) ** 2
            if 0.62 <= d <= 1.05:
                top = y <= cy
                c.put(x, y, "stone" if d > 0.86 else "wood", (5.2 if top else 2.6) if d > 0.86 else (4.4 if top else 2.4))
    for a in range(4):
        ang = a * math.pi / 4
        for k in (1, 2, 3):
            c.put(cx + round(math.cos(ang) * k * 1.4), cy + round(math.sin(ang) * k * 0.75), "wood", 4.0)
            c.put(cx - round(math.cos(ang) * k * 1.4), cy - round(math.sin(ang) * k * 0.75), "wood", 3.2)
    c.rect(cx - 1, cy - 1, 3, 2, "stone", 3.8)
    c.put(cx - 1, cy - 1, "stone", 6.0)
    for y in range(26, 29):                                     # a small crate thrown clear
        for x in range(38, 42):
            edge = y in (26, 28) or x in (38, 41)
            c.put(x, y, "wood", (5.6 if y == 26 or x == 38 else 2.6) if edge else 1.8)
    for i, (x, y) in enumerate(((22, 26), (23, 26), (25, 26), (23, 27), (24, 27), (25, 27), (21, 27), (26, 28), (20, 28))):
        c.put(x, y, "straw", 5.4 - (y - 26) * 0.9 + hash2(i, 0, 72) * 0.6)
    return c.outline().image(), (24, 29)


def greenhouse_ruin():
    """Where the greenhouse will stand: a broken stone footing with lit tops, shaded faces and shadow on the grass,
    corner pillars, rubble in the gaps, weeds, glass shards and a rusted frame bar. Ground-level, no outline."""
    w, h = 82, 58
    c = Canvas(w, h)

    def gap_h(x):
        return (x // 9) % 4 == 3

    def gap_v(y):
        return (y // 9) % 3 == 2

    for x in range(2, w - 2):                                    # top and bottom walls: two rows of top, one of face
        for y0 in (2, h - 6):
            if gap_h(x):
                continue
            block = (x + (3 if y0 > 10 else 0)) // 6
            seam = (x + (3 if y0 > 10 else 0)) % 6 == 5
            v = (hash2(block, y0, 401) - 0.5) * 0.9
            end = gap_h(x + 1) or gap_h(x - 1)
            for k, lv in enumerate((6.0, 5.2, 3.0)):
                level = lv + v - (1.5 if seam else 0) - (0.8 if end and k < 2 else 0)
                c.put(x, y0 + k, "stone", level)
            c.put(x, y0 + 3, "grass", 1.4)
            if hash2(x, y0, 402) < 0.18:
                c.put(x, y0, "moss", 3.8 + hash2(x, y0, 403) * 1.2)
    for y in range(5, h - 6):                                    # side walls: top faces lit, right face shaded
        for x0 in (2, w - 5):
            if gap_v(y):
                continue
            block = (y + (2 if x0 > 10 else 0)) // 5
            seam = (y + (2 if x0 > 10 else 0)) % 5 == 4
            v = (hash2(block, x0, 404) - 0.5) * 0.9
            for k, lv in enumerate((6.0, 5.0, 2.6)):
                c.put(x0 + k, y, "stone", lv + v - (1.5 if seam else 0))
            c.put(x0 + 3, y, "grass", 1.6)
            if gap_v(y + 1):
                for k in range(3):
                    c.put(x0 + k, y, "stone", 3.0 + v)            # the broken end's face
            if hash2(x0, y, 405) < 0.15:
                c.put(x0, y, "moss", 3.8 + hash2(x0, y, 406) * 1.2)
    for px, py in ((1, 1), (w - 7, 1), (1, h - 8), (w - 7, h - 8)):   # corner pillars
        for y in range(py, py + 6):
            for x in range(px, px + 6):
                if y < py + 4:
                    level = 6.2 - (x - px) * 0.25 - (y - py) * 0.2
                    if x == px + 3 or y == py + 2:
                        level -= 1.2
                else:
                    level = 3.2 if y == py + 4 else 2.2
                c.put(x, y, "stone", level)
        for x in range(px, px + 6):
            c.put(x, py + 6, "grass", 1.2)
        for y in range(py + 1, py + 7):
            c.put(px + 6, y, "grass", 1.5)
    for x, y in ((35, 1), (37, 5), (70, 55), (0, 20), (79, 38), (60, 2), (5, 44), (44, 54)):   # rubble in the gaps
        for dx, dy, lv in ((0, 0, 5.8), (1, 0, 4.4), (0, 1, 3.2), (1, 1, 1.6)):
            c.put(x + dx, y + dy, "stone", lv)
        c.put(x + 2, y + 1, "grass", 1.6)
    for x, y in ((14, 12), (30, 30), (55, 18), (64, 40), (22, 44), (44, 24), (7, 30), (74, 12), (40, 50)):   # weeds
        for dx, dy, lv, r in ((1, 0, 6.2, "dry"), (3, 0, 5.4, "grass"), (0, 1, 4.6, "grass"), (2, 1, 4.4, "grass"),
                              (1, 2, 2.4, "grass"), (2, 2, 2.0, "grass"), (4, 1, 3.4, "grass"), (1, 3, 1.4, "grass")):
            c.put(x + dx, y + dy, r, lv)
    for x, y in ((40, 8), (61, 49), (18, 30), (68, 22)):          # glass shards
        c.put(x, y, "white", 6.4)
        c.put(x + 1, y, "glass", 4.6)
        c.put(x, y + 1, "glass", 3.6)
        c.put(x + 1, y + 1, "glass", 2.4)
        c.put(x + 2, y + 1, "grass", 1.6)
    for k in range(14):                                          # a rusted frame bar
        x, y = 20 + k, 14 + k * 0.45
        c.put(x, y, "stone", 4.0)
        c.put(x, y + 1, "stone", 1.8)
        if hash2(k, 0, 407) < 0.35:
            c.put(x, y, "dirt", 3.4)
        c.put(x + 1, y + 2, "grass", 1.6)
    for y in range(12, 19):
        c.put(26, y, "stone", 3.4 if y % 2 else 2.4)
    return c.image(), (w // 2, h - 2)


def loose_board():
    """The secret: one board hanging off its nail, a little askew."""
    c = Canvas(8, 18)
    for y in range(1, 17):
        off = 1 if y < 6 else 0
        for x in range(2, 6):
            level = 5.6 if x == 2 else 2.2 if x == 5 else 4.4
            if x in (3, 4) and hash2(x, y // 3, 501) < 0.3:
                level -= 0.7
            c.put(x + off - (1 if x == 5 and off else 0) * 0, y, "wood", level)
    c.put(3, 5, "stone", 6.0)
    c.put(3, 6, "wood", 2.0)
    c.put(3, 13, "stone", 5.4)
    c.put(3, 14, "wood", 2.4)
    c.put(4, 9, "wood", 2.0)
    c.put(4, 10, "wood", 2.4)
    return c.outline().image(), (4, 17)


# ------------------------------------------------------------------ crops

PRODUCE = {
    "carrot": ("gold", "oTN", 1.3, 2.9),
    "potato": ("wood", "oTN", 3.9, 6.3),
    "radish": ("red", "RWP", 2.6, 4.6),
    "wheat": ("straw", "YWoT", 2.8, 5.2),
}


def sprout(name):
    """A seedling's first pair of leaves on a short stem."""
    c = Canvas(5, 4)
    c.put(1, 1, "leaf2", 5.6)
    c.put(3, 1, "leaf2", 4.8)
    c.put(1, 2, "leaf", 3.8)
    c.put(3, 2, "leaf", 2.8)
    c.put(2, 2, "red" if name == "radish" else "leaf", 3.2 if name == "radish" else 2.6)
    return c.outline().image(), (2, 3)


def potatoes(c):
    """Two tubers and a small one pushed up out of the soil: lit top-left, an eye, a crumb of earth."""
    big = ((".ab.", 0), ("cdde", 1), (".ff.", 2))
    level = {"a": 6.2, "b": 5.4, "c": 5.0, "d": 4.4, "e": 3.0, "f": 2.4}
    for ox, oy in ((1, 10), (9, 10)):
        for row, dy in big:
            for dx, ch in enumerate(row):
                if ch != ".":
                    c.put(ox + dx, oy + dy, "dirt", level[ch])
        c.put(ox + 2, oy + 1, "dirt", 2.6)
        c.put(ox + 3, oy + 2, "soil", 2.0)
    for dx, dy, lv in ((0, 0, 5.6), (1, 0, 4.4), (0, 1, 3.8), (1, 1, 2.4)):
        c.put(6 + dx, 11 + dy, "dirt", lv)
    c.put(6, 10, "leaf", 2.4)
    c.put(7, 10, "leaf", 2.0)


def crop(name, stage):
    """Each crop keeps the rig's silhouette; the leaves and the produce are shaded as solid forms."""
    if stage == 0:
        return sprout(name)
    rows = rig_crops.CROPS[name][stage]
    w, h = len(rows[0]) + 2, len(rows) + 2
    c = Canvas(w, h)
    ramp, chars, lo, hi = PRODUCE[name]
    cells = {(i + 1, j + 1): k for j, row in enumerate(rows) for i, k in enumerate(row) if k != "."}
    if name == "potato" and stage == 2:
        cells = {p: k for p, k in cells.items() if k not in "ToN"}
    leaf_rows = [y for (x, y), k in cells.items() if k in "vG"]
    ltop, lbot = (min(leaf_rows), max(leaf_rows)) if leaf_rows else (0, 1)
    produce = {p: k for p, k in cells.items() if k not in "vG" and not (name == "potato" and k in "WY" and p[1] < ltop + 3)}
    if name == "wheat":
        produce = {p: k for p, k in cells.items() if k in "YWoT"}
    ys = [y for _, y in produce] or [0]
    ptop, pbot = min(ys), max(ys)

    for (x, y), k in cells.items():
        if k in "vG":
            level = (4.5 if k == "v" else 3.5) + (1 - (y - ltop) / max(lbot - ltop, 1)) * 1.1 - 0.55
            if x < w / 2:
                level += 0.3
            c.put(x, y, "leaf", level)
        elif (x, y) in produce:
            row_x = [px for (px, py) in produce if py == y]
            mid = (min(row_x) + max(row_x)) / 2
            half = max((max(row_x) - min(row_x)) / 2, 1)
            nx = (x - mid) / (half + 0.5)
            ny = (y - ptop) / max(pbot - ptop, 1) * 2 - 1
            light = 0.62 - nx * 0.42 - ny * 0.3
            level = lo + light * (hi - lo)
            if name == "wheat":
                if k == "T":
                    level = 3.2 + (0.8 if x % 2 else 0)
                elif k == "W":
                    level = hi + 0.6
                elif k == "o":
                    level = lo + 0.2
                elif (x + y) % 2 == 0:
                    level += 0.5
            elif name == "carrot":
                if k == "T":
                    level += 0.35
                if (y - ptop) % 2 == 1 and nx > -0.4:
                    level -= 0.35
                if k == "N":
                    level = lo - 0.2
            elif name == "potato":
                blob = [p for p in produce if abs(p[0] - x) <= 2 and abs(p[1] - y) <= 2]
                bx = sum(p[0] for p in blob) / len(blob)
                by = sum(p[1] for p in blob) / len(blob)
                light = 0.62 - (x - bx) * 0.3 - (y - by) * 0.35
                level = lo + light * (hi - lo)
                if k == "N":
                    level = lo - 1.2
            elif name == "radish":
                if k == "W" and y > (ptop + pbot) / 2:
                    c.put(x, y, "white", 5.0)
                    continue
                if k == "W":
                    level = hi + 0.9
                if k == "P":
                    level = lo - 0.6
            c.put(x, y, ramp, level)
        elif name == "potato" and k in "WY":
            c.put(x, y, "white" if k == "W" else "gold", 5.8 if k == "W" else 3.6)
    if name == "potato" and stage == 2:
        potatoes(c)
    return c.outline().image(), (w // 2, h - 1)
