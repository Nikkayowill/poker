"""Drawing pieces for the farm buildings, at the LPC pack's 32px per tile:
shingles, boards, windows, doors, chimneys. Lit from the top left, hard dark outline.
"""
import numpy as np
from PIL import Image


def hx(s):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def ramp(*cols):
    return [hx(c) for c in cols]


# dark -> light
RED_ROOF = ramp('#3a1511', '#6b2119', '#93301f', '#b8452a', '#d4623a', '#eb8a55')
BROWN_ROOF = ramp('#2a1a14', '#4f2f20', '#71452b', '#915d37', '#b07a47', '#cf9d62')
SLATE_ROOF = ramp('#1e2230', '#313a52', '#465474', '#5f7196', '#8093b5', '#a9b8d2')
CREAM = ramp('#4a3326', '#8a6d52', '#b39570', '#d6bd92', '#ecdcb4', '#fbf0d2')
WOOD = ramp('#34200f', '#5a371c', '#7f5129', '#a26b36', '#c48c4c', '#ddb070')
DARKWOOD = ramp('#24150d', '#3e2515', '#5a371d', '#744a27', '#905f33', '#a97640')
BARN = ramp('#361010', '#621c19', '#8a2822', '#ab372b', '#c84e38', '#e06d4b')
STONE = ramp('#26252b', '#45434d', '#65626d', '#8a8691', '#aeaab0', '#d0cccc')
GLASS = ramp('#16203a', '#243d66', '#3c6596', '#6c9cc9', '#b3dbef', '#effbff')
GREEN = ramp('#15291d', '#224531', '#336546', '#4d8a55', '#71ad66', '#9ccd80')
WHITE = ramp('#4c4a50', '#7f7c82', '#aeaab0', '#d6d2cd', '#eeebe4', '#fffdf6')
PLASTER = ramp('#5a4a3a', '#9a876d', '#c3b193', '#ddcfb2', '#efe5cc', '#fbf5e4')
FLOWERS = [hx('#e0507a'), hx('#f5d04a'), hx('#f2f0ff'), hx('#b04ad0'), hx('#ff8a4a')]
LEAF = ramp('#1c3a1e', '#2e5e2a', '#468a36', '#6db448')


def hsh(x, y, s=0):
    v = (int(x) * 374761393 + int(y) * 668265263 + s * 982451653) & 0xffffffff
    v = ((v ^ (v >> 13)) * 1274126177) & 0xffffffff
    v ^= v >> 16
    return (v & 0xffff) / 65535.0


