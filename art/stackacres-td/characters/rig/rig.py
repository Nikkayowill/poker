#!/usr/bin/env python3
"""StackAcres character rig.

One body, one set of poses, one set of tools. A character is only a head style plus a
palette of color roles, so every animation exists for every character. Running this
writes each character's frames (build/<name>.json), an expected composite to verify
Aseprite's export against, and review previews. build.sh then turns each JSON into a
layered, tagged .aseprite file and a spritesheet.

Frames are 48x48, feet bottom at y=44, character centered on x=23.5. Left-facing
animations are exact mirrors of right-facing ones.
"""
import json
import os

from PIL import Image

RIG = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(RIG)
BUILD = os.path.join(RIG, "build")
SIZE = 48

DB16 = {  # DawnBringer 16
    "K": "#140C1C", "P": "#442434", "B": "#30346D", "g": "#4E4A4E", "N": "#854C30",
    "G": "#346524", "R": "#D04648", "O": "#757161", "L": "#597DCE", "o": "#D27D2C",
    "s": "#8595A1", "v": "#6DAA2C", "T": "#D2AA99", "C": "#6DC2CA", "Y": "#DAD45E",
    "W": "#DEEED6",
}

# Bottom to top. FX layers are never outlined; Arms and Tool get a dark edge where
# they cross the body so a raised arm or axe handle doesn't vanish into the shirt.
LAYERS = ["FX Back", "Tool Back", "Arm Back", "Legs", "Body", "Head", "Arms", "Tool", "FX", "Outline"]
NO_OUTLINE = {"FX Back", "FX", "Outline"}
FRONT = ("Arms", "Tool")

# Role keys used in the body grids: S s h skin, H j hair, C c k hat, E eyes,
# R r shirt, L l Y overalls and buckle, u cuffs, D b d boots.
CHARACTERS = {
    "ray": {"head": "flat_cap_beard", "roles": {
        "S": "N", "s": "P", "h": "o", "H": "W", "j": "s", "C": "T", "c": "O", "k": "W",
        "E": "K", "R": "R", "r": "P", "L": "L", "l": "B", "Y": "Y", "u": "s",
        "D": "N", "b": "o", "d": "P"}},
    "farmer": {"head": "straw_hat", "roles": {
        "S": "N", "s": "P", "h": "o", "H": "P", "j": "K", "C": "Y", "c": "o", "k": "W",
        "E": "K", "R": "v", "r": "G", "L": "L", "l": "B", "Y": "Y", "u": "s",
        "D": "N", "b": "o", "d": "P"}},
}

HEADS = {  # 14 wide, drawn at x=17 from head_top; the torso starts 11 rows down
    "flat_cap_beard": {
        "front": [
            "...CCCCCCCC...", "..CkkCCCCCCc..", ".CCCCCCCCCCcc.", ".CCCCCCCCCCCC.",
            "..jSssssssSj..", "..HSHSSSSHSH..", "..hSESSSSESs..", "..hSSSssSSSs..",
            "..SSHHHHHHSs..", "..HHHHssHHHH..", "...jHHHHHHj...", ".....jHHj.....",
        ],
        "back": [
            "...CCCCCCCC...", "..CkkCCCCCCc..", ".CCCCCCCCCCcc.", ".cccccccccccc.",
            "..jHHHHHHHHj..", "..HHHHHHHHHH..", "..SHHHHHHHHs..", "..HHHHHHHHHj..",
            "...HHHHHHHj...", "...jSSSSSSj...", "....SSSSSs....", ".....SSSs.....",
        ],
        "side": [
            "....CCCCCC....", "...CkkCCCCc...", "...CCCCCCCCCc.", "...ccccccCCCCC",
            "...jjssssss...", "...HHSSSHSS...", "...HHSSSESSS..", "...jHhSSSSSSs.",
            "....HHSHHHHH..", "....HHHHHHsH..", ".....jHHHHHj..", "......jHHHj...",
        ],
    },
    "straw_hat": {
        "front": [
            "....CCCCCC....", "...CkkCCCCc...", "...cccccccc...", "CCCCCCCCCCCCCC",
            ".cccccccccccc.", "..HssssssssH..", "..hSESSSSESs..", "..hSSSSsSSSs..",
            "...SSSssSSs...", "....SSSSSs....", ".....SSSs.....",
        ],
        "back": [
            "....CCCCCC....", "...CCCCCCCc...", "...cccccccc...", "CCCCCCCCCCCCCC",
            ".cccccccccccc.", "..HHHHHHHHHH..", "..HHHHHHHHHj..", "..SHHHHHHHHs..",
            "...HHHHHHHj...", "....SSSSSs....", ".....SSSs.....",
        ],
        "side": [
            ".....CCCCC....", "....CkkCCCc...", "....ccccccc...", ".CCCCCCCCCCCCC",
            "..cccccccccccc", "...HHHssssS...", "...HHSSSSES...", "...HSSSSSSSS..",
            "....SSSSSsS...", ".....SSSS.....", "......SSs.....",
        ],
    },
}

