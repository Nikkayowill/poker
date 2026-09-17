"""Per-pixel textured terrain from an Area's vertex grid. Not tiled: the game pre-renders ground per area anyway."""
import numpy as np
from PIL import Image

from pal import RID, fbm, hash2, hash_np, to_rgb
from pal import noise1 as vnoise1

T = 16
ORDER = ["sand", "gravel", "mud", "cobble", "path", "soil", "water", "stream"]
CODE = {m: i + 1 for i, m in enumerate(ORDER)}
EDGE_AMP = {"stream": 0.1, "water": 0.2, "path": 0.32, "soil": 0.04}


def shift(a, dy, dx):
    """result[y, x] = a[y - dy, x - dx], edges replicated."""
    p = max(abs(dy), abs(dx))
    padded = np.pad(a, p, mode="edge")
    h, w = a.shape
    return padded[p - dy:p - dy + h, p - dx:p - dx + w]


def depth(mask, n):
    d = np.zeros(mask.shape, np.int16)
    cur = mask.copy()
    for _ in range(n):
        d += cur
        cur = cur & shift(cur, 1, 0) & shift(cur, -1, 0) & shift(cur, 0, 1) & shift(cur, 0, -1)
    return d


def blur(a, r, passes=3):
    for _ in range(passes):
        for axis in (0, 1):
            p = np.pad(a, [(r + 1, r)] if False else ([(r + 1, r), (0, 0)] if axis == 0 else [(0, 0), (r + 1, r)]), mode="edge")
            c = np.cumsum(p, axis=axis)
            a = (np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis) - np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
    return a


def near(mask, dy, dx, k):
    """True where `mask` holds within 1..k steps in direction (dy, dx)."""
    out = np.zeros(mask.shape, bool)
    for s in range(1, k + 1):
        out |= shift(mask, -dy * s, -dx * s)
    return out


def dilate(mask, k):
    out = mask.copy()
    for _ in range(k):
        out = out | shift(out, 1, 0) | shift(out, -1, 0) | shift(out, 0, 1) | shift(out, 0, -1) \
            | shift(out, 1, 1) | shift(out, -1, -1) | shift(out, 1, -1) | shift(out, -1, 1)
    return out


GRASS_TUFTS = [
    ["2.2", "1d1"],
    [".2.", "212", "d.d"],
    ["2..", "12.", "d12", ".d."],
    ["..2", ".21", "21d", "d.."],
    ["2.2.2", "1d1d1"],
    ["D.D", ".D."],
    ["D...D", ".D.D."],
]
DELTA = {"2": 2, "1": 1, "d": -1, "D": -2}
PEBBLES = [["65", "43", ".s"], ["5", "s"], ["654", "432", ".ss"], ["56", "4s"]]


