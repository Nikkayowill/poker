"""Ray's house, the barn, the windmill and the well with depth: recesses, cast shade under every overhang,
per-shingle and per-stone lighting, weathering, and warm light inside. Same sizes and anchors as kit.py."""
import math

from pal import Canvas, hash2, noise1


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def shingles(c, x0, y0, x1, y1, ramp, lit_top, lit_bottom, row_h=4, width=6, seed=0, moss=0.0):
    rows = max(1, (y1 - y0 + 1) // row_h)
    for y in range(y0, y1 + 1):
        r, ry = (y - y0) // row_h, (y - y0) % row_h
        base = lit_top + (lit_bottom - lit_top) * r / max(rows - 1, 1)
        off = (width // 2) * (r % 2)
        for x in range(x0, x1 + 1):
            col, cx = (x + off) // width, (x + off) % width
            b = base - 0.7 * (x - x0) / max(x1 - x0, 1) + (hash2(col, r, seed) - 0.5) * 0.9
            if hash2(col, r, seed + 1) < 0.04:
                b -= 1.4
            level = b + (1 - cx / (width - 1)) * 0.7 - (ry / (row_h - 1)) * 0.5
            if ry == 0:
                above = (x + (width // 2) * ((r + 1) % 2)) % width
                level = b - (1.0 if above in (2, 3) else 2.3)
            elif cx == width - 1:
                level = b - 1.0
            if x <= x0 + 1:
                level += 1.0
            use = ramp
            if moss and ry in (1, 2) and noise1(x, y, 6, seed + 7) > 1 - moss:
                use, level = "moss", 2.6 + (1 - cx / width) * 2 + (1.2 if ry == 1 else 0)
            c.put(x, y, use, level)


def stone_blocks(c, x0, y0, x1, y1, seed, bw=6, bh=3, lit=4.8, light_x=True, moss_below=None):
    for y in range(y0, y1 + 1):
        row, ry = (y - y0) // bh, (y - y0) % bh
        off = (bw // 2) * (row % 2)
        for x in range(x0, x1 + 1):
            col, bx = (x + off) // bw, (x + off) % bw
            b = lit + (hash2(col, row, seed) - 0.5) * 1.4
            if light_x:
                b -= 1.2 * (x - x0) / max(x1 - x0, 1)
            if bx == bw - 1 or ry == bh - 1:
                level = 1.6
            elif ry == 0 or bx == 0:
                level = b + 0.9
            else:
                level = b - (0.5 if bx == bw - 2 else 0)
            use = "stone"
            if moss_below is not None and y >= moss_below and ry == 0 and hash2(col, row, seed + 3) < 0.5:
                use, level = "moss", 3.4
            c.put(x, y, use, level)


def boards(c, x0, y0, w, h, ramp, base, width=5, seed=0, weather=0.0):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            bx = (x - x0) % width
            board = (x - x0) // width
            b = base + (hash2(board, 0, seed) - 0.5) * 0.8 + (noise1(x * 4, y, 9, seed + board) - 0.5) * 1.1
            if bx == 0:
                level = 0.8
            elif bx == 1:
                level = b + 1.1
            elif bx == width - 1:
                level = b - 0.6
            else:
                level = b
            kx, ky = board * width + x0 + 2, y0 + int(hash2(board, 1, seed) * h)
            if hash2(board, 2, seed) < 0.25 and x == kx and y in (ky, ky + 1):
                level = b - 2.4 if y == ky else b - 1.0
            if weather and y > y0 + h - 9 and hash2(x, y, seed + 5) < weather * (y - (y0 + h - 9)) / 9:
                c.put(x, y, "dirt", 2.2 + hash2(x, y, seed + 6) * 1.4)
                continue
            c.put(x, y, ramp, level)


# ------------------------------------------------------------------ Ray's house

def window(c, wx, wy, seed):
    for sx in (wx - 3, wx + 11):                              # louvred shutters
        for y in range(wy, wy + 11):
            for x in (sx, sx + 1):
                level = 3.4 if (y - wy) % 2 == 0 else 2.0
                level += 0.7 if x == sx else -0.5
                c.put(x, y, "shutter", level)
        c.put(sx + (1 if sx < wx else 0), wy + 2, "stone", 4.5)
        c.put(sx + (1 if sx < wx else 0), wy + 8, "stone", 4.5)
    for y in range(wy - 1, wy + 12):
        for x in range(wx - 1, wx + 11):
            top_or_left = y == wy - 1 or x == wx - 1
            level = 6.0 if top_or_left else 3.4 if (y == wy + 11 or x == wx + 10) else 5.2
            c.put(x, y, "white", level)
    for y in range(wy, wy + 11):
        for x in range(wx, wx + 10):
            t = (y - wy) / 10
            level = 3.6 - t * 2.2
            s = (x - wx) + (y - wy)
            if s in (4, 5):
                level += 1.5
            elif s in (8, 14):
                level += 0.8
            if y == wy or x == wx:
                level = 0.4                                   # the recess shade inside the frame
            use = "glass"
            if (x - wx) in (1, 8) and y > wy:                 # curtains
                use, level = "pink", 3.6 if (y - wy) % 2 else 3.0
                if x - wx == 8:
                    level -= 0.8
            if y > wy + 6 and 3 <= x - wx <= 6 and hash2(x, y, seed) < 0.6:
                use, level = "lamp", 2.2 + (y - wy - 6) * 0.3  # warm lamplight inside
            c.put(x, y, use, level)
    for y in range(wy, wy + 11):
        c.put(wx + 4, y, "white", 5.4)
        c.put(wx + 5, y, "white", 3.0)
    for x in range(wx, wx + 10):
        c.put(x, wy + 5, "white", 5.4)
        c.put(x, wy + 6, "glass", 1.0)
    for x in range(wx - 2, wx + 12):                          # sill and flower box
        c.put(x, wy + 11, "wood", 5.6)
        c.put(x, wy + 12, "wood", 3.8 - (x - wx) * 0.05)
        c.put(x, wy + 13, "wood", 1.2)
    for fx in range(wx - 1, wx + 11):
        k = int(hash2(fx, wy, seed + 1) * 5)
        c.put(fx, wy + 10, "leaf", 3.4 if fx % 2 else 2.4)
        if k == 0:
            c.put(fx, wy + 9, "red", 4.4)
            c.put(fx, wy + 10, "red", 2.8)
        elif k == 1:
            c.put(fx, wy + 9, "pink", 4.2)
        elif k == 2:
            c.put(fx, wy + 9, "straw", 5.2)
        elif k == 3:
            c.put(fx, wy + 9, "leaf2", 5.0)
        if hash2(fx, wy, seed + 2) < 0.3:
            c.put(fx, wy + 12, "leaf", 3.0)                   # trailing leaves over the box front


def farmhouse():
    w, h = 86, 80
    c = Canvas(w, h)
    roof_top, eave, wall_bottom = 10, 46, 75
    stone_blocks(c, 58, 1, 66, 13, 21, bw=4, bh=3, lit=5.0)   # chimney
    for x in range(58, 67):
        c.put(x, 0, "stone", 6.4 if x < 63 else 5.0)
        c.put(x, 1, "stone", 1.6)
        c.put(x, 2, "stone", c.get(x, 2)[1] - 1.6)            # soot
    c.rect(59, 1, 7, 1, "ink", 0)
    shingles(c, 1, roof_top + 2, w - 2, eave - 1, "slate", 5.6, 3.2, seed=4, moss=0.14)
    for x in range(67, 74):                                    # the chimney's shade on the roof
        for y in range(roof_top + 2, 22 - (x - 67)):
            p = c.get(x, y)
            if p:
                c.put(x, y, p[0], p[1] - 1.8)
    for x in range(1, w - 1):                                  # ridge cap tiles
        cap = x % 6
        c.put(x, roof_top, "slate", 6.6 if cap else 4.6)
        c.put(x, roof_top + 1, "slate", 4.4 if cap else 3.0)
    for y in range(roof_top, eave):
        c.put(1, y, "slate", 6.6)
        c.put(w - 2, y, "slate", 1.6)
    shingles(c, 1, eave + 1, 29, eave + 6, "slate", 4.6, 3.6, row_h=3, seed=9)
    for x in range(1, w - 1):                                  # fascia and gutter
        c.put(x, eave, "stone", 6.2)
    for x in range(1, 30):
        c.put(x, eave + 7, "stone", 6.0)
    for y in range(eave + 1, wall_bottom):                     # clapboard
        for x in range(4, w - 4):
            if x < 30 and y <= eave + 7:
                continue
            by = (y - eave - 1) % 3
            board = (y - eave - 1) // 3
            level = 2.3 if by == 0 else 5.4 if by == 1 else 4.7
            level += (noise1(x, board * 7, 11, 31) - 0.5) * 0.6
            if by == 1 and (x + board * 5) % 13 == 0:
                level = 3.0                                    # nail heads
            if x < 6:
                level = 6.0 if x == 4 else 5.3
            elif x > w - 7:
                level = 3.4 if x == w - 6 else 2.6
            under = y - (eave + 1) if x >= 30 else y - (eave + 8)
            if under < 4:
                level -= (4 - under) * 0.65                    # the roof's shade on the wall
            if y > wall_bottom - 6:
                level -= (y - (wall_bottom - 6)) * 0.28 * (0.6 + noise1(x, y, 4, 33))
            c.put(x, y, "white", level)
    for y in range(eave + 1, wall_bottom - 1):                 # downspout
        c.put(w - 5, y, "stone", 5.2)
        c.put(w - 4, y, "stone", 3.0)
    stone_blocks(c, 4, wall_bottom - 2, w - 5, wall_bottom - 1, 41, bw=7, bh=2, lit=4.6, light_x=False)
    for wx in (12, 60):
        window(c, wx, eave + 9, wx)
    dx = w // 2 - 5
    for y in range(eave + 8, wall_bottom):                     # door frame
        for x in range(dx - 1, dx + 11):
            c.put(x, y, "white", 6.2 if x == dx - 1 or y == eave + 8 else 3.2 if x == dx + 10 else 5.2)
    for y in range(eave + 9, wall_bottom):
        for x in range(dx, dx + 10):
            level = 3.4 + (noise1(x * 3, y, 6, 51) - 0.5) * 0.7
            if x == dx or y == eave + 9:
                level = 1.2                                    # the door sits back in its frame
            elif x == dx + 9:
                level = 2.4
            c.put(x, y, "red", level)
    for x in range(dx + 2, dx + 8):                            # small window in the door
        for y in range(eave + 11, eave + 14):
            c.put(x, y, "glass", 3.2 - (y - eave - 11) * 0.8 + (1.2 if x == dx + 3 else 0))
    c.rect(dx + 2, eave + 14, 6, 1, "red", 5.2)
    for px, py, pw, ph in ((dx + 1, eave + 16, 3, 7), (dx + 6, eave + 16, 3, 7)):
        for y in range(py, py + ph):
            for x in range(px, px + pw):
                level = 1.4 if (y == py or x == px) else 5.0 if (y == py + ph - 1 or x == px + pw - 1) else 3.1
                c.put(x, y, "red", level)
    for x in range(dx + 1, dx + 9):                            # kick plate
        c.put(x, wall_bottom - 2, "gold", 3.6 if x < dx + 5 else 2.6)
        c.put(x, wall_bottom - 1, "gold", 2.0)
    c.put(dx + 8, eave + 24, "gold", 4.8)
    c.put(dx + 8, eave + 25, "gold", 1.8)
    c.put(dx - 5, eave + 10, "stone", 1.6)                     # porch lamp and its glow on the wall
    c.put(dx - 4, eave + 10, "stone", 1.6)
    c.rect(dx - 5, eave + 11, 2, 3, "lamp", 4.2)
    c.put(dx - 5, eave + 11, "lamp", 5.0)
    c.rect(dx - 5, eave + 14, 2, 1, "stone", 2.2)
    for y in range(eave + 8, eave + 18):
        for x in range(dx - 9, dx - 1):
            p = c.get(x, y)
            d = math.hypot(x - (dx - 4.5), y - (eave + 12))
            if p and p[0] == "white" and d < 4.5:
                c.put(x, y, "white", p[1] + (4.5 - d) * 0.3)
    for y in range(wall_bottom, wall_bottom + 3):              # stone step with a worn middle and a mat
        for x in range(dx - 2, dx + 12):
            level = 6.2 if y == wall_bottom else 4.2 if y == wall_bottom + 1 else 2.2
            if y == wall_bottom and dx + 1 <= x <= dx + 8:
                level = 5.4
            c.put(x, y, "stone", level)
    for x in range(dx + 1, dx + 9):
        c.put(x, wall_bottom, "straw", 4.2 if x % 2 else 3.4)
    for y in range(wall_bottom - 5, wall_bottom):              # potted fern by the door
        for x in range(dx + 12, dx + 16):
            if y == wall_bottom - 5:
                c.put(x, y, "red", 5.0 if x < dx + 14 else 3.6)
            else:
                c.put(x, y, "red", 4.2 - (x - dx - 12) * 0.7 - (y - wall_bottom + 5) * 0.15)
    for k in range(10):
        ang = math.pi * (0.1 + 0.8 * k / 9)
        for t in range(1, 5):
            x = dx + 14 + math.cos(ang) * t * 1.2 - 0.5
            y = wall_bottom - 6 - math.sin(ang) * t + (t * t) * 0.12
            c.put(x, y, "leaf2" if ang > 1.6 else "leaf", 5.4 - t * 0.6 - (0 if ang > 1.6 else 1.2))
    for y in range(eave + 30, wall_bottom):                    # ivy up the left corner
        for x in range(3, 10):
            n = noise1(x, y, 3, 61)
            if n > 0.5 + (wall_bottom - y) * 0.018 + (x - 3) * 0.04:
                c.put(x, y, "leaf2" if n > 0.72 else "leaf", 2.2 + n * 3.2 - (y - eave - 30) * 0.03)
    return c.outline().image(), (w // 2, wall_bottom + 2)


# ------------------------------------------------------------------ barn

def barn():
    w, h = 96, 84
    c, cx = Canvas(w, h), w // 2
    peak, knee, eave, bottom = 3, 16, 32, 79

    def half(y):
        if y < knee:
            return 12 + (y - peak) * (32 - 12) / (knee - peak)
        return 32 + (y - knee) * (44 - 32) / (eave - knee)

    boards(c, cx - 44, peak, 89, eave - peak + 1, "barnred", 3.4, seed=30)
    boards(c, cx - 44, eave, 89, bottom - eave, "barnred", 3.4, seed=31, weather=0.35)
    for y in range(peak, eave + 1):
        hw = half(y)
        for x in range(cx - 44, cx + 45):
            d = min(x - (cx - hw), (cx + hw) - x, (y - peak) * 1.6 + 0.01)
            if d < 0:
                c.px[y][x] = None
                continue
            if d < 4:                                           # shingled roof edge, lit left, dark right
                level = (6.2 if x < cx else 3.4) - d * 0.35
                if (y + x // 3) % 3 == 0:
                    level -= 0.9
                if d >= 3:
                    level = 1.2                                 # its underside
                c.put(x, y, "slate", level)
            elif d < 7:
                p = c.get(x, y)
                if p and p[0] == "barnred":
                    c.put(x, y, "barnred", p[1] - (7 - d) * 0.6)  # the edge's shade on the boards
            if y < peak + 7:
                p = c.get(x, y)
                if p and p[0] == "barnred":
                    c.put(x, y, "barnred", p[1] - 0.8)
    for x in range(cx - 44, cx + 45):                          # eave trim with its shade below
        c.put(x, eave, "white", 6.2)
        c.put(x, eave + 1, "white", 4.2)
        for k, amt in ((2, 1.8), (3, 1.1), (4, 0.5)):
            p = c.get(x, eave + k)
            if p:
                c.put(x, eave + k, p[0], p[1] - amt)
    for y in range(eave, bottom):                              # corner trim, chipped
        for i, x in enumerate(range(cx - 44, cx - 41)):
            c.put(x, y, "white", (6.2, 5.4, 4.2)[i] - (0.8 if hash2(x, y, 70) < 0.04 else 0))
        for i, x in enumerate(range(cx + 42, cx + 45)):
            c.put(x, y, "white", (4.0, 3.2, 2.2)[i])
    for y in range(13, 29):                                    # hayloft
        for x in range(cx - 9, cx + 9):
            c.put(x, y, "white", 6.2 if (x == cx - 9 or y == 13) else 3.2 if (x == cx + 8 or y == 28) else 5.2)
    for y in range(15, 27):
        for x in range(cx - 7, cx + 7):
            c.put(x, y, "wood", 0.2 + (y - 15) * 0.08 + (0.4 if x == cx + 6 else 0))
    for y in range(20, 27):
        for x in range(cx - 7, cx + 7):
            top = 20 + round(abs(x - cx + 1) * 0.35)
            if y >= top:
                level = 5.6 if y == top else 4.4 - (y - top) * 0.35
                if hash2(x, y, 72) < 0.25:
                    level -= 1.2
                c.put(x, y, "straw", level - (x - cx + 7) * 0.08)
    for x, y in ((cx - 5, 27), (cx - 4, 28), (cx + 2, 27), (cx + 3, 28), (cx + 3, 29)):
        c.put(x, y, "straw", 4.8)
    for x in range(cx - 3, cx + 3):                            # hay hook beam, rope and hook
        c.put(x, 10, "wood", 5.8)
        c.put(x, 11, "wood", 3.6)
        c.put(x, 12, "wood", 1.4)
    for y in range(13, 18):
        c.put(cx + 1, y, "straw", 3.0)
    c.put(cx + 1, 18, "stone", 5.0)
    c.put(cx + 2, 19, "stone", 3.0)
    for y in range(44, bottom):                                # door frame, header shade, track rail
        for x in range(cx - 21, cx + 21):
            c.put(x, y, "white", 6.2 if x == cx - 21 or y == 44 else 3.2 if x == cx + 20 else 5.2)
    for x in range(cx - 21, cx + 21):
        c.put(x, 46, "stone", 5.8)
        c.put(x, 47, "stone", 2.4)
    for d in (-19, 1):
        x0 = cx + d
        boards(c, x0, 48, 18, bottom - 48, "barnred", 3.2, width=4, seed=40 + d, weather=0.4)
        for x in range(x0, x0 + 18):
            p = c.get(x, 48)
            c.put(x, 48, "barnred", p[1] - 1.6)
        span = bottom - 49
        for i in range(18):
            y = 49 + round(i * (span - 1) / 17)
            y2 = 49 + (span - 1) - (y - 49)
            for yy in (y, y2):
                c.put(x0 + i, yy, "white", 5.8)
                c.put(x0 + i, yy + 1, "white", 3.8)
                p = c.get(x0 + i, yy + 2)
                if p and p[0] == "barnred":
                    c.put(x0 + i, yy + 2, "barnred", p[1] - 1.5)
        for y in range(48, bottom):
            c.put(x0, y, "white", 5.6)
            c.put(x0 + 17, y, "white", 3.4)
        for x in range(x0, x0 + 18):
            c.put(x, 49, "white", 5.6)
            c.put(x, bottom - 1, "white", 3.4)
        c.put(x0 + 3, 47, "stone", 1.0)
        c.put(x0 + 14, 47, "stone", 1.0)
    c.rect(cx - 1, 48, 2, bottom - 48, "ink", 0)
    for y in (62, 63):
        c.put(cx - 3, y, "stone", 5.0 if y == 62 else 2.2)
        c.put(cx + 2, y, "stone", 4.2 if y == 62 else 1.8)
    c.rect(cx - 1, 38, 3, 1, "stone", 2.0)                     # lantern over the doors
    c.rect(cx - 1, 39, 3, 3, "lamp", 4.0)
    c.put(cx - 1, 39, "lamp", 5.0)
    c.rect(cx - 1, 42, 3, 1, "stone", 1.6)
    for y in range(34, 46):
        for x in range(cx - 7, cx + 8):
            p = c.get(x, y)
            dd = math.hypot(x - cx, (y - 40) * 1.2)
            if p and p[0] == "barnred" and dd < 7:
                c.put(x, y, "barnred", p[1] + (7 - dd) * 0.28)
    stone_blocks(c, cx - 46, bottom, cx + 46, bottom + 2, 81, bw=8, bh=3, lit=4.8)
    c.rect(cx - 1, 0, 2, peak + 1, "stone", 3.0)
    for x, y, lv in ((cx - 4, 0, 5.2), (cx - 3, 0, 4.8), (cx - 2, 0, 4.4), (cx + 2, 0, 3.6), (cx + 3, 0, 3.0),
                     (cx - 5, 1, 4.0)):
        c.put(x, y, "gold", lv)
    img = c.outline().image()
    img.info["lights"] = [(48, 40, "lantern")]
    return img, (cx, bottom + 2)


# ------------------------------------------------------------------ windmill

def windmill():
    w, h = 64, 88
    c, cx = Canvas(w, h), w // 2
    top, bottom = 30, 84
    for y in range(top, bottom):
        hw = 7 + (y - top) * 3 / (bottom - top)
        row = y // 4
        for x in range(round(cx - hw), round(cx + hw) + 1):
            rel = (x - (cx - hw)) / (2 * hw)
            shade = 6.0 - abs(rel - 0.25) * 6.4 - (0.8 if rel > 0.6 else 0)
            col = (x + row % 2 * 2) // 4
            bx, by = (x + row % 2 * 2) % 4, y % 4
            b = shade + (hash2(col, row, 60) - 0.5) * 1.2
            if bx == 3 or by == 3:
                level = min(b - 2.2, 2.4)
            elif by == 0:
                level = b + 0.7
            elif bx == 0:
                level = b + 0.4
            else:
                level = b
            if y < top + 4:
                level -= (top + 4 - y) * 0.6                  # the cap's shade
            use = "stone"
            if y > bottom - 12 and by == 0 and hash2(col, row, 61) < 0.45:
                use, level = "moss", 2.4 + rel * -1.4 + 2.2
            c.put(x, y, use, level)
    for y in range(bottom - 14, bottom):                       # arched door, iron straps
        for x in range(cx - 4, cx + 4):
            if y == bottom - 14 and x in (cx - 4, cx + 3):
                continue
            if y < bottom - 12 or x in (cx - 4, cx + 3):
                c.put(x, y, "stone", 6.0 if x < cx else 3.4)
                continue
            bx = (x - (cx - 3)) % 3
            level = 1.0 if bx == 2 else 4.2 if bx == 0 else 3.2
            if y in (bottom - 9, bottom - 4):
                c.put(x, y, "stone", 2.2 if x != cx - 3 else 4.6)
                continue
            c.put(x, y, "wood", level - (0.8 if x == cx - 3 else 0))
    c.put(cx + 1, bottom - 7, "gold", 4.6)
    for y in range(42, 49):                                    # arched window
        for x in range(cx - 2, cx + 3):
            if y == 42 and x in (cx - 2, cx + 2):
                continue
            edge = x in (cx - 2, cx + 2) or y in (42, 48)
            c.put(x, y, "stone" if edge else "glass", (6.0 if x < cx else 3.2) if edge else 2.8 - (y - 43) * 0.35)
    c.put(cx - 1, 44, "glass", 4.6)
    c.put(cx, 46, "lamp", 2.4)
    for y in range(17, top + 3):                               # wooden cap, shingled
        hw = 3 + (y - 17) * 7 / (top + 3 - 17)
        for x in range(round(cx - hw), round(cx + hw) + 1):
            rel = (x - (cx - hw)) / max(2 * hw, 1)
            level = 6.2 - rel * 4.6
            if (y - 17) % 3 == 2:
                level -= 1.4
            elif (x + (y - 17) // 3 * 2) % 4 == 0:
                level -= 0.7
            c.put(x, y, "wood", level)
    for x in range(cx - 10, cx + 11):
        c.put(x, top + 3, "wood", 1.0)
    hub = (cx, 24)
    arms = (((1, -1), 24, False), ((-1, -1), 24, False), ((-1, 1), 22, True), ((1, 1), 11, None))
    for (dx, dy), length, torn in arms:
        if torn is not None:
            for t in range(7, length):
                for k in range(1, 6):
                    for sx in (0, 1):
                        x = hub[0] + dx * t - dy * k + sx
                        y = hub[1] + dy * t + dx * k
                        if k == 5 or t % 4 == 0:
                            c.put(x, y, "wood", 3.4 - k * 0.2)
                        elif not (torn and 12 <= t < 16):
                            level = 5.8 - k * 0.45 - (0.7 if dy > 0 else 0) - ((t % 4) - 2) ** 2 * 0.12
                            c.put(x, y, "white", level)
        for t in range(3, length):
            c.put(hub[0] + dx * t, hub[1] + dy * t, "wood", 5.0)
            c.put(hub[0] + dx * t + 1, hub[1] + dy * t, "wood", 2.4)
        if torn is None:
            ex, ey = hub[0] + dx * length, hub[1] + dy * length
            for k, (ox, oy) in enumerate(((0, 0), (1, 1), (-1, 1), (2, 0))):
                c.put(ex + ox, ey + oy, "wood", 5.6 - k)
    c.rect(hub[0] - 1, hub[1] - 1, 3, 3, "stone", 2.2)
    c.put(hub[0] - 1, hub[1] - 1, "stone", 5.6)
    gx, gy = cx + 6, 54                                        # the jammed gear
    for a in range(16):
        ang = a * math.pi / 8
        lit = -math.cos(ang + 0.8)
        r = 4.6 if a % 2 else 3.8
        c.put(gx + round(math.cos(ang) * r), gy + round(math.sin(ang) * r), "gold", 3.0 + lit * 1.6)
    for y in range(gy - 3, gy + 4):
        for x in range(gx - 3, gx + 4):
            d = math.hypot(x - gx, y - gy)
            if d <= 3.2:
                c.put(x, y, "gold", 3.4 - (x - gx + y - gy) * 0.45 - (1.4 if 1.2 < d < 2.2 else 0))
    c.put(gx, gy, "ink", 0)
    for k in range(4):
        c.put(gx + 3 + k, gy + 3 + k // 2, "dirt", 2.4 - k * 0.3)
    return c.outline().image(), (cx, bottom - 1)


# ------------------------------------------------------------------ well

def well():
    w, h = 22, 30
    c = Canvas(w, h)
    for x in range(3, 19):
        c.put(x, 2, "wood", 6.0 - (x - 3) * 0.08)
        c.put(x, 3, "wood", 4.4 - (x - 3) * 0.08 + (noise1(x * 3, 3, 4, 2) - 0.5))
        c.put(x, 4, "wood", 1.4)
    for y in range(5, 19):
        for px in (4, 16):
            c.put(px, y, "wood", 5.0 + (noise1(px, y * 2, 3, px) - 0.5))
            c.put(px + 1, y, "wood", 2.2)
    for x in range(6, 16):
        c.put(x, 8, "wood", 2.4)
        c.put(x, 9, "straw", 3.8 if x % 2 else 2.8)          # rope wound on the axle
    c.put(17, 7, "stone", 5.0)
    c.put(18, 8, "stone", 3.6)
    c.put(18, 9, "stone", 2.4)
    for y in range(10, 13):
        c.put(11, y, "straw", 3.2)
    for y in range(13, 17):                                   # bucket
        for x in range(9, 14):
            level = 4.6 - (x - 9) * 0.7
            if y in (13, 16):
                c.put(x, y, "stone", level + 0.6)
            else:
                c.put(x, y, "wood", level)
    for y in range(15, 29):
        for x in range(1, 21):
            ox = ((x - 10.5) / 9) ** 2 + ((y - 21.5) / 6.5) ** 2
            if ox > 1:
                continue
            inner = ((x - 10.5) / 6.4) ** 2 + ((y - 19.5) / 3.2) ** 2
            if inner <= 1:
                depth = (y - 16.5) / 6
                c.put(x, y, "water" if y > 19 else "stone", (0.6 + depth * 1.6) if y > 19 else 0.8 + depth)
                continue
            ang = math.atan2(y - 21.5, x - 10.5)
            row = (y - 15) // 3
            block = int((ang + math.pi) * (4 + row % 2)) + row * 7
            nx = (x - 10.5) / 9
            level = 4.6 - nx * 2.0 + (1.0 if y < 19 else 0) - (1.2 if y > 25 else 0)
            level += (hash2(block, row, 80) - 0.5) * 1.0
            if (y - 15) % 3 == 2 or (y > 19 and int((ang + math.pi) * (4 + row % 2) * 3) % 3 == 0):
                level = min(level - 1.8, 2.2)
            use = "stone"
            if y > 25 and hash2(block, row, 81) < 0.4 and (y - 15) % 3 == 0:
                use, level = "moss", 3.2
            c.put(x, y, use, level)
    c.put(8, 21, "water", 5.4)
    c.put(9, 21, "water", 4.4)
    c.put(13, 22, "water", 3.4)
    return c.outline().image(), (11, 27)


# ------------------------------------------------------------------ workshop

def workshop():
    """The workshop, where the Mill, Dairy, Loom and Vat recipes are worked: a timber-framed shop with cream plaster
    panels, a shingled gable carrying a gear sign, a stovepipe, wide plank doors, and a lean-to stacked with lumber."""
    w, h = 82, 78
    c = Canvas(w, h)
    L, R = 24, 79                                              # the main building's walls
    mid = (L + R) / 2
    peak, eave, bottom = 5, 32, 72

    # lean-to on the left: a dark back wall, a sloped shingle roof, lumber stacked under it
    for y in range(34, bottom):
        for x in range(2, L):
            c.put(x, y, "wood", 0.5 + (y - 34) * 0.018 + (hash2(x // 4, y, 90) - 0.5) * 0.3)
    for x in range(1, L + 1):
        top = 30 + round((L - x) * 9 / (L - 1))
        for k in range(6):
            row = k // 2
            level = 4.8 - row * 0.9 - (0.9 if (x + row * 2) % 4 == 0 else 0) - (1.0 if k % 2 else 0)
            c.put(x, top + k, "leather", level)
        c.put(x, top + 6, "coal", 0.8)
    for y in range(40, bottom):                                # the lean-to's front post
        c.put(2, y, "wood", 4.8)
        c.put(3, y, "wood", 3.2)
        c.put(4, y, "wood", 1.4)
    for x in range(9, 20):                                     # a hand saw hung on the back wall: steel blade, teeth, handle
        top = 45 + round((x - 9) * 0.25)
        for y in range(top, 50):
            c.put(x, y, "stone", 5.4 - (y - top) * 0.5)
        if x % 2:
            c.put(x, 50, "stone", 2.2)
    for x, y in ((19, 44), (20, 44), (21, 45), (21, 46), (21, 47), (20, 48), (19, 48), (20, 46)):
        c.put(x, y, "wood", 4.4 if y < 46 else 3.0)
    for row, y0 in enumerate(range(54, bottom, 3)):            # planks stacked on edge, end grain showing
        for x in range(6, 22):
            end = x in (6, 7)
            level = (5.2 if end else 4.2) - row * 0.15 + (hash2(x, row, 91) - 0.5) * 0.6
            c.put(x, y0, "wood", level + 0.6)
            c.put(x, y0 + 1, "wood", level)
            c.put(x, y0 + 2, "wood", 1.6)
    for lx, ly in ((9, 66), (15, 66), (12, 62)):               # a few logs in front, rings on their ends
        for y in range(ly - 2, ly + 3):
            for x in range(lx - 2, lx + 3):
                d = math.hypot(x - lx, y - ly)
                if d <= 2.6:
                    c.put(x, y, "tan" if d < 1.8 else "wood", 4.6 - (x - lx + y - ly) * 0.35 if d < 1.8 else 2.4)
        c.put(lx, ly, "wood", 2.8)

    # plaster panels between dark oak beams
    for y in range(eave, bottom):
        for x in range(L, R + 1):
            n = noise1(x, y, 5, 93)
            level = 5.4 - (x - L) / (R - L) * 0.9 + (n - 0.5) * 0.6
            if hash2(x, y, 94) < 0.03:
                level -= 0.9                                   # pits in the plaster
            if y > bottom - 7:
                level -= (y - (bottom - 7)) * 0.22 * (0.6 + n)  # splashed dirt at the foot of the wall
            c.put(x, y, "white", level)

    def beam(x0, y0, x1, y1, lit=3.2):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                edge = 0.9 if (x == x0 or y == y0) else -0.9 if (x == x1 or y == y1) else 0
                grain = -0.5 if hash2(x // 2, y // 5, 95) < 0.2 else 0
                c.put(x, y, "wood", lit + edge + grain)

    beam(L, eave, R, eave + 2)                                 # sill beam under the gable
    beam(L, 52, R, 53)                                         # mid rail
    for bx in (L, 36, 63, R - 2):
        beam(bx, eave, bx + 2 if bx != R - 2 else R, bottom - 1)
    for t in range(0, 17):                                     # braces in the lower side panels
        for x0, sgn in ((L + 3, 1), (R - 3, -1)):
            x = x0 + sgn * round(t * 9 / 16)
            y = bottom - 2 - t
            c.put(x, y, "wood", 3.4)
            c.put(x + sgn, y, "wood", 2.2)

    def lit_window(wx, wy):
        for y in range(wy - 1, wy + 11):
            for x in range(wx - 1, wx + 9):
                c.put(x, y, "wood", 4.6 if (x == wx - 1 or y == wy - 1) else 2.0)
        for y in range(wy, wy + 10):
            for x in range(wx, wx + 8):
                s = (x - wx) + (y - wy)
                level = 3.2 - (y - wy) * 0.2 + (1.4 if s in (3, 4) else 0)
                use = "glass"
                if y > wy + 5 and hash2(x, y, wx) < 0.55:
                    use, level = "lamp", 2.0 + (y - wy - 5) * 0.35   # the stove's glow inside
                c.put(x, y, use, level if x != wx and y != wy else 0.6)
        for y in range(wy, wy + 10):
            c.put(wx + 4, y, "wood", 3.6)
        for x in range(wx, wx + 8):
            c.put(x, wy + 4, "wood", 3.6)
        for x in range(wx - 2, wx + 10):                        # sill
            c.put(x, wy + 10, "wood", 5.4)
            c.put(x, wy + 11, "wood", 2.2)

    lit_window(L + 4, eave + 6)
    lit_window(R - 11, eave + 6)

    # wide plank double doors under a lintel, iron straps and ring pulls
    dx0, dx1, dy0 = round(mid) - 10, round(mid) + 11, 46
    beam(dx0 - 2, dy0 - 3, dx1 + 2, dy0 - 1, lit=3.6)
    for y in range(dy0, bottom):
        for x in range(dx0, dx1 + 1):
            board = (x - dx0) % 4
            level = 3.4 + (hash2((x - dx0) // 4, 0, 96) - 0.5) * 0.7 + (noise1(x * 3, y, 7, 97) - 0.5) * 0.8
            level = level + 0.9 if board == 1 else level - 0.8 if board == 0 else level
            if y == dy0:
                level = 1.0                                    # the lintel's shade on the doors
            c.put(x, y, "wood", level)
    for y in range(dy0, bottom):
        c.put(round(mid), y, "ink", 0)
    for sy in (dy0 + 5, bottom - 6):
        for x in range(dx0, dx1 + 1):
            if x != round(mid):
                c.put(x, sy, "coal", 2.8 if x < mid else 2.2)
                c.put(x, sy + 1, "coal", 1.0)
    for rx in (round(mid) - 3, round(mid) + 3):
        c.put(rx, dy0 + 13, "gold", 4.6)
        c.put(rx - 1, dy0 + 14, "gold", 3.4)
        c.put(rx + 1, dy0 + 14, "gold", 2.6)
        c.put(rx, dy0 + 15, "gold", 2.0)

    # the gable: steep shingles framing a boarded face with the gear sign
    for y in range(peak, eave + 2):
        hw = (y - peak) * ((R - L) / 2 + 5) / (eave - peak)
        for x in range(round(mid - hw), round(mid + hw) + 1):
            d = min(x - (mid - hw), (mid + hw) - x)
            if d < 8:
                row = (y - peak) // 3
                level = (5.4 if x < mid else 3.0) - d * 0.2 - (0.8 if (x + row * 3) % 5 == 0 else 0)
                if (y - peak) % 3 == 2:
                    level -= 1.1
                if hash2(x // 5, row, 97) < 0.12 and d < 6:
                    c.put(x, y, "moss", 2.8 + (1.0 if x < mid else 0))
                    continue
                if d >= 7:
                    level = 0.6                                # the roof edge's underside
                c.put(x, y, "leather", level)
            elif y < eave:
                board = (x - round(mid)) % 3
                level = 4.2 + (0.8 if board == 0 else -0.7 if board == 2 else 0) + (hash2(x // 3, y, 98) - 0.5) * 0.5
                if d < 10:
                    level -= (10 - d) * 0.45                   # the roof's shade on the gable boards
                c.put(x, y, "tan", level)
    for x in range(round(mid) - 2, round(mid) + 3):            # ridge cap
        c.put(x, peak - 1, "leather", 5.4 if x < mid else 3.2)
        c.put(x, peak, "leather", 4.4 if x < mid else 2.6)
    gx, gy = mid, 21                                           # a dark wooden disc sign with a gold gear on it
    for y in range(gy - 7, gy + 8):
        for x in range(round(gx) - 7, round(gx) + 8):
            d = math.hypot(x - gx, y - gy)
            if d <= 6.6:
                c.put(x, y, "wood", 2.2 - (x - gx + y - gy) * 0.08 if d < 5.6 else 4.6 if x + y < gx + gy else 1.4)
    for a in range(10):
        ang = a * math.pi / 5 + 0.3
        for r in (3.4, 4.4):
            c.put(gx + math.cos(ang) * r, gy + math.sin(ang) * r, "gold", 4.2 - math.sin(ang + 0.8) * 0.9)
    for y in range(round(gy) - 4, round(gy) + 5):
        for x in range(round(gx) - 4, round(gx) + 5):
            d = math.hypot(x - gx, y - gy)
            if 1.2 < d <= 3.3:
                c.put(x, y, "gold", 4.2 - (x - gx + y - gy) * 0.35)
    c.put(round(gx), round(gy), "coal", 0.6)

    # stovepipe through the right slope, a cap, and a rust streak
    for y in range(0, 22):
        c.put(66, y, "stone", 3.6)
        c.put(67, y, "stone", 2.6)
        c.put(68, y, "stone", 1.6)
    for x in range(64, 71):
        c.put(x, 0, "stone", 4.4 if x < 67 else 2.4)
        c.put(x, 1, "coal", 1.2)
    for y in range(8, 14):
        c.put(67, y, "orange", 2.2)

    stone_blocks(c, L - 2, bottom, R + 2, bottom + 3, 99, bw=7, bh=2, lit=4.4)
    for x in range(1, L - 2):
        c.put(x, bottom, "dirt", 3.0)
        c.put(x, bottom + 1, "dirt", 2.2)
    for x, y in ((L + 1, bottom - 1), (L + 2, bottom - 2), (R - 4, bottom - 1)):   # weeds at the wall's foot
        c.put(x, y, "leaf", 3.6)
    img = c.outline().image()
    img.info["lights"] = [(L + 8, eave + 11, "window"), (R - 7, eave + 11, "window")]
    return img, (round(mid), bottom + 3)
