"""Rich palette: every material is a 12-shade ramp whose shadows drift cool and whose lights drift warm.

Sprite and terrain code speak in *levels* on each ramp's own scale (0..TOP[ramp], fractions allowed);
a level maps onto the 12 shades only when the image is made, so finer math buys more colours.
"""
import colorsys
import math

import numpy as np
from PIL import Image

SHADES = 12
WARM_HUE, COOL_HUE = 55, 255

# name: (hue, saturation, darkest lightness, lightest lightness, warm drift, cool drift, level scale)
MATERIALS = {
    "grass":   (104, 0.54, 0.10, 0.62, 34, 38, 7),
    "lush":    (132, 0.48, 0.09, 0.56, 26, 30, 7),
    "dry":     (80, 0.46, 0.14, 0.62, 18, 32, 7),
    "leaf":    (108, 0.52, 0.07, 0.60, 38, 44, 7),
    "leaf2":   (86, 0.56, 0.08, 0.64, 28, 44, 7),
    "pine":    (158, 0.44, 0.06, 0.52, 44, 26, 7),
    "moss":    (84, 0.48, 0.12, 0.58, 24, 36, 7),
    "dirt":    (28, 0.50, 0.10, 0.72, 18, 42, 7),
    "soil":    (20, 0.40, 0.06, 0.46, 10, 44, 5),
    "water":   (212, 0.66, 0.12, 0.88, 32, 22, 7),
    "wood":    (26, 0.50, 0.08, 0.72, 18, 42, 7),
    "greywood": (32, 0.13, 0.12, 0.80, 12, 34, 7),
    "barnred": (6, 0.60, 0.10, 0.66, 24, 34, 7),
    "fencewood": (12, 0.44, 0.07, 0.56, 20, 36, 7),
    "slate":   (222, 0.20, 0.08, 0.84, 22, 16, 7),
    "stone":   (248, 0.08, 0.10, 0.90, 34, 10, 7),
    "white":   (40, 0.20, 0.26, 0.97, 10, 40, 6),
    "red":     (355, 0.64, 0.12, 0.72, 26, 22, 6),
    "straw":   (45, 0.66, 0.16, 0.84, 10, 44, 6),
    "shutter": (150, 0.40, 0.07, 0.54, 30, 22, 5),
    "glass":   (214, 0.45, 0.07, 0.86, 22, 14, 5),
    "gold":    (42, 0.80, 0.14, 0.85, 10, 34, 5),
    "blue":    (220, 0.56, 0.12, 0.80, 22, 16, 5),
    "pink":    (340, 0.58, 0.18, 0.80, 22, 22, 5),
    "lamp":    (40, 0.95, 0.40, 0.96, 14, 0, 5),
    "skin":    (22, 0.52, 0.16, 0.86, 16, 30, 6),
    "skin_light": (24, 0.55, 0.24, 0.88, 14, 30, 6),
    "skin_mid": (22, 0.52, 0.16, 0.74, 14, 34, 6),
    "skin_deep": (18, 0.44, 0.09, 0.58, 12, 40, 6),
    "coal":    (255, 0.20, 0.04, 0.44, 20, 0, 6),
    "plum":    (332, 0.28, 0.08, 0.54, 22, 20, 6),
    "denim":   (218, 0.50, 0.10, 0.74, 22, 14, 6),
    "orange":  (26, 0.78, 0.16, 0.80, 18, 30, 6),
    "teal":    (186, 0.48, 0.12, 0.82, 18, 20, 6),
    "tan":     (30, 0.36, 0.20, 0.88, 14, 36, 6),
    "khaki":   (52, 0.16, 0.14, 0.76, 12, 30, 6),
    "leather": (22, 0.48, 0.08, 0.64, 16, 40, 6),
    "linen":   (50, 0.14, 0.30, 0.97, 6, 150, 6),
    "sand":    (40, 0.44, 0.20, 0.86, 12, 40, 7),
}


def _toward(h, target, amount):
    d = (target - h + 540) % 360 - 180
    return (h + math.copysign(min(abs(d), amount), d)) % 360


def make_ramp(hue, sat, l_lo, l_hi, warm, cool, n=SHADES):
    out = []
    for i in range(n):
        t = i / (n - 1)
        h = _toward(hue, WARM_HUE, warm * (t - 0.5) * 2) if t >= 0.5 else _toward(hue, COOL_HUE, cool * (0.5 - t) * 2)
        light = l_lo + (l_hi - l_lo) * t ** 0.95
        s = sat * (0.78 + 0.32 * math.sin(math.pi * t)) * (0.85 if t > 0.9 else 1)
        r, g, b = colorsys.hls_to_rgb(h / 360, light, min(1.0, s))
        out.append((round(r * 255), round(g * 255), round(b * 255)))
    return out


RGB = {k: make_ramp(*v[:6]) for k, v in MATERIALS.items()}
RGB["ink"] = [(18, 12, 24)] * SHADES
TOP = {k: v[6] for k, v in MATERIALS.items()}
TOP["ink"] = 1
NAMES = list(RGB)
RID = {k: i for i, k in enumerate(NAMES)}
RAMPS = RGB
LUT = np.array([RGB[k] for k in NAMES], np.uint8)
TOP_ARR = np.array([TOP[k] for k in NAMES], np.float64)


def shade_index(ramp, level):
    return int(round(max(0.0, min(1.0, level / TOP[ramp])) * (SHADES - 1)))


