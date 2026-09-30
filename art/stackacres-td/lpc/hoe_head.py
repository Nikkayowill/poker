#!/usr/bin/env python3
"""The overhead hoe swing, cut out of LPC's pickaxe swing.

LPC draws its hoe only for the forward jab (`thrust`), and a hoe is swung over the head like a
pick. The pickaxe has that swing on the same oversize sheet as the axe, so the hoe is the pickaxe
with one point of its head taken off: seen side on, a pick head is a T and a hoe head is an L.
Seen from the front or the back the head is edge on, a flat bar, and a hoe blade looks the same
there, so those two directions are left alone.

Which point goes is chosen so the one that stays points into the ground at the strike, the way a
hoe blade bites.
"""
import math

OUTLINE = (43, 28, 29)
CREAM = (196, 181, 159)
METAL = {(134, 126, 127), (77, 74, 93), (114, 107, 126), CREAM}
HANDLE = {(174, 118, 75), (105, 71, 51)}
# Which side of the handle the removed point is on, per direction the farmer faces.
SIDE = {"left": -1, "right": 1}
HEAD = 9     # how far from the handle's end the head is looked for
REACH = 15   # how far from the head's middle a point can reach
KEEP = 1.5   # the socket: pixels this close to the handle's line stay whatever side they are on


def cut(bg, fg, direction):
    """One frame's two tool layers with the back point of the head removed."""
    side = SIDE.get(direction)
    if side is None:
        return bg, fg
    both = bg.copy()
    both.alpha_composite(fg)
    px = both.load()
    w, h = both.size
    lit = [(x, y) for y in range(h) for x in range(w) if px[x, y][3]]
    metal = [p for p in lit if px[p][:3] in METAL]
    handle = [p for p in lit if px[p][:3] in HANDLE]
    if len(metal) < 3 or len(handle) < 2:
        return bg, fg
    hx = sum(p[0] for p in handle) / len(handle)
    hy = sum(p[1] for p in handle) / len(handle)
    tip = max(handle, key=lambda p: (p[0] - hx) ** 2 + (p[1] - hy) ** 2)
    head = [p for p in metal if px[p][:3] != CREAM and (p[0] - tip[0]) ** 2 + (p[1] - tip[1]) ** 2 <= HEAD ** 2]
    if not head:
        return bg, fg
    mx = sum(p[0] for p in head) / len(head)
    my = sum(p[1] for p in head) / len(head)
    length = math.hypot(mx - hx, my - hy) or 1
    nx, ny = -(my - hy) / length, (mx - hx) / length
    smear = _long_cream(both)
    out = []
    for layer in (bg, fg):
        img = layer.copy()
        p = img.load()
        cleared = set()
        for x, y in lit:
            c = p[x, y]
            if not c[3] or (c[:3] not in METAL and c[:3] != OUTLINE) or (x, y) in smear:
                continue
            if (x - mx) ** 2 + (y - my) ** 2 > REACH ** 2:
                continue
            if side * ((x - mx) * nx + (y - my) * ny) > KEEP:
                p[x, y] = (0, 0, 0, 0)
                cleared.add((x, y))
        # Close the cut with outline where it opened up the metal.
        for x, y in cleared:
            if any(0 <= x + dx < w and 0 <= y + dy < h and p[x + dx, y + dy][3] and p[x + dx, y + dy][:3] in METAL
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                p[x, y] = OUTLINE + (255,)
        out.append(img)
    return out[0], out[1]


def _long_cream(img, least=25):
    """The swing's smear: a long cream stroke, unlike the pick's own few highlight pixels."""
    p = img.load()
    w, h = img.size
    seen, keep = set(), set()
    for y in range(h):
        for x in range(w):
            if (x, y) in seen or not p[x, y][3] or p[x, y][:3] != CREAM:
                continue
            comp, stack = [], [(x, y)]
            seen.add((x, y))
            while stack:
                a, b = stack.pop()
                comp.append((a, b))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        q = (a + dx, b + dy)
                        if 0 <= q[0] < w and 0 <= q[1] < h and q not in seen and p[q][3] and p[q][:3] == CREAM:
                            seen.add(q)
                            stack.append(q)
            if len(comp) >= least:
                keep.update(comp)
    return keep
