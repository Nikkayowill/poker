"""Ambient-life sprites the engine animates (docs/stackacres-premium-life.md, Phase 3): butterflies, a dragonfly,
a bird and its ground shadow, fireflies, falling leaves, a fish jumping, and drifting cloud shadows.

Every function returns PIL RGBA images. Frames face right; the engine mirrors them. Tiny sprites are drawn as
grids of keys so each pixel is placed on purpose; glows, shadows and clouds carry stepped alpha instead of
ramp colours, because they are blended over the scene.
"""
import math

import numpy as np
from PIL import Image

from pal import Canvas, hash2


def _grid(rows, keys, w, h):
    """rows: strings of keys; keys: key -> (ramp, level). '.' is transparent."""
    assert len(rows) == h and all(len(r) == w for r in rows), rows
    c = Canvas(w, h)
    for y, row in enumerate(rows):
        for x, k in enumerate(row):
            if k != ".":
                c.put(x, y, *keys[k])
    return c.image()


def _alpha_grid(rows, keys, w, h):
    """rows: strings of keys; keys: key -> (r, g, b, a)."""
    assert len(rows) == h and all(len(r) == w for r in rows), rows
    img = Image.new("RGBA", (w, h))
    for y, row in enumerate(rows):
        for x, k in enumerate(row):
            if k != ".":
                img.putpixel((x, y), keys[k])
    return img


# ------------------------------------------------------------------ butterflies

BUTTERFLY_WINGS = {
    "white": {"U": ("linen", 6.0), "u": ("linen", 4.2), "L": ("linen", 5.0), "l": ("linen", 3.4), "T": ("coal", 1.6)},
    "yellow": {"U": ("straw", 5.6), "u": ("straw", 3.8), "L": ("gold", 4.2), "l": ("gold", 2.8), "T": ("leather", 1.4)},
    "blue": {"U": ("blue", 4.6), "u": ("blue", 3.0), "L": ("teal", 4.4), "l": ("blue", 2.2), "T": ("coal", 1.2)},
}
BUTTERFLY_BODY = {"B": ("coal", 1.2), "a": ("coal", 2.4)}


def butterfly_frames(kind):
    """[wings_open, wings_closed], 7x6, seen from above, body down the middle column (x=3)."""
    keys = {**BUTTERFLY_WINGS[kind], **BUTTERFLY_BODY}
    wings_open = [
        "TUa.aUT",
        "UUuBuUU",
        "uUuBuUu",
        ".LlBlL.",
        ".Ll.lL.",
        ".......",
    ]
    wings_closed = [
        "..a.a..",
        "..uBu..",
        "..UBU..",
        "..LBl..",
        "...B...",
        ".......",
    ]
    return [_grid(wings_open, keys, 7, 6), _grid(wings_closed, keys, 7, 6)]


# ------------------------------------------------------------------ dragonfly

def dragonfly_frames():
    """[wings_a, wings_b], 9x7: a teal body along the middle row, head and big eyes at the right, glassy wings."""
    keys = {
        "g": ("glass", 4.4), "w": ("linen", 6.0), "b": ("teal", 2.8), "B": ("teal", 4.8),
        "e": ("blue", 4.0), "d": ("coal", 1.6),
    }
    body = "dbbbBBbee"
    wings_a = ["....wg...", "...ggg...", "....gg...", body, "....gg...", "...ggg...", "....wg..."]
    wings_b = ["..wg.....", "..ggg....", "...gg....", body, "...gg....", "..ggg....", "..wg....."]
    return [_grid(wings_a, keys, 9, 7), _grid(wings_b, keys, 9, 7)]


# ------------------------------------------------------------------ bird

def bird_frames():
    """[wings_up, wings_level, wings_down], 9x7: a dark crow flying right, seen from the side so it reads at a
    glance, tail at the left, a pale eye and a grey beak at the right."""
    keys = {
        "K": ("coal", 1.0), "k": ("coal", 2.6), "W": ("coal", 1.8), "w": ("slate", 3.2),
        "e": ("slate", 5.0), "y": ("stone", 3.0),
    }
    wings_up = ["...w.....", "...WW....", "....WWK..", ".KKkkKKey", "KK.KKKK..", ".........", "........."]
    wings_level = [".........", ".........", "..wWWWK..", ".KKkkKKey", "KK.KKKK..", ".........", "........."]
    wings_down = [".........", ".........", "......K..", ".KKkkKKey", "KK.WKKK..", "...WWw...", "....W...."]
    return [_grid(r, keys, 9, 7) for r in (wings_up, wings_level, wings_down)]


def bird_shadow():
    """7x3 ground shadow under a flying bird: a dark core, a lighter edge, dithered tips."""
    ink = (26, 20, 48)
    keys = {"c": ink + (90,), "e": ink + (45,), "d": ink + (28,)}
    rows = ["..eee..", "eecccee", "..eee.."]
    img = _alpha_grid(rows, keys, 7, 3)
    img.putpixel((1, 0), keys["d"])
    img.putpixel((5, 2), keys["d"])
    return img


# ------------------------------------------------------------------ firefly

