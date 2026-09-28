"""The City's building kit: the pieces an old market town's buildings are made of, in the farm's building
style (gable_kit.py), drawn at the pack's 32px per tile and handed to the export at half size.

A town building here faces the street with its eaves to the front, the way terraces and shops on a high street
do: a roof band above a front wall of one to three storeys. `building()` puts one together from a spec
(walls, roof, storeys, a shopfront or a front door, a hanging sign) so the town's houses and shops come from
one kit and line up with each other: every storey is the same height, windows sit in the same columns up the
front, and doors and signs are centred on their bays. Lit from the top left like everything else on the map.
"""
import numpy as np

import gable_kit as B
from gable_kit import CREAM, GLASS, GREEN, PLASTER, RED_ROOF, SLATE_ROOF, STONE, WHITE, WOOD, Cv, hsh, ramp

TILE = 32                      # hires px to a map square
# Storey heights, the same on every building so floors line up along a street. A door is as tall as a person
# (the cast stands 32 map px, 64 here), like the grocery's, and each storey leaves room over it.
GROUND_H, UPPER_H = 94, 80

# ---------------------------------------------------------------- colours

BRICK = ramp('#3e1712', '#662519', '#8a3524', '#a8472f', '#c25e3e', '#d97b56')
SANDSTONE = ramp('#4a3c2c', '#7c6648', '#a68c66', '#c6ad84', '#ddc8a0', '#f0e2c2')
THATCH = ramp('#3a2a12', '#654a1f', '#8e6c2c', '#b38c3c', '#d2ac55', '#ead07e')
IRON = ramp('#18181e', '#2a2a32', '#3e3e48', '#585866', '#7a7a8a', '#a0a0b0')
BRASS = ramp('#4a3210', '#6e4c16', '#a07424', '#d0a040', '#ecc868', '#fff0a8')
MOSS = ramp('#223018', '#344a24', '#4a6230', '#62803e', '#80a050', '#a0c068')
CANVAS_RED = ramp('#4a1410', '#78201a', '#a02e24', '#c0443a', '#d8624f', '#ec8a74')
CANVAS_GREEN = ramp('#132a1a', '#1f4228', '#2e5c38', '#3f7a4a', '#58965e', '#7cb47a')
CANVAS_BLUE = ramp('#121e36', '#1c3054', '#2a4676', '#3c6096', '#5a80b2', '#86a6cc')
PAINT = {
    'green': GREEN,
    'red': ramp('#3a0e10', '#621a1c', '#8a2626', '#aa3632', '#c84e44', '#e07262'),
    'blue': ramp('#10182e', '#1a2a4c', '#243e6e', '#325690', '#4a72ae', '#7092c6'),
    'black': ramp('#101014', '#1c1c22', '#2a2a32', '#3a3a44', '#50505c', '#6c6c7a'),
    'plum': ramp('#240e1c', '#3e1830', '#5a2446', '#76345c', '#924a74', '#b06c92'),
    'teal': ramp('#0c2626', '#15403e', '#1e5a56', '#2a766e', '#3c928a', '#62b0a6'),
    'mustard': ramp('#3a2c08', '#624a10', '#8c6c1a', '#b08a26', '#cca63a', '#e2c464'),
    'white': WHITE,
    'wood': WOOD,
}
WASH = {                       # plaster washes: cream, and the pale colours old town fronts are painted
    'cream': PLASTER,
    'pink': ramp('#5a3a3a', '#9a7070', '#c49a96', '#e0bcb6', '#f0d4ce', '#fbe8e2'),
    'yellow': ramp('#5a4a2a', '#9a8450', '#c6ae72', '#e2cc90', '#f2e0aa', '#fcf0cc'),
    'sage': ramp('#3a4a3a', '#6a7e66', '#94a88c', '#b4c6aa', '#cedcc4', '#e6eedc'),
    'blue': ramp('#3a4450', '#687a8c', '#94a6b6', '#b8c8d4', '#d2dee6', '#eaf0f4'),
    'white': WHITE,
}

# ---------------------------------------------------------------- pixels

def mul(cv, x, y, f):
    """Darken (f < 1) or lighten (f > 1) a pixel already drawn."""
    if cv.solid(x, y):
        c = np.array(cv.get(x, y), float) * f
        cv.put(x, y, tuple(np.clip(c, 0, 255).astype(int)))


def shade(cv, x0, y0, x1, y1, f_top, f_bottom=None, f_left=1.0, f_right=1.0):
    """Multiply a box by a vertical and a horizontal gradient."""
    f_bottom = f_top if f_bottom is None else f_bottom
    for y in range(y0, y1):
        fy = f_top + (f_bottom - f_top) * (y - y0) / max(1, y1 - y0 - 1)
        for x in range(x0, x1):
            fx = f_left + (f_right - f_left) * (x - x0) / max(1, x1 - x0 - 1)
            mul(cv, x, y, fy * fx)


# ---------------------------------------------------------------- lettering

