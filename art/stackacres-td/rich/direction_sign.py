"""A roadside direction sign: an arrow board on a post, saying where the gate beside it leads.

Drawn at the pack's 32px a tile and handed to the rig like the trees are: a half-size stand-in carrying the
full drawing. The lettering is a 5x7 face set by hand below, two pixels to a dot. The wood is the dock's (and
the terrace stair's): light, mid and dark, with a cream painted board so the words read on a phone.

Pure: a picture out.
"""
from PIL import Image

import lpc_cliffs

# 5x7 capitals, one string per row, "#" a dot. Only the letters the signs say.
FONT = {
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "C": [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
}

HI = (238, 196, 132, 255)
LIGHT = (196, 140, 76, 255)
MID = (162, 107, 54, 255)
SHADE = (128, 82, 42, 255)
DARK = (90, 55, 28, 255)
DEEP = (56, 34, 20, 255)
PAINT = (240, 220, 172, 255)         # the board's painted face
PAINT_LOW = (222, 196, 140, 255)     # its lower edge
INK = (74, 40, 20, 255)

DOT = 2                              # picture pixels to a lettering dot
GAP = 2                              # between letters
SPACE = 8                            # between words
PAD_X, PAD_Y = 9, 7
TIP = 16                             # how far the arrow's point reaches past the board
POST_W = 10
POST_BELOW = 50                      # post under the board


def _width(text):
    w = 0
    for ch in text:
        w += SPACE if ch == " " else len(FONT[ch][0]) * DOT + GAP
    return w - GAP


def _rect(px, x0, y0, x1, y1, colour):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px[x, y] = colour


def _board(px, text, points, post_x, top):
    """One arrow board with its tail on the post at `post_x`, its top row at `top`. Returns its bottom row."""
    body_w = _width(text) + 2 * PAD_X
    board_h = 7 * DOT + 2 * PAD_Y
    west = points == "west"
    x1 = post_x + 8 if west else post_x - 8 + body_w - 1     # the board's rectangular body
    x0 = x1 - body_w + 1
    y0, y1 = top, top + board_h - 1
    mid = (y0 + y1) / 2

    def span(y):
        """The board's x extent on row y: the body, and the point narrowing to nothing at the middle row."""
        reach = round(TIP * (1 - abs(y - mid) / ((board_h - 1) / 2)))
        return (x0 - reach, x1) if west else (x0, x1 + reach)

    for y in range(y0, y1 + 1):
        a, b = span(y)
        _rect(px, a, y, b, y, PAINT)
    for y in range(y0, y1 + 1):
        a, b = span(y)
        px[a, y] = DEEP
        px[b, y] = DEEP
        # The slanted edges of the point: carry the line across to the next row's reach too.
        for ny in (y - 1, y + 1):
            if y0 <= ny <= y1:
                na, nb = span(ny)
                for x in range(min(a, na), max(a, na) + 1):
                    px[x, y] = DEEP
                for x in range(min(b, nb), max(b, nb) + 1):
                    px[x, y] = DEEP
    for x in range(span(y0)[0], span(y0)[1] + 1):
        px[x, y0] = DEEP
        px[x, y1] = DEEP
    for x in range(x0, x1):
        px[x, y0 + 1] = HI
        px[x, y1 - 1] = PAINT_LOW
        px[x, y1 - 2] = PAINT_LOW
    for nx in (x0 + 4, x1 - 4):                                # two nails
        px[nx, y0 + 4] = DARK
        px[nx, y1 - 5] = DARK
    x, y = x0 + PAD_X, y0 + PAD_Y                              # the words
    for ch in text:
        if ch == " ":
            x += SPACE
            continue
        glyph = FONT[ch]
        for gy, row in enumerate(glyph):
            for gx, dot in enumerate(row):
                if dot == "#":
                    _rect(px, x + gx * DOT, y + gy * DOT, x + gx * DOT + DOT - 1, y + gy * DOT + DOT - 1, INK)
        x += len(glyph[0]) * DOT + GAP
    return y1


def signs(boards):
    """A post carrying one board per (text, points) in `boards`, top to bottom, `points` "west" or "east".
    Returns (stand-in, base)."""
    board_h = 7 * DOT + 2 * PAD_Y
    reach = max(_width(t) + 2 * PAD_X + TIP for t, _ in boards)
    margin = 3
    w = 2 * (reach + margin)
    cx = w // 2
    board_gap = 5
    h = len(boards) * board_h + (len(boards) - 1) * board_gap + POST_BELOW + 2 * margin
    img = Image.new("RGBA", (w, h))
    px = img.load()
    px0, px1, py1 = cx - POST_W // 2, cx + POST_W // 2 - 1, h - margin - 1
    top = margin
    _rect(px, px0, top + 4, px1, py1, MID)                       # the post, behind the boards
    _rect(px, px0, top + 4, px0, py1, DEEP)
    _rect(px, px1, top + 4, px1, py1, DEEP)
    _rect(px, px0, py1, px1, py1, DEEP)
    _rect(px, px0 + 1, top + 4, px0 + 2, py1 - 1, LIGHT)
    _rect(px, px1 - 3, top + 4, px1 - 1, py1 - 1, SHADE)
    for text, points in boards:
        top = _board(px, text, points, cx, top) + 1 + board_gap
    left, _, right, _ = img.getbbox()                # no empty sides: the picture is only as wide as the signs
    img = img.crop((left, 0, right, h))
    return lpc_cliffs._made(img, (cx - left, h - margin))


def sign(text, points):
    """One board on its own post."""
    return signs([(text, points)])
