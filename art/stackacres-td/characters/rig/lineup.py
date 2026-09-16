#!/usr/bin/env python3
"""Everyone side by side at 4x, facing down, right and up, from build/<name>-expected.png.
Writes build/lineup.png. Look at it after every rig change."""
import os

from PIL import Image

import rig

RIG = os.path.dirname(os.path.abspath(__file__))
SIZE, SCALE, GAP = rig.SIZE, 4, 4
ROWS = [("walk_down", 1), ("walk_right", 1), ("walk_up", 1), ("harvest_down", 3), ("fish_right", 3)]


def main():
    names = list(rig.CHARACTERS)
    sheets = {n: Image.open(os.path.join(RIG, "build", f"{n}-expected.png")).convert("RGBA") for n in names}
    tags, _ = rig.build(rig.CHARACTERS[names[0]])
    row_of = {t["name"]: i for i, t in enumerate(tags)}
    W, H = len(names) * (SIZE + GAP), len(ROWS) * (SIZE + GAP)
    out = Image.new("RGBA", (W, H), (110, 170, 110, 255))
    for r, (tag, frame) in enumerate(ROWS):
        for c, n in enumerate(names):
            src = sheets[n].crop((frame * SIZE, row_of[tag] * SIZE, (frame + 1) * SIZE, (row_of[tag] + 1) * SIZE))
            out.alpha_composite(src, (c * (SIZE + GAP), r * (SIZE + GAP)))
    out = out.resize((W * SCALE, H * SCALE), Image.NEAREST)
    out.save(os.path.join(RIG, "build", "lineup.png"))
    print("lineup.png", out.size, "|", " ".join(names))


if __name__ == "__main__":
    main()