FONT = {
    'A': ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    'B': ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    'C': ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    'D': ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    'E': ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    'F': ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    'G': ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    'H': ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    'I': ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    'J': ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    'K': ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    'L': ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    'M': ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    'N': ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    'O': ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    'P': ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    'Q': ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    'R': ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    'S': ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    'T': ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    'U': ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    'V': ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    'W': ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    'X': ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    'Y': ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    'Z': ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    '&': ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
    "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
    ' ': ["000", "000", "000", "000", "000", "000", "000"],
}


def text_width(text, k=1):
    return sum((len(FONT[ch][0]) + 1) * k for ch in text) - k


def lettering(cv, text, cx, cy, fg, shadow, k=2, hi=None):
    """`text` in block capitals, `k` pixels to a dot, centred on (cx, cy), with a drop shadow and, if given, a
    lighter top row where the letters catch the light."""
    x = cx - text_width(text, k) // 2
    y0 = cy - 7 * k // 2
    for ch in text:
        rows = FONT[ch]
        for r, row in enumerate(rows):
            for c, bit in enumerate(row):
                if bit != "1":
                    continue
                for dy in range(k):
                    for dx in range(k):
                        cv.put(x + c * k + dx + 1, y0 + r * k + dy + 1, shadow)
        for r, row in enumerate(rows):
            for c, bit in enumerate(row):
                if bit != "1":
                    continue
                for dy in range(k):
                    for dx in range(k):
                        top = hi is not None and (r == 0 or rows[r - 1][c] != "1") and dy == 0
                        cv.put(x + c * k + dx, y0 + r * k + dy, hi if top else fg)
        x += (len(rows[0]) + 1) * k


# ---------------------------------------------------------------- roofs

