#!/usr/bin/env python3
"""64x64 dialogue portraits for every rig character, in six expressions.

Stardew's 64x64 portraits are the reference: head and shoulders, a big face whose eyes, brows and mouth carry the
feeling. One face system serves all 14 people; what differs is taken from each character's rig roles and head style
through characters.py's own ramp mapping, so a portrait always matches its sprite. Helmets and hoods hide what the
sprite hides and show the feeling through what is left (eyes behind a visor, a glowing stare) plus a small mark.

Writes rich/out/portraits/<name>.png (the six expressions across) and contact.png (everyone at 3x).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from PIL import Image  # noqa: E402

import characters as C  # noqa: E402
from pal import RGB, TOP, Canvas, lambert  # noqa: E402

SIZE = 64
EXPRESSIONS = ("neutral", "happy", "sad", "surprised", "thinking", "love")
OUT = os.path.join(HERE, "out", "portraits")
# The head: centre and radii. Everything else is placed from these.
HX, HY, HRX, HRY = 32, 30, 16, 18
TOP_Y, LEFT, RIGHT = HY - HRY, HX - HRX, HX + HRX
EYES = ((HX - 7, HY + 1), (HX + 7, HY + 1))
MOUTH_Y = HY + 11
SHOULDERS = HY + HRY + 2
HELMETS = {"dive_helmet", "great_helm"}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def role(ch, group, key):
    """(ramp, level) for one of a character's colour roles, as its sprite shades it."""
    ramp = C.part_ramp(ch, group, key)
    return ramp, C.level_matching(ramp, ch["roles"][key])


def blob(c, cx, cy, rx, ry, ramp, base, spread=2.2, clip=None):
    """A lit ellipse: lighter toward the top-left, darker toward the bottom-right."""
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            nx, ny = (x - cx) / rx, (y - cy) / ry
            d = nx * nx + ny * ny
            if d > 1 or (clip and not clip(x, y)):
                continue
            nz = math.sqrt(max(0.0, 1 - d))
            c.put(x, y, ramp, clamp(base + (lambert(nx, ny, nz) - 0.45) * spread, 0.2, TOP[ramp]))


def in_head(x, y, grow=0.0):
    return ((x - HX) / (HRX + grow)) ** 2 + ((y - HY) / (HRY + grow)) ** 2 <= 1


# ------------------------------------------------------------------ body

