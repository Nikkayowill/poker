"""Writes out/sheet-coast.png: every Coastal Market sprite at 4x, land things on sand, water things on the sea."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from PIL import Image  # noqa: E402

import area_coast as A  # noqa: E402

Z, PAD = 4, 6
land = [A.stall("R", "fish"), A.stall("L", "fruit"), A.stall("v", "bread"), A.stall("o", "cloth"), A.boat(),
        A.lobster_trap(), A.driftwood(), A.fish_rack(), A.seagull(), A.seagull(True), A.fish(), A.fish("o")]
sea = [A.pier(60), A.buoy(), A.buoy()]


def row(items, bg):
    w = sum(img.width for img, _ in items) + PAD * (len(items) + 1)
    h = max(img.height for img, _ in items) + PAD * 2
    strip = Image.new("RGBA", (w, h), bg)
    x = PAD
    for img, _ in items:
        strip.alpha_composite(img, (x, h - PAD - img.height))
        x += img.width + PAD
    return strip


top, bottom = row(land, (214, 190, 132, 255)), row(sea, (46, 112, 190, 255))
sheet = Image.new("RGBA", (max(top.width, bottom.width), top.height + bottom.height), (30, 26, 22, 255))
sheet.alpha_composite(top, (0, 0))
sheet.alpha_composite(bottom, (0, top.height))
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
sheet.resize((sheet.width * Z, sheet.height * Z), Image.NEAREST).save(os.path.join(HERE, "out", "sheet-coast.png"))
print(sheet.width * Z, sheet.height * Z)