def firefly_glow():
    """7x7, for additive blending: a near-opaque warm core, fading yellow-green rings, a dithered outer ring."""
    img = Image.new("RGBA", (7, 7))
    for y in range(7):
        for x in range(7):
            d = math.hypot(x - 3, y - 3)
            if d == 0:
                px = (255, 250, 170, 240)
            elif d < 1.5:
                px = (196, 242, 96, 150)
            elif d < 2.3:
                px = (156, 224, 64, 72)
            elif d < 3.2 and (x + y) % 2 == 0:
                px = (120, 200, 50, 32)
            else:
                continue
            img.putpixel((x, y), px)
    return img


# ------------------------------------------------------------------ falling leaf

def leaf_frames():
    """4 frames, 4x4: one small leaf tumbling through four orientations, with a dark edge so it reads on grass."""
    keys = {"L": ("straw", 4.4), "m": ("leaf2", 4.2), "D": ("dirt", 1.5), "s": ("wood", 2.8)}
    frames = [
        ["..Ls", ".LmD", "LmD.", "D..."],
        ["....", "sLLm", ".mmD", "...."],
        ["D...", "LmD.", ".LmD", "..Ls"],
        [".s..", ".L..", ".mD.", ".D.."],
    ]
    return [_grid(rows, keys, 4, 4) for rows in frames]


# ------------------------------------------------------------------ fish jump

def fish_jump_frames():
    """5 frames, 11x9, sitting on water: ripple starts, fish rises, tops its arc, dives, ripple closes."""
    keys = {
        "r": ("water", 6.2), "R": ("water", 7.0), "q": ("water", 5.4), "p": ("linen", 6.2),
        "f": ("stone", 4.2), "F": ("stone", 6.0), "h": ("linen", 6.4), "d": ("blue", 2.2), "e": ("coal", 0.8),
    }
    empty = "..........."
    ripple_start = [empty] * 7 + ["...rRRRr...", "..r.....r.."]
    rising = [
        empty,
        empty,
        "......Fh...",
        ".....fFe...",
        "....dfF....",
        "...dfd.p...",
        "..p.d...p..",
        "..rRRRRRr..",
        ".r.......r.",
    ]
    top = [
        empty,
        "....fFFhe..",
        "...dfFFFf..",
        "..d.dddd...",
        empty,
        "....p......",
        "..p.....p..",
        "...rRRRr...",
        "..r.....r..",
    ]
    diving = [
        empty,
        empty,
        "...dF......",
        "....fFh....",
        ".....fFe...",
        "......fF.p.",
        ".......Fp..",
        "..rRRRRRRr.",
        ".r.......r.",
    ]
    closing = [empty] * 7 + [".q.q...q.q.", "q.........q"]
    return [_grid(rows, keys, 11, 9) for rows in (ripple_start, rising, top, diving, closing)]


# ------------------------------------------------------------------ cloud shadow

CLOUD_INK = (28, 30, 64)
CLOUD_ALPHA = 56


def cloud_shadow(seed):
    """About 120x64: a hard-edged cloud-shaped patch of shade, solid inside, with a 3px checkerboard rim.
    Crisp pixel art on purpose: soft, blurred cloud blobs were rejected twice."""
    w, h = 120, 64
    ys, xs = np.mgrid[0:h, 0:w].astype(float)
    inside = np.zeros((h, w), bool)
    n = 7 + int(hash2(seed, 0, 1) * 3)
    for i in range(n):
        t = (i + 0.5) / n
        cx = 12 + t * (w - 24) + (hash2(seed, i, 2) - 0.5) * 8
        cy = h / 2 + (hash2(seed, i, 3) - 0.5) * 14 - math.sin(t * math.pi) * 4
        r = (10 + math.sin(t * math.pi) * 14) * (0.8 + hash2(seed, i, 4) * 0.4)
        ry = r * (0.72 + hash2(seed, i, 5) * 0.2)
        inside |= ((xs - cx) / r) ** 2 + ((ys - cy) / ry) ** 2 <= 1
    # little billows along the top and bottom edges so the outline isn't a smooth sausage
    for i in range(10):
        cx = 14 + hash2(seed, i, 6) * (w - 28)
        top = hash2(seed, i, 7) < 0.5
        col = inside[:, int(cx)]
        rows = np.nonzero(col)[0]
        if not len(rows):
            continue
        cy = rows.min() + 2 if top else rows.max() - 2
        r = 4 + hash2(seed, i, 8) * 5
        inside |= ((xs - cx) / r) ** 2 + ((ys - cy) / (r * 0.8)) ** 2 <= 1
    inside[:, :1] = inside[:, -1:] = False
    inside[:1, :] = inside[-1:, :] = False
    core = inside.copy()
    for _ in range(3):
        core = core & np.roll(core, 1, 0) & np.roll(core, -1, 0) & np.roll(core, 1, 1) & np.roll(core, -1, 1)
    rim = inside & ~core
    checker = ((xs.astype(int) + ys.astype(int)) % 2) == 0
    keep = core | (rim & checker)
    arr = np.zeros((h, w, 4), np.uint8)
    arr[keep] = CLOUD_INK + (CLOUD_ALPHA,)
    return Image.fromarray(arr, "RGBA")