def torso(c, ch):
    kind = ch.get("torso", "overalls")
    shirt, sl = role(ch, "shirt", "R")

    def half(y):
        return min(26, 12 + (y - SHOULDERS) * 3)

    for y in range(SHOULDERS, SIZE):
        for x in range(HX - half(y), HX + half(y)):
            t = (x - (HX - half(y))) / (2 * half(y))
            level = sl + 0.9 - t * 1.8 - (0.7 if y == SHOULDERS else 0)
            if abs(x - HX) in (half(y) - 3, half(y) - 4) and y > SHOULDERS + 4:
                level -= 0.6                                          # where the arm meets the shoulder
            c.put(x, y, shirt, clamp(level, 0.3, TOP[shirt]))
    if kind == "overalls":
        denim, dl = role(ch, "legs", "L")
        gold, gl = role(ch, "buckle", "Y")
        for y in range(SHOULDERS + 6, SIZE):
            for x in range(HX - 10, HX + 10):
                c.put(x, y, denim, clamp(dl + 0.6 - (x - HX + 10) * 0.07 - (0.4 if (x - y) % 3 == 0 else 0), 0.3, TOP[denim]))
        for x0 in (HX - 10, HX + 7):
            for y in range(SHOULDERS, SHOULDERS + 7):
                for x in range(x0, x0 + 3):
                    c.put(x, y, denim, dl + (0.8 if x == x0 else -0.2))
            c.put(x0 + 1, SHOULDERS + 6, gold, gl + 1.0)
            c.put(x0, SHOULDERS + 6, gold, gl)
        for x in range(HX - 6, HX + 6):
            c.put(x, SHOULDERS + 10, denim, dl - 0.9)
    elif kind in ("apron", "vest", "coat"):
        acc, al = role(ch, "accent", "A")
        if kind == "apron":
            for y in range(SHOULDERS + 4, SIZE):
                for x in range(HX - 9, HX + 9):
                    c.put(x, y, acc, clamp(al + 0.7 - (x - HX + 9) * 0.08, 0.3, TOP[acc]))
            for y in range(SHOULDERS - 1, SHOULDERS + 4):
                c.put(HX - 8, y, acc, al + 0.4)
                c.put(HX + 7, y, acc, al - 0.4)
        elif kind == "vest":
            for y in range(SHOULDERS, SIZE):
                for x in range(HX - half(y), HX + half(y)):
                    if abs(x - HX) >= 4 + (y - SHOULDERS) // 3:
                        t = (x - (HX - half(y))) / (2 * half(y))
                        c.put(x, y, acc, clamp(al + 0.8 - t * 1.6, 0.3, TOP[acc]))
        else:
            for y in range(SHOULDERS, SIZE):
                for k in range(3):
                    c.put(HX - 1 - (y - SHOULDERS) // 2 - k, y, shirt, sl - 1.2 + k * 0.5)
                    c.put(HX + (y - SHOULDERS) // 2 + k, y, shirt, sl - 1.6 + k * 0.3)
    elif kind == "robe":
        for y in range(SHOULDERS, SIZE):
            w = max(0, 7 - (y - SHOULDERS) // 2)
            for x in range(HX - w, HX + w):
                c.put(x, y, shirt, sl - 1.8)
    else:
        for y in range(SHOULDERS, SHOULDERS + 5):
            c.put(HX - 3 - (y - SHOULDERS), y, shirt, sl + 1.2)
            c.put(HX + 2 + (y - SHOULDERS), y, shirt, sl - 0.4)


def neck_and_head(c, ch):
    skin, sl = role(ch, "skin", "S")
    for y in range(HY + 12, SHOULDERS + 2):
        for x in range(HX - 6, HX + 6):
            c.put(x, y, skin, sl - 0.4 - (x - HX + 6) * 0.1 - (0.9 if y < HY + 16 else 0))
    for ex in (LEFT - 1, RIGHT + 1):
        blob(c, ex, HY + 2, 2.6, 3.6, skin, sl - 0.3, spread=1.6)
    blob(c, HX, HY, HRX, HRY, skin, sl + 0.2, spread=2.4)
    c.put(HX + 1, HY + 5, skin, sl - 1.2)                             # the nose
    c.put(HX + 1, HY + 6, skin, sl - 1.0)
    c.put(HX, HY + 5, skin, sl + 0.9)


def hair_sides(c, ch, low=None):
    if "H" not in ch["roles"]:
        return
    hair, hl = role(ch, "hair", "H")
    for y in range(TOP_Y + 5, low or HY + 4):
        for x0, x1 in ((LEFT, LEFT + 4), (RIGHT - 3, RIGHT + 1)):
            for x in range(x0, x1):
                if in_head(x, y, 0.6):
                    level = hl + 0.6 - (0.9 if x0 > HX else 0) - (0.6 if (x + y // 2) % 3 == 0 else 0)
                    c.put(x, y, hair, level)


def fringe(c, ch, top=None, bottom=None):
    hair, hl = role(ch, "hair", "H")
    top = TOP_Y if top is None else top
    bottom = TOP_Y + 9 if bottom is None else bottom
    for y in range(top, bottom):
        for x in range(LEFT, RIGHT + 1):
            if not in_head(x, y, 0.6):
                continue
            if y > bottom - 1 - (1 if x % 4 == 0 else 0) - (1 if (x * 7) % 5 == 0 else 0):
                continue
            level = hl + 0.8 - (x - LEFT) * 0.04 - (y - top) * 0.05 - (0.7 if (x + y // 2) % 3 == 0 else 0)
            c.put(x, y, hair, level)


# ------------------------------------------------------------------ hats, hoods and helmets

def crown(c, ch, cx, cy, rx, ry, clip_bottom, spread=2.0):
    hat, hl = role(ch, "hat", "C")
    blob(c, cx, cy, rx, ry, hat, hl + 0.2, spread=spread, clip=lambda x, y: y <= clip_bottom)
    return hat, hl


def brim(c, ch, cy, rx, ry, up_ends=0.0):
    hat, hl = role(ch, "hat", "C")
    for y in range(int(cy - ry) - 4, int(cy + ry) + 2):
        for x in range(int(HX - rx) - 1, int(HX + rx) + 2):
            nx = (x - HX) / rx
            lift = up_ends * max(0.0, abs(nx) - 0.6) * 2.5
            if nx * nx + ((y + lift - cy) / ry) ** 2 <= 1:
                c.put(x, y, hat, hl + (0.9 if y + lift < cy else -0.6) - nx * 0.6)


def rows(c, x0, x1, y, ramp, level, slope=0.03):
    for x in range(x0, x1 + 1):
        c.put(x, y, ramp, level - (x - x0) * slope)


def head_style(c, ch):
    style = ch["head"]
    T = TOP_Y
    if style == "flat_cap_beard":
        hair_sides(c, ch, low=HY + 6)
        hat, hl = crown(c, ch, HX, T + 4, HRX + 2, 7, T + 7)
        rows(c, LEFT - 2, RIGHT + 1, T + 8, hat, hl - 1.2)
        rows(c, LEFT - 2, RIGHT + 1, T + 9, hat, hl - 0.4)
        rows(c, HX - 10, HX - 4, T, "white", 5.6, 0)
    elif style in ("straw_hat", "sunhat_veil"):
        hair_sides(c, ch)
        brim(c, ch, T + 7, 30 if style == "straw_hat" else 29, 4)
        hat, hl = crown(c, ch, HX, T, 12, 7, T + 5)
        band_ramp, bl = role(ch, "hat", "c")
        rows(c, HX - 11, HX + 11, T + 4, band_ramp, bl + 0.3)
        rows(c, HX - 11, HX + 11, T + 5, band_ramp, bl - 0.5)
        for y in range(0, T + 12):
            for x in range(0, SIZE):
                p = c.get(x, y)
                if p and p[0] == hat and (x + y) % 2 == 0:
                    c.put(x, y, hat, p[1] - 0.35)                     # the weave
    elif style == "toque":
        fringe(c, ch, T + 3, T + 8)
        hair_sides(c, ch)
        hat, hl = role(ch, "hat", "C")
        for y in range(T, T + 6):
            rows(c, LEFT, RIGHT, y, hat, hl + (0.5 if y == T else -0.4 if y == T + 5 else 0), 0.05)
        blob(c, HX, T - 5, 17, 8, hat, hl + 0.3, spread=1.8)
        for x in (HX - 8, HX, HX + 8):
            for y in range(0, T):
                if c.get(x, y):
                    c.put(x, y, hat, hl - 1.0)
    elif style == "fedora":
        fringe(c, ch, T + 3, T + 9)
        hair_sides(c, ch)
        brim(c, ch, T + 6, 25, 3)
        hat, hl = crown(c, ch, HX, T - 1, 12, 7, T + 4)
        acc, al = role(ch, "accent", "A")
        rows(c, HX - 11, HX + 11, T + 3, acc, al + 0.4)
        rows(c, HX - 11, HX + 11, T + 4, acc, al - 0.4)
        for y in range(max(0, T - 7), T - 1):
            c.put(HX, y, hat, hl - 1.3)
    elif style == "cap_back":
        fringe(c, ch, T + 5, T + 11)
        hair_sides(c, ch)
        hat, hl = crown(c, ch, HX, T + 3, HRX + 1, 7, T + 6)
        rows(c, HX - 5, HX + 5, T + 6, hat, hl - 1.4, 0)
        c.put(HX, T - 3, hat, hl + 1.5)
    elif style == "hard_hat":
        fringe(c, ch, T + 5, T + 10)
        hair_sides(c, ch)
        hat, hl = crown(c, ch, HX, T + 3, HRX + 2, 9, T + 6)
        rows(c, LEFT - 3, RIGHT + 3, T + 7, hat, hl - 0.1)
        rows(c, LEFT - 3, RIGHT + 3, T + 8, hat, hl - 1.3)
        for y in range(T - 5, T + 6):
            if c.get(HX, y):
                c.put(HX, y, hat, hl + 1.2)
    elif style == "toadstool":
        hair_sides(c, ch)
        hat, hl = crown(c, ch, HX, T, 26, 11, T + 6)
        rows(c, LEFT - 8, RIGHT + 8, T + 6, "tan", 4.4, 0.02)
        rows(c, LEFT - 8, RIGHT + 8, T + 7, "tan", 3.0, 0.02)
        for sx, sy, r in ((HX - 9, T - 4, 2.8), (HX + 6, T - 6, 2.3), (HX + 15, T, 2.0), (HX - 17, T + 1, 1.8), (HX - 1, T + 1, 1.6)):
            blob(c, sx, sy, r, r * 0.8, "linen", 5.4, spread=1.2)
    elif style == "stetson":
        fringe(c, ch, T + 4, T + 9)
        hair_sides(c, ch)
        brim(c, ch, T + 6, 29, 3, up_ends=3)
        hat, hl = crown(c, ch, HX, T - 2, 11, 7, T + 4)
        acc, al = role(ch, "accent", "A")
        rows(c, HX - 10, HX + 10, T + 2, acc, al + 0.3)
        rows(c, HX - 10, HX + 10, T + 3, acc, al - 0.5)
        for y in range(max(0, T - 8), T - 2):
            c.put(HX, y, hat, hl - 1.3)
    elif style == "shaved":
        skin, sl = role(ch, "skin", "S")
        for x, y in ((HX - 8, T + 4), (HX - 7, T + 3), (HX - 6, T + 3)):
            c.put(x, y, skin, sl + 1.6)
    elif style == "hood":
        hood, hl = role(ch, "hat", "C")
        for y in range(2, SIZE):
            for x in range(4, SIZE - 4):
                d_out = ((x - HX) / 24) ** 2 + ((y - HY + 1) / 28) ** 2
                d_in = ((x - HX) / 13.5) ** 2 + ((y - HY - 2) / 15) ** 2
                if d_out <= 1 and d_in > 1:
                    level = hl + 0.8 - (x - 4) * 0.025 - y * 0.012 - (0.5 if (x + y) % 5 == 0 else 0)
                    c.put(x, y, hood, clamp(level, 0.2, TOP[hood]))
                elif d_in <= 1:
                    c.put(x, y, "coal", 0.4 + (1 - d_in) * 0.9)       # the face lost in the hood's shade


def helmet(c, ch):
    metal, ml = role(ch, "hat", "C")
    if ch["head"] == "dive_helmet":
        blob(c, HX, HY - 1, 25, 25, metal, ml + 0.4, spread=2.6)
        acc, al = role(ch, "accent", "A")
        ring, rl = role(ch, "accent", "a")
        for y in range(HY - 13, HY + 13):
            for x in range(HX - 17, HX + 18):
                d = ((x - HX) / 14.5) ** 2 + ((y - HY) / 11) ** 2
                if d <= 1:
                    streak = 0.2 < (x - HX + 14 + (y - HY + 11)) / 44 < 0.3
                    c.put(x, y, acc, al - 1.2 - (y - HY + 11) * 0.04 + (1.4 if streak else 0))
                elif d <= 1.35:
                    c.put(x, y, ring, rl + (0.8 if y < HY else -0.4))
        for bx, by in ((HX - 22, HY), (HX + 21, HY), (HX, HY - 23), (HX - 15, HY - 17), (HX + 15, HY - 17)):
            c.put(bx, by, "gold", 4.6)
            c.put(bx + 1, by + 1, "gold", 2.4)
    else:
        for y in range(5, SHOULDERS + 2):
            for x in range(HX - 19, HX + 20):
                if ((x - HX) / 19.5) ** 2 + (max(0, 22 - y) / 17) ** 2 <= 1:
                    level = ml + 1.0 - (x - HX + 19) * 0.06 + (0.8 if x in (HX - 14, HX - 13) else 0)
                    c.put(x, y, metal, clamp(level, 0.4, TOP[metal]))
        for y in range(HY - 1, HY + 3):
            rows(c, HX - 14, HX + 14, y, "coal", 0.3, 0)
        for y in range(HY + 7, HY + 17, 3):
            rows(c, HX - 3, HX + 3, y, "coal", 0.8, 0)
        acc, al = role(ch, "accent", "A")
        for y in range(0, 7):
            for x in range(HX - 2 - y // 3, HX + 3 + y // 3):
                c.put(x, y, acc, al + 1.0 - (x - HX + 3) * 0.2)


# ------------------------------------------------------------------ the face

def eyes(c, expr, glow=False, slit=False):
    """Eyes carry most of the feeling. `glow` for eyes in a dark hood, `slit` for eyes behind a helm's slit."""
    white = ("gold", 5.0) if glow else ("linen", 5.8)
    pupil = ("gold", 3.0) if glow else ("coal", 0.3)
    for ex, ey in EYES:
        if slit:
            glints = {"surprised": [(-1, 0), (0, 0), (1, 0), (-1, 1), (0, 1), (1, 1)], "happy": [(-1, 1), (0, 0), (1, 1)],
                      "sad": [(-1, 1), (0, 1)], "love": [(-1, 0), (1, 0), (0, 1)]}.get(expr, [(-1, 0), (0, 0), (-1, 1)])
            for dx, dy in glints:
                c.put(ex + dx, ey + dy, "gold", 5.0)
            continue
        if expr == "happy":
            for dx, dy in ((-2, 0), (-1, -1), (0, -1), (1, -1), (2, 0), (-2, 1), (2, 1)):
                c.put(ex + dx, ey + dy, *pupil)
        elif expr == "love":
            for j, row in enumerate([".R.R.", "RRRRR", "RRRRR", ".RRR.", "..R.."]):
                for i, k in enumerate(row):
                    if k == "R":
                        c.put(ex - 2 + i, ey - 2 + j, "red", 4.6 - j * 0.5 + (1.6 if (i, j) in ((1, 0), (0, 1)) else 0))
        elif expr == "surprised":
            for y in range(ey - 3, ey + 2):
                for x in range(ex - 2, ex + 3):
                    if (x, y) not in ((ex - 2, ey - 3), (ex + 2, ey - 3), (ex - 2, ey + 1), (ex + 2, ey + 1)):
                        c.put(x, y, *white)
            c.put(ex, ey - 1, *pupil)
            c.put(ex, ey, *pupil)
        else:
            lid = ey - 1 if expr == "sad" else ey - 2
            for y in range(lid + 1, ey + 2):
                for x in range(ex - 2, ex + 3):
                    c.put(x, y, *white)
            for x in range(ex - 2, ex + 3):
                c.put(x, lid, *pupil)
            px, py = {"thinking": (ex, ey - 1), "sad": (ex - 1, ey)}.get(expr, (ex - 1, ey - 1))
            for dx in (0, 1):
                for dy in (0, 1):
                    c.put(px + dx, py + dy, *pupil)
            if not glow:
                c.put(px, py, "linen", 6.0)


def brows(c, ch, expr):
    ramp, level = role(ch, "hair", "H") if "H" in ch["roles"] else role(ch, "skin", "s")
    level = max(0.3, level - 1.6)
    for side, (ex, ey) in zip((-1, 1), EYES):
        by = ey - 6
        for dx in range(-3, 4):
            inner = dx * side < 0                                     # toward the nose
            y = by
            if expr in ("happy", "love"):
                y = by - (1 if abs(dx) <= 1 else 0)
            elif expr == "sad":
                y = by + (1 if not inner else 0) - (1 if inner and abs(dx) >= 2 else 0)
            elif expr == "surprised":
                y = by - 2 - (1 if abs(dx) <= 1 else 0)
            elif expr == "thinking":
                y = by - (2 if side > 0 else 0) + (1 if side < 0 and inner else 0)
            c.put(ex + dx, y, ramp, level)
            c.put(ex + dx, y + 1, ramp, level + 0.8) if abs(dx) <= 2 else None


def mouth(c, expr):
    dark, pink, y = ("coal", 1.0), ("pink", 2.8), MOUTH_Y
    if expr == "happy":
        c.put(HX - 5, y - 1, *dark)
        c.put(HX + 5, y - 1, *dark)
        rows(c, HX - 4, HX + 4, y, *dark, slope=0)
        rows(c, HX - 3, HX + 3, y + 1, *pink, slope=0)
        rows(c, HX - 2, HX + 2, y + 2, *dark, slope=0)
    elif expr == "sad":
        rows(c, HX - 3, HX + 3, y, *dark, slope=0)
        c.put(HX - 4, y + 1, *dark)
        c.put(HX + 4, y + 1, *dark)
    elif expr == "surprised":
        for dx, dy in ((-1, -1), (0, -1), (1, -1), (-2, 0), (2, 0), (-2, 1), (2, 1), (-1, 2), (0, 2), (1, 2)):
            c.put(HX + dx, y + dy, *dark)
        for dx, dy in ((-1, 0), (0, 0), (1, 0), (-1, 1), (0, 1), (1, 1)):
            c.put(HX + dx, y + dy, "coal", 0.2)
    elif expr == "thinking":
        rows(c, HX, HX + 4, y, *dark, slope=0)
        c.put(HX - 1, y + 1, *dark)
    elif expr == "love":
        rows(c, HX - 3, HX + 3, y, *dark, slope=0)
        c.put(HX - 4, y - 1, *dark)
        c.put(HX + 4, y - 1, *dark)
    else:
        rows(c, HX - 3, HX + 3, y, *dark, slope=0)


def blush(c, ch, strength):
    base = {"skin_light": 3.0, "skin_mid": 2.5, "skin_deep": 1.9}.get(C.part_ramp(ch, "skin", "S"), 2.5) + strength
    for cx in (EYES[0][0] - 5, EYES[1][0] + 2):
        for dx in range(4):
            c.put(cx + dx, EYES[0][1] + 5, "pink", base - abs(dx - 1.5) * 0.3)


def beard(c, ch):
    hair, hl = role(ch, "hair", "H")
    for y in range(HY + 4, SHOULDERS + 3):
        for x in range(LEFT - 1, RIGHT + 2):
            if ((x - HX) / (HRX + 1.5)) ** 2 + ((y - HY - 4) / 16) ** 2 > 1 or y < HY + 4 + abs(x - HX) // 4:
                continue
            c.put(x, y, hair, hl + 0.4 - (x - LEFT) * 0.035 - (y - HY) * 0.04 - (0.7 if (x * 2 + y) % 3 == 0 else 0))
    for x in range(HX - 8, HX + 9):                                   # moustache
        c.put(x, MOUTH_Y - 2, hair, hl + 0.9 - abs(x - HX) * 0.07)
        c.put(x, MOUTH_Y - 1, hair, hl - 0.6)


def veil(c):
    for y in range(TOP_Y + 9, SHOULDERS + 4):
        for x in range(LEFT - 5, RIGHT + 6):
            over_face = in_head(x, y) and y > TOP_Y + 9
            mesh = (x % 3 == 0 and y % 3 == 0) if over_face else (x % 2 == 0 and y % 2 == 0)  # thinner over the face
            if mesh or (x in (LEFT - 5, LEFT - 4, RIGHT + 4, RIGHT + 5) and y % 3):
                c.put(x, y, "linen", 5.0 if c.get(x, y) else 5.8)


def visor(c):
    for y in range(4, SHOULDERS + 4):
        for x in range(4, SIZE - 4):
            d = ((x - HX) / 23) ** 2 + ((y - HY) / 21) ** 2
            if 1 < d <= 1.4:
                c.put(x, y, "linen", 6.0 - (x - 4) * 0.04)
    for k in range(7):
        c.put(HX - 12 + k, HY - 13 + k // 2, "linen", 6.0)
        c.put(HX - 11 + k, HY - 13 + k // 2, "linen", 5.4)


# ------------------------------------------------------------------ marks beside the head

MARKS = {
    "love": ["RR.RR", "RRRRR", "RRRRR", ".RRR.", "..R.."],
    "thinking": [".LL.", "L..L", "..L.", ".L..", "....", ".L.."],
    "surprised": ["Y", "Y", "Y", ".", "Y"],
    "sad": [".L", "LL", "LL"],
    "happy": ["..NN", "..N.", "NNN.", "NN.."],
}
MARK_RAMP = {"R": ("red", 4.6), "L": ("water", 5.6), "Y": ("gold", 4.6), "N": ("wood", 3.0)}


def mark(c, expr, x=54, y=3):
    grid = MARKS.get(expr)
    if not grid:
        return
    m = Canvas(len(grid[0]) + 2, len(grid) + 2)
    for j, row in enumerate(grid):
        for i, k in enumerate(row):
            if k != ".":
                ramp, level = MARK_RAMP[k]
                m.put(i + 1, j + 1, ramp, level + (0.8 if j == 0 else 0))
    m.outline(ramp="coal", idx=0.6, rim=False)
    x = min(x, SIZE - m.w)
    for j in range(m.h):
        for i in range(m.w):
            if m.px[j][i]:
                c.px[y + j][x + i] = m.px[j][i]


# ------------------------------------------------------------------ assembly

def finish(c):
    filled = {(x, y) for y in range(SIZE) for x in range(SIZE) if c.px[y][x]}
    c.outline(rim_amount=0.45, lit_bonus=0.04)
    for y in range(SIZE):
        for x in range(SIZE):
            p = c.px[y][x]
            if p and (x, y) not in filled and C.luminance(RGB[p[0]][0]) > 48:
                c.px[y][x] = ("coal", 0.6)


def portrait(name, expression):
    ch = C.rig.CHARACTERS[name]
    style = ch["head"]
    c = Canvas(SIZE, SIZE)
    torso(c, ch)
    if style in HELMETS:
        helmet(c, ch)
        eyes(c, expression, slit=style == "great_helm")
        finish(c)
        mark(c, expression)
        return c.image()
    neck_and_head(c, ch)
    if style not in ("shaved", "hood", "flat_cap_beard") and "H" in ch["roles"]:
        fringe(c, ch)
    head_style(c, ch)
    if style == "hood":
        eyes(c, expression, glow=True)
        finish(c)
        mark(c, expression if expression != "happy" else "")
        return c.image()
    brows(c, ch, expression)
    eyes(c, expression)
    if expression in ("happy", "love"):
        blush(c, ch, 0.6 if expression == "love" else 0.2)
    if style == "flat_cap_beard":
        beard(c, ch)
    mouth(c, expression)
    if style == "sunhat_veil":
        veil(c)
    if style == "space_helmet":
        visor(c)
    finish(c)
    if expression == "sad":
        c.put(EYES[0][0] - 2, EYES[0][1] + 3, "water", 6.2)
        c.put(EYES[0][0] - 2, EYES[0][1] + 4, "water", 4.6)
    mark(c, expression if expression in ("love", "thinking") else "")
    return c.image()


def main():
    os.makedirs(OUT, exist_ok=True)
    names = list(C.rig.CHARACTERS)
    contact = Image.new("RGBA", (len(EXPRESSIONS) * SIZE * 3, len(names) * SIZE * 3), (58, 50, 42, 255))
    for r, name in enumerate(names):
        row = Image.new("RGBA", (len(EXPRESSIONS) * SIZE, SIZE))
        for col, expr in enumerate(EXPRESSIONS):
            img = portrait(name, expr)
            row.alpha_composite(img, (col * SIZE, 0))
            contact.alpha_composite(img.resize((SIZE * 3, SIZE * 3), Image.NEAREST), (col * SIZE * 3, r * SIZE * 3))
        row.save(os.path.join(OUT, f"{name}.png"))
    contact.save(os.path.join(OUT, "contact.png"))
    print("portraits:", len(names), "x", len(EXPRESSIONS))


if __name__ == "__main__":
    main()
