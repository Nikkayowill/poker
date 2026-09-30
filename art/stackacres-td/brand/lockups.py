"""Logo lockups: the wordmark with the chip-stack mark, and the app badge."""
import numpy as np
from PIL import Image
from px import Canvas, rrect, ellipse, edges_top, edges_bottom
from mark import chip_stack
from wordmark import build


def trim(im):
    return im.crop(im.getbbox())


def mark():
    return trim(chip_stack().img())


def wordmark():
    return trim(build().img())


def stacked():
    """Mark sitting on top of the wordmark, overlapping it by a few pixels."""
    m, w = mark(), wordmark()
    W = max(m.width, w.width)
    out = Image.new("RGBA", (W, m.height + w.height - 6))
    out.alpha_composite(w, ((W - w.width) // 2, m.height - 6))
    out.alpha_composite(m, ((W - m.width) // 2, 0))
    return out


def row():
    m, w = mark(), wordmark()
    H = max(m.height, w.height)
    out = Image.new("RGBA", (m.width + w.width + 4, H))
    out.alpha_composite(m, (0, (H - m.height) // 2))
    out.alpha_composite(w, (m.width + 4, (H - w.height) // 2 + 3))
    return out


def badge(S=72):
    """The mark standing on grass under a sky, inside a barn-trim frame."""
    c = Canvas(S, S)
    yy, _ = np.mgrid[0:S, 0:S]
    outer = rrect(S, S, 1, 1, S - 2, S - 2, 11)
    c.put(outer, "red")
    inner = rrect(S, S, 5, 5, S - 6, S - 6, 8)
    field = rrect(S, S, 8, 8, S - 9, S - 9, 6)
    c.put(inner & ~field, "trim")
    c.put(edges_top(inner) & inner, "white")
    c.put(edges_bottom(inner) & inner, "trim2")
    g0 = S - 24
    for y0, col in ((8, "#8ad8f0"), (20, "#62c2ea"), (32, "#42a8dc"), (g0, "#84bf44")):
        c.put(field & (yy >= y0), col)
    c.put(field & (yy == g0), "greenhi")
    c.put(field & (yy >= g0 + 8), "green2")
    c.put(ellipse(S, S, S / 2, g0 + 7, 18, 3.2) & field, "green3")
    c.put(edges_top(outer) & outer, "redhi")
    c.put(edges_bottom(outer) & outer, "red3")
    c.outline("ink", 1, diag=False)
    out = c.img()
    m = mark()
    out.alpha_composite(m, ((S - m.width) // 2, g0 + 9 - m.height))
    return out
