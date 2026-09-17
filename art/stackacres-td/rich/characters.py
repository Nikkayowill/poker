#!/usr/bin/env python3
"""Every rig character in the rich palette, on the rig's own poses.

rig.py places pixels as colour roles (S skin, H hair, R shirt, l trouser shadow...) and turns them into
DawnBringer 16 on the spot. Here `Frame.put` is swapped to keep the role, so each pixel still knows what
it is. A frame is then shaded part by part: every part gets its own ramp and keeps the approved value of
each role, then gains form light from the top-left, cloth and hair texture, a lit rim and a selective
outline. Left-facing frames stay exact mirrors of right-facing ones, as in the rig.

Writes rich/out/characters/<name>-sheet.png (same layout as the rig's Aseprite sheet, so its JSON still
applies), <name>-contact.png, and lineup.png.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TD = os.path.dirname(HERE)
RIG_DIR = os.path.join(TD, "characters", "rig")
CHAR_ROOT = os.path.join(TD, "characters")
OUT = os.path.join(HERE, "out", "characters")
sys.path[:0] = [HERE, RIG_DIR]

from PIL import Image  # noqa: E402

import rig  # noqa: E402
from pal import RGB, SHADES, TOP, Canvas  # noqa: E402

SIZE = rig.SIZE


def _put(self, layer, x, y, key, role=False):
    if 0 <= x < SIZE and 0 <= y < SIZE:
        self.layers[layer][y][x] = ("role" if role else "raw", key)


rig.Frame.put = _put

GROUP = {"S": "skin", "s": "skin", "h": "skin", "H": "hair", "j": "hair", "C": "hat", "c": "hat", "k": "hat",
         "A": "accent", "a": "accent", "E": "eyes", "R": "shirt", "r": "shirt", "L": "legs", "l": "legs",
         "Y": "buckle", "u": "cuffs", "D": "boots", "b": "boots", "d": "boots"}
BASE_ROLE = {"skin": "S", "hair": "H", "hat": "C", "accent": "A", "shirt": "R", "legs": "L", "boots": "D", "cuffs": "u"}
FAMILY = {"K": "coal", "P": "plum", "B": "denim", "g": "stone", "N": "leather", "G": "shutter", "R": "red",
          "O": "khaki", "L": "denim", "o": "orange", "s": "stone", "v": "leaf2", "T": "tan", "C": "teal",
          "Y": "straw", "W": "linen"}
SKIN = {"T": "skin_light", "o": "skin_mid", "N": "skin_deep"}
RAW_FAMILY = {**FAMILY, "N": "wood", "W": "stone", "g": "stone", "s": "stone", "C": "water"}
# (across, down) weight of the form light per part
FORM = {"skin": (0.9, 0.7), "hair": (0.7, 1.0), "hat": (0.9, 0.9), "accent": (0.9, 0.5), "shirt": (1.1, 0.5),
        "legs": (0.8, 0.3), "boots": (0.7, 0.3), "cuffs": (0.5, 0.2), "tool": (0.6, 0.3)}
DB_RGB = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) for k, v in rig.DB16.items()}
FX_LAYERS = ("FX Back", "FX")


def luminance(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def level_matching(ramp, db_key):
    """The level on `ramp` whose shade is closest in brightness to a DB16 colour: keeps the approved values."""
    target = luminance(DB_RGB[db_key])
    best = min(range(SHADES), key=lambda i: abs(luminance(RGB[ramp][i]) - target))
    return best / (SHADES - 1) * TOP[ramp]


def part_ramp(ch, group, key):
    roles = ch["roles"]
    if group == "skin":
        return SKIN.get(roles["S"], "skin_mid")
    if group == "eyes":
        return "coal"
    if group == "buckle":
        return "gold"
    base = roles.get(BASE_ROLE[group], roles.get(key, "N"))
    return FAMILY[base]


# Heads whose eyes are a visor or slit, not eyes: they don't blink.
NO_BLINK = {"dive_helmet", "great_helm"}


def idle(ch, d):
    """Standing still: a breath (head, torso and arms rise a pixel, feet planted) and a blink. Each frame's
    duration is its hold; the engine varies the pace per person so nobody breathes in step."""
    frames = []
    for bob, blink, duration in ((0, False, 900), (-1, False, 700), (0, False, 800), (0, True, 130)):
        f = rig.Frame(ch, duration)
        if d == "right":
            rig.body(f, d, bob, sleeves=False)
            rig.side_legs(f, bob, "together")
            rig.arm(f, "Arm Back", "far", (21, 37 + bob), bob)
            rig.arm(f, "Arms", "near", (23, 38 + bob), bob)
        else:
            rig.body(f, d, bob, sleeves=True)
            rig.front_legs(f, bob)
            f.stamp("Arms", rig.ARM_L["neutral"], 17, 36 + bob)
            f.stamp("Arms", rig.ARM_R["neutral"], 29, 36 + bob)
        f.finish()
        f.blink = blink and ch["head"] not in NO_BLINK
        frames.append(f)
    return frames


ANIMATIONS = rig.ANIMATIONS + [("idle", idle)]


def resolve(ch, frame):
    """Top-most value per pixel for the body, plus the FX layers kept apart (they are never outlined)."""
    body = [[None] * SIZE for _ in range(SIZE)]
    blink = getattr(frame, "blink", False)
    closed = []
    fx = {n: [[None] * SIZE for _ in range(SIZE)] for n in FX_LAYERS}
    sep_shade = rig.DB16[ch["roles"]["r"]]
    for name in rig.LAYERS:
        grid = frame.layers[name]
        for y in range(SIZE):
            for x in range(SIZE):
                v = grid[y][x]
                if v is None:
                    continue
                if name in FX_LAYERS:
                    fx[name][y][x] = v
                elif name == "Outline":
                    if body[y][x] is None:
                        continue                          # silhouette edge: Canvas.outline redraws it
                    body[y][x] = ("sep", "coal" if v == rig.DB16["K"] else "shirt", name)
                    if v == sep_shade and v != rig.DB16["K"]:
                        body[y][x] = ("sep", "shirt", name)
                else:
                    if blink and v == ("role", "E"):
                        v = ("role", "s")                 # eyelids: the eye pixel takes the skin's shade
                        closed.append((x, y, name))
                    body[y][x] = (v[0], v[1], name)
    return body, fx, closed


def shade_body(ch, body, closed_eyes=()):
    info = [[None] * SIZE for _ in range(SIZE)]
    for y in range(SIZE):
        for x in range(SIZE):
            v = body[y][x]
            if v is None:
                continue
            kind, key, layer = v
            if kind == "sep":
                ramp = part_ramp(ch, "shirt", "r") if key == "shirt" else "coal"
                info[y][x] = ("sep", ramp, 0.9 if key == "shirt" else 0.2, layer, key)
            elif kind == "role":
                group = GROUP[key]
                ramp = part_ramp(ch, group, key)
                info[y][x] = (group, ramp, level_matching(ramp, ch["roles"][key]), layer, key)
            else:
                ramp = RAW_FAMILY[key]
                info[y][x] = ("tool", ramp, level_matching(ramp, key), layer, key)

    def same(x, y, group, layer):
        return 0 <= x < SIZE and 0 <= y < SIZE and info[y][x] is not None and info[y][x][0] == group \
            and info[y][x][3] == layer

    c = Canvas(SIZE, SIZE)
    for y in range(SIZE):
        for x in range(SIZE):
            p = info[y][x]
            if p is None:
                continue
            group, ramp, level, layer, key = p
            if group in FORM:
                x0 = x
                while same(x0 - 1, y, group, layer):
                    x0 -= 1
                x1 = x
                while same(x1 + 1, y, group, layer):
                    x1 += 1
                y0 = y
                while same(x, y0 - 1, group, layer):
                    y0 -= 1
                y1 = y
                while same(x, y1 + 1, group, layer):
                    y1 += 1
                t = (x - x0) / (x1 - x0) if x1 > x0 else 0.5
                u = (y - y0) / (y1 - y0) if y1 > y0 else 0.5
                wx, wy = FORM[group]
                level += (0.5 - t) * wx + (0.5 - u) * wy
                if group == "hair":
                    if key == "H" and (x + y // 2) % 3 == 0:
                        level -= 0.5                      # strands
                    if u < 0.34 and t < 0.55 and key == "H":
                        level += 0.6                      # sheen
                elif group == "hat":
                    if ramp == "straw":
                        level += 0.3 if (x + y) % 2 else -0.3   # weave
                    if y == y0 and key != "c":
                        level += 0.4
                elif group == "legs":
                    if (x - y) % 3 == 0:
                        level -= 0.35                     # twill
                    if x == x0 and key == "L":
                        level += 0.4
                elif group == "boots":
                    if x == x0 or y == y0:
                        level += 0.8                      # toe and top catch the light
                    if y == y1 and y1 > y0:
                        level -= 0.6
                elif group == "shirt":
                    if x == x1 and x1 > x0:
                        level -= 0.3
                elif group == "tool" and ramp == "stone" and x == x0 and y == y0:
                    level += 1.0                          # a glint on metal
            elif group == "buckle":
                level += 1.2 if not same(x - 1, y, group, layer) and not same(x, y - 1, group, layer) else 0
            c.put(x, y, ramp, level)
    eyes = sorted([(x, y) for y in range(SIZE) for x in range(SIZE)
                   if info[y][x] and info[y][x][0] == "eyes" and info[y][x][3] == "Head"]
                  + [(x, y) for x, y, layer in closed_eyes if layer == "Head"])
    if len(eyes) == 2 and eyes[0][1] == eyes[1][1]:            # facing us: a touch of colour in the cheeks
        blush = {"skin_light": 3.0, "skin_mid": 2.5, "skin_deep": 1.7}.get(part_ramp(ch, "skin", "S"), 2.5)
        for bx, by in ((eyes[0][0] - 1, eyes[0][1] + 1), (eyes[1][0] + 1, eyes[1][1] + 1)):
            p = info[by][bx] if 0 <= by < SIZE and 0 <= bx < SIZE else None
            if p and p[0] == "skin":
                c.put(bx, by, "pink", blush)
    filled = {(x, y) for y in range(SIZE) for x in range(SIZE) if c.px[y][x]}
    c.outline(rim_amount=0.45, lit_bonus=0.04)
    for y in range(SIZE):                                      # a pale part still gets a dark edge, so the shape reads
        for x in range(SIZE):
            p = c.px[y][x]
            if p and (x, y) not in filled and luminance(RGB[p[0]][0]) > 48:
                c.px[y][x] = ("coal", 0.6)
    return c.image()


FX_RAMP = {"W": ("white", 5.4), "C": ("water", 5.2), "o": ("orange", 4.6), "N": ("wood", 3.4), "T": ("tan", 5.0),
           "R": ("red", 3.8), "s": ("stone", 4.8), "g": ("stone", 3.0)}


def fx_image(ch, grid):
    img = Image.new("RGBA", (SIZE, SIZE))
    for y in range(SIZE):
        for x in range(SIZE):
            v = grid[y][x]
            if v is None:
                continue
            kind, key = v
            if kind == "role":
                ramp = part_ramp(ch, GROUP[key], key)
                level = level_matching(ramp, ch["roles"][key])
            else:
                ramp, level = FX_RAMP.get(key, (RAW_FAMILY.get(key, "stone"), 4.0))
            idx = round(max(0, min(1, level / TOP[ramp])) * (SHADES - 1))
            img.putpixel((x, y), RGB[ramp][idx] + (255,))
    return img


def render(ch, frame):
    body, fx, closed = resolve(ch, frame)
    img = fx_image(ch, fx["FX Back"])
    img.alpha_composite(shade_body(ch, body, closed))
    img.alpha_composite(fx_image(ch, fx["FX"]))
    return img


def build(name, ch):
    tags, frames, durations = [], [], []
    for anim, make in ANIMATIONS:
        rendered = {d: [(render(ch, f), f.duration) for f in make(ch, d)] for d in ("down", "up", "right")}
        rendered["left"] = [(img.transpose(Image.FLIP_LEFT_RIGHT), dur) for img, dur in rendered["right"]]
        for d in rig.DIRECTIONS:
            tags.append((f"{anim}_{d}", len(frames), len(frames) + len(rendered[d]) - 1))
            for img, dur in rendered[d]:
                frames.append(img)
                durations.append(dur)
    return tags, frames, durations


def extend_meta(meta, name, extra_tags, frames, durations):
    """Appends animations the rig doesn't have (idle) to its sheet JSON: one new row of 4 per tag, same format,
    so every existing frame keeps its index and position."""
    cols = 4
    rows = meta["meta"]["size"]["h"] // SIZE
    for r, (tag, first, last) in enumerate(extra_tags):
        for col, i in enumerate(range(first, last + 1)):
            meta["frames"].append({
                "filename": f"{name} #{tag} {col}.aseprite",
                "frame": {"x": col * SIZE, "y": (rows + r) * SIZE, "w": SIZE, "h": SIZE},
                "rotated": False, "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": SIZE, "h": SIZE},
                "sourceSize": {"w": SIZE, "h": SIZE},
                "duration": durations[i],
            })
        meta["meta"]["frameTags"].append({"name": tag, "from": first, "to": last, "direction": "forward",
                                          "color": "#000000ff"})
    meta["meta"]["size"] = {"w": cols * SIZE, "h": (rows + len(extra_tags)) * SIZE}


def main(names=None):
    os.makedirs(OUT, exist_ok=True)
    lineup_rows = []
    for name, ch in rig.CHARACTERS.items():
        if names and name not in names:
            continue
        tags, frames, durations = build(name, ch)
        with open(os.path.join(CHAR_ROOT, name, f"{name}-sheet.json")) as fh:
            meta = json.load(fh)
        rig_tags = meta["meta"]["frameTags"]
        assert [t["name"] for t in rig_tags] == [t[0] for t in tags[:len(rig_tags)]], name
        extend_meta(meta, name, tags[len(rig_tags):], frames, durations)
        assert len(meta["frames"]) == len(frames), name
        sheet = Image.new("RGBA", (meta["meta"]["size"]["w"], meta["meta"]["size"]["h"]))
        for img, fr in zip(frames, meta["frames"]):
            sheet.alpha_composite(img, (fr["frame"]["x"], fr["frame"]["y"]))
        sheet.save(os.path.join(OUT, f"{name}-sheet.png"))
        with open(os.path.join(OUT, f"{name}-sheet.json"), "w") as fh:
            json.dump(meta, fh)
        contact = Image.new("RGBA", (4 * SIZE * 3, len(tags) * SIZE * 3), (74, 147, 59, 255))
        for r, (_, a, b) in enumerate(tags):
            for col, i in enumerate(range(a, b + 1)):
                contact.alpha_composite(frames[i].resize((SIZE * 3, SIZE * 3), Image.NEAREST), (col * SIZE * 3, r * SIZE * 3))
        contact.save(os.path.join(OUT, f"{name}-contact.png"))
        index = {t[0]: t[1] for t in tags}
        lineup_rows.append([frames[index["walk_down"] + 1], frames[index["walk_right"] + 1], frames[index["walk_up"] + 1],
                            frames[index["water_down"] + 3], frames[index["chop_right"] + 3]])
        print(f"{name}: {len(frames)} frames")
    if lineup_rows:
        cell = SIZE * 3
        lineup = Image.new("RGBA", (len(lineup_rows) * cell, 5 * cell), (74, 147, 59, 255))
        for col, row in enumerate(lineup_rows):
            for r, img in enumerate(row):
                lineup.alpha_composite(img.resize((cell, cell), Image.NEAREST), (col * cell, r * cell))
        lineup.save(os.path.join(OUT, "lineup.png"))


if __name__ == "__main__":
    main(sys.argv[1:] or None)
