"""The Ancestral Oak's and the Mine Entrance's sprites at the rich bar. Same signatures, sizes, anchors and
frame counts as areas/rig/props.py. `LIGHTS` gives sprite-pixel light points for things that glow."""
import math

from kit import FRAMES
from pal import Canvas, hash2, lambert, noise1, sway_image
from sprites import faceted
from trees import bark, canopy

LIGHTS = {
    "campfire_lit": [(10, 7, "lamp")],
    "lantern_post": [(4, 5, "lamp")],
    "cave_mouth": [(15, 21, "lamp")],
}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ------------------------------------------------------------------ the Ancestral Oak

def oak_tree():
    """The Ancestral Oak: a crown eight tiles wide on a trunk you could hide in."""
    w, h = 136, 140
    c, cx = Canvas(w, h), w // 2
    bark(c, cx - 12, cx + 12, 90, 132, 911, flare_from=116)
    for side in (-1, 1):                                          # buttress roots curving into the ground
        for r, (reach, drop) in enumerate(((15, 10), (10, 7), (19, 6))):
            for t in range(reach):
                x = cx + side * (9 + t)
                y0 = 112 + r * 3 + round(t * drop / reach + (t / reach) ** 2 * 6)
                thick = max(1, round(8 * (1 - t / reach) ** 0.8))
                for k in range(thick):
                    y = y0 + k
                    if y > 133:
                        continue
                    level = (4.6 if side < 0 else 2.8) + (1.0 if k == 0 else -0.5 * k)
                    c.put(x, y, "wood", level - (0.6 if hash2(x, y, 912) < 0.2 else 0))
                if thick > 1 and hash2(x, r, 913) < 0.3 and y0 + thick <= 133:
                    c.put(x, y0 + thick, "moss", 3.2)
    for y in range(101, 121):                                     # the hollow
        for x in range(cx - 6, cx + 7):
            d = ((x - cx) / 6.2) ** 2 + ((y - 111) / 9.5) ** 2
            if d <= 1:
                rim = d > 0.72
                level = 0.2 if not rim else (1.4 if y < 111 or x < cx else 4.6)
                c.put(x, y, "wood" if rim else "ink", level)
    c.put(cx - 2, 110, "gold", 4.6)                               # something lives in there
    c.put(cx + 1, 110, "gold", 4.6)
    for y, x0 in ((96, cx - 8), (104, cx + 8), (124, cx - 4)):    # old carved initials and scars
        for k in range(3):
            c.put(x0 + k, y + k % 2, "wood", 1.6)
    blobs = [(cx, 46, 30), (cx - 38, 56, 24), (cx + 38, 56, 24), (cx - 20, 30, 20), (cx + 22, 28, 20),
             (cx - 52, 74, 16), (cx + 54, 72, 16), (cx, 72, 26), (cx - 30, 84, 14), (cx + 32, 86, 14),
             (cx - 8, 14, 12), (cx + 10, 12, 10), (cx - 58, 60, 10), (cx + 60, 58, 10)]
    owner = canopy(c, blobs, 915, lo=0.2, hi=5.7, spacing=8, rmin=5.0, rmax=8.5)
    for x in range(cx - 14, cx + 15):                             # the crown's deep shade on the trunk
        for y in range(88, 104):
            p = c.get(x, y)
            if p and p[0] in ("wood", "moss") and (x, y) not in owner:
                c.put(x, y, p[0], p[1] - max(0.0, 3.0 - (y - 88) * 0.2))
    for k in range(22):                                           # leaves trailing from the skirt
        bx = cx - 58 + int(hash2(k, 0, 916) * 116)
        by = max((y for (x, y) in owner if x == bx), default=None)
        if by is None:
            continue
        for j in range(1, 2 + int(hash2(k, 1, 916) * 4)):
            c.put(bx + (j // 3), by + j, "leaf", 3.0 - j * 0.3)
    c.outline()
    img = sway_image(c, lambda x, y, p: p[0] in ("leaf", "leaf2"))
    img.info["sway"]["kind"] = "broadleaf"
    return img, (cx, 133)


def mural():
    """Skye's wall: boards painted with a running figure, mid-frame, in every colour she had."""
    w, h = 58, 38
    c = Canvas(w, h)
    for x0 in (2, w - 5):                                          # posts
        for y in range(2, 36):
            for i in range(3):
                c.put(x0 + i, y, "wood", (4.8, 3.4, 1.6)[i] - (0.6 if hash2(x0, y // 3, 920) < 0.2 else 0))
    for y in range(4, 34):                                         # the boards
        for x in range(5, w - 5):
            seam = (x - 5) % 6 == 5
            level = 1.8 if seam else 5.2 - (x - 5) * 0.02 + (noise1(x * 3, y, 5, 921) - 0.5) * 0.8
            if y == 4:
                level = 6.2
            c.put(x, y, "tan", level)
    for y in range(8, 30):                                         # night-blue ground with a painted edge
        for x in range(8, 50):
            level = 1.6 + (29 - y) * 0.04 + (0.5 if (x + y) % 7 == 0 else 0)
            if (x - 5) % 6 == 5:
                level -= 0.5                                       # the seams show through the paint
            c.put(x, y, "blue", level)
    for x, y in ((12, 11), (20, 24), (40, 12), (44, 26), (30, 9), (47, 10), (15, 17)):
        c.put(x, y, "white", 6.0)
    fig = ["...RR....", "..RRRR...", "...TT....", "..YYYY...", ".YYYYYYo.", "..YYYY...", ".LL..LL..", "LL....LL."]
    keys = {"R": ("red", 4.2), "T": ("skin_light", 4.4), "Y": ("straw", 5.2), "o": ("orange", 4.2), "L": ("denim", 4.2)}
    for j, row in enumerate(fig):
        for i, k in enumerate(row):
            if k != ".":
                ramp, level = keys[k]
                c.put(22 + i, 12 + j, ramp, level + (0.6 if i < 4 else -0.4))
    for i, (ramp, level) in enumerate((("red", 4.4), ("orange", 4.4), ("straw", 5.0), ("leaf2", 4.6),
                                      ("teal", 4.8), ("denim", 4.4))):
        for t in range(9):                                         # spray arcs behind the runner
            c.put(10 + i * 2 + t // 2, 26 - i * 2 - t % 3, ramp, level)
    for x, y in ((44, 18), (45, 18), (46, 18), (44, 19), (46, 19)):
        c.put(x, y, "red", 4.0)
    for x, y in ((12, 20), (13, 20), (12, 21), (13, 21)):
        c.put(x, y, "teal", 5.0)
    for x in (18, 33, 41):                                         # paint drips
        for k in range(2 + int(hash2(x, 0, 922) * 3)):
            c.put(x, 30 + k, "blue", 2.4 - k * 0.3)
    return c.outline().image(), (w // 2, 36)


def beehive():
    """Bea's hive: three painted supers, a sloped lid, bees at the door."""
    c = Canvas(18, 22)
    for y in range(20, 22):
        for x in range(3, 15):
            c.put(x, y, "wood", 3.6 if y == 20 else 1.8)
    for i, y0 in enumerate((4, 10, 15)):
        for y in range(y0, y0 + 6):
            for x in range(3, 15):
                level = 5.8 - (x - 3) * 0.2 - (1.2 if y == y0 + 5 else 0) + (0.6 if y == y0 else 0)
                if x >= 13:
                    level = 3.0 - (y - y0) * 0.1
                c.put(x, y, "linen", level - i * 0.15)
    for x in range(2, 16):                                          # the lid
        c.put(x, 2, "slate", 5.6 - x * 0.12)
        c.put(x, 3, "slate", 3.8 - x * 0.1)
        c.put(x, 4, "slate", 1.4)
    for x in range(4, 14):
        c.put(x, 19, "ink", 0)
        c.put(x, 20, "wood", 4.2)                                   # landing board
    for x, y in ((0, 7), (16, 3), (1, 15), (8, 18), (13, 17)):
        c.put(x, y, "gold", 4.8)
        c.put(x + 1, y, "coal", 0.8)
    return c.outline().image(), (9, 21)


def mushrooms(seed=0):
    """A little clutch of toadstools: spotted domed caps over pale stems, a tuft at their feet."""
    c = Canvas(14, 10)
    for i, (x, y) in enumerate(((2, 4), (7, 2), (10, 5))):
        ramp = "red" if (seed + i) % 3 else "orange"
        for dy in range(2):                                         # stem
            c.put(x + 1, y + 3 + dy, "linen", 5.2 - dy)
            c.put(x + 2, y + 3 + dy, "linen", 3.8 - dy)
        for j, row in enumerate((".XX.", "XXXX", ".uu.")):
            for k, ch in enumerate(row):
                if ch == "X":
                    c.put(x + k, y + j, ramp, 4.8 - k * 0.5 - j * 0.6)
                elif ch == "u":
                    c.put(x + k, y + j, "tan", 3.0)
        c.put(x + 1, y + 1, "linen", 6.0)
        if hash2(seed, i, 925) < 0.6:
            c.put(x + 3, y + 1, "linen", 5.0)
    for x in (1, 6, 12):
        c.put(x, 9, "grass", 3.2)
        c.put(x + 1, 8, "grass", 4.6)
    return c.outline().image(), (7, 9)


def log_bench():
    """A split log on two stumps, the cut face worn smooth."""
    c = Canvas(34, 14)
    for y in range(4, 10):
        for x in range(3, 31):
            if y < 6:
                level = 5.6 - (0.6 if (x + y) % 5 == 0 else 0) - x * 0.02    # the flat, sat-on top
                ramp = "wood"
            else:
                level = 3.6 - (y - 6) * 0.6 - (0.9 if noise1(x * 2, y, 3, 926) < 0.3 else 0)
                ramp = "wood"
            c.put(x, y, ramp, level)
    for ex in (2, 31):                                               # end grain with rings
        for y in range(4, 10):
            for x in range(ex - 1, ex + 1):
                d = abs(y - 6.5)
                c.put(x, y, "wood", 6.0 if d < 1 else 4.4 if d < 2.2 else 2.4)
    for x0 in (6, 24):
        for y in range(10, 13):
            for x in range(x0, x0 + 4):
                c.put(x, y, "wood", 3.8 - (x - x0) * 0.7 - (y - 10) * 0.3)
    for x in range(10, 22, 5):
        c.put(x, 7, "moss", 3.4)
    return c.outline().image(), (17, 12)


def standing_stone():
    """An old standing stone: chiselled faces, a carved mark, moss climbing from the foot."""
    c = Canvas(20, 30)
    for y in range(2, 27):
        hw = 5 + (y - 2) * 3 // 25 + (1 if 8 < y < 20 else 0)
        for x in range(10 - hw, 10 + hw + 1):
            rel = (x - (10 - hw)) / (2 * hw)
            facet = int(rel * 3)                                     # three vertical faces
            level = (5.8, 4.2, 2.4)[min(facet, 2)] - (y - 2) * 0.03
            if hash2(x, y, 930) < 0.15:
                level += 0.5 if hash2(x, y, 931) < 0.5 else -0.5
            if y == 2 or (y == 3 and rel < 0.6):
                level += 0.8
            c.put(x, y, "stone", level)
    for j, row in enumerate(("X..X", ".XX.", "X..X")):                # the carved mark, cut in with a lit lower lip
        for i, ch in enumerate(row):
            if ch == "X":
                c.put(8 + i, 8 + j, "stone", 0.8)
                c.put(8 + i, 9 + j, "stone", 5.2)
    for x in range(3, 18):
        for y in range(18, 28):
            p = c.get(x, y)
            if p and noise1(x, y, 3, 932) > 0.45 + (27 - y) * 0.05:
                c.put(x, y, "moss", 2.6 + (27 - y) * 0.2)
    return c.outline().image(), (10, 28)


# ------------------------------------------------------------------ the Mine Entrance

def rock_face(c, x0, y0, w, h, seed=0):
    """Chiselled strata: wavering bed lines, blocks with leaning joints and a lit top-left bevel, fine grain and
    pitting, cracks, and moss tucked into the joints. Each bed has its own tone, some warmer, some cooler."""
    beds = [0]
    while beds[-1] < h:
        beds.append(beds[-1] + 6 + round(hash2(len(beds), seed, 70) * 6))
    for py in range(y0, y0 + h):
        for px in range(x0, x0 + w):
            wave = lambda k: beds[k] + round((noise1(px, k * 7, 9, seed + 71) - 0.5) * 4)
            k = 0
            while k + 1 < len(beds) and py - y0 >= wave(k + 1):
                k += 1
            top, bottom = wave(k), wave(k + 1) if k + 1 < len(beds) else h
            dy_top, dy_bot = (py - y0) - top, bottom - (py - y0) - 1
            lean = round((py - y0 - top) * 0.12)
            joint = 18 + round(hash2(k, seed, 72) * 16)
            off = round(hash2(k, seed, 73) * joint)
            bx = (px - x0 + off + lean) % joint
            block = (px - x0 + off + lean) // joint
            base = 3.0 + hash2(block, k, 74 + seed) * 1.6 + (0.4 if k % 3 == 0 else -0.2 if k % 3 == 1 else 0)
            ramp = "khaki" if hash2(k, block, 75 + seed) < 0.2 else "stone"
            grain = (noise1(px, py, 2.2, seed + 76) - 0.5) * 0.9
            level = base + grain - 0.8 * (py - y0 - top) / max(bottom - top, 1)
            if dy_bot <= 0 or bx == joint - 1:
                level = 0.7                                                  # the joint
                if hash2(px, py, 77 + seed) < 0.08:
                    ramp, level = "moss", 2.8
            elif dy_top <= 0 or bx == 0:
                level = base + 1.7                                           # the lit bevel
            elif dy_top == 1 or bx == 1:
                level += 0.7
            elif dy_bot == 1 or bx == joint - 2:
                level -= 0.8
            if hash2(px, py, 78 + seed) < 0.04:
                level -= 1.0                                                 # pitting
            c.put(px, py, ramp, level)
    for i in range(max(1, w // 18)):                                        # cracks running across the beds
        x = x0 + hash2(i, seed, 79) * w
        y = y0 + hash2(i, seed, 80) * h * 0.6
        for t in range(6 + int(hash2(i, seed, 81) * 10)):
            if x0 <= x < x0 + w and y0 <= y < y0 + h:
                c.put(x, y, "stone", 0.6)
                c.shift(round(x) + 1, round(y), 0.7)
            x += (hash2(i, t, 82) - 0.5) * 1.6
            y += 1


def grass_lip(c, width, rows=4, seed=0):
    """The turf edge along the top of a rock face, blades hanging over, a root dangling here and there."""
    for x in range(width):
        c.put(x, 0, "grass", 5.2 + (0.6 if x % 3 == 0 else 0))
        c.put(x, 1, "grass", 4.4)
        c.put(x, 2, "grass", 3.4 if hash2(x, 0, seed + 80) < 0.7 else 2.4)
        c.put(x, 3, "grass", 1.6)
        if hash2(x, 1, seed + 81) < 0.25:
            c.put(x, 4, "grass", 2.6)
        if hash2(x, 2, seed + 82) < 0.04:
            for k in range(3 + int(hash2(x, 3, seed + 82) * 5)):
                c.put(x + (k // 3), 4 + k, "wood", 2.0)


def cliff(width, height=44, seed=0):
    """A rock face seen from below: turf lip, chiselled strata, rubble at the foot."""
    c = Canvas(width, height)
    rock_face(c, 0, 4, width, height - 8, seed)
    grass_lip(c, width, seed=seed)
    for x in range(width):
        for y in range(height - 4, height):
            level = 1.4 + (height - 1 - y) * 0.3 + (hash2(x, y, seed + 84) - 0.5)
            c.put(x, y, "stone", level)
        if hash2(x, 0, seed + 85) < 0.2:                                  # fallen scree
            c.put(x, height - 3, "stone", 4.6)
            c.put(x, height - 2, "stone", 2.8)
    return c.image(), (width // 2, height)


def cave_mouth():
    """The way in: a timbered opening in the rock, rails running out of the dark, a lantern on the post."""
    w, h = 70, 64
    c = Canvas(w, h)
    cx = w // 2
    rock_face(c, 0, 4, w, h - 8, seed=3)
    grass_lip(c, w, seed=3)
    for y in range(14, 60):                                           # the opening, darker the deeper it goes
        hw = 16 if y > 22 else 8 + (y - 14)
        for x in range(cx - hw, cx + hw + 1):
            edge = min(x - (cx - hw), (cx + hw) - x, y - 14)
            c.put(x, y, "coal", 0.2 if edge > 3 else 1.2 - edge * 0.3)
    for x in range(cx - 17, cx + 18):                                  # the inner cross beam
        c.put(x, 22, "wood", 2.2)
        c.put(x, 23, "wood", 1.2)
    for x in range(cx - 22, cx + 22):                                  # lintel
        for y in range(10, 16):
            level = (5.6, 4.6, 4.0, 3.6, 3.0, 1.4)[y - 10] - (0.7 if noise1(x * 2, y, 4, 940) < 0.3 else 0)
            c.put(x, y, "wood", level)
    for x0 in (cx - 22, cx + 17):                                      # posts
        for y in range(16, 60):
            for i in range(5):
                level = (5.0, 4.2, 3.6, 3.0, 1.6)[i] - (0.6 if hash2(x0 + i, y // 4, 941) < 0.2 else 0)
                c.put(x0 + i, y, "wood", level)
        for y in (18, 50):                                             # iron straps
            for i in range(5):
                c.put(x0 + i, y, "stone", 3.4 if i else 5.0)
    for y in range(30, 60):                                            # rails fading into the dark
        fade = max(0.0, (y - 30) / 30)
        for rx in (cx - 6, cx + 4):
            c.put(rx, y, "stone", 1.2 + fade * 3.8)
            c.put(rx + 1, y, "stone", 0.8 + fade * 2.2)
    for y in range(34, 60, 6):
        for x in range(cx - 8, cx + 8):
            c.put(x, y, "wood", 1.0 + (y - 34) * 0.1)
            c.put(x, y + 1, "wood", 0.6 + (y - 34) * 0.06)
    for x, y, ramp, level in ((cx - 20, 19, "stone", 2.0), (cx - 21, 20, "gold", 3.2), (cx - 20, 20, "lamp", 4.6),
                              (cx - 19, 20, "gold", 2.6), (cx - 20, 21, "lamp", 3.8), (cx - 20, 22, "stone", 1.6)):
        c.put(x, y, ramp, level)                                       # the lantern
    for x in range(w):
        for y in range(h - 4, h):
            p = c.get(x, y)
            if p is None or p[0] not in ("coal", "wood"):
                c.put(x, y, "stone", 1.4 + (h - 1 - y) * 0.3 + (hash2(x, y, 942) - 0.5))
    return c.image(), (cx, h)


def rails(length):
    """Track on its sleepers: grained timber, steel rails with a polished top."""
    c = Canvas(20, length)
    for y in range(0, length, 6):
        for x in range(2, 18):
            c.put(x, y + 1, "wood", 4.6 - (0.6 if hash2(x, y, 945) < 0.25 else 0))
            c.put(x, y + 2, "wood", 2.6)
        c.put(4, y + 1, "stone", 5.0)
        c.put(15, y + 1, "stone", 5.0)
    for y in range(length):
        for rx in (5, 13):
            c.put(rx, y, "stone", 6.2)
            c.put(rx + 1, y, "stone", 2.8)
    return c.image(), (10, length)


def mine_cart(full=True):
    """An iron ore cart with riveted bands and rust, loaded with rock and a glint of gold and teal."""
    c = Canvas(30, 24)
    for y in range(4, 18):
        inset = (y - 4) // 5
        for x in range(3 + inset, 27 - inset):
            rel = (x - (3 + inset)) / max(23 - inset * 2, 1)
            level = 5.0 - rel * 2.8 - (y - 4) * 0.08
            ramp = "stone"
            if (y - 4) % 5 == 4:
                level = 1.8
            elif noise1(x * 0.5, y * 2, 3, 950) > 0.8 and y > 8:
                ramp, level = "orange", 2.2 + (1 - rel) * 1.2              # rust
            c.put(x, y, ramp, level)
        if (y - 4) % 5 == 4:
            for x in range(5 + inset, 26 - inset, 5):
                c.put(x, y - 1, "stone", 6.2)                                # rivets
    for x in range(3, 27):
        c.put(x, 4, "stone", 6.4)
    if full:
        for i, (x, y) in enumerate(((8, 3), (13, 2), (18, 3), (23, 4), (11, 5), (20, 5))):
            faceted(c, x, y, 2.6, 1.8, 951 + i, facets=5, lichen=0, flat_bottom=0.9)
        for x, y, ramp in ((10, 2, "gold"), (19, 1, "teal"), (15, 3, "gold")):
            c.put(x, y, ramp, 5.0)
            c.put(x + 1, y, ramp, 3.4)
    for wx in (9, 21):                                                     # wheels
        for y in range(18, 23):
            for x in range(wx - 2, wx + 3):
                d = math.hypot(x - wx, y - 20)
                if d <= 2.4:
                    c.put(x, y, "coal", 2.2 if d > 1.5 else 3.6 if (x, y) != (wx, 20) else 5.0)
    return c.outline().image(), (15, 22)


def lantern_post():
    """A wooden post with an arm and a warm lantern hung from it."""
    c = Canvas(12, 30)
    for y in range(6, 28):
        c.put(5, y, "wood", 4.8 - (0.7 if hash2(5, y // 3, 955) < 0.25 else 0))
        c.put(6, y, "wood", 2.2)
    for x in range(2, 10):
        c.put(x, 5, "wood", 4.4)
    c.put(3, 6, "coal", 1.4)
    for y in range(2, 9):                                                  # iron frame and glass
        for x in range(2, 7):
            frame = x in (2, 6) or y in (2, 8)
            if frame:
                c.put(x, y, "coal", 2.8 if (x == 2 or y == 2) else 1.2)
            else:
                c.put(x, y, "lamp", 5.0 - abs(x - 4) * 0.8 - abs(y - 5) * 0.4)
    c.put(4, 1, "coal", 2.0)
    for x in range(3, 9):
        c.put(x, 27, "stone", 4.4 - (x - 3) * 0.4)
        c.put(x, 28, "stone", 2.0)
    return c.outline().image(), (6, 28)


def tent():
    """Brayden's canvas tent, the flap tied back, a bedroll inside, guy lines pegged out."""
    w, h = 46, 34
    c = Canvas(w, h)
    cx = w // 2
    for y in range(4, 30):
        hw = 2 + (y - 4) * 20 // 26
        for x in range(cx - hw, cx + hw + 1):
            left = x < cx
            level = (5.6 if left else 3.2) - (y - 4) * 0.03
            if (x - cx) % 5 == 0 and x != cx:
                level -= 0.7                                                 # seams
            if noise1(x, y, 4, 960) > 0.72:
                level -= 0.5                                                 # creases
            c.put(x, y, "linen" if left else "tan", level)
    for y in range(12, 30):                                                  # the opening
        hw = (y - 12) * 6 // 18
        for x in range(cx - hw, cx + hw + 1):
            c.put(x, y, "coal", 0.6 + (y - 12) * 0.05)
    for x in range(cx - 4, cx + 3):                                          # a bedroll inside
        c.put(x, 27, "red", 3.0)
        c.put(x, 28, "red", 2.0)
    for x, y in ((cx - 7, 22), (cx - 6, 23), (cx - 7, 23)):                  # the tied-back flap
        c.put(x, y, "tan", 4.6)
    for y in range(2, 30):
        c.put(cx, y, "wood", 3.0)
    for x in range(cx - 3, cx + 3):
        c.put(x, 2, "wood", 4.4)
    for x in range(12, 19):                                                  # a patch
        for y in range(19, 23):
            c.put(x, y, "khaki", 4.6 - (y - 19) * 0.3)
    for x in range(1, w - 1):
        c.put(x, 30, "stone", 3.8 - (x / w) * 1.2)
        c.put(x, 31, "stone", 2.0)
    for gx, gy, sx in ((2, 29, 1), (w - 3, 29, -1)):                          # guy lines
        for t in range(9):
            c.put(gx + sx * t // 3, gy - t, "khaki", 5.0)
    return c.outline().image(), (cx, 31)


def _campfire_base():
    c = Canvas(20, 16)
    for a in range(10):                                                      # ring of stones
        ang = a * math.pi / 5
        x, y = 9.5 + math.cos(ang) * 7, 10.5 + math.sin(ang) * 3.5
        faceted(c, x, y, 1.6, 1.3, 970 + a, facets=4, lichen=0, flat_bottom=0.9)
    for t in range(12):                                                      # two crossed logs, charred ends
        for (x0, y0, dx) in ((4, 9, 1), (15, 9, -1)):
            x, y = x0 + dx * t, y0 + (t // 4)
            char = t > 6
            c.put(x, y, "coal" if char else "wood", 1.6 if char else 4.2)
            c.put(x, y + 1, "coal" if char else "wood", 0.8 if char else 2.2)
    return c


FLAMES = [
    ["...R...", "..RoR..", ".RoYoR.", ".RoYoR.", "RRoYoRR"],
    ["..R....", "..RoR..", ".RoYoR.", "RRoYoR.", "RRoYoRR"],
    ["....R..", "..RoRR.", ".RoYoR.", ".RoYoRR", "RRoYoRR"],
    ["...R...", "..RYR..", ".RoYoR.", ".RoYoR.", "RRoYoRR"],
]


def campfire_lit():
    """The campfire: stones and charring logs outlined, the flame over them unoutlined so it glows."""
    frames = []
    for f in range(FRAMES):
        c = _campfire_base().outline()
        keys = {"R": ("red", 4.6), "o": ("orange", 5.2), "Y": ("lamp", 4.6)}
        for j, row in enumerate(FLAMES[f]):
            for i, k in enumerate(row):
                if k != ".":
                    ramp, level = keys[k]
                    c.put(6 + i, 3 + j, ramp, level + (0.5 if j >= 3 else 0))
        for k in range(3):                                                   # embers rising
            ex = 7 + int(hash2(k, f, 975) * 6)
            ey = 2 - int(hash2(k, f, 976) * 2)
            c.put(ex, ey, "orange", 5.5)
        frames.append((c.image(), (10, 13)))
    return frames


def ore_rock(vein="Y"):
    """A chiselled boulder with a seam of gold (Y) or teal crystal (C) catching the light."""
    c = Canvas(16, 12)
    drawn = faceted(c, 7.5, 6.0, 6.5, 4.5, 980 + ord(vein), facets=7, lichen=0.12)
    ramp = "gold" if vein == "Y" else "teal"
    for i, (x, y) in enumerate(((4, 5), (5, 5), (8, 7), (9, 6), (10, 4), (6, 8))):
        if (x, y) in drawn:
            c.put(x, y, ramp, 4.6 if i % 2 == 0 else 3.0)
    c.put(10, 3, ramp, 5.8)
    return c.outline().image(), (8, 10)


def warning_sign():
    """A hazard board on a post: yellow with a dark border, crossed marks, nails, chipped paint."""
    c = Canvas(20, 26)
    for y in range(12, 25):
        c.put(9, y, "wood", 4.6)
        c.put(10, y, "wood", 2.2)
    for y in range(2, 12):
        for x in range(2, 18):
            border = x in (2, 17) or y in (2, 11)
            if border:
                c.put(x, y, "coal", 2.4 if (x == 2 or y == 2) else 1.0)
            else:
                level = 4.6 - (x - 3) * 0.06 + (0.6 if y == 3 else 0) - (0.6 if y == 10 else 0)
                c.put(x, y, "gold", level)
                if hash2(x, y, 985) < 0.05:
                    c.put(x, y, "wood", 3.4)                                   # chipped to the wood
    for j, row in enumerate(("X..X", ".XX.", "X..X")):
        for i, ch in enumerate(row):
            if ch == "X":
                c.put(8 + i, 5 + j, "coal", 0.6)
    c.put(4, 4, "stone", 5.6)
    c.put(15, 4, "stone", 5.6)
    return c.outline().image(), (10, 24)


def waterfall(height=60, width=22):
    """A sheet of falling water, deeper blue at the edges, streaks running down, a white plunge and mist."""
    frames = []
    w = width + 8
    for f in range(FRAMES):
        c = Canvas(w, height + 12)
        for y in range(height):
            for x in range(4, width + 4):
                rel = abs(x - (width / 2 + 3.5)) / (width / 2)
                level = 4.4 - rel * 2.6 + (y / height) * 0.4
                if (x * 3 + y - f * 3) % 9 in (0, 1):
                    level += 0.9
                if (x * 5 + y - f * 3) % 23 == 0:
                    level = 6.6
                if x in (4, width + 3):
                    level = 1.6
                if y < 3:
                    level = 6.4 if (x + f) % 3 else 5.2                          # the lip where it pours over
                c.put(x, y, "water", level)
        for x in range(w):
            d = abs(x - (w - 1) / 2) / (w / 2)
            for y in range(height - 2, height + 10):
                if y - height + 2 < 9 * (1 - d * d):
                    r = hash2(x, y, 90 + f)
                    if r < 0.3:
                        c.put(x, y, "white", 6.0 - (y - height) * 0.1)
                    elif r < 0.8:
                        c.put(x, y, "water", 6.2)
                    else:
                        c.put(x, y, "water", 4.6)
        for i in range(9):                                                     # mist
            x = 1 + round(hash2(i, f, 91) * (w - 3))
            y = height - 6 - round(hash2(i, f, 92) * 14)
            c.put(x, y, "white", 6.4)
        frames.append((c.image(), (w // 2, height + 8)))
    return frames
