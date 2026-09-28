"""The City's paving, drawn at the ground picture's full resolution (32px a map square) and laid into it as a
ground item: granite setts for the market place and the quay, York-stone flags for the pavements, a granite kerb
with its gutter and drains, and a ring of sandstone round the market cross. The LPC terrain set's paving is flat
and dark next to the town's buildings, so these are drawn in the building kit's stone colours instead.
"""
import math

import numpy as np
from PIL import Image

from gable_kit import hsh

MOSS = [(58, 78, 44), (78, 104, 56), (104, 130, 70)]
S = 32                         # hires px to a map square


def ground_item(img, scale=0.5):
    """A hires ground picture as the exporter takes one: a half-size stand-in carrying the full drawing."""
    proxy = img.resize((img.width // 2, img.height // 2), Image.NEAREST)
    proxy.info["hires"] = {"img": img, "scale": scale}
    return proxy, (0, 0)


# ---------------------------------------------------------------- the town's paving
#
# Calm, the way Stardew's square is: the ground people walk on is the quietest thing on
# the screen so the stalls, doors and people stand out on it. Mortar sits one step under the stone, each stone
# has a lit top and a shaded foot and nothing else, and the square's tone moves slowly (grimy here, polished
# there) stone by stone rather than pixel by pixel.

GRANITE = [(84, 82, 86), (110, 107, 110), (132, 128, 128), (150, 146, 142), (168, 164, 158), (186, 182, 174)]
GRANITE_WARM = [(96, 86, 74), (122, 110, 96), (144, 132, 116), (162, 150, 132), (178, 166, 148), (194, 182, 164)]
FLAG = [(120, 112, 98), (146, 138, 122), (166, 158, 140), (182, 174, 156), (196, 188, 170), (210, 202, 184)]
KERB = [(92, 90, 94), (116, 114, 116), (150, 148, 146), (178, 176, 172), (198, 196, 190)]
IRON = [(34, 34, 40), (54, 54, 62), (78, 78, 88)]
WEED = [(64, 92, 46), (88, 122, 58), (116, 152, 72)]
SANDSTONE = [(92, 60, 42), (128, 84, 58), (160, 108, 74), (182, 128, 88), (202, 150, 106), (220, 174, 128)]


def value_noise(x, y, scale, seed):
    """Smooth noise in 0..1 over map squares, changing over about `scale` squares."""
    gx, gy = x / scale, y / scale
    ix, iy = math.floor(gx), math.floor(gy)
    fx, fy = gx - ix, gy - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = hsh(ix, iy, seed), hsh(ix + 1, iy, seed)
    c, d = hsh(ix, iy + 1, seed), hsh(ix + 1, iy + 1, seed)
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy


def _depth_field(inside, x0, y0, W, H, step=4, reach=12):
    """How far inside the paving each coarse cell is, in map squares (0 outside)."""
    gx = np.arange(0, W + step, step)
    gy = np.arange(0, H + step, step)
    coarse = np.array([[inside(x0 + px / S, y0 + py / S) for px in gx] for py in gy], bool)
    depth = np.zeros(coarse.shape, float)
    cur = coarse.copy()
    for k in range(1, reach):
        depth[cur] = k
        nxt = cur.copy()
        nxt[1:, :] &= cur[:-1, :]
        nxt[:-1, :] &= cur[1:, :]
        nxt[:, 1:] &= cur[:, :-1]
        nxt[:, :-1] &= cur[:, 1:]
        cur = nxt
    return depth * step / S, step


def square_setts(inside, x0, y0, x1, y1, seed=0, fringe=0.45, bands=(), tone=None, cover=None):
    """Granite setts for the market place over the squares [x0, x1) x [y0, y1) wherever inside(x, y) holds.

    bands: (cx, cy, r_in, r_out) in map squares, a ring of warm sandstone blocks laid round a point, as round a
    market cross. tone(x, y): a whole-step shift of a stone's shade (-1 grimy, +1 worn smooth) at its middle.
    Near the edge of cover(x, y) (inside by default) stones go missing and the joints turn to moss, so the
    paving breaks up into the grass; where it meets other paving, like the pavement, it stays whole."""
    W, H = (x1 - x0) * S, (y1 - y0) * S
    out = np.zeros((H, W, 4), np.uint8)
    depth, step = _depth_field(cover or inside, x0, y0, W, H)
    ch, sw = 11, 16                                              # a course's height and a stone's length
    shade_of = {}

    def stone_shade(key, mx, my):
        if key not in shade_of:
            v = hsh(key[0], key[1], seed + key[2])
            base = 3 + (tone(mx, my) if tone else 0) + (-1 if v < 0.08 else 1 if v > 0.93 else 0)
            warm = hsh(key[0], key[1], seed + 11 + key[2]) < 0.045
            shade_of[key] = (max(1, min(4, base)), GRANITE_WARM if warm else GRANITE)
        return shade_of[key]

    for py in range(H):
        for px in range(W):
            d = depth[min(depth.shape[0] - 1, py // step), min(depth.shape[1] - 1, px // step)]
            mx, my = x0 + px / S, y0 + py / S
            if d <= 0 or not inside(mx, my):
                continue
            band = None
            for cx, cy, r_in, r_out in bands:
                r = math.hypot(mx - cx, (my - cy) * 1.1)             # a touch flattened, seen from above
                if r_in <= r < r_out:
                    band = (cx, cy, r_in, r_out, r)
            if band:
                out[py, px, :3] = _band_pixel(band, mx, my, seed)
                out[py, px, 3] = 255
                continue
            row = py // ch
            x = px + int(hsh(row, 1, seed) * 18)
            k, lx, ly = x // sw, x % sw, py % ch
            key = (k, row, 0)
            last = sw - 1
            edge = d < fringe
            if edge and hsh(key[0], key[1], seed + 3) < (1 - d / fringe) * 0.8:
                continue                                         # a stone gone at the ragged edge
            base, pal = stone_shade(key, mx, my)
            corner = (lx in (0, last) and ly in (0, ch - 1))
            if ly == ch - 1 or lx == last or corner:
                col = MOSS[int(hsh(px, py, seed) * 3)] if edge else tuple(int(c * 0.86) for c in pal[base - 1])
            elif ly == 0:
                col = pal[base + 1]
            elif ly == ch - 2 or lx == last - 1:
                col = pal[base - 1]
            else:
                col = pal[base]
                if hsh(px // 2, py // 2, seed + 9) < 0.018:
                    col = pal[base - 1]                          # pitting
            out[py, px, :3] = col
            out[py, px, 3] = 255
    _weeds(out, depth, step, fringe, seed, rate=0.0016)
    return Image.fromarray(out, "RGBA")


def _band_pixel(band, mx, my, seed):
    """A pixel of the sandstone ring: two courses of blocks laid round it, radial joints, a dark kerb each side."""
    cx, cy, r_in, r_out, r = band
    px_r = (r - r_in) * S                                         # hires px out from the inner edge
    width = (r_out - r_in) * S
    if px_r < 2 or px_r > width - 3:
        return KERB[1] if px_r < 1 or px_r > width - 2 else KERB[3]
    course = 0 if px_r < width / 2 else 1
    circ = 2 * math.pi * r * S
    n = max(8, round(circ / 22))
    ang = (math.atan2(my - cy, mx - cx) + math.pi) / (2 * math.pi) + course * 0.5 / n
    k = int(ang * n) % n
    along = (ang * n) % 1.0
    if along * circ / n < 1.2 or abs(px_r - width / 2) < 0.7:
        return SANDSTONE[1]                                      # the joints
    base = 3 if hsh(k, course, seed + 31) > 0.3 else 2
    inner_edge = px_r - (2 if course == 0 else width / 2) < 1.5
    return SANDSTONE[base + 1] if inner_edge else SANDSTONE[base]


def _weeds(out, depth, step, fringe, seed, rate):
    """A few tufts of weed in the joints, thicker toward the ragged edge."""
    H, W = out.shape[:2]
    for py in range(2, H - 1, 3):
        for px in range(1, W - 2, 3):
            d = depth[min(depth.shape[0] - 1, py // step), min(depth.shape[1] - 1, px // step)]
            if d <= 0 or out[py, px, 3] == 0:
                continue
            chance = rate * (6 if d < fringe * 2 else 1)
            if hsh(px, py, seed + 21) < chance:
                for dx, dy, c in ((0, 0, 1), (1, 0, 2), (1, -1, 2), (2, 0, 1), (-1, -1, 0), (2, -2, 1)):
                    if 0 <= px + dx < W and 0 <= py + dy < H and out[py + dy, px + dx, 3]:
                        out[py + dy, px + dx, :3] = WEED[c]


def flagstones(inside, x0, y0, x1, y1, seed=0):
    """York-stone pavement: big buff slabs in courses, each slab its own shade, a crack across one here and there,
    over the squares [x0, x1) x [y0, y1) wherever inside(x, y) holds."""
    W, H = (x1 - x0) * S, (y1 - y0) * S
    out = np.zeros((H, W, 4), np.uint8)
    ch = 20
    for py in range(H):
        row = py // ch
        ly = py % ch
        # slab edges along this course: widths of 26 to 44 px
        for px in range(W):
            if not inside(x0 + px / S, y0 + py / S):
                continue
            x = px + int(hsh(row, 2, seed) * 40)
            k = x // 36
            lx = x % 36
            cut = 26 + int(hsh(k, row, seed + 1) * 18)        # this slab's own length within its 36 px cell
            v = hsh(k, row, seed)
            base = 3 if v > 0.3 else 2 if v > 0.08 else 4
            if lx >= cut:                                         # the next slab starts early: a short one
                k, lx, base = k + 1000, lx - cut, 3 if hsh(k + 1000, row, seed) > 0.4 else 4
            if ly == ch - 1 or lx == 0:
                col = FLAG[1]
            elif ly == 0:
                col = FLAG[min(5, base + 1)]
            elif ly == ch - 2:
                col = FLAG[base - 1]
            else:
                col = FLAG[base]
                if hsh(k, row, seed + 5) < 0.06 and abs((lx - 4) - (ly - 3) * 1.5) < 0.7:
                    col = FLAG[1]                                # a crack across the slab
            out[py, px, :3] = col
            out[py, px, 3] = 255
    return Image.fromarray(out, "RGBA")


def kerb_line(img, x0, y0, xa, xb, kerb_y, drains=7.0, seed=0, gutter=True):
    """Draws a granite kerb into `img` (an RGBA picture whose top-left is map square (x0, y0)) from x = xa to xb
    along y = kerb_y(x): the kerb's lit top, its face stepping down to the road, and a gutter of small setts laid
    along it with an iron drain every `drains` squares."""
    a = np.array(img)
    H, W = a.shape[:2]
    rows = [KERB[4]] + [KERB[3]] * 3 + [KERB[2]] + [KERB[1]] * 3 + [KERB[0]]    # its top, then its face
    for px in range(int((xa - x0) * S), int((xb - x0) * S)):
        if not 0 <= px < W:
            continue
        mx = x0 + px / S
        top = int(round((kerb_y(mx) - y0) * S))
        joint = (px + int(hsh(0, 3, seed) * 40)) % 44 == 0
        for i, col in enumerate(rows):
            if 0 <= top + i < H:
                a[top + i, px, :3] = KERB[1] if joint and i < 5 else col
                a[top + i, px, 3] = 255
        if not gutter:
            continue
        drain = (mx % drains) < 0.45
        for i in range(9, 15):
            y = top + i
            if not 0 <= y < H:
                continue
            if drain:
                col = IRON[0] if (px % 3 == 0 or i in (9, 14)) else IRON[1]
            else:
                lx, ly = (px + (i // 3 % 2) * 4) % 8, (i - 9) % 3
                col = GRANITE[1] if lx == 7 or ly == 2 else GRANITE[2] if ly == 1 else GRANITE[3]
            a[y, px, :3] = col
            a[y, px, 3] = 255
    return Image.fromarray(a, "RGBA")


def kerb_end(img, x0, y0, x, ya, yb):
    """A short kerb running north and south at the end of a pavement, at map x from ya to yb."""
    a = np.array(img)
    H, W = a.shape[:2]
    px0 = int((x - x0) * S)
    for py in range(int((ya - y0) * S), int((yb - y0) * S)):
        for i, col in enumerate((KERB[4], KERB[3], KERB[3], KERB[2], KERB[1])):
            if 0 <= py < H and 0 <= px0 + i < W:
                a[py, px0 + i, :3] = col
                a[py, px0 + i, 3] = 255
    return Image.fromarray(a, "RGBA")
