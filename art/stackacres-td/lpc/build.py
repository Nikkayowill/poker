#!/usr/bin/env python3
"""Write the game's character sheets from LPC art.

The layout is not ours to choose: `components/arcade/stackacres-td/scene.ts` names standing frames
by index ("1", "5", "9", "13") and `lib/stackacres-td/fishing-cast.ts` names the fish and harvest
tags by index, so a sheet has to come out frame for frame like the one it replaces. 48x48 frames,
four to a row, feet on row 44, tags walk/harvest/water/chop/fish/shoot then idle, four frames each,
per direction. A character with an eight frame walk appends it and points the walk tags at it, which
is how the player gets a real stride while frame 1 of walk stays the standing pose.

    python3 build.py            # every character in cast.py
    python3 build.py farmer ray # just these
"""
import json
import os
import sys

from PIL import Image, ImageChops

import cast
import lpc

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
OUT = os.path.join(REPO, "public", "stackacres-td", "characters")

SIZE, COLS, FEET_X, FEET_Y = 48, 4, 24, 44
DIRS = ["down", "up", "left", "right"]
# Where a character stands in an LPC frame: centred, feet on the row below the last one drawn.
GROUND = (32, 62)
# LPC draws people this tall from hat to boot, which is what cast.TARGET_HEIGHT scales down from.
LPC_HEIGHT = 50

# Shrinking 50px art to 31 blends thousands of tones out of LPC's forty, which triples the PNG and
# softens the pixels. Cutting back to a palette undoes both. Transparent pixels are keyed to a
# colour no sprite uses so the palette can carry one transparent index.
COLOURS, KEY = 48, (255, 0, 255)

# Frame holds, kept from the rig so actions keep the timing the game was tuned against.
DURATIONS = {"harvest": [110, 170, 170, 350], "water": [160, 160, 160, 160],
             "chop": [180, 120, 60, 260], "fish": [220, 90, 150, 500],
             "shoot": [150, 250, 200, 250]}
IDLE_MS = [700, 500, 700, 500]
WALK_MS, STRIDE_MS = 150, 100

# Which LPC animation and which of its frames each of the game's actions is cut from. `tools` are
# added to the character for that action alone, so the hoe only exists while he is hoeing.
ACTIONS = {
    "harvest": dict(poses="pick", tools=[]),
    "water": dict(anim="watering", cols=[0, 1, 4, 5], tools=[("tool_watering_can", None)]),
    "chop": dict(anim="thrust", cols=[1, 3, 5, 5], tools=[("tool_hoe", None)]),
    "fish": dict(custom="tool_rod", cols=[0, 2, 5, 8], tools=[("tool_rod", None)]),
    "shoot": dict(anim="shoot", cols=[1, 3, 6, 7], tools=[("weapon_ranged_bow_normal", None)]),
}
# Picking a crop has no LPC animation, so it is put together from poses LPC does draw: he bends down
# to the plant, grips it, rises with his hands still low as it comes up, and holds it at his chest (lib/stackacres-td/pull.ts
# times the crop to these frames). Facing us, LPC's hurt stumble is a real bend with the hands at the
# ground. Every other way, it is the thrust pose with the body dropped at the hips (`bent`) so the
# reaching hand goes down to the plant. Each entry is (animation, column, drop, lean) in LPC pixels;
# lean is toward the way he faces.
PICK = {
    "down": [("hurt", 1, 0, 0), ("hurt", 2, 0, 0), ("hurt", 1, 0, 0), ("thrust", 3, 0, 0)],
    "up": [("thrust", 4, 2, 0), ("thrust", 4, 5, 0), ("thrust", 4, 2, 0), ("thrust", 3, 0, 0)],
    "left": [("thrust", 4, 2, 1), ("thrust", 4, 5, 2), ("thrust", 4, 2, 1), ("thrust", 3, 0, 0)],
    "right": [("thrust", 4, 2, 1), ("thrust", 4, 5, 2), ("thrust", 4, 2, 1), ("thrust", 3, 0, 0)],
}
# Where LPC's legs start: everything above this row is the body that bends over them.
WAIST = 46