def to_rgb(ramp_ids, levels):
    t = np.clip(levels / TOP_ARR[ramp_ids], 0, 1)
    return LUT[ramp_ids, np.rint(t * (SHADES - 1)).astype(int)]


BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16 + 1 / 32


def hash2(x, y, seed=0):
    h = (x * 374761393 + y * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296


def hash_np(x, y, seed=0):
    m = np.uint64(0xFFFFFFFF)
    x = np.asarray(x).astype(np.uint64)
    y = np.asarray(y).astype(np.uint64)
    h = (x * np.uint64(374761393) + y * np.uint64(668265263) + np.uint64((seed * 1442695041) & 0xFFFFFFFF)) & m
    h = ((h ^ (h >> np.uint64(13))) * np.uint64(1274126177)) & m
    return ((h ^ (h >> np.uint64(16))) & m).astype(np.float64) / 4294967296


def vnoise(xs, ys, scale, seed=0):
    u, v = xs / scale, ys / scale
    i0, j0 = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
    fu, fv = u - i0, v - j0
    fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
    i0, j0 = i0 + 10000, j0 + 10000
    a, b = hash_np(i0, j0, seed), hash_np(i0 + 1, j0, seed)
    c, d = hash_np(i0, j0 + 1, seed), hash_np(i0 + 1, j0 + 1, seed)
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv


def fbm(xs, ys, scale, seed=0, octaves=3):
    total, amp, norm = 0, 1.0, 0
    for o in range(octaves):
        total = total + vnoise(xs, ys, scale / 2 ** o, seed + o * 17) * amp
        norm += amp
        amp *= 0.5
    return total / norm


def noise1(x, y, scale, seed=0):
    """Scalar value noise matching vnoise, cheap enough to call per sprite pixel."""
    u, v = x / scale, y / scale
    i0, j0 = math.floor(u), math.floor(v)
    fu, fv = u - i0, v - j0
    fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
    i0, j0 = i0 + 10000, j0 + 10000
    a, b = hash2(i0, j0, seed), hash2(i0 + 1, j0, seed)
    c, d = hash2(i0, j0 + 1, seed), hash2(i0 + 1, j0 + 1, seed)
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv


LIGHT = (-0.45, -0.62, 0.64)
_n = math.sqrt(sum(c * c for c in LIGHT))
LIGHT = tuple(c / _n for c in LIGHT)


def lambert(nx, ny, nz):
    return nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]


N4 = ((0, 1), (1, 0), (-1, 0), (0, -1))


class Canvas:
    """Pixels are (ramp, level). `outline()` finishes a sprite: a lit rim on the top-left edge, a selective
    outline (a soft dark shade on the lit side, the darkest shade on the shaded side), and eased stair steps."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]

    def put(self, x, y, ramp, level):
        x, y = int(math.floor(x + 0.5)), int(math.floor(y + 0.5))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = (ramp, max(0.0, min(float(TOP[ramp]), float(level))))

    def get(self, x, y):
        return self.px[y][x] if 0 <= x < self.w and 0 <= y < self.h else None

    def rect(self, x, y, w, h, ramp, level):
        for j in range(h):
            for k in range(w):
                self.put(x + k, y + j, ramp, level)

    def shift(self, x, y, d):
        p = self.get(x, y)
        if p:
            self.put(x, y, p[0], p[1] + d)

    def rim(self, amount=0.8):
        """Brighten filled pixels whose top or left neighbour is empty: light catching the edge."""
        lit = []
        for y in range(self.h):
            for x in range(self.w):
                p = self.px[y][x]
                if p and p[0] != "ink" and (self.get(x - 1, y) is None or self.get(x, y - 1) is None):
                    lit.append((x, y, p))
        for x, y, (r, lv) in lit:
            self.put(x, y, r, lv + amount)
        return self

    def outline(self, ramp=None, idx=0, rim=True, rim_amount=0.8, lit_bonus=0.2):
        if rim:
            self.rim(rim_amount)
        out = [row[:] for row in self.px]
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] is not None:
                    continue
                right, below = self.get(x + 1, y), self.get(x, y + 1)
                left, above = self.get(x - 1, y), self.get(x, y - 1)
                n = right or below or left or above
                if not n:
                    continue
                r = ramp or n[0]
                lit_side = (right or below) and not (left or above)
                level = idx + (TOP[r] * lit_bonus if lit_side and not ramp else 0)
                filled = sum(1 for p in (right, below, left, above) if p)
                if filled >= 2 and not ramp and ((right and below) or (left and above) or (right and above) or (left and below)):
                    level = max(level, idx + TOP[r] * lit_bonus * 0.5)
                out[y][x] = (r, level)
        self.px = out
        return self

    def image(self):
        img = Image.new("RGBA", (self.w, self.h))
        for y in range(self.h):
            for x in range(self.w):
                p = self.px[y][x]
                if p:
                    img.putpixel((x, y), RGB[p[0]][shade_index(p[0], p[1])] + (255,))
        return img


def sway_image(canvas, upper, amp=1, rustle=False):
    """The finished picture, carrying (in PIL `info`) the part that moves in the wind and the part that stays put,
    for the game's wind layer. `upper(x, y, pixel)` says which pixels move."""
    img = canvas.image()
    top, rest = Canvas(canvas.w, canvas.h), Canvas(canvas.w, canvas.h)
    for y in range(canvas.h):
        for x in range(canvas.w):
            p = canvas.px[y][x]
            if p:
                (top if upper(x, y, p) else rest).px[y][x] = p
    img.info["sway"] = {"upper": top.image(), "lower": rest.image(), "amp": amp, "rustle": rustle}
    return img
