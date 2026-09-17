"""Trees and bushes with volume: each canopy is lit as one dome and as its own leaf clumps, with dark hollows,
warm light through the lit edge and cool shade on the far side. Same sizes and anchors as kit.py."""
import math

from pal import Canvas, hash2, lambert, noise1, sway_image

LEAVES = ("leaf", "leaf2", "pine")


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def canopy(c, blobs, seed, lo=0.6, hi=6.6, spacing=5, rmin=3.0, rmax=4.8, ramp="leaf", warm="leaf2"):
    inside = lambda x, y: any(math.hypot(x - bx, y - by) <= r for bx, by, r in blobs)
    top = min(by - r for bx, by, r in blobs)
    bottom = max(by + r for bx, by, r in blobs)
    left = min(bx - r for bx, by, r in blobs)
    right = max(bx + r for bx, by, r in blobs)
    dcx, dcy = (left + right) / 2, (top + bottom) / 2
    drx, dry = (right - left) / 2 + 0.5, (bottom - top) / 2 + 0.5
    clumps = []
    for gy in range(int(top) - 2, int(bottom) + 3, spacing - 1):
        for gx in range(int(left) - 2, int(right) + 3, spacing):
            x = gx + (hash2(gx, gy, seed) - 0.5) * spacing * 0.9 + (gy // (spacing - 1)) % 2 * spacing / 2
            y = gy + (hash2(gx, gy, seed + 1) - 0.5) * spacing * 0.6
            if inside(x, y):
                clumps.append((x, y, rmin + hash2(gx, gy, seed + 2) * (rmax - rmin)))
    clumps.sort(key=lambda k: k[1])
    owner = {}
    for n, (cx, cy, r) in enumerate(clumps):
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                d = math.hypot(x - cx, y - cy)
                if d <= r and (inside(x, y) or d <= r * 0.7):
                    owner[(x, y)] = n
    for (x, y), n in owner.items():
        cx, cy, r = clumps[n]
        nx, ny = (x - cx) / r, (y - cy) / r
        nz = math.sqrt(max(0.0, 1 - nx * nx - ny * ny))
        local = lambert(nx, ny, nz)
        ex, ey = (x - dcx) / drx, (y - dcy) / dry
        ez = math.sqrt(max(0.0, 1 - ex * ex - ey * ey))
        dome = lambert(ex, ey, ez)
        v = 0.58 * local + 0.42 * dome + 0.04
        hollow = noise1(x, y, 3.2, seed + 9)
        if hollow < 0.28 and nx + ny > -0.2:
            v -= 0.22                                       # gaps between leaves, looking into the crown
        rim_d = math.hypot(nx, ny)
        if rim_d > 0.78 and nx + ny > 0.3:
            below = owner.get((x + (1 if nx > 0 else 0), y + 1))
            if below is not None and below != n:
                v = min(v, 0.02)                            # the clump's underside over the clump behind it
            else:
                v -= 0.2
        level = lo + clamp(v, 0, 1) * (hi - lo)
        edge = any((x + dx, y + dy) not in owner for dx, dy in ((-1, 0), (0, -1)))
        use = ramp
        if v > 0.86 or (edge and v > 0.7):
            use = warm                                      # sunlight through the lit edge warms toward yellow
            level -= 0.2
        c.put(x, y, use, level)
    for n, (cx, cy, r) in enumerate(clumps):                # leaf glints: small lit pairs on sunlit clumps
        lx, ly = round(cx - r * 0.45), round(cy - r * 0.55)
        ex, ey = (lx - dcx) / drx, (ly - dcy) / dry
        if ex + ey < 0.2 and hash2(n, seed, 4) < 0.7 and owner.get((lx, ly)) == n:
            c.put(lx, ly, warm, hi - 0.2)
            if owner.get((lx + 1, ly - 1)) == n:
                c.put(lx + 1, ly - 1, ramp, hi - 0.6)
    return owner


def bark(c, x0, x1, y0, y1, seed, flare_from=None):
    for y in range(y0, y1):
        f = 0
        if flare_from is not None and y >= flare_from:
            f = 1 + (y - flare_from) // 2
        for x in range(x0 - f, x1 + f):
            rel = (x - (x0 - f)) / max(x1 - x0 + 2 * f - 1, 1)
            level = 5.4 - rel * 3.6
            streak = noise1(x * 3.1, y, 5, seed)
            if streak < 0.3:
                level -= 1.4
            elif streak > 0.72:
                level += 0.6
            c.put(x, y, "wood", level)
            if rel > 0.6 and noise1(x, y, 3, seed + 3) > 0.58:
                c.put(x, y, "moss", 2.6 + (1 - rel) * 2)


def round_tree(seed=0):
    w, h = 40, 44
    c, cx = Canvas(w, h), w // 2
    j = lambda i: round((hash2(seed, i, 3) - 0.5) * 4)
    bark(c, cx - 2, cx + 3, 24, 41, seed * 13 + 1, flare_from=37)
    blobs = [(cx + j(1), 13, 9.5), (cx - 9 + j(2), 18, 7.5), (cx + 9 + j(3), 18, 7.5),
             (cx + j(4), 22, 8.5), (cx - 5, 9 + j(5) // 2, 6.5), (cx + 5, 9, 6.5)]
    owner = canopy(c, blobs, seed * 7 + 11)
    for x in range(cx - 4, cx + 5):                         # the crown's shade on the trunk top
        for y in range(26, 32):
            p = c.get(x, y)
            if p and p[0] in ("wood", "moss") and (x, y) not in owner:
                c.put(x, y, p[0], p[1] - (2.6 - (y - 26) * 0.4))
    c.outline()
    img = sway_image(c, lambda x, y, p: p[0] in LEAVES)
    img.info["sway"]["kind"] = "broadleaf"
    return img, (cx, h - 3)


def spruce(seed=0, big=False):
    w, h = (26, 44) if big else (22, 36)
    c, cx = Canvas(w, h), w // 2
    tiers = [(2, 12, 4), (7, 20, 6), (13, 28, 8)] + ([(20, 36, 11)] if big else [])
    trunk_top = tiers[-1][1] - 2
    bark(c, cx - 1, cx + 2, trunk_top, h - 2, seed * 5 + 2)
    for t, (top, bottom, half) in reversed(list(enumerate(tiers))):
        span = bottom - top
        for y in range(top, bottom + 3):
            prog = (y - top) / span
            hw = half * min(prog, 1) + (1 if (y - top) % 3 == 2 and y <= bottom else 0)
            for x in range(cx - math.ceil(hw) - 1, cx + math.ceil(hw) + 2):
                if abs(x - cx) > hw + 0.3:
                    continue
                rel = (x - cx) / max(hw, 1)
                drop = bottom + round(abs(rel) * 2.4) - (1 if (x + seed + t) % 3 == 0 else 0)
                if y > drop:
                    continue
                v = 0.66 - rel * 0.36 - prog * 0.26 + (0.1 if t == 0 else 0) - t * 0.02
                if abs(rel) < 0.3 and prog > 0.55:
                    v -= 0.2                                # the dark heart under each tier
                if (x + (y if x < cx else -y)) % 3 == 0 and abs(rel) > 0.12:
                    v -= 0.13                               # needle strokes slanting outward
                if y >= drop - 1:
                    v = min(v, 0.22)
                ramp = "pine"
                if rel < -0.55 and v > 0.62 and hash2(x, y, seed + t) < 0.18:
                    ramp, v = "leaf2", v + 0.05             # sunlit tips
                c.put(x, y, ramp, 0.5 + clamp(v, 0, 1) * 6.2)
        for x in range(cx - half, cx + half + 1):
            by = bottom + round(abs((x - cx) / max(half, 1)) * 2.4) + 1
            for dy, amt in ((0, 2.2), (1, 1.2), (2, 0.5)):
                p = c.get(x, by + dy)
                if p and p[0] in ("pine", "leaf2"):
                    c.put(x, by + dy, "pine", p[1] - amt)
    c.put(cx, 1, "leaf2", 5.5)
    c.put(cx - 1, 3, "leaf2", 6.4)
    c.outline()
    return sway_image(c, lambda x, y, p: p[0] in LEAVES), (cx, h - 2)


def bush(seed=0, berries=False):
    c = Canvas(18, 14)
    owner = canopy(c, [(6, 8, 5), (11, 8, 5), (9, 5, 4)], seed * 5 + 3, spacing=4, rmin=2.3, rmax=3.3)
    if berries:
        for k in range(6):
            x, y = 3 + int(hash2(seed, k, 1) * 12), 3 + int(hash2(seed, k, 2) * 8)
            if (x, y) in owner and (x + 1, y + 1) in owner:
                c.put(x, y, "red", 4.6)
                c.put(x + 1, y, "red", 3.2)
                c.put(x, y + 1, "red", 2.4)
                c.put(x + 1, y + 1, "red", 1.4)
                c.put(x, y, "pink", 4.6)
    return c.outline().image(), (9, 12)
