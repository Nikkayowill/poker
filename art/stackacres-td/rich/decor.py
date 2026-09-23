"""Small generated detail scattered over an area: leaf litter under broadleaf trees, mushrooms and ferns along
the tree lines, weeds at fence posts and building corners, pebbles along foundations, wildflowers in open
meadow, stones and cattails at the pond, and a few butterflies and a dragonfly.

Everything stays off roads, soil, water, zones, exits and tap targets, and every standing piece is under
16x16 so export.py lets people walk over it.
"""
import math

import numpy as np

import terrain
from pal import Canvas, hash2, lambert, sway_image

TAP_CLEARANCE = 22
FLOWER_KINDS = {"white": ("white", 6.0), "straw": ("straw", 5.4), "pink": ("pink", 4.4), "blue": ("blue", 4.6)}


# ------------------------------------------------------------------ flat litter (no outline)

def leaves(seed):
    c = Canvas(10, 7)
    tones = (("dry", 4.4), ("straw", 3.6), ("wood", 4.8), ("leaf2", 4.0), ("dry", 5.4), ("red", 3.4))
    for k in range(3 + int(hash2(seed, 0, 1) * 3)):
        x, y = 1 + int(hash2(seed, k, 2) * 7), 1 + int(hash2(seed, k, 3) * 4)
        ramp, lv = tones[int(hash2(seed, k, 4) * len(tones))]
        if hash2(seed, k, 5) < 0.5:
            c.put(x, y, ramp, lv + 1.2)
            c.put(x + 1, y, ramp, lv + 0.4)
            c.put(x + 1, y + 1, ramp, lv - 1.6)
        else:
            c.put(x, y, ramp, lv + 0.8)
            c.put(x, y + 1, ramp, lv - 0.4)
            c.put(x + 1, y + 1, ramp, lv - 1.8)
    return c.image(), (5, 6)


def twig(seed):
    c = Canvas(10, 6)
    flip = hash2(seed, 1, 6) < 0.5
    pts = []
    for i in range(8):
        x = (8 - i) if flip else (1 + i)
        y = 4 - i // 3
        pts.append((x, y))
        c.put(x, y, "wood", 4.4 if i % 3 else 3.2)
    fx, fy = pts[3]
    c.put(fx + (-1 if flip else 1), fy - 1, "wood", 5.0)
    c.put(fx, fy + 1, "wood", 1.6)
    return c.image(), (5, 5)


def pebbles(seed):
    c = Canvas(9, 5)
    for k in range(2 + int(hash2(seed, 0, 7) * 2)):
        x, y = int(hash2(seed, k, 8) * 6), int(hash2(seed, k, 9) * 2)
        c.put(x, y, "stone", 5.8)
        c.put(x + 1, y, "stone", 4.4)
        if hash2(seed, k, 10) < 0.4:
            c.put(x, y + 1, "stone", 4.0)
            c.put(x + 1, y + 1, "stone", 3.0)
            c.put(x + 2, y + 1, "stone", 1.4)
        else:
            c.put(x + 1, y + 1, "stone", 1.6)
    return c.image(), (4, 4)


def flower_patch(seed, kind):
    ramp, hi = FLOWER_KINDS[kind]
    c = Canvas(14, 11)
    for k in range(3 + int(hash2(seed, 0, 11) * 3)):
        x, y = 2 + int(hash2(seed, k, 12) * 10), 2 + int(hash2(seed, k, 13) * 6)
        c.put(x - 1, y + 2, "lush", 3.6)
        c.put(x + 1, y + 2, "lush", 2.6)
        c.put(x, y + 2, "grass", 1.6)
        c.put(x, y - 1, ramp, hi)
        c.put(x - 1, y, ramp, hi - 0.4)
        c.put(x + 1, y, ramp, hi - 1.5)
        c.put(x, y + 1, ramp, hi - 1.9)
        c.put(x, y, "gold", 4.6)
    return c.image(), (7, 10)


# ------------------------------------------------------------------ standing plants (outlined, under 16x16)

