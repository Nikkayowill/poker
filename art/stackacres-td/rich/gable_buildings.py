"""Gable-front farm buildings: the ridge runs away from the camera, so the roof
shows as two (or, on the barn's gambrel, four) sloped planes meeting at a
peak, above a triangular front wall. Lit from the top left: left planes catch
the sun, right planes sit in shade.

Uses the drawing pieces in gable_kit.py. Drawn at the pack's 32px per tile and
handed to the export at half size, like the pack trees (lpc_trees.py).
"""
import numpy as np
from PIL import Image, ImageDraw

import gable_kit as B
from gable_kit import (Cv, hsh, hx, RED_ROOF, BROWN_ROOF, SLATE_ROOF, CREAM, WOOD, DARKWOOD, BARN, STONE,
                       GLASS, GREEN, WHITE, PLASTER, LEAF, FLOWERS)


def poly_mask(w, h, pts):
    im = Image.new('L', (w, h), 0)
    ImageDraw.Draw(im).polygon([(float(x), float(y)) for x, y in pts], fill=255)
    return np.asarray(im) > 0


def profile_y(profile, x):
    """Height of the roof's front edge at x (profile is left to right)."""
    for (x0, y0), (x1, y1) in zip(profile, profile[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / max(1e-9, x1 - x0)
    return None


def roof(cv, profile, depth, R, style='shingle', lit=(1, -1), seed=0):
    """Every segment of the front profile swept back by `depth` into a plane.
    `lit` gives each plane's light step, left to right."""
    n = len(profile) - 1
    for i in range(n):
        (ax, ay), (bx, by) = profile[i], profile[i + 1]
        m = poly_mask(cv.w, cv.h, [(ax, ay), (bx, by), (bx, by - depth), (ax, ay - depth)])
        step = lit[i] if i < len(lit) else lit[-1]
        inside = lambda x, y, m=m: m[y, x]
        if style == 'barrel':
            barrel(cv, inside, R, step, seed + i)
        else:
            B.shingles(cv, inside, R, row_h=7, sh_w=10, seed=seed + i, lit=lambda x, y, s=step: s)
    # ridge and hip creases: a cap line running back from every inner vertex
    for i in range(1, n):
        x, y = profile[i]
        apex = y == min(p[1] for p in profile)
        for yy in range(int(y - depth), int(y) + 1):
            if apex:
                cv.put(x - 2, yy, R[1]); cv.put(x - 1, yy, R[5]); cv.put(x, yy, R[4]); cv.put(x + 1, yy, R[2]); cv.put(x + 2, yy, R[0])
                if (yy - int(y - depth)) % 6 == 5:
                    cv.put(x - 1, yy, R[2]); cv.put(x, yy, R[1]); cv.put(x + 1, yy, R[1])
            else:
                cv.put(x, yy, R[0]); cv.put(x + 1, yy, R[4] if x < profile[n // 2][0] else R[1])
    # the back edge catches light as a thin rim
    for i in range(n):
        (ax, ay), (bx, by) = profile[i], profile[i + 1]
        for x in range(int(ax), int(bx) + 1):
            y = ay + (by - ay) * (x - ax) / max(1e-9, bx - ax) - depth
            cv.put(x, int(round(y)), R[5] if i < n / 2 else R[3])


def barrel(cv, inside, R, step, seed):
    """Clay barrel tiles in horizontal courses (see buildings.barrel_tiles), with a light step per plane."""
    pts = [(x, y) for y in range(cv.h) for x in range(cv.w) if inside(x, y)]
    for x, y in pts:
        r, ly = y // 8, y % 8
        c, lx = x // 8, x % 8
        base = 3 + step
        v = hsh(c, r, seed)
        if v < 0.15: base -= 1
        elif v > 0.92: base += 1
        prof = [1, 2, 2, 1, 0, 0, -1, -2][lx]
        b = max(1, min(5, base + (1 if prof >= 2 else 0) - (1 if prof <= -1 else 0)))
        col = R[b]
        lip = 6 + (1 if lx in (0, 7) else 0) - (1 if lx in (3, 4) else 0)
        if ly >= lip:
            col = R[max(0, base - 2)]
        elif ly == lip - 1 and lx in (1, 2, 3):
            col = R[min(5, b + 1)]
        if lx == 7 and ly < lip:
            col = R[max(0, base - 2)]
        if hsh(x, y, seed + 7) < 0.03 and ly < lip - 1:
            col = R[max(1, b - 1)]
        cv.put(x, y, col)


def barge(cv, profile, T, thick=4):
    """Trim boards along the front edge of the roof: the triangle's outline."""
    for (ax, ay), (bx, by) in zip(profile, profile[1:]):
        for x in range(int(ax), int(bx) + 1):
            y = int(round(ay + (by - ay) * (x - ax) / max(1e-9, bx - ax)))
            for k in range(thick):
                col = T[5] if k == 0 else (T[4] if k < thick - 1 else T[2])
                cv.put(x, y + k, col)
            cv.put(x, y - 1, T[1])
    # a finial / boss where the boards meet at the peak
    top = min(profile, key=lambda p: p[1])
    cv.rect(top[0] - 2, top[1] - 2, top[0] + 3, top[1] + 5, T[4]); cv.put(top[0] - 2, top[1] - 2, T[5])


def front_face(cv, profile, x0, x1, wall_top, foot, fill):
    """The front wall: a rectangle below `wall_top`, and the gable up to the roof edge.
    `fill(tmp)` paints the wall material into a scratch canvas that is then clipped."""
    tmp = Cv(cv.w, cv.h)
    fill(tmp)
    for x in range(x0, x1):
        py = profile_y(profile, x)
        if py is None:
            continue
        for y in range(int(py) + 3, foot):
            cv.put(x, y, tmp.get(x, y))
    # shade under the barge boards: the roof's overhang
    for x in range(x0, x1):
        py = profile_y(profile, x)
        for k in range(4, 9):
            y = int(py) + k
            if y < foot and cv.solid(x, y):
                c = np.array(cv.get(x, y), float) * (0.55 if k < 7 else 0.78)
                cv.put(x, y, tuple(c.astype(int)))


def corner_posts(cv, x0, x1, top_of, foot, T=WHITE, w=5):
    for px in (x0, x1 - w):
        for x in range(px, px + w):
            for y in range(int(top_of(x)) + 3, foot):
                k = x - px
                cv.put(x, y, T[4] if k < 2 else (T[3] if k < w - 1 else T[1]))


def round_window(cv, cx, cy, r, trim=WHITE):
    for y in range(cy - r - 2, cy + r + 3):
        for x in range(cx - r - 2, cx + r + 3):
            d = (x - cx) ** 2 + (y - cy) ** 2
            if d <= (r + 2) ** 2:
                cv.put(x, y, trim[4] if d > r * r else (GLASS[4] if (x - cx) + (y - cy) in (-3, -2) else (GLASS[2] if y > cy else GLASS[1])))
    cv.vline(cx, cy - r, cy + r + 1, trim[4]); cv.hline(cx - r, cx + r + 1, cy, trim[4])


# ---------------------------------------------------------------- buildings

def farmhouse():
    W, H = 216, 236
    cv = Cv(W, H)
    foot = 206
    # side wing on the right, lower and set back behind the main block
    wx0, wx1, wtop = 146, 204, 156
    wprof = [(wx0 - 6, wtop + 4), ((wx0 + wx1) // 2, wtop - 26), (wx1 + 6, wtop + 4)]
    roof(cv, wprof, 34, RED_ROOF, style='barrel', seed=40)
    front_face(cv, wprof, wx0, wx1, wtop, foot, lambda t: B.hboards(t, wx0, 60, wx1, foot, CREAM, seed=41))
    corner_posts(cv, wx0, wx1, lambda x: profile_y(wprof, x), foot)
    barge(cv, wprof, WHITE)
    B.window(cv, 164, 172, 22, 20, shutters=None, seed=5)
    # the main block, gable to the front
    x0, x1, wall_top = 22, 150, 140
    prof = [(x0 - 10, wall_top + 6), ((x0 + x1) // 2, wall_top - 46), (x1 + 10, wall_top + 6)]
    roof(cv, prof, 50, RED_ROOF, style='barrel', seed=1)
    B.chimney(cv, 112, 52, 16, 40)
    front_face(cv, prof, x0, x1, wall_top, foot, lambda t: B.vboards(t, x0, 40, x1, foot, CREAM, bw=7, seed=2))
    corner_posts(cv, x0, x1, lambda x: profile_y(prof, x), foot)
    barge(cv, prof, WHITE, thick=5)
    cx = (x0 + x1) // 2
    round_window(cv, cx, 120, 8)
    B.panel_door(cv, cx - 12, 162, 24, 44, R=BARN)
    B.lamp(cv, cx + 20, 158)
    B.window(cv, 34, 164, 24, 22, shutters=GREEN, seed=1)
    B.window(cv, 112, 164, 24, 22, shutters=GREEN, seed=2)
    B.foundation(cv, x0, wx1, foot, foot + 7)
    # porch
    for y in range(foot + 1, foot + 20):
        for x in range(x0 - 8, x1 + 8):
            ly = (y - foot - 1) % 5
            seg = (x + (y // 5) * 17) // 34
            base = 3 if hsh(seg, y // 5, 9) > 0.25 else 2
            col = WOOD[base]
            if ly == 4: col = WOOD[1]
            elif ly == 0: col = WOOD[base + 1]
            if (x + (y // 5) * 17) % 34 == 0: col = WOOD[1]
            cv.put(x, y, col)
    for x in range(x0 - 8, x1 + 8):
        cv.put(x, foot + 20, DARKWOOD[1]); cv.put(x, foot + 21, DARKWOOD[0])
    for px in (x0 - 6, x1 + 2):
        for y in range(foot - 26, foot + 20):
            cv.put(px, y, WOOD[4]); cv.put(px + 1, y, WOOD[3]); cv.put(px + 2, y, WOOD[3]); cv.put(px + 3, y, WOOD[1])
    for seg in ((x0 - 2, cx - 18), (cx + 18, x1 + 2)):
        for x in range(*seg):
            cv.put(x, foot + 3, WOOD[4]); cv.put(x, foot + 4, WOOD[3]); cv.put(x, foot + 5, WOOD[1])
            if (x - seg[0]) % 7 == 3:
                for y in range(foot + 6, foot + 17):
                    cv.put(x, y, WOOD[3]); cv.put(x + 1, y, WOOD[1])
    for i, y in enumerate(range(foot + 20, foot + 30, 5)):
        for yy in range(y, y + 5):
            for x in range(cx - 16 - i * 2, cx + 16 + i * 2):
                cv.put(x, yy, WOOD[5] if yy == y else (WOOD[3] if yy - y < 3 else WOOD[1]))
    B.barrel(cv, 176, foot - 16)
    B.pot(cv, cx + 22, foot + 1)
    cv.outline()
    return cv.image()


def barn():
    W, H = 216, 212
    cv = Cv(W, H)
    foot = 192
    x0, x1, wall_top = 14, 202, 124
    cx = (x0 + x1) // 2
    # gambrel: steep lower slopes, shallow upper ones
    prof = [(x0 - 8, wall_top + 4), (x0 + 30, wall_top - 40), (cx, wall_top - 66), (x1 - 30, wall_top - 40), (x1 + 8, wall_top + 4)]
    roof(cv, prof, 52, BROWN_ROOF, lit=(0, 1, -1, -2), seed=5)
    # cupola sitting on the ridge
    cy = wall_top - 66 - 40
    for yy in range(cy, cy + 22):
        for xx in range(cx - 10, cx + 11):
            col = BARN[3] if xx < cx + 3 else BARN[1]
            if (xx - cx + 10) % 5 == 0: col = BARN[1]
            cv.put(xx, yy, col)
    for yy in range(cy + 4, cy + 16):
        for xx in range(cx - 6, cx + 7):
            cv.put(xx, yy, WHITE[4] if (xx + yy) % 3 else WHITE[2])
    for i in range(10):
        c = BROWN_ROOF[4] if i % 2 else BROWN_ROOF[3]
        cv.hline(cx - 13 + i, cx + 1, cy - 1 - i, c)
        cv.hline(cx + 1, cx + 14 - i, cy - 1 - i, BROWN_ROOF[1] if i % 2 else BROWN_ROOF[2])
    cv.vline(cx, cy - 20, cy - 10, STONE[1]); cv.hline(cx - 4, cx + 5, cy - 17, STONE[3])
    front_face(cv, prof, x0, x1, wall_top, foot, lambda t: B.vboards(t, x0, 30, x1, foot, BARN, bw=8, seed=6))
    corner_posts(cv, x0, x1, lambda x: profile_y(prof, x), foot)
    barge(cv, prof, WHITE, thick=5)
    # a white band where the gambrel meets the walls
    for x in range(x0, x1):
        for k, c in enumerate((WHITE[5], WHITE[4], WHITE[2])):
            cv.put(x, wall_top + 8 + k, c)
    # hay loft
    lx, ly = cx - 15, wall_top - 44
    cv.rect(lx - 3, ly - 3, lx + 33, ly + 34, WHITE[4]); cv.hline(lx - 3, lx + 33, ly - 3, WHITE[5])
    cv.rect(lx, ly, lx + 30, ly + 31, hx('#24160f'))
    for yy in range(ly + 12, ly + 31):
        for xx in range(lx, lx + 30):
            if yy - ly > 15 + 4 * np.sin(xx * 0.7):
                v = hsh(xx, yy, 4)
                cv.put(xx, yy, hx('#f2cf5c') if v > 0.55 else (hx('#d8a93c') if v > 0.2 else hx('#a8772a')))
    cv.hline(lx - 4, lx + 34, ly - 8, WOOD[3]); cv.hline(lx - 4, lx + 34, ly - 7, WOOD[1])
    cv.vline(cx, ly - 8, ly - 2, STONE[1]); cv.rect(cx - 2, ly - 4, cx + 3, ly - 1, STONE[2])
    B.barn_doors(cv, cx - 34, 138, 68, 54)
    B.window(cv, 30, 144, 18, 18, box=False, seed=3)
    B.window(cv, x1 - 48, 144, 18, 18, box=False, seed=4)
    B.lamp(cv, cx - 44, 132); B.lamp(cv, cx + 44, 132)
    B.foundation(cv, x0, x1, foot, foot + 7, seed=2)
    for y in range(foot, foot + 14):
        for x in range(cx - 38 - (y - foot), cx + 38 + (y - foot)):
            ly2 = (y - foot) % 5
            cv.put(x, y, DARKWOOD[5] if ly2 == 0 else (DARKWOOD[1] if ly2 == 4 else DARKWOOD[3]))
    cv.outline()
    return cv.image()


def workshop():
    W, H = 192, 200
    cv = Cv(W, H)
    foot = 176
    x0, x1, wall_top = 18, 170, 116
    cx = (x0 + x1) // 2
    prof = [(x0 - 10, wall_top + 6), (cx, wall_top - 56), (x1 + 10, wall_top + 6)]
    roof(cv, prof, 56, SLATE_ROOF, seed=12)
    # stovepipe through the shaded slope
    for y in range(12, 70):
        for k in range(8):
            cv.put(128 + k, y, STONE[4] if k < 2 else (STONE[3] if k < 5 else STONE[1]))
        if y % 12 == 0:
            cv.hline(127, 137, y, STONE[1])
    cv.rect(125, 8, 139, 13, STONE[2]); cv.hline(125, 139, 8, STONE[4])

    def frame(t):
        for y in range(40, foot):
            for x in range(x0, x1):
                v = hsh(x // 2, y // 2, 13)
                t.put(x, y, PLASTER[4] if v > 0.2 else (PLASTER[3] if v < 0.97 else PLASTER[2]))
        # gable in boards above the tie beam
        B.hboards(t, x0, 40, x1, wall_top + 4, WOOD, seed=14)
        for bx in (x0, 56, cx - 3, x1 - 62, x1 - 6):
            for y in range(wall_top + 4, foot):
                for k in range(6):
                    t.put(bx + k, y, DARKWOOD[3] if k < 2 else (DARKWOOD[2] if k < 5 else DARKWOOD[0]))
        for by in (wall_top, wall_top + 26, foot - 6):
            for x in range(x0, x1):
                for k in range(5):
                    t.put(x, by + k, DARKWOOD[4] if k == 0 else (DARKWOOD[2] if k < 4 else DARKWOOD[0]))
        for (a, b, up) in ((x0 + 6, 56, False), (x1 - 56, x1 - 6, True)):
            for x in range(a, b):
                t_ = (x - a) / (b - a)
                y = int(wall_top + 30 + (t_ if not up else 1 - t_) * 16)
                for k in range(4):
                    t.put(x, y + k, DARKWOOD[2] if k else DARKWOOD[4])

    front_face(cv, prof, x0, x1, wall_top, foot, frame)
    barge(cv, prof, WOOD, thick=5)
    # sign in the gable
    sx, sy = cx - 14, wall_top - 30
    cv.rect(sx, sy, sx + 28, sy + 18, WOOD[3]); cv.hline(sx, sx + 28, sy, WOOD[5]); cv.hline(sx, sx + 28, sy + 17, WOOD[1])
    cv.vline(sx, sy, sy + 18, WOOD[4]); cv.vline(sx + 27, sy, sy + 18, WOOD[1])
    for k in range(14):
        cv.put(sx + 4 + k, sy + 12 - k // 3, STONE[4]); cv.put(sx + 4 + k, sy + 13 - k // 3, STONE[2])
    cv.rect(sx + 3, sy + 11, sx + 7, sy + 15, BARN[3])
    cv.vline(sx + 20, sy + 4, sy + 15, WOOD[1]); cv.rect(sx + 17, sy + 3, sx + 25, sy + 7, STONE[2]); cv.hline(sx + 17, sx + 25, sy + 3, STONE[4])
    # doors and windows
    x, y, w, h = cx - 22, 136, 44, 40
    cv.rect(x - 3, y - 3, x + w + 3, y + h, DARKWOOD[2]); cv.hline(x - 3, x + w + 3, y - 3, DARKWOOD[4])
    B.vboards(cv, x, y, x + w, y + h, WOOD, bw=5, seed=15)
    for yy in (y + 6, y + h - 9):
        for xx in range(x, x + w):
            cv.put(xx, yy, DARKWOOD[1]); cv.put(xx, yy + 1, STONE[2]); cv.put(xx, yy + 2, DARKWOOD[1])
    cv.vline(x + w // 2, y, y + h, DARKWOOD[0])
    cv.put(x + w // 2 - 3, y + h // 2, hx('#f2cd5a')); cv.put(x + w // 2 + 2, y + h // 2, hx('#f2cd5a'))
    B.window(cv, 30, 146, 18, 16, trim=WOOD, seed=5)
    B.window(cv, x1 - 48, 146, 18, 16, trim=WOOD, seed=6)
    B.foundation(cv, x0, x1, foot, foot + 7, seed=3)
    for r in range(4):
        for c in range(3):
            lx0, ly0 = x0 - 14 + c * 6, foot - 2 - r * 6
            for yy in range(ly0, ly0 + 6):
                for xx in range(lx0, lx0 + 6):
                    d = (xx - lx0 - 2.5) ** 2 + (yy - ly0 - 2.5) ** 2
                    if d <= 7:
                        cv.put(xx, yy, hx('#e3b77a') if d < 2.5 else (WOOD[3] if d < 5 else WOOD[1]))
    ax, ay = x1 - 20, foot - 12
    cv.rect(ax + 3, ay + 4, ax + 11, ay + 12, STONE[1])
    cv.rect(ax, ay, ax + 16, ay + 5, STONE[2]); cv.hline(ax, ax + 16, ay, STONE[4]); cv.rect(ax - 4, ay + 1, ax, ay + 3, STONE[2])
    cv.outline()
    return cv.image()


# ---------------------------------------------------------------- for the export

# Where each building's door, lamps, windows and chimney are, in its full-size pixels.
FEATURES = {
    'farmhouse': {'door': 86, 'lights': [(106, 162, 'lamp'), (46, 175, 'window'), (124, 175, 'window'), (175, 182, 'window')],
                  'chimney': (120, 50)},
    'barn': {'door': 108, 'lights': [(64, 136, 'lamp'), (152, 136, 'lamp'), (39, 153, 'window'), (163, 153, 'window')],
             'chimney': None},
    'workshop': {'door': 94, 'lights': [(39, 154, 'window'), (131, 154, 'window')], 'chimney': (132, 6)},
}
DRAW = {'farmhouse': farmhouse, 'barn': barn, 'workshop': workshop}


def made(name):
    """(half-size stand-in, base point) with the full-size drawing in info['hires'], plus where the
    door, chimney and lights land relative to the base point, in map px."""
    img = DRAW[name]()
    l, t, r, b = img.getbbox()
    l, t, r, b = l - l % 2, t - t % 2, r + r % 2, b + b % 2
    img = img.crop((l, t, r, b))
    proxy = img.resize((img.width // 2, img.height // 2), Image.NEAREST)
    proxy.info['hires'] = {'img': img, 'scale': 0.5}
    f = FEATURES[name]
    proxy.info['lights'] = [((x - l) // 2, (y - t) // 2, k) for x, y, k in f['lights']]
    proxy.info['solid_h'] = proxy.height - 10              # the whole plan walks round, not just the porch
    base = (proxy.width // 2, proxy.height)
    rel = lambda x, y: ((x - l) // 2 - base[0], (y - t) // 2 - base[1])
    meta = {'door_dx': rel(f['door'], 0)[0], 'chimney': rel(*f['chimney']) if f['chimney'] else None,
            'size': (proxy.width, proxy.height)}
    return (proxy, base), meta


if __name__ == '__main__':
    import os
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'previews')
    ims = [workshop(), farmhouse(), barn()]
    w = sum(i.width for i in ims) + 24 * 4
    h = max(i.height for i in ims) + 24
    sheet = Image.new('RGBA', (w, h), (104, 150, 72, 255))
    x = 24
    for im in ims:
        sheet.alpha_composite(im, (x, h - 12 - im.height)); x += im.width + 24
    sheet.resize((w * 2, h * 2), Image.NEAREST).convert('RGB').save(os.path.join(out, 'buildings.png'))