class Ground:
    def __init__(self, area):
        self.area = area
        W, H = area.w * T, area.h * T
        self.W, self.H = W, H
        ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
        self.xs, self.ys = xs, ys
        U, V = (xs + 0.5) / T, (ys + 0.5) / T
        i0, j0 = np.floor(U).astype(int), np.floor(V).astype(int)
        fu, fv = U - i0, V - j0
        owner = np.zeros((H, W), np.int8)
        for m in ORDER:
            verts = area.verts.get(m)
            if not verts:
                continue
            G = np.zeros((area.h + 2, area.w + 2))
            for vx, vy in verts:
                if 0 <= vx <= area.w and 0 <= vy <= area.h:
                    G[vy, vx] = 1
            f = (G[j0, i0] * (1 - fu) * (1 - fv) + G[j0, i0 + 1] * fu * (1 - fv)
                 + G[j0 + 1, i0] * (1 - fu) * fv + G[j0 + 1, i0 + 1] * fu * fv)
            n = (fbm(xs, ys, 7, seed=CODE[m] * 31, octaves=2) - 0.5) * EDGE_AMP.get(m, 0.25)
            owner[f + n > 0.5] = CODE[m]
        self.owner = owner
        self._static()

    def _static(self):
        xs, ys, owner = self.xs, self.ys, self.owner
        H, W = owner.shape
        ix, iy = xs.astype(int), ys.astype(int)
        grass = owner == 0
        wet = (owner == CODE["water"]) | (owner == CODE["stream"])
        path = owner == CODE["path"]
        soil = owner == CODE["soil"]

        # grass: three kinds (lush, meadow, dry) in broad drifts, clustered light patches, and speckle
        sp = fbm(xs, ys, 70, 5, 2) + (fbm(xs, ys, 4, 6, 2) - 0.5) * 0.14
        ramp = np.where(sp < 0.37, RID["lush"], np.where(sp > 0.65, RID["dry"], RID["grass"])).astype(np.int16)
        g = 3.7 + (fbm(xs, ys, 26, 1) - 0.5) * 1.9 + (fbm(xs, ys, 7, 2, 2) - 0.5) * 1.2
        g = np.clip(np.floor(g * 2) / 2, 2.0, 5.5)
        g += np.where(ramp == RID["dry"], -0.2, 0) - np.where(ramp == RID["lush"], 0.2, 0)
        speck = hash_np(ix, iy, 2)
        g = np.where(speck < 0.035, g - 0.8, np.where(speck > 0.975, g + 0.8, g))
        idx = g.astype(np.float64)

        def stamp(x, y, level, r=None):
            if 0 <= x < W and 0 <= y < H and grass[y, x]:
                if r is not None:
                    ramp[y, x] = r
                idx[y, x] = level

        for cy in range(0, H, 5):                                 # small tufts
            for cx in range(0, W, 5):
                if hash2(cx, cy, 3) > 0.26:
                    continue
                shape = GRASS_TUFTS[int(hash2(cx, cy, 4) * len(GRASS_TUFTS))]
                ox, oy = cx + int(hash2(cx, cy, 5) * 4), cy + int(hash2(cx, cy, 6) * 4)
                if not (0 <= oy < H and 0 <= ox < W):
                    continue
                base = idx[oy, ox]
                for j, row in enumerate(shape):
                    for i, ch in enumerate(row):
                        if ch != ".":
                            stamp(ox + i, oy + j, min(7, max(0.8, base + DELTA[ch])))
        for cy in range(0, H, 11):                                # taller clumps that stand up and shade their root
            for cx in range(0, W, 13):
                if hash2(cx, cy, 13) > 0.34:
                    continue
                ox, oy = cx + int(hash2(cx, cy, 14) * 8), cy + 4 + int(hash2(cx, cy, 15) * 5)
                if not (0 <= oy < H and 0 <= ox < W):
                    continue
                base = idx[oy, ox]
                for k in range(3 + int(hash2(cx, cy, 16) * 3)):
                    x = ox + k * 2 - 2 + (1 if hash2(cx, k, 17) > 0.6 else 0)
                    tall = 3 + int(hash2(cx + k, cy, 18) * 3)
                    lean = -1 if hash2(k, cy, 19) < 0.3 else 1 if hash2(k, cy, 19) > 0.7 else 0
                    stamp(x, oy, base - 1.6)
                    stamp(x + 1, oy, base - 1.1)
                    for j in range(1, tall):
                        xx = x + (lean if j == tall - 1 else 0)
                        stamp(xx, oy - j, base + 0.2 + j * 1.9 / tall)
        for cy in range(0, H, 4):                                 # clover drifts
            for cx in range(0, W, 4):
                if hash2(cx, cy, 20) > 0.45 or vnoise1(cx, cy, 20, 21) < 0.72:
                    continue
                ox, oy = cx + int(hash2(cx, cy, 22) * 2), cy + int(hash2(cx, cy, 23) * 2)
                if not (0 <= oy + 2 < H and 0 <= ox + 2 < W and grass[oy + 1, ox + 1]):
                    continue
                base = idx[oy + 1, ox + 1]
                stamp(ox + 1, oy, base + 1.6, RID["lush"])
                stamp(ox, oy + 1, base + 1.2, RID["lush"])
                stamp(ox + 1, oy + 1, base + 2.2, RID["lush"])
                stamp(ox + 2, oy + 1, base + 0.8, RID["lush"])
                stamp(ox + 1, oy + 2, base - 1.2)
                if hash2(cx, cy, 24) < 0.08:
                    stamp(ox + 1, oy + 1, 6.0, RID["white"])
        flower_ramps = (("white", 5.8), ("straw", 5.4), ("pink", 4.2), ("blue", 4.4))
        for cy in range(0, H, 23):                                # little flower clusters
            for cx in range(0, W, 23):
                if hash2(cx, cy, 30) > 0.3:
                    continue
                name, lv = flower_ramps[int(hash2(cx, cy, 31) * len(flower_ramps))]
                ox, oy = cx + 4 + int(hash2(cx, cy, 32) * 14), cy + 4 + int(hash2(cx, cy, 33) * 14)
                for k in range(3 + int(hash2(cx, cy, 34) * 4)):
                    x = ox + int((hash2(cx, k, 35) - 0.5) * 9)
                    y = oy + int((hash2(k, cy, 36) - 0.5) * 7)
                    if 0 <= y + 1 < H and 0 <= x + 1 < W and grass[y, x] and grass[y + 1, x]:
                        base = idx[y + 1, x]
                        stamp(x, y, lv, RID[name])
                        stamp(x + 1, y, lv - 1.2, RID[name])
                        stamp(x, y + 1, base - 1.4)

        # a raised lip wherever grass meets lower ground
        below_other = shift(~grass, -1, 0) & grass
        above_other = shift(~grass, 1, 0) & grass
        idx[below_other] = 1.2
        idx[above_other & ~below_other] = np.minimum(7, idx[above_other & ~below_other] + 1.6)

        # muddy bank around water
        bank1 = dilate(wet, 1) & ~wet & ~path & ~soil
        bank2 = dilate(wet, 2) & ~wet & ~bank1 & ~path & ~soil
        patchy = fbm(xs, ys, 5, 40, 2) > 0.42
        bank3 = dilate(wet, 3) & ~wet & ~bank1 & ~bank2 & ~path & ~soil & ~dilate(owner == CODE["stream"], 2)
        ramp[bank1] = RID["dirt"]
        idx[bank1] = np.where(shift(wet, 1, 0)[bank1], 3.2, 2.0)
        ramp[bank2], idx[bank2] = RID["dirt"], np.where(shift(wet, -2, 0)[bank2], 5.0, 4.0)
        b3 = bank3 & patchy
        ramp[b3], idx[b3] = RID["dirt"], 5.0 + (fbm(xs, ys, 3, 42, 1)[b3] - 0.5)
        stones = (bank2 | bank3) & (hash_np(ix, iy, 41) < 0.05)
        ramp[stones], idx[stones] = RID["stone"], 5.2

        # road: a lighter trodden middle, lumpier edges, stones sunk in the dirt
        pdist = depth(path, 12)
        p = 4.2 + (fbm(xs, ys, 13, 20) - 0.5) * 1.3 + (fbm(xs, ys, 4, 21, 2) - 0.5) * 0.9 + np.clip((pdist - 4) / 8, 0, 1) * 0.7
        p = np.clip(np.floor(p * 2) / 2, 2.5, 6.0)
        not_path = ~path
        p = np.where(near(not_path, -1, 0, 3), np.minimum(p, 3.2), p)
        p = np.where(near(not_path, -1, 0, 1), 2.0, p)
        p = np.where(near(not_path, 0, -1, 1), np.minimum(p, 3.2), p)
        p = np.where(near(not_path, 1, 0, 1), p - 0.6, p)
        sp2 = hash_np(ix, iy, 22)
        p = np.where(sp2 < 0.025, p - 1.4, np.where(sp2 > 0.985, p + 1.2, p))
        ramp[path], idx[path] = RID["dirt"], p[path]
        for cy in range(0, H, 8):
            for cx in range(0, W, 8):
                r = hash2(cx, cy, 23)
                if r > 0.2:
                    continue
                big = r < 0.03
                sw, sh = (5, 3) if big else (2 + int(hash2(cx, cy, 24) * 2), 2)
                ox, oy = cx + int(hash2(cx, cy, 25) * 5), cy + int(hash2(cx, cy, 26) * 5)
                cells = [(ox + i, oy + j) for j in range(sh) for i in range(sw)
                         if not (big and (i, j) in ((0, 0), (sw - 1, 0), (0, sh - 1), (sw - 1, sh - 1)))]
                if not all(x + 1 < W and y + 1 < H and pdist[y, x] >= 3 for x, y in cells):
                    continue
                for x, y in cells:
                    if (x + 1, y + 1) not in cells:
                        ramp[y + 1, x + 1], idx[y + 1, x + 1] = RID["dirt"], p[y + 1, x + 1] - 1.6
                for x, y in cells:
                    i, j = x - ox, y - oy
                    level = 5.8 if (i == 0 or j == 0) else 3.0 if (i == sw - 1 or j == sh - 1) else 4.4
                    if big and j == 0 and hash2(x, y, 27) < 0.5:
                        ramp[y, x], idx[y, x] = RID["moss"], 4.0
                    else:
                        ramp[y, x], idx[y, x] = RID["stone"], level + (hash2(x, y, 28) - 0.5) * 0.6
        edge_y, edge_x = np.nonzero(grass & shift(path, -1, 0))      # grass hanging over the road's top edge
        for y, x in zip(edge_y, edge_x):
            if hash2(x, y, 29) > 0.4 or y + 2 >= H or x + 1 >= W:
                continue
            gr = ramp[y, x]
            ramp[y + 1, x], idx[y + 1, x] = gr, 4.4
            if hash2(x, y, 30) < 0.45 and path[y + 2, x]:
                ramp[y + 2, x], idx[y + 2, x] = gr, 5.4
                if path[y + 2, x + 1]:
                    ramp[y + 2, x + 1], idx[y + 2, x + 1] = RID["dirt"], p[y + 2, x + 1] - 1.2

        # tilled soil: furrows, lit ridges, dark top edge under the grass lip
        row = iy % 8
        si = np.where(row == 0, 1.0, np.where(row == 1, 4.0, np.clip(np.floor((2.6 + (fbm(xs, ys, 5, 31, 2) - 0.5) * 1.6) * 2) / 2, 2, 3.5)))
        si = np.where(hash_np(ix, iy, 30) < 0.05, 4.2, si)
        not_soil = ~soil
        si = np.where(near(not_soil, -1, 0, 1), 3.0, si)
        si = np.where(near(not_soil, 0, -1, 1), 1.0, si)
        si = np.where(near(not_soil, 1, 0, 2), 0.2, si)
        si = np.where(near(not_soil, 0, 1, 1), 4.0, si)
        ramp[soil], idx[soil] = RID["soil"], si[soil]

        self.ramp, self.idx = ramp, idx
        self.wet = wet
        self.wdepth = depth(wet, 22)
        self.wsoft = blur(wet.astype(float), 9)

    def frame(self, f=0):
        xs, ys = self.xs, self.ys
        ix, iy = xs.astype(int), ys.astype(int)
        H, W = self.owner.shape
        ramp, idx = self.ramp.copy(), self.idx.copy()
        wet, d = self.wet, self.wdepth
        pond = self.owner == CODE["water"]
        stream = self.owner == CODE["stream"]
        dry = ~wet

        soft = np.clip((self.wsoft - 0.5) * 2, 0, 1)
        sky = 0.45 * (1 - (xs + ys) / (W + H))
        L = np.where(pond, 5.5 - np.clip(soft * 1.3, 0, 1) * 2.9 + sky + (fbm(xs, ys, 30, 72) - 0.5) * 0.6,
                     5.7 - np.clip(d / 7, 0, 1) * 1.8)
        wi = np.floor(L * 2 + (fbm(xs, ys, 3.5, 71, 2) - 0.5) * 1.1) / 2
        wi = np.where(near(dry, -1, 0, 4), wi - 0.9, wi)
        wi = np.where(near(dry, -1, 0, 2), wi - 0.9, wi)
        wi = np.where(near(dry, 0, -1, 2), wi - 0.8, wi)
        shore = (d <= 2) & (near(dry, 1, 0, 2) | near(dry, 0, 1, 2) | near(dry, 0, -1, 2))
        lap = hash_np(ix // 2, iy + ((ix // 3 + f) % 4) * 1000, 73) < 0.45
        wi = np.where(shore & lap & pond, 6.5, wi)
        sway = [0, 1, 2, 1][f % 4]
        for cy in range(0, H, 7):                                 # slow two-tone ripples
            for cx in range(0, W, 11):
                if hash2(cx, cy, 50) > 0.45:
                    continue
                ox = cx + int(hash2(cx, cy, 51) * 6) + sway
                oy = cy + int(hash2(cx, cy, 52) * 5)
                n = 4 + int(hash2(cx, cy, 53) * 3)
                for i in range(n):
                    x = ox + i
                    if x < W and oy < H and pond[oy, x] and d[oy, x] >= 3:
                        wi[oy, x] += 1.6 if 0 < i < n - 1 else 0.8
                        if oy + 1 < H and pond[oy + 1, x] and 0 < i < n - 1:
                            wi[oy + 1, x] -= 0.5
        for cy in range(0, H, 10):                                # twinkles
            for cx in range(0, W, 16):
                if hash2(cx, cy, 54) > 0.3:
                    continue
                ox, oy = cx + int(hash2(cx, cy, 55) * 12), cy + int(hash2(cx, cy, 56) * 8)
                phase = (f + int(hash2(cx, cy, 57) * 4)) % 4
                pts = {0: [(0, 6.2)], 1: [(-1, 6.2), (0, 7), (1, 6.2)], 2: [(0, 6.2)], 3: []}[phase]
                for dx, k in pts:
                    x = ox + dx
                    if 0 <= x < W and oy < H and wet[oy, x] and d[oy, x] >= 3:
                        wi[oy, x] = k
        for cy in range(0, H, 8):                                 # the stream runs downhill
            for cx in range(0, W, 5):
                if hash2(cx, cy, 60) > 0.5:
                    continue
                ox = cx + int(hash2(cx, cy, 61) * 4)
                oy = cy + (int(hash2(cx, cy, 62) * 8) + f * 2) % 8
                for j, k in ((0, 6.0), (1, 7.0), (2, 6.4), (3, 5.8)):
                    y = oy + j
                    if y < H and ox < W and stream[y, ox] and d[y, ox] >= 2:
                        wi[y, ox] = k
        foam = stream & (d == 1) & (hash_np(ix, ((iy - f * 2) // 2) + 5000, 63) < 0.3)
        wi = np.where(foam, 7, wi)
        ramp[wet], idx[wet] = RID["water"], np.clip(wi, 0, 7)[wet]
        rgb = to_rgb(ramp.astype(int), idx)
        alpha = np.full((H, W, 1), 255, np.uint8)
        return Image.fromarray(np.concatenate([rgb, alpha], axis=2), "RGBA")