class Cv:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.a = np.zeros((h, w, 4), np.uint8)

    def put(self, x, y, c, alpha=255):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.a[y, x, :3] = c
            self.a[y, x, 3] = alpha

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1):
            for x in range(x0, x1):
                self.put(x, y, c)

    def hline(self, x0, x1, y, c):
        for x in range(x0, x1):
            self.put(x, y, c)

    def vline(self, x, y0, y1, c):
        for y in range(y0, y1):
            self.put(x, y, c)

    def get(self, x, y):
        return tuple(self.a[y, x, :3])

    def solid(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h and self.a[y, x, 3] > 0

    def outline(self, f=0.38):
        """Every edge pixel of the silhouette darkened hard, like the pack's pieces."""
        al = self.a[..., 3] > 0
        pad = np.pad(al, 1)
        edge = al & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
        rgb = self.a[..., :3].astype(np.float64)
        dark = rgb * f + np.array([10, 4, 6]) * (1 - f)
        self.a[edge, :3] = np.clip(dark[edge] * np.array([1.0, 0.9, 0.95]), 0, 255).astype(np.uint8)

    def image(self):
        return Image.fromarray(self.a, 'RGBA')


# ---------------------------------------------------------------- roofs

def shingles(cv, inside, R, row_h=7, sh_w=10, seed=0, lit=None):
    """Staggered shingles over every pixel where inside(x, y) holds.

    Each shingle is its own piece: a lit top-left, a shaded foot with rounded
    corners, a seam on its right. Rows near the ridge sit one step lighter,
    rows at the eave one step darker (they are flat steps, one per row).
    """
    pts = [(x, y) for y in range(cv.h) for x in range(cv.w) if inside(x, y)]
    if not pts:
        return
    ys = [p[1] for p in pts]
    top, bot = min(ys), max(ys)
    rows = max(1, (bot - top + 1) // row_h)
    for x, y in pts:
        r = (y - top) // row_h
        ly = (y - top) % row_h
        off = (sh_w // 2) * (r % 2)
        c = (x + off) // sh_w
        lx = (x + off) % sh_w
        base = 3
        if r <= 1:
            base = 4
        elif r >= rows - 2:
            base = 2
        v = hsh(c, r, seed)
        if v < 0.18:
            base -= 1
        elif v > 0.9:
            base += 1
        if lit is not None:
            base += lit(x, y)
        base = max(1, min(5, base))
        col = R[base]
        if ly == row_h - 1:
            col = R[max(0, base - 2)]                       # the shadow line under the row above
        elif ly == row_h - 2 and (lx == 0 or lx == sh_w - 1):
            col = R[max(0, base - 2)]                       # rounded foot corners
        elif lx == sh_w - 1:
            col = R[max(0, base - 1)]                       # seam
        elif ly == 0 and lx < sh_w - 2:
            col = R[min(5, base + 1)]                       # lit top edge
        elif lx == 0:
            col = R[min(5, base + 1)] if ly < row_h - 3 else col
        if hsh(x, y, seed + 7) < 0.035 and ly not in (0, row_h - 1):
            col = R[max(0, base - 1)]                       # weathering flecks
        cv.put(x, y, col)


def ridge(cv, x0, x1, y, R):
    """The ridge cap along the top: a run of rounded caps."""
    for x in range(x0, x1):
        lx = (x - x0) % 8
        cv.put(x, y, R[1])
        cv.put(x, y + 1, R[4] if lx < 6 else R[2])
        cv.put(x, y + 2, R[3] if lx < 7 else R[1])
        cv.put(x, y + 3, R[2] if lx < 7 else R[1])
        cv.put(x, y + 4, R[1])


def fascia(cv, x0, x1, y, T):
    """The trim board along the eave, and the shadow it throws on the wall below."""
    for x in range(x0, x1):
        cv.put(x, y, T[5])
        cv.put(x, y + 1, T[4])
        cv.put(x, y + 2, T[3])
        cv.put(x, y + 3, T[1])


# ---------------------------------------------------------------- walls

def vboards(cv, x0, y0, x1, y1, R, bw=7, seed=0):
    for x in range(x0, x1):
        b = (x - x0) // bw
        lx = (x - x0) % bw
        base = 3 if hsh(b, 0, seed) > 0.25 else 2
        for y in range(y0, y1):
            col = R[base]
            if lx == bw - 1:
                col = R[1]
            elif lx == 0:
                col = R[base + 1]
            elif hsh(x, y // 3, seed + b) < 0.07:
                col = R[base - 1]                            # grain streak
            if hsh(b, y // 9, seed + 3) < 0.03 and lx == 3:
                col = R[1]                                   # a knot
            cv.put(x, y, col)
        # nail heads near top and bottom of each board
        if lx == 2:
            cv.put(x, y0 + 3, R[1]); cv.put(x, y1 - 4, R[1])


def hboards(cv, x0, y0, x1, y1, R, bh=6, seed=0):
    for y in range(y0, y1):
        r = (y - y0) // bh
        ly = (y - y0) % bh
        for x in range(x0, x1):
            seg = (x + (r * 13) % 40) // 40
            base = 3 if hsh(seg, r, seed) > 0.2 else 2
            col = R[base]
            if ly == bh - 1:
                col = R[1]
            elif ly == bh - 2:
                col = R[base - 1]
            elif ly == 0:
                col = R[base + 1]
            elif hsh(x // 4, y, seed + 1) < 0.05:
                col = R[base - 1]
            if (x + (r * 13) % 40) % 40 == 0 and ly != bh - 1:
                col = R[1]                                   # board joint
            cv.put(x, y, col)


def foundation(cv, x0, x1, y0, y1, R=STONE, seed=0):
    """Fieldstone footing: irregular stones in courses."""
    for y in range(y0, y1):
        course = (y - y0) // 4
        for x in range(x0, x1):
            off = 5 * (course % 2)
            s = (x + off) // 10
            lx = (x + off) % 10
            ly = (y - y0) % 4
            base = 3 if hsh(s, course, seed) > 0.3 else 2
            col = R[base]
            if lx == 9 or ly == 3:
                col = R[0]
            elif ly == 0 or lx == 0:
                col = R[base + 1]
            cv.put(x, y, col)


def eave_shadow(cv, x0, x1, y, depth=5):
    """Darken the wall just under the eave, a flat band, two steps."""
    for x in range(x0, x1):
        for k in range(depth):
            if cv.solid(x, y + k):
                c = np.array(cv.get(x, y + k), float)
                f = 0.55 if k < depth - 2 else 0.75
                cv.put(x, y + k, tuple((c * f).astype(int)))


# ---------------------------------------------------------------- openings

def window(cv, x, y, w, h, trim=WHITE, shutters=None, box=True, seed=0):
    # shutters
    if shutters is not None:
        sw = w // 3
        for sx in (x - sw - 1, x + w + 1):
            for yy in range(y, y + h):
                for xx in range(sx, sx + sw):
                    lx = xx - sx
                    col = shutters[3]
                    if lx == 0: col = shutters[4]
                    if lx == sw - 1: col = shutters[1]
                    if (yy - y) % 4 == 3 and 0 < lx < sw - 1: col = shutters[2]   # louvres
                    if yy in (y, y + h - 1): col = shutters[1]
                    cv.put(xx, yy, col)
    # frame
    for yy in range(y - 2, y + h + 2):
        for xx in range(x - 2, x + w + 2):
            cv.put(xx, yy, trim[4])
    cv.hline(x - 2, x + w + 2, y - 2, trim[5])
    cv.vline(x - 2, y - 2, y + h + 2, trim[5])
    cv.hline(x - 2, x + w + 2, y + h + 1, trim[2])
    cv.vline(x + w + 1, y - 2, y + h + 2, trim[2])
    # glass: dark interior with a lit sky reflection and a diagonal glint
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            ly, lx = yy - y, xx - x
            col = GLASS[1] if ly < 3 else GLASS[2]
            if ly >= h // 2:
                col = GLASS[2] if ly < h - 2 else GLASS[3]
            d = lx + ly
            if d in (4, 5) or d == 10:
                col = GLASS[4]
            if d == 5 and ly < h // 2:
                col = GLASS[5]
            cv.put(xx, yy, col)
    # curtains peeking in at the top corners
    for k in range(3):
        cv.put(x + k, y + k // 2, FLOWERS[2]); cv.put(x + w - 1 - k, y + k // 2, FLOWERS[2])
    # muntins
    cv.vline(x + w // 2, y, y + h, trim[4])
    cv.hline(x, x + w, y + h // 2, trim[4])
    cv.put(x + w // 2, y + h // 2, trim[5])
    cv.hline(x, x + w, y + h // 2 + 1, trim[2])
    # sill
    cv.hline(x - 3, x + w + 3, y + h + 2, trim[5])
    cv.hline(x - 3, x + w + 3, y + h + 3, trim[2])
    if box:
        flower_box(cv, x - 2, y + h + 4, w + 4, seed)


def flower_box(cv, x, y, w, seed=0):
    for yy in range(y, y + 5):
        for xx in range(x, x + w):
            col = WOOD[3]
            if yy == y: col = WOOD[4]
            if yy == y + 4 or xx in (x, x + w - 1): col = WOOD[1]
            cv.put(xx, yy, col)
    for xx in range(x, x + w):
        h = 2 + int(hsh(xx, 1, seed) * 3)
        for k in range(h):
            cv.put(xx, y - 1 - k, LEAF[1 + (k + xx) % 3])
    for i in range(w // 3):
        fx = x + 1 + i * 3 + int(hsh(i, 2, seed) * 2)
        fy = y - 3 - int(hsh(i, 3, seed) * 2)
        fc = FLOWERS[int(hsh(i, 4, seed) * 3) % 3 if seed % 2 == 0 else (int(hsh(i, 4, seed) * 2) % 2) * 3 % 5]
        cv.put(fx, fy, fc); cv.put(fx + 1, fy, fc); cv.put(fx, fy - 1, fc); cv.put(fx + 1, fy + 1, tuple(int(v * 0.7) for v in fc))
        cv.put(fx, fy, FLOWERS[1] if fc != FLOWERS[1] else FLOWERS[2])


def panel_door(cv, x, y, w, h, R=BARN, trim=WHITE, glass=True):
    # frame
    cv.rect(x - 3, y - 3, x + w + 3, y + h, trim[4])
    cv.hline(x - 3, x + w + 3, y - 3, trim[5])
    cv.vline(x - 3, y - 3, y + h, trim[5])
    cv.vline(x + w + 2, y - 3, y + h, trim[2])
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            lx, ly = xx - x, yy - y
            col = R[3]
            if lx == 0: col = R[4]
            if lx == w - 1: col = R[1]
            # two sunk panels below, a window above
            for (px0, py0, px1, py1) in ((3, h // 2 + 1, w // 2 - 1, h - 4), (w // 2 + 1, h // 2 + 1, w - 3, h - 4)):
                if px0 <= lx < px1 and py0 <= ly < py1:
                    col = R[2]
                    if lx == px0 or ly == py0: col = R[1]
                    if lx == px1 - 1 or ly == py1 - 1: col = R[4]
            if glass and 3 <= lx < w - 3 and 3 <= ly < h // 2 - 2:
                col = GLASS[2] if (lx + ly) % 7 not in (0, 1) else GLASS[4]
                if lx == w // 2: col = R[2]
            cv.put(xx, yy, col)
    # knob
    cv.put(x + w - 4, y + h // 2 + 1, hx('#f2cd5a')); cv.put(x + w - 4, y + h // 2 + 2, hx('#9c6b1e'))
    cv.put(x + w - 5, y + h // 2 + 1, hx('#fff0a0'))


def barn_doors(cv, x, y, w, h, R=BARN, trim=WHITE):
    cv.rect(x - 3, y - 3, x + w + 3, y + h, trim[4])
    cv.hline(x - 3, x + w + 3, y - 3, trim[5])
    half = w // 2
    for leaf in (0, 1):
        lx0 = x + leaf * half
        vboards(cv, lx0, y, lx0 + half, y + h, R, bw=6, seed=leaf + 11)
        # white rails round the edge and the X
        for yy in range(y, y + h):
            for xx in range(lx0, lx0 + half):
                lx, ly = xx - lx0, yy - y
                t = lx in (0, 1, 2) or lx in (half - 3, half - 2, half - 1) or ly in (0, 1, 2) or ly in (h - 3, h - 2, h - 1)
                d1 = abs(lx * (h - 1) - ly * (half - 1)) <= (h + half) * 1.2
                d2 = abs((half - 1 - lx) * (h - 1) - ly * (half - 1)) <= (h + half) * 1.2
                if t or d1 or d2:
                    col = trim[4]
                    if lx in (0,) or ly in (0,): col = trim[5]
                    if lx == half - 1 or ly == h - 1: col = trim[2]
                    cv.put(xx, yy, col)
    cv.vline(x + half, y, y + h, R[0])
    cv.vline(x + half - 1, y, y + h, trim[2])
    # iron handles
    for k in range(5):
        cv.put(x + half - 5, y + h // 2 - 2 + k, STONE[1]); cv.put(x + half + 4, y + h // 2 - 2 + k, STONE[1])


def chimney(cv, x, y, w, h):
    for yy in range(y, y + h):
        course = (yy - y) // 4
        for xx in range(x, x + w):
            off = 3 * (course % 2)
            lx = (xx - x + off) % 7
            ly = (yy - y) % 4
            base = 3 if xx - x < w // 2 else 2
            if hsh((xx - x + off) // 7, course, 5) < 0.25: base -= 1
            col = STONE[base]
            if ly == 3 or lx == 6: col = STONE[0]
            elif ly == 0: col = STONE[base + 1]
            cv.put(xx, yy, col)
    # cap
    cv.rect(x - 2, y - 3, x + w + 2, y, STONE[2])
    cv.hline(x - 2, x + w + 2, y - 3, STONE[4])
    cv.hline(x - 2, x + w + 2, y - 1, STONE[1])
    cv.rect(x + 2, y - 4, x + w - 2, y - 3, STONE[0])


def lamp(cv, x, y):
    cv.vline(x, y, y + 3, STONE[0])
    cv.rect(x - 2, y + 3, x + 3, y + 9, hx('#2a2320'))
    cv.rect(x - 1, y + 4, x + 2, y + 8, hx('#ffd86a'))
    cv.put(x - 1, y + 4, hx('#fff6c8'))
    cv.hline(x - 3, x + 4, y + 3, hx('#3a302a'))




def barrel(cv, x, y):
    for yy in range(y, y + 18):
        for xx in range(x, x + 14):
            lx = xx - x
            bulge = 1 if 4 <= yy - y <= 13 else 0
            if lx < 1 - bulge or lx > 12 + bulge: continue
            col = WOOD[3] if lx < 5 else (WOOD[2] if lx < 10 else WOOD[1])
            if lx in (2, 6, 10): col = WOOD[1]
            if yy - y in (3, 4, 13, 14): col = STONE[1] if lx > 6 else STONE[3]
            cv.put(xx, yy, col)
    for xx in range(x + 1, x + 13):
        cv.put(xx, y, WOOD[4]); cv.put(xx, y + 1, DARKWOOD[1])


def pot(cv, x, y):
    for yy in range(y, y + 8):
        for xx in range(x, x + 10):
            w = 5 - (yy - y) // 3
            if abs(xx - x - 4.5) <= w:
                cv.put(xx, yy, hx('#b8603a') if xx < x + 5 else hx('#8a4228'))
    cv.hline(x - 1, x + 11, y, hx('#d9844f'))
    for k in range(14):
        a = hsh(k, 1, 3) * 3.14
        for r in range(2, 7):
            cv.put(x + 5 + int(np.cos(a) * r * 0.9), y - 1 - int(np.sin(a) * r), LEAF[1 + (r + k) % 3])
    cv.put(x + 3, y - 6, FLOWERS[0]); cv.put(x + 7, y - 5, FLOWERS[0]); cv.put(x + 5, y - 7, FLOWERS[1])