TORSO = {  # 14 wide at x=17. "sleeves" keeps the hanging upper arms the walk uses.
    "front": [
        "RRRRLSSSSLRRRR", "RrRRLRSSRLRRrR", "rrrrYLLLLYrrrr", "RrRLLLLLLLLRrR",
        "RrRLLllllLLRrR", "RrRLLlLLlLLRrR", "..LLLLLLLLLL..", "..lLLLLLLLLl..",
        "..llllllllll..",
    ],
    "back": [
        "RRRRLRRRRLRRRR", "RrRRRLRRLRRRrR", "rrrrrrLLrrrrrr", "RrRRRLRRLRRRrR",
        "RrRLLLLLLLLRrR", "RrRLLlLLlLLRrR", "..LLLLLLLLLL..", "..lLLLLLLLLl..",
        "..llllllllll..",
    ],
    "side": [
        "...RRRSSRRR...", "..RRrRRLRRR...", "..rrrrrYLLLL..", "..RrRRRLLLLL..",
        "..RrRRLLLLLl..", "..RrRLLLLLLl..", "...LLLLLLLLl..", "...lLLLLLLLl..",
        "...lllllllll..",
    ],
}
ARM_L = {"neutral": ["RR", "Rr", "hS", "Ss"], "forward": ["RR", "Rr", "RR", "hS", "Ss"], "back": ["Rr", "hS", "Ss"]}
ARM_R = {"neutral": ["RR", "rR", "hS", "Ss"], "forward": ["RR", "rR", "RR", "hS", "Ss"], "back": ["rR", "hS", "Ss"]}
CARROT = ["v.v", ".G.", "ooN", "ooN", ".o."]

for style in HEADS.values():
    for view, grid in style.items():
        assert {len(r) for r in grid} == {14}, view
for view, grid in TORSO.items():
    assert {len(r) for r in grid} == {14}, view

# Everyone else: heads, outfits and palettes on this same body (see wardrobe.py).
import wardrobe  # noqa: E402

HEADS.update(wardrobe.HEADS)
TORSOS = {"overalls": TORSO, **wardrobe.TORSOS}
CHARACTERS.update(wardrobe.CHARACTERS)


def without_sleeves(grid):
    return ["..%s.." % r[2:12] if i < 6 else r for i, r in enumerate(grid)]


def line(p0, p1):
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err, pts = dx + dy, []
    while True:
        pts.append((x0, y0))
        if (x0, y0) == (x1, y1):
            return pts
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