def roof_band(cv, x0, x1, ridge_y, eave_y, kind='slate', hip=0, seed=0):
    """The front slope of an eaves-to-the-street roof, from its ridge down to the eave. `hip` pulls the ends in
    toward the ridge (a hipped roof); 0 is a gable end. Slate, clay tile or thatch."""
    h = eave_y - ridge_y
    for y in range(ridge_y, eave_y):
        t = (y - ridge_y) / max(1, h - 1)
        inset = int(round(hip * (1 - t)))
        for x in range(x0 + inset, x1 - inset):
            ly = y - ridge_y
            if kind == 'slate':
                row, rh, sw = ly // 6, 6, 11
                off = (sw // 2) * (row % 2)
                lx = (x + off) % sw
                v = hsh((x + off) // sw, row, seed)
                base = 3 if v > 0.3 else 2 if v > 0.07 else 4
                col = SLATE_ROOF[base]
                if ly % rh == rh - 1:
                    col = SLATE_ROOF[0]
                elif lx == sw - 1:
                    col = SLATE_ROOF[1]
                elif ly % rh == 0:
                    col = SLATE_ROOF[min(5, base + 1)]
            elif kind == 'tile':
                row, rh, sw = ly // 7, 7, 8
                off = (sw // 2) * (row % 2)
                lx = (x + off) % sw
                v = hsh((x + off) // sw, row, seed)
                base = 3 if v > 0.25 else 2
                col = RED_ROOF[base]
                if lx in (0, 1):
                    col = RED_ROOF[min(5, base + 1)]            # the rounded crown of each pantile
                elif lx == sw - 1:
                    col = RED_ROOF[1]
                if ly % rh == rh - 1:
                    col = RED_ROOF[0]
                if hsh(x // 3, y // 5, seed + 4) < 0.04:
                    col = MOSS[2]
            else:                                               # thatch: combed straw, a darker weathered band
                v = hsh(x, y // 3, seed)
                base = 4 if v > 0.55 else 3 if v > 0.15 else 2
                if (x * 7 + y // 2) % 5 == 0:
                    base -= 1
                col = THATCH[base]
                if ly < 10:
                    col = THATCH[min(5, base + 1)] if (x // 4) % 3 else THATCH[1]   # the ridge, bound in hazel
                    if ly in (0, 9):
                        col = THATCH[1]
                    if 3 <= ly <= 6 and ((x - x0) // 6) % 2 == 0 and (x - x0 + ly) % 6 < 2:
                        col = THATCH[5]                         # the scalloped ridge pattern
            cv.put(x, y, col)
    # a ridge line, the roof lighter up toward it and shadowed at the eave
    if kind != 'thatch':
        R = SLATE_ROOF if kind == 'slate' else RED_ROOF
        for x in range(x0 + hip, x1 - hip):
            cv.put(x, ridge_y, R[5]); cv.put(x, ridge_y + 1, R[4]); cv.put(x, ridge_y + 2, R[1])
    shade(cv, x0, ridge_y + 3, x1, eave_y, 1.08, 0.86, 1.03, 0.94)
    if hip == 0 and kind != 'thatch':                           # the verge along each gable end
        for y in range(ridge_y, eave_y):
            for k, f in ((0, 0.5), (1, 0.7), (2, 0.85)):
                mul(cv, x0 + k, y, f + 0.35)
                mul(cv, x1 - 1 - k, y, f)
    if kind == 'thatch':                                        # the thick rounded thatch eave
        for x in range(x0 - 2, x1 + 2):
            for k in range(5):
                cv.put(x, eave_y + k, THATCH[3 - min(3, k)] if (x + k) % 4 else THATCH[1])
    else:
        for x in range(x0 - 2, x1 + 2):                         # the gutter
            cv.put(x, eave_y, IRON[4]); cv.put(x, eave_y + 1, IRON[2]); cv.put(x, eave_y + 2, IRON[0])


def chimney(cv, x, top, base, w=18, R=BRICK, pots=2):
    """A brick stack rising off the ridge, stone cap, clay pots, lit on its left."""
    for y in range(top + 6, base):
        row = (y - top) // 4
        for xx in range(x, x + w):
            lx = (xx - x + (row % 2) * 4) % 8
            col = R[3] if hsh((xx - x + (row % 2) * 4) // 8, row, 12) > 0.3 else R[2]
            if (y - top) % 4 == 3 or lx == 7:
                col = R[0]
            if xx < x + 2:
                col = R[4]
            elif xx >= x + w - 3:
                col = R[1]
            cv.put(xx, y, col)
    for y in range(top + 2, top + 6):
        for xx in range(x - 2, x + w + 2):
            cv.put(xx, y, STONE[5] if y == top + 2 else STONE[3] if y < top + 5 else STONE[1])
    for i in range(pots):
        px = x + 2 + i * ((w - 8) // max(1, pots - 1)) if pots > 1 else x + w // 2 - 3
        for y in range(top - 4, top + 2):
            for xx in range(px, px + 6):
                col = (184, 100, 60) if xx < px + 3 else (132, 66, 40)
                if y == top - 4:
                    col = (40, 26, 22) if px < xx < px + 5 else (210, 130, 84)
                cv.put(xx, y, col)


def dormer(cv, cx, eave_y, w, R_wall, R_roof, kind='slate'):
    """A small gabled dormer standing on the roof slope with a window in it."""
    top = eave_y - 42
    for y in range(top + 10, eave_y - 2):
        for x in range(cx - w // 2, cx + w // 2):
            cv.put(x, y, R_wall[4] if x < cx else R_wall[3])
    for k in range(12):                                         # its little roof
        for x in range(cx - w // 2 - 3 + k, cx + w // 2 + 3 - k):
            col = R_roof[3 if x < cx else 2]
            if k == 0:
                col = R_roof[1]
            if kind == 'thatch':
                col = THATCH[3 if x < cx else 2]
            cv.put(x, top + 10 - k, col)
    sash(cv, cx - (w - 10) // 2, top + 14, w - 10, eave_y - top - 20, frame=WHITE, lintel=None, panes=(2, 2))


# ---------------------------------------------------------------- walls

def wall(cv, x0, y0, x1, y1, kind, R, seed=0):
    """A stretch of front wall: 'plaster' (R a wash), 'brick', 'stone' (dressed blocks), 'timber' (black beams
    over white infill), or 'boards'."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            if kind == 'plaster':
                v = hsh(x // 3, y // 3, seed)
                col = R[4] if v > 0.2 else R[3]
                if hsh(x // 11, y // 8, seed + 1) < 0.05:
                    col = R[2]
            elif kind == 'brick':
                row = (y - y0) // 5
                lx = (x - x0 + (row % 2) * 6) % 12
                v = hsh((x - x0 + (row % 2) * 6) // 12, row, seed)
                col = R[3] if v > 0.35 else R[2] if v > 0.08 else R[4]
                if (y - y0) % 5 == 4 or lx == 11:
                    col = STONE[3]                               # lime mortar
                elif (y - y0) % 5 == 0:
                    col = R[min(5, 4 if v > 0.35 else 3)]
            elif kind == 'stone':
                row = (y - y0) // 10
                lx = (x - x0 + (row % 2) * 12) % 24
                v = hsh((x - x0 + (row % 2) * 12) // 24, row, seed)
                col = R[3] if v > 0.3 else R[4] if v > 0.1 else R[2]
                if (y - y0) % 10 == 9 or lx == 23:
                    col = R[1]
                elif (y - y0) % 10 == 0 or lx == 0:
                    col = R[min(5, 4 if v > 0.3 else 5)]
            elif kind == 'boards':
                col = None
            else:                                               # timber-framed: white infill, beams laid later
                v = hsh(x // 3, y // 3, seed)
                col = WHITE[4] if v > 0.2 else WHITE[3]
            if col is not None:
                cv.put(x, y, col)
    if kind == 'boards':
        B.hboards(cv, x0, y0, x1, y1, R, bh=6, seed=seed)


def timbers(cv, x0, y0, x1, y1, bays, braces=True):
    """The dark oak frame over a timber-framed storey: posts between bays, rails top and bottom, a brace in the
    end bays."""
    beam = PAINT['black']
    bw = (x1 - x0) / bays
    for i in range(bays + 1):
        px = int(round(x0 + i * bw)) - (3 if i == bays else 0)
        for y in range(y0, y1):
            for k in range(4):
                cv.put(px + k, y, beam[3] if k == 0 else beam[2] if k < 3 else beam[1])
    for yy in (y0, y1 - 4):
        for y in range(yy, yy + 4):
            for x in range(x0, x1):
                cv.put(x, y, beam[3] if y == yy else beam[2] if y < yy + 3 else beam[1])
    if braces:
        for i in (0, bays - 1):
            bx0 = int(round(x0 + i * bw)) + 4
            bx1 = int(round(x0 + (i + 1) * bw)) - 1
            for t in range(y1 - y0 - 8):
                fx = bx0 + (bx1 - bx0) * t / (y1 - y0 - 8)
                if i == bays - 1:
                    fx = bx1 - (bx1 - bx0) * t / (y1 - y0 - 8) - 3
                for k in range(3):
                    cv.put(int(fx) + k, y0 + 4 + t, beam[2] if k < 2 else beam[1])


def quoins(cv, x, top, foot, R=STONE, w=10, flip=False):
    """Dressed corner stones up the wall, long and short in turn."""
    for y in range(top, foot):
        course = (y - top) // 10
        width = w if course % 2 == 0 else w - 4
        for k in range(width):
            xx = x - k if flip else x + k
            col = R[4] if (y - top) % 10 not in (0, 9) else R[2]
            if (y - top) % 10 == 1:
                col = R[5]
            if k == width - 1:
                col = R[2]
            cv.put(xx, y, col)


def string_course(cv, x0, x1, y, R=STONE):
    """The moulded band between storeys: lit top, shadow under."""
    for x in range(x0, x1):
        cv.put(x, y, R[5]); cv.put(x, y + 1, R[4]); cv.put(x, y + 2, R[3]); cv.put(x, y + 3, R[1])
    for x in range(x0, x1):
        mul(cv, x, y + 4, 0.72); mul(cv, x, y + 5, 0.86)


def foundation(cv, x0, x1, y, R=STONE):
    B.foundation(cv, x0, x1, y, y + 7, R=R)
    shade(cv, x0, y, x1, y + 7, 0.82, 1.0)


# ---------------------------------------------------------------- windows and doors

def sash(cv, x, y, w, h, frame=WHITE, lintel=STONE, panes=(3, 2), sill=True, shutters=None, box=False, seed=0):
    """A sash window sunk into the wall: stone lintel over, painted frame, glazing bars, sill under, and the
    reveal's shadow along its top and left."""
    if lintel is not None:
        for yy in range(y - 6, y - 2):
            for xx in range(x - 3, x + w + 3):
                col = lintel[4] if yy == y - 6 else lintel[3] if yy < y - 3 else lintel[1]
                if xx in (x - 3, x + w + 2):
                    col = lintel[2]
                cv.put(xx, yy, col)
        cv.put(x + w // 2, y - 5, lintel[5]); cv.put(x + w // 2, y - 4, lintel[4])
    if shutters is not None:
        sw = max(5, w // 2 - 2)
        for sx in (x - sw - 2, x + w + 2):
            for yy in range(y - 1, y + h + 1):
                for xx in range(sx, sx + sw):
                    lx = xx - sx
                    col = shutters[3]
                    if lx == 0:
                        col = shutters[4]
                    if lx == sw - 1:
                        col = shutters[1]
                    if (yy - y) % 4 == 3 and 0 < lx < sw - 1:
                        col = shutters[2]
                    cv.put(xx, yy, col)
    for yy in range(y - 2, y + h + 2):
        for xx in range(x - 2, x + w + 2):
            cv.put(xx, yy, frame[4])
    cv.hline(x - 2, x + w + 2, y - 2, frame[5])
    cv.vline(x - 2, y - 2, y + h + 2, frame[5])
    cv.vline(x + w + 1, y - 2, y + h + 2, frame[2])
    cols, rows = panes
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            ly, lx = yy - y, xx - x
            col = GLASS[1] if ly < h // 3 else GLASS[2]
            if (lx + ly) % 11 in (0, 1) and ly < h * 2 // 3:
                col = GLASS[4]
            if (lx + ly) % 11 == 5 and ly < h // 2:
                col = GLASS[3]
            cv.put(xx, yy, col)
    for c in range(1, cols):                                    # glazing bars
        cv.vline(x + w * c // cols, y, y + h, frame[3])
    for r in range(1, rows * 2):
        yy = y + h * r // (rows * 2)
        if r == rows:                                           # the meeting rail between the two sashes
            cv.hline(x, x + w, yy, frame[4]); cv.hline(x, x + w, yy + 1, frame[2])
        elif rows > 1:
            cv.hline(x, x + w, yy, frame[3])
    for k in range(3):                                          # the reveal
        for xx in range(x, x + w):
            mul(cv, xx, y + k, 0.6 + k * 0.12)
        for yy in range(y, y + h):
            mul(cv, x + k, yy, 0.7 + k * 0.1)
    if sill:
        cv.hline(x - 4, x + w + 4, y + h + 2, STONE[5])
        cv.hline(x - 4, x + w + 4, y + h + 3, STONE[3])
        cv.hline(x - 4, x + w + 4, y + h + 4, STONE[1])
        for xx in range(x - 3, x + w + 5):
            mul(cv, xx, y + h + 5, 0.7)
    if box:
        B.flower_box(cv, x - 2, y + h + 5, w + 4, seed)


def front_door(cv, cx, foot, w=30, h=66, R=PAINT['green'], fanlight=True, surround=WHITE, steps=2):
    """A panelled front door centred on `cx`: a pedimented surround, a fanlight over, brass knocker, stone steps."""
    x, y = cx - w // 2, foot - h
    top = y - (12 if fanlight else 0)
    for yy in range(top - 7, foot):                             # the surround: pilasters and a hood
        for xx in range(x - 6, x + w + 6):
            if x <= xx < x + w and yy >= top:
                continue
            col = surround[4]
            if xx in (x - 6, x - 5) or yy == top - 7:
                col = surround[5]
            if xx >= x + w + 4 or yy in (top - 1,):
                col = surround[2]
            cv.put(xx, yy, col)
    for yy in range(top - 12, top - 7):                         # the hood's little pediment
        half = (w + 16) // 2 - (top - 7 - yy) * 3
        for xx in range(cx - half, cx + half):
            cv.put(xx, yy, surround[5] if yy == top - 12 or xx < cx else surround[3])
    if fanlight:
        for yy in range(top, y):
            for xx in range(x, x + w):
                dx, dy = xx - cx + 0.5, yy - y + 0.5
                inside = dx * dx + (dy * w / 24) ** 2 < (w / 2) ** 2
                col = GLASS[2] if inside else surround[3]
                if inside and (int(np.degrees(np.arctan2(-dy, dx))) % 36) < 5:
                    col = surround[4]                            # the fan's spokes
                cv.put(xx, yy, col)
    for yy in range(y, foot):
        for xx in range(x, x + w):
            lx, ly = xx - x, yy - y
            col = R[3]
            if lx <= 1:
                col = R[4]
            if lx >= w - 2:
                col = R[1]
            for (px0, py0, px1, py1) in ((3, 3, w // 2 - 1, h // 2 - 2), (w // 2 + 1, 3, w - 3, h // 2 - 2),
                                         (3, h // 2 + 1, w // 2 - 1, h - 4), (w // 2 + 1, h // 2 + 1, w - 3, h - 4)):
                if px0 <= lx < px1 and py0 <= ly < py1:
                    col = R[2]
                    if lx == px0 or ly == py0:
                        col = R[1]
                    if lx == px1 - 1 or ly == py1 - 1:
                        col = R[4]
            cv.put(xx, yy, col)
    cv.put(cx, y + 10, BRASS[5]); cv.put(cx, y + 11, BRASS[3]); cv.put(cx - 1, y + 12, BRASS[2]); cv.put(cx + 1, y + 12, BRASS[2])
    cv.put(x + w - 5, y + h // 2 + 2, BRASS[4]); cv.put(x + w - 5, y + h // 2 + 3, BRASS[1])
    for k in range(3):
        for yy in range(y, foot):
            mul(cv, x + k, yy, 0.7 + k * 0.1)
        for xx in range(x, x + w):
            mul(cv, xx, y + k, 0.65 + k * 0.1)
    for i in range(steps):
        sy = foot + i * 3
        inset = -3 - i * 3
        for yy in range(sy, sy + 3):
            for xx in range(x - 6 + inset, x + w + 6 - inset):
                cv.put(xx, yy, STONE[5] if yy == sy else STONE[3] if yy < sy + 2 else STONE[1])


def shopfront(cv, x0, x1, top, foot, R=PAINT['green'], name=None, door_at='centre', stall=True, seed=0):
    """A painted timber shopfront: fascia board with the shop's name, cornice over it, big display windows on a
    stall riser, and a recessed glazed door."""
    fascia_h = 22
    for y in range(top, top + 6):                               # cornice
        for x in range(x0 - 4, x1 + 4):
            cv.put(x, y, R[5] if y == top else R[4] if y < top + 3 else R[1])
    for y in range(top + 6, top + 6 + fascia_h):
        for x in range(x0, x1):
            col = R[2] if hsh(x // 5, y // 5, seed) > 0.25 else R[3]
            if y == top + 6:
                col = R[1]
            cv.put(x, y, col)
    for x in range(x0, x1):                                     # gilt lining round the board
        cv.put(x, top + 8, BRASS[3]); cv.put(x, top + 4 + fascia_h, BRASS[2])
    if name:
        k = 2 if text_width(name, 2) < (x1 - x0) - 12 else 1
        lettering(cv, name, (x0 + x1) // 2, top + 6 + fascia_h // 2 + 1, CREAM[5], R[0], k=k, hi=(255, 252, 236))
    ftop = top + 6 + fascia_h
    for x in (x0, x1 - 5):                                      # pilasters either end
        for y in range(ftop, foot):
            for k in range(5):
                cv.put(x + k, y, R[4] if k == 0 else R[3] if k < 4 else R[1])
    dw = 28
    dcx = (x0 + x1) // 2 if door_at == 'centre' else (x1 - 20 if door_at == 'right' else x0 + 20)
    for (wx0, wx1) in ((x0 + 5, dcx - dw // 2 - 3), (dcx + dw // 2 + 3, x1 - 5)):
        if wx1 - wx0 < 12:
            continue
        riser = foot - 16 if stall else foot - 4
        for y in range(ftop + 4, riser):
            for x in range(wx0, wx1):
                ly = y - ftop - 4
                col = GLASS[2] if ly > 6 else GLASS[1]
                if (x - wx0 + ly) % 13 in (0, 1):
                    col = GLASS[4]
                cv.put(x, y, col)
        for x in range(wx0, wx1, 16):                            # mullions
            cv.vline(x, ftop + 4, riser, R[3])
        cv.hline(wx0, wx1, ftop + 4, R[4]); cv.hline(wx0, wx1, ftop + 12, R[3])
        for y in range(riser, foot):
            for x in range(wx0, wx1):
                col = R[3] if (y - riser) % 8 else R[1]
                if (x - wx0) % 20 == 0:
                    col = R[1]
                cv.put(x, y, col)
        cv.hline(wx0 - 1, wx1 + 1, riser, STONE[4])
        shade(cv, wx0, ftop + 4, wx1, ftop + 10, 0.6, 0.95)
    for y in range(ftop + 2, foot):                             # the recessed door
        for x in range(dcx - dw // 2 - 2, dcx + dw // 2 + 2):
            cv.put(x, y, R[1])
    for y in range(ftop + 5, foot):
        for x in range(dcx - dw // 2, dcx + dw // 2):
            lx, ly = x - dcx + dw // 2, y - ftop - 5
            col = R[3]
            if 3 <= lx < dw - 3 and 3 <= ly < (foot - ftop - 5) // 2:
                col = GLASS[2] if (lx + ly) % 9 else GLASS[4]
            if lx in (0, 1):
                col = R[4]
            cv.put(x, y, col)
    cv.put(dcx + dw // 2 - 4, ftop + 5 + (foot - ftop - 5) // 2 + 2, BRASS[4])
    shade(cv, dcx - dw // 2, ftop + 5, dcx + dw // 2, ftop + 12, 0.6, 1.0)
    return dcx


def awning(cv, x0, x1, top, depth, R=CANVAS_RED):
    """A striped canvas awning on iron arms, its scalloped hem and the shadow it throws on the wall."""
    for y in range(top + depth, top + depth + 12):
        for x in range(x0 + 2, x1 - 2):
            mul(cv, x, y, 0.6 + (y - top - depth) * 0.03)
    for y in range(top, top + depth):
        for x in range(x0, x1):
            stripe = ((x - x0) // 9) % 2
            f = 0.78 + 0.22 * (y - top) / depth
            col = CREAM[5] if stripe else R[3]
            if y == top:
                col = CREAM[3] if stripe else R[1]
            cv.put(x, y, tuple(int(v * f) for v in col))
    for x in range(x0, x1):
        k = (x - x0) % 9
        drop = 3 if 2 <= k <= 6 else 2 if k in (1, 7) else 1
        stripe = ((x - x0) // 9) % 2
        for d in range(drop):
            cv.put(x, top + depth + d, CREAM[4] if stripe else R[4])
        cv.put(x, top + depth + drop, CREAM[2] if stripe else R[1])
    for ax in (x0 + 3, x1 - 4):
        for k in range(depth + 8):
            cv.put(ax, top + depth + 6 - k * 3 // 4, IRON[1])


ICONS = {                      # a hanging sign's picture, 12x10, by trade
    'loaf': ["....0000....", "..00111100..", ".0111111110.", "011212121110", "011111111110", ".0111111110.",
             "..00000000..", "............", "............", "............"],
    'sheaf': ["...2.2.2....", "..22222222..", "...222222...", "....1111....", "...000000...", "....1111....",
              "...111111...", "..11.11.11..", ".11..11..11.", "............"],
    'scissors': ["0........0..", ".0......0...", "..0....0....", "...0..0.....", "....00......", "...0110.....",
                 "..0.00.0....", ".00....00...", ".00....00...", "............"],
}


def hanging_sign(cv, x, y, icon, board=PAINT['black'], ink=None):
    """An iron bracket off the wall with a painted board swinging from it."""
    ink = ink or [BRASS[1], BRASS[4], (240, 226, 190), (140, 70, 40)]
    for k in range(22):                                         # the bracket and its scroll
        cv.put(x + k, y, IRON[2]); cv.put(x + k, y + 1, IRON[0])
    for k in range(8):
        cv.put(x + k // 2, y + 2 + k, IRON[1])
    for cx in (x + 6, x + 18):
        cv.vline(cx, y + 2, y + 5, IRON[3])
    for yy in range(y + 5, y + 21):
        for xx in range(x + 2, x + 22):
            col = board[3]
            if yy in (y + 5, y + 20) or xx in (x + 2, x + 21):
                col = BRASS[2]
            cv.put(xx, yy, col)
    for r, row in enumerate(ICONS[icon]):
        for c, ch in enumerate(row):
            if ch != '.':
                cv.put(x + 6 + c, y + 8 + r, ink[int(ch)])


def lantern(cv, x, y):
    """An iron wall lantern, lit, warming the wall round it."""
    for yy in range(y - 8, y + 16):
        for xx in range(x - 8, x + 9):
            d = ((xx - x) ** 2 + (yy - y - 4) ** 2) ** 0.5
            if d < 9:
                mul(cv, xx, yy, 1.08 - d * 0.005)
    cv.hline(x - 5, x + 1, y - 2, IRON[1])
    for yy in range(y, y + 10):
        for xx in range(x - 3, x + 4):
            col = (255, 214, 120) if 1 <= yy - y <= 7 and abs(xx - x) <= 1 else IRON[2]
            if yy - y in (0, 9) or abs(xx - x) == 3:
                col = IRON[1]
            cv.put(xx, yy, col)
    cv.put(x, y + 3, (255, 244, 200))
    cv.hline(x - 2, x + 3, y - 1, IRON[3])


# ---------------------------------------------------------------- a whole building

def building(spec):
    """One street-front building from a spec:

      width      front wall width, hires px (a multiple of 32 keeps it on the map's grid)
      storeys    1 to 3 (a cottage is 1 with dormers)
      wall       'plaster' | 'brick' | 'stone' | 'timber' | 'boards'; `wash` picks the plaster colour
      upper      the upper storeys' wall, if different (a timber-framed floor over a stone one)
      roof       'slate' | 'tile' | 'thatch'; `hip` pulls its ends in; `roof_h` its height
      bays       window columns across the front; windows on every floor sit in the same columns
      ground     'house' (front door on `door_bay`) | 'shop' (a shopfront named `name`) | 'arch' (a carriage arch)
      paint      door and shopfront colour; `shutters`, `boxes` for flower boxes upstairs
      chimneys   list of x positions (fractions of the width) for stacks on the ridge
      sign       (icon) for a hanging sign by the door; `awning` for a striped awning over the shopfront
      board      a name lettered on a board across the front, over the ground floor
      quoins     a stone ramp for dressed corner stones; `dormers` how many in the roof; `seed` varies the texture
    Returns (image, info) with info['door'] the door's centre x and info['foot'] the ground line, in hires px.
    """
    s = dict(storeys=2, wall='plaster', wash='cream', roof='slate', hip=0, roof_h=58, bays=3, ground='house',
             paint='green', shutters=None, boxes=True, chimneys=(0.2,), sign=None, awning=None, name=None,
             door_bay=None, quoins=None, dormers=0, upper=None, seed=0, board=None)
    s.update(spec)
    W = s['width']
    pad = 12
    storeys = s['storeys']
    wall_h = GROUND_H + UPPER_H * (storeys - 1)
    roof_h = s['roof_h'] if s['roof'] != 'thatch' or 'roof_h' in spec else 76
    top_extra = 34                                              # room above the ridge for chimneys
    H = top_extra + roof_h + wall_h + 20
    cv = Cv(W + pad * 2, H)
    x0, x1 = pad, pad + W
    ridge = top_extra
    eave = ridge + roof_h
    foot = eave + wall_h
    R = WASH.get(s['wash'], PLASTER)
    Rw = {'brick': BRICK, 'stone': SANDSTONE, 'boards': WOOD}.get(s['wall'], R)
    paint = PAINT[s['paint']]
    # walls, ground floor first, the upper storeys over it
    wall(cv, x0, eave, x1, foot, s['wall'], Rw, seed=s['seed'])
    upper = s['upper']
    if upper and storeys > 1:
        Ru = {'brick': BRICK, 'stone': SANDSTONE, 'boards': WOOD}.get(upper, WASH.get(s['wash'], PLASTER))
        wall(cv, x0, eave, x1, eave + UPPER_H * (storeys - 1), upper, Ru, seed=s['seed'] + 1)
    kind_up = upper or s['wall']
    if kind_up == 'timber' and storeys > 1:
        timbers(cv, x0, eave, x1, eave + UPPER_H * (storeys - 1), s['bays'] * 2)
    if s['wall'] == 'timber':
        timbers(cv, x0, foot - GROUND_H, x1, foot, s['bays'] * 2, braces=storeys == 1)
    if storeys > 1 and kind_up != 'timber':
        string_course(cv, x0, x1, foot - GROUND_H - 2)
    if s['quoins']:
        quoins(cv, x0, eave + 4, foot, R=s['quoins'])
        quoins(cv, x1 - 1, eave + 4, foot, R=s['quoins'], flip=True)
    # the roof and its stacks
    stacks = []
    for fx in s['chimneys']:
        cx = x0 + int(W * fx)
        chimney(cv, cx, ridge - 28, ridge + 10, w=18, R=BRICK if s['wall'] != 'stone' else SANDSTONE)
        stacks.append((cx + 9, ridge - 28))
    roof_band(cv, x0 - 8, x1 + 8, ridge, eave, kind=s['roof'], hip=s['hip'], seed=s['seed'] + 2)
    shade(cv, x0, eave + 3, x1, eave + 12, 0.62, 1.0)             # the eave's shadow on the wall
    # windows in columns, the same columns on every floor
    bays = s['bays']
    bay_w = W / bays
    door_bay = s['door_bay'] if s['door_bay'] is not None else bays // 2
    cols = [int(x0 + bay_w * (i + 0.5)) for i in range(bays)]
    ww = min(32, int(bay_w) - 16)
    for f in range(1, storeys):
        wy = eave + UPPER_H * (f - 1) + 16
        for i, cx in enumerate(cols):
            sash(cv, cx - ww // 2, wy, ww, 46, frame=WHITE, lintel=None if kind_up == 'timber' else STONE,
                 panes=(2, 2), shutters=PAINT[s['shutters']] if s['shutters'] else None, box=s['boxes'],
                 seed=s['seed'] + f * 10 + i)
    for i in range(s['dormers']):
        dcx = int(x0 + W * (i + 1) / (s['dormers'] + 1))
        dormer(cv, dcx, eave, 30, R if s['wall'] == 'plaster' else WHITE, SLATE_ROOF if s['roof'] == 'slate' else RED_ROOF, kind=s['roof'])
    gtop = foot - GROUND_H
    info = {'foot': foot, 'pad': pad, 'width': W, 'lights': [], 'chimneys': stacks}
    for f in range(1, storeys):
        for cx in cols:
            info['lights'].append((cx, eave + UPPER_H * (f - 1) + 38, 'window'))
    if s['ground'] == 'shop':
        sx0, sx1 = x0 + 10, x1 - 10
        dcx = shopfront(cv, sx0, sx1, gtop + 8, foot, R=paint, name=s['name'], seed=s['seed'])
        info['lights'] += [((sx0 + dcx) // 2, gtop + 56, 'window'), ((dcx + sx1) // 2, gtop + 56, 'window')]
        if s['awning']:
            awning(cv, sx0 - 4, sx1 + 4, gtop + 34, 12, R=s['awning'])
        info['door'] = dcx
    elif s['ground'] == 'arch':
        ax = cols[door_bay]
        aw = 64
        for y in range(gtop + 14, foot):
            for x in range(ax - aw // 2 - 6, ax + aw // 2 + 6):
                dx, dy = x - ax + 0.5, y - (gtop + 14 + aw // 2)
                inner = abs(dx) < aw / 2 and (dy > 0 or dx * dx + dy * dy < (aw / 2) ** 2)
                outer = abs(dx) < aw / 2 + 6 and (dy > 0 or dx * dx + dy * dy < (aw / 2 + 6) ** 2)
                if inner:
                    t = (y - gtop - 14) / (foot - gtop - 14)
                    cv.put(x, y, tuple(int(c * (0.35 + 0.4 * t)) for c in STONE[2]))  # the dark way through to the yard
                elif outer:
                    ang = np.degrees(np.arctan2(-dy, dx)) if dy < 0 else 0
                    col = SANDSTONE[4] if int(ang // 18) % 2 else SANDSTONE[3]
                    if dy >= 0:
                        col = SANDSTONE[4] if (y // 10) % 2 else SANDSTONE[3]
                    cv.put(x, y, col)
        info['door'] = ax
        for i, cx in enumerate(cols):
            if i != door_bay:
                sash(cv, cx - ww // 2, gtop + 22, ww, 52, frame=WHITE, lintel=STONE, panes=(3, 2), seed=s['seed'] + i)
    else:
        for i, cx in enumerate(cols):
            if i == door_bay:
                front_door(cv, cx, foot, R=paint)
            else:
                sash(cv, cx - ww // 2, gtop + 22, ww, 52, frame=WHITE, lintel=None if s['wall'] == 'timber' else STONE,
                     panes=(3, 2), shutters=PAINT[s['shutters']] if s['shutters'] and storeys == 1 else None,
                     box=storeys == 1 and s['boxes'], seed=s['seed'] + i)
                info['lights'].append((cx, gtop + 46, 'window'))
        info['door'] = cols[door_bay]
    if s['board']:                                              # a name board across the front, over the ground floor
        text = s['board']
        bw = text_width(text, 1) + 20
        by = foot - GROUND_H - 22
        bx0 = (x0 + x1) // 2 - bw // 2
        for y in range(by, by + 16):
            for x in range(bx0, bx0 + bw):
                col = PAINT['black'][2]
                if y in (by, by + 15) or x in (bx0, bx0 + bw - 1):
                    col = BRASS[3]
                cv.put(x, y, col)
        lettering(cv, text, (x0 + x1) // 2, by + 8, BRASS[4], PAINT['black'][0], k=1, hi=BRASS[5])
        for x in range(bx0 + 2, bx0 + bw):
            mul(cv, x, by + 16, 0.7)
    if s['sign']:
        sx = info['door'] + (34 if s['ground'] != 'shop' else (x1 - x0) // 2 - 6)
        hanging_sign(cv, min(sx, x1 - 26), gtop + 22, s['sign'])
    if s['ground'] != 'arch':
        lantern(cv, info['door'] - 20, gtop + 28)
        info['lights'].append((info['door'] - 20, gtop + 32, 'lantern'))
    foundation(cv, x0, x1, foot, R=STONE)
    shade(cv, x0, foot - 10, x1, foot, 1.0, 0.84)                # the wall darkens toward the ground
    cv.outline()
    return cv.image(), info
