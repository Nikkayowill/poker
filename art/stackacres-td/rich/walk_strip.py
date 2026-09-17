"""Writes out/characters/walk-<dir>-<rich|db16>.gif: every character walking in a row at 4x, for review."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TD = os.path.dirname(HERE)
OUT = os.path.join(HERE, "out", "characters")
sys.path[:0] = [os.path.join(TD, "characters", "rig")]

from PIL import Image  # noqa: E402

import rig  # noqa: E402

Z, CROP = 4, (6, 8, 42, 47)
BG = (74, 147, 59, 255)


def strip(direction, kind):
    names = list(rig.CHARACTERS)
    cw, ch = (CROP[2] - CROP[0]) * Z, (CROP[3] - CROP[1]) * Z
    frames = [Image.new("RGBA", (len(names) * cw, ch), BG) for _ in range(4)]
    for n, name in enumerate(names):
        base = os.path.join(OUT, name) if kind == "rich" else os.path.join(TD, "characters", name, name)
        sheet = Image.open(f"{base}-sheet.png").convert("RGBA")
        meta = json.load(open(f"{base}-sheet.json"))
        start = next(t["from"] for t in meta["meta"]["frameTags"] if t["name"] == f"walk_{direction}")
        for k in range(4):
            fr = meta["frames"][start + k]["frame"]
            cell = sheet.crop((fr["x"] + CROP[0], fr["y"] + CROP[1], fr["x"] + CROP[2], fr["y"] + CROP[3]))
            frames[k].alpha_composite(cell.resize((cw, ch), Image.NEAREST), (n * cw, 0))
    seq = [f.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=255) for f in frames]
    seq[0].save(os.path.join(OUT, f"walk-{direction}-{kind}.gif"), save_all=True, append_images=seq[1:],
                duration=150, loop=0)


for d in ("down", "right"):
    for kind in ("rich", "db16"):
        strip(d, kind)
print("strips written")