class Frame:
    def __init__(self, ch, duration):
        self.ch, self.duration = ch, duration
        self.layers = {n: [[None] * SIZE for _ in range(SIZE)] for n in LAYERS}

    def put(self, layer, x, y, key, role=False):
        if 0 <= x < SIZE and 0 <= y < SIZE:
            self.layers[layer][y][x] = DB16[self.ch["roles"][key] if role else key]

    def stamp(self, layer, grid, x, y, role=True):
        for j, row in enumerate(grid):
            for i, key in enumerate(row):
                if key != ".":
                    self.put(layer, x + i, y + j, key, role)

    def finish(self):
        """Silhouette outline, then separation edges where front pieces cross the body."""
        solid = [[any(self.layers[n][y][x] for n in LAYERS if n not in NO_OUTLINE)
                  for x in range(SIZE)] for y in range(SIZE)]
        out = self.layers["Outline"]
        near = lambda x, y: ((x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                             if 0 <= x + dx < SIZE and 0 <= y + dy < SIZE)
        for y in range(SIZE):
            for x in range(SIZE):
                if not solid[y][x] and any(solid[ny][nx] for nx, ny in near(x, y)):
                    out[y][x] = DB16["K"]
        behind = [n for n in LAYERS[:LAYERS.index("Arms")] if n not in NO_OUTLINE]
        covered = lambda layer, x, y: bool(self.layers[layer][y][x]) and any(self.layers[n][y][x] for n in behind)
        shade = DB16[self.ch["roles"]["r"]]
        for y in range(SIZE):
            for x in range(SIZE):
                if any(self.layers[n][y][x] for n in FRONT) or not any(self.layers[n][y][x] for n in behind):
                    continue
                around = list(near(x, y))
                if any(covered("Tool", nx, ny) for nx, ny in around):
                    out[y][x] = DB16["K"]
                elif any(covered("Arms", nx, ny) for nx, ny in around):
                    out[y][x] = shade
        return self

    def mirrored(self):
        m = Frame(self.ch, self.duration)
        for n in LAYERS:
            m.layers[n] = [row[::-1] for row in self.layers[n]]
        return m

    def composite(self):
        img = Image.new("RGBA", (SIZE, SIZE))
        for n in LAYERS:
            for y, row in enumerate(self.layers[n]):
                for x, c in enumerate(row):
                    if c:
                        img.putpixel((x, y), tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
        return img


# ---------------------------------------------------------------- body parts

VIEW = {"down": "front", "up": "back", "right": "side"}
SHOULDER = {"L": (17, 30), "R": (29, 30), "near": (23, 31), "far": (21, 31)}


def body(f, direction, bob, sleeves):
    view = VIEW[direction]
    head_top = 19 + bob
    style = TORSOS[f.ch.get("torso", "overalls")][view]
    torso = style if sleeves or view == "side" else without_sleeves(style)
    f.stamp("Body", torso, 17, head_top + 11)
    head = HEADS[f.ch["head"]]
    f.stamp("Head", head[view], 17, head_top - head.get("rise", 0))


def front_legs(f, bob, lifted=None, spread=0):
    rows = ["LLLl"] * max(3 - bob, 0) + ["uuuu", "bDDD", "DDDd"]
    for side, x in (("L", 19 - spread), ("R", 25 + spread)):
        bottom = 43 if lifted == side else 44
        f.stamp("Legs", rows, x, bottom - len(rows) + 1)


def side_leg(f, top, x_top, x_bot, bottom, near):
    denim = bottom - 2 - top
    for k in range(denim):
        x = round(x_top + (x_bot - x_top) * (k / max(denim - 1, 1)))
        f.stamp("Legs", ["LLLl" if near else "llll"], x, top + k)
    f.stamp("Legs", ["uuuu" if near else "llll"], x_bot, bottom - 2)
    f.stamp("Legs", ["bDDDD", "DDDDd"] if near else ["DDDDd", "ddddd"], x_bot, bottom - 1)


def side_legs(f, bob, stance):
    top = 39 + bob
    far, near = {
        "together": ((21, 21, 44), (23, 23, 44)),
        "passing": ((21, 21, 43), (23, 23, 44)),
        "near_forward": ((22, 20, 44), (23, 25, 44)),
        "far_forward": ((22, 24, 44), (23, 21, 44)),
        "crouch": ((22, 22, 44), (24, 25, 44)),
        "lunge": ((21, 20, 44), (24, 26, 44)),
    }[stance]
    side_leg(f, top, *far, near=False)
    side_leg(f, top, *near, near=True)


def arm(f, layer, which, hand, bob):
    """A 2px sleeve from shoulder to hand: lit edge plus shadow edge, not a 2x2 smear."""
    sx, sy = SHOULDER[which]
    start = (sx, sy + bob)
    steep = abs(hand[1] - start[1]) >= abs(hand[0] - start[0])
    for x, y in line(start, hand)[:-1]:
        f.put(layer, x, y, "R", role=True)
        f.put(layer, x + steep, y + (not steep), "r", role=True)
    f.stamp(layer, ["hS", "Ss"], *hand)


# ---------------------------------------------------------------- tools and effects

def axe(f, layer, grip, tip):
    for x, y in line(grip, tip):
        f.put(layer, x, y, "N")
    dx, dy = tip[0] - grip[0], tip[1] - grip[1]
    n = (dx * dx + dy * dy) ** 0.5 or 1
    ux, uy = dx / n, dy / n
    px, py = -uy, ux
    for a2 in range(-2, 6):
        for b2 in range(-2, 3):
            a, b = a2 / 2, b2 / 2
            key = "W" if a >= 2 else "g" if a <= -1 else "s"
            f.put(layer, round(tip[0] + px * a + ux * b), round(tip[1] + py * a + uy * b), key)


def can(f, layer, hand, facing, tilt):
    hx, hy = hand
    for i in range(5):
        x, drop = hx + facing * (i - 2), tilt * (i // 2)
        for k, key in enumerate("Wssg"):
            f.put(layer, x, hy + 2 + k + drop, key)
    base = (hx + facing * 3, hy + 3 + tilt * 2)
    step = 1 if tilt else -1
    pts = [base, (base[0] + facing, base[1] + step), (base[0] + 2 * facing, base[1] + 2 * step)]
    for x, y in pts:
        f.put(layer, x, y, "s")
    f.put(layer, *pts[-1], "W")
    return pts[-1]


def drops(f, layer, tip, phase):
    x, y = tip
    for dx, dy in ((0, 1), (0, 2), (1, 3)):
        f.put(layer, x + dx, y + dy, "W")
    for i, (dx, dy) in enumerate(((-1, 5), (1, 6), (0, 8), (-1, 10), (2, 9), (1, 12))):
        f.put(layer, x + dx, y + dy + phase, "C" if i % 2 else "W")


def chips(f, layer, center, phase):
    for i, (dx, dy) in enumerate(((-4, -2), (4, -3), (-3, 1), (5, 0), (0, -4))):
        f.put(layer, center[0] + dx * (1 + phase), center[1] + dy * (1 + phase), "oNT"[i % 3])


def rod(f, layer, grip, tip, fx=None, line_end=None):
    for x, y in line(grip, tip):
        f.put(layer, x, y, "N")
    f.put(layer, *tip, "o")
    if line_end:
        for x, y in line(tip, line_end)[1:]:
            f.put(fx, x, y, "W")


def bow_side(f, layer, x, cy, fx, hand=None):
    for t in range(-5, 6):
        f.put(layer, x + round(2 * (1 - (t / 5) ** 2)), cy + t, "N")
    top, bottom = (x, cy - 5), (x, cy + 5)
    f.put(layer, *top, "o")
    f.put(layer, *bottom, "o")
    for a, b in ((top, hand), (hand, bottom)) if hand else ((top, bottom),):
        for px, py in line(a, b):
            f.put(fx, px, py, "W")


def bow_front(f, layer, cx, y, w, bulge, fx, hand=None):
    for t in range(-w, w + 1):
        by = y + bulge * round(2 * (1 - (t / w) ** 2))
        f.put(layer, cx + t, by - bulge, "o")
        f.put(layer, cx + t, by, "N")
    left, right = (cx - w, y), (cx + w, y)
    f.put(layer, *left, "o")
    f.put(layer, *right, "o")
    for a, b in ((left, hand), (hand, right)) if hand else ((left, right),):
        for px, py in line(a, b):
            f.put(fx, px, py, "W")


def arrow(f, layer, tail, head):
    pts = line(tail, head)
    for x, y in pts:
        f.put(layer, x, y, "N")
    f.put(layer, *pts[-1], "s")
    f.put(layer, *pts[-2], "s")
    f.put(layer, *pts[0], "W")
    f.put(layer, *pts[1], "R")


def carrot(f, layer, x, y, leaves_only=False):
    f.stamp(layer, CARROT[:2] if leaves_only else CARROT, x, y, role=False)


# ---------------------------------------------------------------- animations

def posed(ch, direction, dur, bob, legs, arms=(), extras=()):
    f = Frame(ch, dur)
    body(f, direction, bob, sleeves=False)
    if direction == "right":
        side_legs(f, bob, legs)
    else:
        front_legs(f, bob, spread=legs)
    for layer, which, hand in arms:
        arm(f, layer, which, hand, bob)
    for draw in extras:
        draw(f)
    return f.finish()


def walk(ch, direction):
    frames = []
    if direction == "right":
        for bob, stance, near, far in (
            (1, "near_forward", (21, 39), (26, 39)),
            (0, "passing", (23, 38), (21, 37)),
            (1, "far_forward", (26, 39), (19, 39)),
            (0, "passing", (23, 38), (21, 37)),
        ):
            f = Frame(ch, 150)
            body(f, direction, bob, sleeves=False)
            side_legs(f, bob, stance)
            arm(f, "Arm Back", "far", far, bob)
            arm(f, "Arms", "near", near, bob)
            frames.append(f.finish())
        return frames
    for bob, lifted, la, ra in ((1, "R", "back", "forward"), (0, None, "neutral", "neutral"),
                                (1, "L", "forward", "back"), (0, None, "neutral", "neutral")):
        f = Frame(ch, 150)
        body(f, direction, bob, sleeves=True)
        front_legs(f, bob, lifted)
        f.stamp("Arms", ARM_L[la], 17, 36 + bob)
        f.stamp("Arms", ARM_R[ra], 29, 36 + bob)
        frames.append(f.finish())
    return frames


def harvest(ch, d):
    # Arms stay about as long as the walking arm (9px); the old 13px reach read as a sash.
    if d in ("down", "up"):
        low = "Arms" if d == "down" else "Arm Back"
        in_front = d == "down"
        return [
            posed(ch, d, 120, 2, 1, [(low, "L", (19, 39)), (low, "R", (27, 39))]),
            posed(ch, d, 160, 3, 1, [(low, "L", (20, 41)), (low, "R", (26, 41))],
                  [lambda f: carrot(f, "Tool", 22, 42, leaves_only=True)] if in_front else []),
            posed(ch, d, 120, 1, 0, [(low, "L", (21, 36)), (low, "R", (26, 36))],
                  [lambda f: carrot(f, "Tool", 22, 33)] if in_front else []),
            posed(ch, d, 350, 0, 0, [("Arms", "L", (17, 21)), ("Arms", "R", (29, 21))],
                  [lambda f: carrot(f, "Tool", 22, 13)]),
        ]
    return [
        posed(ch, d, 120, 2, "crouch", [("Arm Back", "far", (27, 39)), ("Arms", "near", (29, 39))]),
        posed(ch, d, 160, 3, "crouch", [("Arm Back", "far", (28, 41)), ("Arms", "near", (30, 41))],
              [lambda f: carrot(f, "Tool", 31, 43, leaves_only=True)]),
        posed(ch, d, 120, 1, "together", [("Arm Back", "far", (28, 35)), ("Arms", "near", (30, 34))],
              [lambda f: carrot(f, "Tool", 30, 30)]),
        posed(ch, d, 350, 0, "together", [("Arm Back", "far", (29, 33)), ("Arms", "near", (31, 32))],
              [lambda f: carrot(f, "Tool", 31, 26)]),
    ]


def water(ch, d):
    def pour(f, layer, fx, hand, facing, tilt, phase):
        tip = can(f, layer, hand, facing, tilt)
        if phase is not None:
            drops(f, fx, tip, phase)

    if d == "down":
        arms, hand, facing, layer, fx, legs = [("Arms", "L", (17, 38)), ("Arms", "R", (28, 37))], (28, 37), -1, "Tool", "FX", 0
    elif d == "up":
        arms, hand, facing, layer, fx, legs = [("Arms", "L", (17, 38)), ("Arms", "R", (31, 31))], (31, 31), 1, "Tool Back", "FX Back", 0
    else:
        arms, hand, facing, layer, fx, legs = [("Arm Back", "far", (20, 38)), ("Arms", "near", (28, 36))], (28, 36), 1, "Tool", "FX", "together"
    return [
        posed(ch, d, 160, 0, legs, arms, [lambda f, t=tilt, p=phase: pour(f, layer, fx, hand, facing, t, p)])
        for tilt, phase in ((0, None), (1, None), (1, 0), (1, 2))
    ]


def chop(ch, d):
    if d in ("down", "up"):
        front = d == "down"
        low, low_tool = ("Arms", "Tool") if front else ("Arm Back", "Tool Back")
        swing = [((23, 36), (23, 44)), ((23, 38), (23, 46))] if front else [((23, 27), (23, 14)), ((23, 28), (23, 12))]
        chip = (23, 45) if front else (23, 11)
        back_tilt = -2 if front else 2
        # Arms go up beside the head, not across it; the axe waits behind the head.
        return [
            posed(ch, d, 180, 0, 0, [("Arms", "L", (17, 21)), ("Arms", "R", (29, 21))],
                  [lambda f: axe(f, "Tool Back", (23, 19), (23, 9))]),
            posed(ch, d, 120, 0, 0, [("Arms", "L", (17, 20)), ("Arms", "R", (29, 20))],
                  [lambda f: axe(f, "Tool Back", (23, 19), (23 + back_tilt, 8))]),
            posed(ch, d, 60, 1, 0, [(low, "L", (21, swing[0][0][1])), (low, "R", (25, swing[0][0][1]))],
                  [lambda f: axe(f, low_tool, *swing[0])]),
            posed(ch, d, 260, 2, 1, [(low, "L", (21, swing[1][0][1])), (low, "R", (25, swing[1][0][1]))],
                  [lambda f: axe(f, low_tool, *swing[1]), lambda f: chips(f, "FX", chip, 0)]),
        ]
    # Windups raise the arm behind the back of the head, never across the face.
    return [
        posed(ch, d, 180, 0, "together", [("Arm Back", "far", (19, 23)), ("Arms", "near", (20, 22))],
              [lambda f: axe(f, "Tool Back", (20, 22), (13, 13))]),
        posed(ch, d, 120, 0, "together", [("Arm Back", "far", (20, 21)), ("Arms", "near", (21, 20))],
              [lambda f: axe(f, "Tool Back", (21, 20), (17, 8))]),
        posed(ch, d, 60, 1, "near_forward", [("Arm Back", "far", (28, 35)), ("Arms", "near", (29, 34))],
              [lambda f: axe(f, "Tool", (29, 34), (36, 41))]),
        posed(ch, d, 260, 2, "lunge", [("Arm Back", "far", (28, 39)), ("Arms", "near", (29, 38))],
              [lambda f: axe(f, "Tool", (29, 38), (36, 45)), lambda f: chips(f, "FX", (37, 44), 0)]),
    ]


def fish(ch, d):
    if d == "down":
        hang = ("Arms", "L", (17, 38))
        return [
            posed(ch, d, 220, 0, 0, [hang, ("Arms", "R", (30, 21))], [lambda f: rod(f, "Tool", (30, 21), (36, 7))]),
            posed(ch, d, 90, 0, 0, [hang, ("Arms", "R", (29, 36))], [lambda f: rod(f, "Tool", (29, 36), (38, 44))]),
            posed(ch, d, 150, 0, 0, [hang, ("Arms", "R", (29, 35))],
                  [lambda f: rod(f, "Tool", (29, 35), (39, 40), "FX", (41, 47))]),
            posed(ch, d, 500, 0, 0, [hang, ("Arms", "R", (29, 34))],
                  [lambda f: rod(f, "Tool", (29, 34), (38, 37), "FX", (39, 47))]),
        ]
    if d == "up":
        hang = ("Arms", "L", (17, 38))
        return [
            posed(ch, d, 220, 0, 0, [hang, ("Arms", "R", (30, 24))], [lambda f: rod(f, "Tool", (30, 24), (36, 36))]),
            posed(ch, d, 90, 0, 0, [hang, ("Arm Back", "R", (29, 27))], [lambda f: rod(f, "Tool Back", (29, 27), (34, 10))]),
            posed(ch, d, 150, 0, 0, [hang, ("Arm Back", "R", (29, 27))],
                  [lambda f: rod(f, "Tool Back", (29, 27), (34, 11), "FX Back", (35, 1))]),
            posed(ch, d, 500, 0, 0, [hang, ("Arm Back", "R", (29, 27))],
                  [lambda f: rod(f, "Tool Back", (29, 27), (33, 12), "FX Back", (34, 0))]),
        ]
    return [
        posed(ch, d, 220, 0, "together", [("Arm Back", "far", (19, 24)), ("Arms", "near", (20, 23))],
              [lambda f: rod(f, "Tool Back", (20, 23), (11, 9))]),
        posed(ch, d, 90, 1, "near_forward", [("Arm Back", "far", (28, 32)), ("Arms", "near", (29, 31))],
              [lambda f: rod(f, "Tool", (29, 31), (42, 24))]),
        posed(ch, d, 150, 1, "near_forward", [("Arm Back", "far", (28, 33)), ("Arms", "near", (29, 32))],
              [lambda f: rod(f, "Tool", (29, 32), (42, 27), "FX", (46, 47))]),
        posed(ch, d, 500, 0, "together", [("Arm Back", "far", (28, 33)), ("Arms", "near", (29, 32))],
              [lambda f: rod(f, "Tool", (29, 32), (41, 28), "FX", (44, 47))]),
    ]


def shoot(ch, d):
    if d == "down":
        bow = lambda f, hand=None: bow_front(f, "Tool", 24, 35, 7, 1, "FX", hand)
        hold = ("Arms", "L", (23, 35))
        return [
            posed(ch, d, 150, 0, 0, [hold, ("Arms", "R", (28, 36))], [bow]),
            posed(ch, d, 250, 0, 0, [hold, ("Arms", "R", (25, 30))],
                  [lambda f: bow(f, (25, 31)), lambda f: arrow(f, "Tool", (25, 31), (25, 45))]),
            posed(ch, d, 200, 0, 0, [hold, ("Arms", "R", (25, 29))],
                  [lambda f: bow(f, (25, 30)), lambda f: arrow(f, "Tool", (25, 30), (25, 44))]),
            posed(ch, d, 250, 0, 0, [hold, ("Arms", "R", (28, 33))],
                  [bow, lambda f: arrow(f, "Tool", (25, 43), (25, 47))]),
        ]
    if d == "up":
        # Aiming away from camera: the bow sits behind the back at chest height, tips showing.
        bow = lambda f, hand=None: bow_front(f, "Tool Back", 24, 31, 8, -1, "FX Back", hand)
        hold = ("Arm Back", "L", (23, 31))
        return [
            posed(ch, d, 150, 0, 0, [hold, ("Arm Back", "R", (28, 33))], [bow]),
            posed(ch, d, 250, 0, 0, [hold, ("Arm Back", "R", (25, 34))],
                  [lambda f: bow(f, (25, 34)), lambda f: arrow(f, "Tool Back", (25, 34), (25, 12))]),
            posed(ch, d, 200, 0, 0, [hold, ("Arm Back", "R", (25, 35))],
                  [lambda f: bow(f, (25, 35)), lambda f: arrow(f, "Tool Back", (25, 35), (25, 13))]),
            posed(ch, d, 250, 0, 0, [hold, ("Arms", "R", (29, 35))],
                  [bow, lambda f: arrow(f, "Tool Back", (25, 6), (25, 1))]),
        ]
    bow = lambda f, hand=None: bow_side(f, "Tool", 33, 31, "FX", hand)
    far = ("Arm Back", "far", (31, 31))
    return [
        posed(ch, d, 150, 0, "together", [far, ("Arms", "near", (29, 32))], [bow]),
        posed(ch, d, 250, 0, "together", [far, ("Arms", "near", (25, 30))],
              [lambda f: bow(f, (26, 31)), lambda f: arrow(f, "Tool", (26, 31), (37, 31))]),
        posed(ch, d, 200, 0, "together", [far, ("Arms", "near", (24, 30))],
              [lambda f: bow(f, (25, 31)), lambda f: arrow(f, "Tool", (25, 31), (36, 31))]),
        posed(ch, d, 250, 0, "together", [far, ("Arms", "near", (27, 31))],
              [bow, lambda f: arrow(f, "Tool", (42, 31), (47, 31))]),
    ]


ANIMATIONS = [("walk", walk), ("harvest", harvest), ("water", water), ("chop", chop), ("fish", fish), ("shoot", shoot)]
DIRECTIONS = ["down", "up", "left", "right"]


def build(ch):
    tags, frames = [], []
    for name, make in ANIMATIONS:
        right = None
        for d in DIRECTIONS:
            if d == "left":
                right = right or make(ch, "right")
                seq = [f.mirrored() for f in right]
            elif d == "right":
                seq = right or make(ch, "right")
            else:
                seq = make(ch, d)
            tags.append({"name": f"{name}_{d}", "from": len(frames) + 1, "to": len(frames) + len(seq)})
            frames.extend(seq)
    return tags, frames


def main():
    os.makedirs(BUILD, exist_ok=True)
    allowed = set(DB16.values())
    for name, ch in CHARACTERS.items():
        tags, frames = build(ch)
        out_dir = os.path.join(ROOT, name)
        os.makedirs(os.path.join(out_dir, "previews"), exist_ok=True)
        cols, rows = 4, len(tags)
        expected = Image.new("RGBA", (cols * SIZE, rows * SIZE))
        contact = Image.new("RGBA", (cols * SIZE * 3, rows * SIZE * 3), (90, 156, 71, 255))
        payload = {"name": name, "width": SIZE, "height": SIZE, "palette": list(DB16.values()),
                   "layers": LAYERS, "tags": tags, "frames": []}
        for i, f in enumerate(frames):
            cels = {}
            for layer in LAYERS:
                px = [[x, y, c] for y, row in enumerate(f.layers[layer]) for x, c in enumerate(row) if c]
                assert all(c in allowed for _, _, c in px), f"{name} frame {i + 1} {layer} off palette"
                if px:
                    cels[layer] = px
            payload["frames"].append({"duration": f.duration, "cels": cels})
        for r, tag in enumerate(tags):
            seq = frames[tag["from"] - 1:tag["to"]]
            imgs = []
            for c, f in enumerate(seq):
                img = f.composite()
                expected.alpha_composite(img, (c * SIZE, r * SIZE))
                big = img.resize((SIZE * 3, SIZE * 3), Image.NEAREST)
                contact.alpha_composite(big, (c * SIZE * 3, r * SIZE * 3))
                imgs.append(img.resize((SIZE * 4, SIZE * 4), Image.NEAREST))
            imgs[0].save(os.path.join(out_dir, "previews", f"{tag['name']}.gif"), save_all=True,
                         append_images=imgs[1:], duration=[f.duration for f in seq], loop=0, disposal=2)
        with open(os.path.join(BUILD, f"{name}.json"), "w") as fh:
            json.dump(payload, fh, separators=(",", ":"))
        expected.save(os.path.join(BUILD, f"{name}-expected.png"))
        contact.save(os.path.join(out_dir, f"{name}-contact.png"))
        print(f"{name}: {len(tags)} tags, {len(frames)} frames")


if __name__ == "__main__":
    main()