def bent(frame, drop, lean, facing):
    """The body above the hips lowered by `drop` and pushed `lean` toward where he faces."""
    if drop == 0 and lean == 0:
        return frame
    dx = -lean if facing == "left" else lean
    out = Image.new("RGBA", frame.size)
    out.alpha_composite(frame.crop((0, WAIST, frame.width, frame.height)), (0, WAIST))
    out.alpha_composite(frame.crop((0, 0, frame.width, WAIST)), (dx, drop))
    return out


# The axe swing LPC draws on its oversize sheet. Nothing calls a chopping tag yet (the game's chop
# is the hoe going into the ground), so it is here for the wood chopping that is being built.
AXE = dict(custom="tool_axe", cols=[0, 3, 5, 8], tools=[("tool_axe", None)])


def place(frame, height, ground=GROUND):
    """One LPC frame in the game's 48x48 box, shrunk to `height` and stood on row 44."""
    k = height / LPC_HEIGHT
    small = lpc.shrink(frame, max(1, round(frame.height * k)))
    x = FEET_X - round(ground[0] * k)
    y = FEET_Y + 1 - round(ground[1] * k)
    pad = Image.new("RGBA", (SIZE * 3, SIZE * 3))
    pad.alpha_composite(small, (SIZE + x, SIZE + y))
    return pad.crop((SIZE, SIZE, SIZE * 2, SIZE * 2))


# Only the player walks the map, and a sheet costs texture memory on a phone, so the eight frame
# stride is his. Everyone else keeps the 112 frame sheet the game already loads.
STRIDES = {"farmer"}


def frames_for(name, height):
    """(tag, direction, frames, durations) for every tag the sheet carries, in sheet order."""
    spec = cast.CAST[name]
    base = cast.build(name)
    out = []

    def dressed(tools):
        if not tools:
            return base
        return lpc.Character(spec["items"] + list(tools), body=spec.get("body", "male"),
                             palette=spec.get("palette"))

    for d in DIRS:
        walk = dressed([]).frames("walk", d)          # LPC walk cycle, eight frames
        stand = dressed([]).frames("idle", d)[0]      # the pose he holds between steps
        pick = [walk[0], stand, walk[4], stand]
        out.append(("walk", d, [place(f, height) for f in pick], [WALK_MS] * 4))
    for action, how in ACTIONS.items():
        for d in DIRS:
            who = dressed(how["tools"])
            if how.get("poses") == "pick":
                got = [place(bent(who.frames(anim, d)[col].convert("RGBA"), drop, lean, d), height)
                       for anim, col, drop, lean in PICK[d]]
                out.append((action, d, got, DURATIONS[action]))
                continue
            src = (who.custom_frames(how["custom"], d) if "custom" in how
                   else who.frames(how["anim"], d))
            ground = (GROUND[0] + 32, GROUND[1] + 32) if "custom" in how else GROUND
            got = [place(src[min(c, len(src) - 1)], height, ground) for c in how["cols"]]
            out.append((action, d, got, DURATIONS[action]))
    for d in DIRS:
        idle = dressed([]).frames("idle", d)
        out.append(("idle", d, [place(idle[i % len(idle)], height) for i in (0, 1, 0, 1)], IDLE_MS))
    if name in STRIDES:
        for d in DIRS:
            stride = dressed([]).frames("walk", d)
            out.append(("stride", d, [place(f, height) for f in stride], [STRIDE_MS] * len(stride)))
    return out