def mushrooms(seed):
    c = Canvas(12, 10)
    red = hash2(seed, 1, 20) < 0.45
    ramp = "red" if red else "wood"
    base = 8
    for k in range(2 + int(hash2(seed, 2, 21) * 2)):
        cx = 2 + k * 3 + int(hash2(seed, k, 22) * 2)
        tall = 1 + int(hash2(seed, k, 23) * 3)
        wide = hash2(seed, k, 24) < 0.5
        top = base - tall
        for y in range(top, base + 1):
            c.put(cx, y, "white", 5.0 - (y - top) * 0.3)
            if wide:
                c.put(cx + 1, y, "white", 3.2)
        span = range(cx - 2, cx + 3 + (1 if wide else 0))
        for x in span:
            rel = (x - span.start) / max(len(span) - 1, 1)
            c.put(x, top - 1, ramp, (4.2 if red else 3.4) - rel * 2.2)          # cap rim, shaded underside
            if span.start < x < span.stop - 1:
                c.put(x, top - 2, ramp, (5.6 if red else 5.0) - rel * 2.4)
            if span.start + 1 < x < span.stop - 2:
                c.put(x, top - 3, ramp, (6.0 if red else 5.6) - rel * 1.6)
        if red:
            c.put(cx - 1, top - 2, "white", 6.0)
            c.put(cx + 1, top - 3, "white", 5.4)
    return c.outline().image(), (6, 9)


def fern(seed):
    c = Canvas(14, 11)
    bx, by = 7, 10
    for k in range(5):
        ang = math.pi * (0.1 + 0.8 * k / 4) + (hash2(seed, k, 30) - 0.5) * 0.25
        length = 5.2 + hash2(seed, k, 31) * 1.6 - abs(k - 2) * 0.5
        for t in range(1, int(length) + 1):
            x = bx + math.cos(ang) * t * 1.15
            y = by - math.sin(ang) * t * 1.05 + t * t * 0.1
            lit = 5.0 - t * 0.3 - (1.1 if math.cos(ang) > 0.25 else 0)
            c.put(x, y, "lush" if k % 2 else "leaf", lit)
            if t % 2 == 0 and t < length - 0.5:
                c.put(x, y - 1, "leaf2", lit + 0.5)
    c.outline()
    return sway_image(c, lambda x, y, p: y < 8, rustle=True), (7, 10)


def weeds(seed):
    c = Canvas(11, 13)
    for x in range(2, 9):                                         # the clump's base, so blades read as one plant
        c.put(x, 12, "grass", 2.2 + (1 - abs(x - 5) / 4) * 0.8)
        if 3 <= x <= 7:
            c.put(x, 11, "grass", 3.0 - (x - 3) * 0.3)
    for k in range(5 + int(hash2(seed, 0, 40) * 2)):
        x0 = 3 + int(hash2(seed, k, 41) * 5)
        tall = 5 + int(hash2(seed, k, 42) * 6)
        lean = (x0 - 5) * 0.18 + (hash2(seed, k, 43) - 0.5) * 0.2
        ramp = "dry" if hash2(seed, k, 44) < 0.35 else "grass"
        for j in range(tall):
            c.put(x0 + lean * j, 12 - j, ramp, 2.6 + j * 3.2 / tall - (0.8 if x0 > 5 else 0))
        if hash2(seed, k, 45) < 0.5:
            tx, ty = x0 + lean * (tall - 1), 12 - tall
            c.put(tx, ty, "straw", 4.4)
            c.put(tx, ty - 1, "straw", 5.4)
    c.outline()
    return sway_image(c, lambda x, y, p: y < 10, rustle=True), (5, 12)


def flower_stalks(seed, kind):
    ramp, hi = FLOWER_KINDS[kind]
    c = Canvas(11, 12)
    for k in range(3):
        x = 2 + k * 3 + int(hash2(seed, k, 50) * 2)
        tall = 5 + int(hash2(seed, k, 51) * 4)
        for j in range(tall):
            c.put(x, 11 - j, "leaf", 2.4 + j * 0.35)
        mid = 11 - tall // 2
        c.put(x - 1, mid, "lush", 4.4)
        c.put(x + 1, mid + 1, "lush", 3.0)
        y = 11 - tall
        c.put(x, y - 1, ramp, hi)
        c.put(x - 1, y, ramp, hi - 0.4)
        c.put(x + 1, y, ramp, hi - 1.6)
        c.put(x, y + 1, ramp, hi - 2.0)
        c.put(x, y, "gold", 4.6)
    c.outline()
    return sway_image(c, lambda x, y, p: y < 9, rustle=True), (5, 11)