def write(name, blocks):
    """The sheet and its Aseprite-shaped JSON, in the layout Phaser's createFromAseprite reads."""
    frames, sheet_frames, tags, rows, row = [], {}, [], [], 0
    for action, d, imgs, holds in blocks:
        first = len(frames)
        for col, (img, ms) in enumerate(zip(imgs, holds)):
            i = len(frames)
            frames.append(img)
            sheet_frames[str(i)] = {
                "frame": {"x": col % COLS * SIZE, "y": (row + col // COLS) * SIZE, "w": SIZE, "h": SIZE},
                "rotated": False, "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": SIZE, "h": SIZE},
                "sourceSize": {"w": SIZE, "h": SIZE}, "duration": ms}
            rows.append((i, col % COLS, row + col // COLS))
        row += -(-len(imgs) // COLS)
        tag = f"{'walk' if action == 'stride' else action}_{d}"
        existing = next((t for t in tags if t["name"] == tag), None)
        if existing:
            existing.update({"from": first, "to": len(frames) - 1})
        else:
            tags.append({"name": tag, "from": first, "to": len(frames) - 1,
                         "direction": "forward", "color": "#000000ff"})
    sheet = Image.new("RGBA", (COLS * SIZE, row * SIZE))
    for i, c, r in rows:
        sheet.alpha_composite(frames[i], (c * SIZE, r * SIZE))
    os.makedirs(OUT, exist_ok=True)
    small, clear = paletted(sheet)
    small.save(os.path.join(OUT, f"{name}.png"), transparency=clear, optimize=True)
    with open(os.path.join(OUT, f"{name}.json"), "w") as fh:
        json.dump({"frames": sheet_frames,
                   "meta": {"image": f"{name}.png", "format": "RGBA8888",
                            "size": {"w": sheet.width, "h": sheet.height}, "scale": "1",
                            "frameTags": tags}}, fh, separators=(",", ":"))
    return len(frames), sheet.size


def credits(names):
    """Attribution for every piece of LPC art the built sheets use.

    Required: the art is CC0, OGA-BY and CC-BY, and all but CC0 want the authors named somewhere a
    player can find. `components/info/credits-page.tsx` is where that happens; this is the long list
    it points at. Written next to the sheets so it ships."""
    rows, licences = {}, set()
    for name in names:
        spec = cast.CAST[name]
        tools = [t for how in list(ACTIONS.values()) + [AXE] for t in how["tools"]]
        who = lpc.Character(spec["items"] + tools, body=spec.get("body", "male"),
                            palette=spec.get("palette"))
        for row in who.credits():
            rows[row.get("file")] = row
            licences.update(row.get("licenses", []))
    authors = sorted({a for row in rows.values() for a in row.get("authors", [])})
    out = ["# Character art credits", "",
           "The StackAcres people are built from the Universal LPC Spritesheet Character Generator",
           "(https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator).",
           "Every layer used is listed below with its authors and licence.", "",
           "## Everyone who drew a piece of it", "", ", ".join(authors), "",
           "## Licences in use", "", ", ".join(sorted(licences)), "", "## Layer by layer", ""]
    for f, row in sorted(rows.items()):
        out.append(f"- **{f}** - {', '.join(row.get('authors', []))} - "
                   f"{', '.join(row.get('licenses', []))}")
        for url in row.get("urls", []):
            out.append(f"  - {url}")
    text = "\n".join(out) + "\n"
    for path in (os.path.join(os.path.dirname(os.path.abspath(__file__)), "CREDITS.md"),
                 os.path.join(OUT, "CREDITS.md")):
        with open(path, "w") as fh:
            fh.write(text)
    return authors, licences


def paletted(img):
    """An RGBA sheet as a palette PNG with one transparent index."""
    alpha = img.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    rgb = img.convert("RGB")
    rgb.paste(KEY, mask=ImageChops.invert(alpha))
    out = rgb.quantize(colors=COLOURS, method=Image.MEDIANCUT, dither=Image.NONE)
    palette = out.getpalette()
    clear = min(range(COLOURS),
                key=lambda i: sum((palette[i * 3 + c] - KEY[c]) ** 2 for c in range(3)))
    return out, clear


def main(names):
    """Everyone in the cast, except the two LPC cannot dress unless they are asked for by name."""
    names = names or [n for n in cast.CAST if n not in cast.ODD_ONES]
    for name in names:
        count, size = write(name, frames_for(name, cast.TARGET_HEIGHT))
        print(f"{name:9s} {count:3d} frames  {size[0]}x{size[1]}")
    authors, licences = credits(names)
    print(f"\ncredits: {len(authors)} artists, licences {sorted(licences)}")
    strict = [n for n in names for p in [cast.build(n).license_problems()] if p]
    tools = lpc.Character([t for how in list(ACTIONS.values()) + [AXE] for t in how["tools"]])
    share_alike = tools.license_problems()
    if strict:
        print("share-alike only, in a wardrobe:", strict)
    if share_alike:
        print("share-alike only, in a tool:", share_alike)


if __name__ == "__main__":
    main(sys.argv[1:])