def cattails(seed):
    c = Canvas(14, 15)
    for k in range(3):
        x0, tall = 1 + k * 5, 4 + int(hash2(seed, k, 63) * 3)
        d = 1 if k % 2 else -1
        for j in range(tall):
            c.put(x0 + d * (j * j) // 9, 14 - j, "lush", 2.8 + j * 0.55)
    for k in range(4):
        x0 = 2 + k * 3 + int(hash2(seed, k, 60) * 2)
        tall = 8 + int(hash2(seed, k, 61) * 5)
        lean = (hash2(seed, k, 62) - 0.5) * 0.3
        for j in range(tall):
            c.put(x0 + lean * j, 14 - j, "grass", 2.4 + j * 2.8 / tall)
        hx, hy = x0 + lean * (tall - 3), 14 - tall
        for j in range(3):
            c.put(hx, hy + j, "wood", 3.8 - j * 0.7)
            c.put(hx + 1, hy + j, "wood", 2.0 - j * 0.3)
        c.put(hx, hy - 1, "grass", 4.6)
    c.outline()
    return sway_image(c, lambda x, y, p: y < 12, rustle=True), (7, 14)


def shore_stone(seed):
    c = Canvas(9, 6)
    for y in range(6):
        for x in range(9):
            nx, ny = (x - 4) / 3.9, (y - 3) / 2.7
            d = nx * nx + ny * ny
            if d <= 1:
                c.put(x, y, "stone", 2.0 + lambert(nx, ny * 1.3, math.sqrt(1 - d)) * 4.4 - (1.2 if y == 5 else 0))
    if hash2(seed, 0, 70) < 0.6:
        c.put(3, 1, "moss", 4.4)
        c.put(4, 1, "moss", 3.6)
        c.put(5, 1, "moss", 3.0)
    return c.outline().image(), (4, 5)


def grass_clump(seed):
    c = Canvas(9, 8)
    for k in range(5):
        x0 = 1 + k * 1.6 + hash2(seed, k, 80)
        tall = 3 + int(hash2(seed, k, 81) * 4)
        lean = -0.35 if k < 2 else 0.35 if k > 2 else 0
        for j in range(tall):
            c.put(x0 + lean * j, 7 - j, "grass", 2.4 + j * 3.4 / tall)
    c.outline()
    return sway_image(c, lambda x, y, p: y < 5, rustle=True), (4, 7)


# ------------------------------------------------------------------ animated

def butterfly(seed, kind):
    ramp, hi = FLOWER_KINDS[kind]
    phase = int(hash2(seed, 0, 90) * 4)
    frames = []
    for f in range(4):
        g = (f + phase) % 4
        c = Canvas(9, 15)
        cy = 5 + (0, -1, -2, -1)[g]
        spread = (2, 1, 0, 1)[g]
        c.put(4, cy, "ink", 0)
        c.put(4, cy + 1, "ink", 0)
        if spread == 2:
            for side, dim in ((-1, 0), (1, 0.9)):
                c.put(4 + side, cy - 1, ramp, hi - dim)
                c.put(4 + 2 * side, cy - 1, ramp, hi - 0.6 - dim)
                c.put(4 + side, cy, ramp, hi - 1.2 - dim)
                c.put(4 + 2 * side, cy, ramp, hi - 1.8 - dim)
                c.put(4 + side, cy + 1, ramp, hi - 2.2 - dim)
        elif spread == 1:
            c.put(3, cy - 1, ramp, hi)
            c.put(3, cy, ramp, hi - 1.4)
            c.put(5, cy - 1, ramp, hi - 0.8)
            c.put(5, cy, ramp, hi - 2.0)
        else:
            c.put(4, cy - 2, ramp, hi)
            c.put(4, cy - 1, ramp, hi - 1.0)
        frames.append((c.outline(rim=False).image(), (4, 14)))
    return frames


def dragonfly(seed):
    frames = []
    for f in range(4):
        c = Canvas(13, 14)
        cy, dx = 4 + (0, -1, 0, 1)[f], (0, 1, 1, 0)[f]
        for i in range(6):
            c.put(2 + i + dx, cy, "blue", 2.6 + i * 0.45)
        c.put(8 + dx, cy, "glass", 4.4)
        c.put(9 + dx, cy, "shutter", 4.4)
        up = f % 2 == 0
        wy = cy - 1 if up else cy + 1
        c.put(6 + dx, wy, "glass", 5.0)
        c.put(7 + dx, wy, "glass", 4.2)
        c.put(6 + dx, wy + (-1 if up else 1), "glass", 3.6)
        frames.append((c.outline(rim=False).image(), (6, 13)))
    return frames


# ------------------------------------------------------------------ placement

class Space:
    """Where decor may go: grass away from other ground, clear of zones, exits, tap targets and existing sprites."""

    def __init__(self, area):
        self.area = area
        ground = terrain.Ground(area)
        owner = ground.owner
        self.H, self.W = owner.shape
        grass = owner == 0
        self.wet = (owner == terrain.CODE["water"]) | (owner == terrain.CODE["stream"])
        self.pond = owner == terrain.CODE["water"]
        self.free = grass & ~terrain.dilate(~grass, 2)
        self.shore = grass & terrain.dilate(self.wet, 5) & ~terrain.dilate(self.wet, 2) & ~terrain.dilate(owner == terrain.CODE["path"], 3)
        self.block = np.zeros(owner.shape, bool)
        for _, x, y, w, h in area.zones:
            self._rect(x - 2, y - 2, w + 4, h + 4)
        for _, x, y, w, h, *_ in area.exits:
            self._rect(x, y, w, h)
        self.tap_bases = [(area.items[i][2], area.items[i][3]) for i in area.tags]
        self.tap_bases += [(x, y) for _, x, y in area.npcs]
        if area.spawn:
            self.tap_bases.append(area.spawn)
        self.boxes = []        # (x0, y0, x1, y1, kind) for every existing sprite
        for imgs, (ax, ay), bx, by, _, is_ground, name in area.items:
            w, h = imgs[0].size
            kind = "ground" if is_ground else "character" if name else ("tree" if (w, h) == (40, 44) or (w in (22, 26) and h in (36, 44))
                                             else "building" if w >= 34 and h >= 30
                                             else "fence" if (h == 12 and w >= 40) or w == 7 else "prop")
            self.boxes.append((bx - ax, by - ay, bx - ax + w, by - ay + h, kind, bx, by, imgs[0]))
        self.placed = []

    def _rect(self, x, y, w, h):
        self.block[max(0, y):max(0, y + h), max(0, x):max(0, x + w)] = True

    def fits(self, made, bx, by, standing, allow=(), on_shore=False, on_water=False, over_placed=False):
        img, (ax, ay) = made[0] if isinstance(made, list) else made
        w, h = img.size
        x0, y0 = bx - ax, by - ay
        if x0 < 0 or y0 < 0 or x0 + w > self.W or by + 2 > self.H:
            return False
        if any(math.hypot(bx - tx, by - ty) < TAP_CLEARANCE for tx, ty in self.tap_bases):
            return False
        foot = (slice(max(by - 2, 0), by + 1), slice(x0, x0 + w)) if standing else (slice(y0, y0 + h), slice(x0, x0 + w))
        if on_water:
            if not self.pond[foot].all():
                return False
        elif on_shore:
            if not (self.shore[by, bx] and not self.wet[foot].any()):
                return False
        elif not self.free[foot].all():
            return False
        if self.block[y0:y0 + h, x0:x0 + w].any():
            return False
        for bx0, by0, bx1, by1, kind, *_ in self.boxes:
            if kind in allow:
                continue
            if x0 < bx1 + 1 and bx0 - 1 < x0 + w and y0 < by1 + 1 and by0 - 1 < y0 + h:
                return False
        for px0, py0, px1, py1 in ([] if over_placed else self.placed):
            if x0 < px1 + 2 and px0 - 2 < x0 + w and y0 < py1 + 2 and py0 - 2 < y0 + h:
                return False
        return True

    def put(self, made, bx, by, ground):
        img, (ax, ay) = made[0] if isinstance(made, list) else made
        w, h = img.size
        self.area.add(made, bx, by, ground=ground)
        self.placed.append((bx - ax, by - ay, bx - ax + w, by - ay + h))


def decorate(area):
    sp = Space(area)
    counts = {}

    def place(name, made, bx, by, standing, **kw):
        if sp.fits(made, bx, by, standing, **kw):
            sp.put(made, bx, by, ground=not standing and not isinstance(made, list))
            counts[name] = counts.get(name, 0) + 1
            return True
        return False

    trees = [b for b in sp.boxes if b[4] == "tree"]
    for n, (_, _, _, _, _, bx, by, img) in enumerate(trees):
        s = bx * 31 + by * 17
        if img.size == (40, 44) and hash2(s, 1, 100) < 0.7:          # litter under broadleaf trees
            for k in range(2):
                dx, dy = int((hash2(s, k, 101) - 0.5) * 26), 2 + int(hash2(s, k, 102) * 6)
                made = twig(s + k) if hash2(s, k, 103) < 0.25 else leaves(s + k)
                place("leaves/twigs", made, bx + dx, by + dy, False, allow=("tree",))
        if hash2(s, 2, 104) < 0.45:                                  # mushrooms and ferns at the forest edge
            r = hash2(s, 4, 106)
            made = mushrooms(s) if r < 0.35 else fern(s) if r < 0.75 else grass_clump(s)
            side = -1 if hash2(s, 3, 105) < 0.5 else 1
            for dx, dy in ((side * 6, 15), (-side * 6, 15), (0, 18), (side * 12, 16)):
                if place("mushrooms/ferns", made, bx + dx, by + dy + int(hash2(s, 5, 107) * 3), True):
                    break

    for x0, y0, x1, y1, kind, bx, by, img in [b for b in sp.boxes if b[4] == "fence"]:
        horizontal = img.size[1] == 12
        posts = ([(x, by + 2) for x in range(x0 + 3, x1 - 3, 16)] if horizontal
                 else [(bx, y + 8) for y in range(y0, y1 - 6, 16)])
        for k, (px, py) in enumerate(posts):
            s = px * 13 + py * 7
            if hash2(s, k, 110) < 0.34:
                made = weeds(s) if hash2(s, k, 111) < 0.65 else flower_stalks(s, ("white", "straw", "pink", "blue")[k % 4])
                spots = ((px, py - 5), (px, py + 7)) if horizontal else ((px - 7, py), (px + 7, py))
                for sx, sy in spots:
                    if place("fence weeds", made, sx, sy, True, allow=("fence",)):
                        break

    for x0, y0, x1, y1, kind, bx, by, img in [b for b in sp.boxes if b[4] == "building"]:
        s = bx * 7 + by
        for corner, cx in enumerate((x0 - 7, x1 + 6)):              # corners: a weed or a flower clump
            made = flower_stalks(s + corner, ("pink", "straw")[corner]) if hash2(s, corner, 120) < 0.5 else weeds(s + corner)
            place("corner plants", made, cx, by + 2, True)
        for k, x in enumerate(range(x0 + 4, x1 - 4, 14)):           # foundation pebbles and grass
            if hash2(s, k, 121) < 0.55:
                made = pebbles(s + k) if hash2(s, k, 122) < 0.55 else grass_clump(s + k)
                standing = made[0].size != (9, 5)
                place("foundation", made, x + int(hash2(s, k, 123) * 6), y1 + 3 + int(hash2(s, k, 124) * 3), standing)

    # The open meadow: a few standing weeds and flower stalks, far apart. The flat patches and pebbles
    # that used to go here read as litter on a lawn (Kayo, 2026-09-23), so the ground itself stays clean.
    patches = []
    for cy in range(20, sp.H - 16, 40):
        for cx in range(20, sp.W - 16, 40):
            if hash2(cx, cy, 130) > 0.22:
                continue
            kind = ("white", "straw", "pink", "blue")[int(hash2(cx, cy, 133) * 4)]
            r = hash2(cx, cy, 134)
            for attempt in range(3):
                x = cx + int((hash2(cx, cy + attempt, 131) - 0.5) * 32)
                y = cy + int((hash2(cx + attempt, cy, 132) - 0.5) * 32)
                if r < 0.6:
                    ok = place("meadow weeds", weeds(cx * 3 + cy) if r < 0.3 else grass_clump(cx + cy), x, y, True)
                else:
                    ok = place("meadow flowers", flower_stalks(cx + cy * 3, kind), x, y, True)
                    if ok:
                        patches.append((x, y, kind))
                if ok:
                    break

    by_pond = terrain.dilate(sp.pond, 5)
    ys, xs = np.nonzero(sp.shore & by_pond)                          # the pond edge
    near_pond = [(int(x), int(y)) for x, y in zip(xs, ys)]
    near_pond.sort(key=lambda p: hash2(p[0], p[1], 140))
    stones = cats = 0
    for x, y in near_pond:
        if stones < 4 and place("shore stones", shore_stone(x + y), x, y, True, on_shore=True):
            stones += 1
        elif cats < 2 and place("cattails", cattails(x * 3 + y), x, y, True, on_shore=True):
            cats += 1
        if stones >= 4 and cats >= 2:
            break

    for k, (x, y, kind) in enumerate(patches[1::max(len(patches) // 3, 1)][:3]):  # butterflies over flower patches
        place("butterflies", butterfly(x + y, ("straw", "white")[k % 2]), x + 6, y + 2, True, allow=("ground",), over_placed=True)
    pys, pxs = np.nonzero(terrain.depth(sp.pond, 12) >= 10)
    for i in np.argsort([hash2(int(a), int(b), 150) for a, b in zip(pxs, pys)]):
        if place("dragonfly", dragonfly(int(pxs[i])), int(pxs[i]), int(pys[i]), True, on_water=True):
            break
    return counts
