"""Writes out/characters/compare.png: for each named character, DB16 frames above rich frames, at 8x."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TD = os.path.dirname(HERE)
OUT = os.path.join(HERE, "out", "characters")

from PIL import Image  # noqa: E402

SIZE, Z = 48, 8
TAGS = [("walk_down", 1), ("walk_right", 1), ("walk_up", 1), ("water_right", 3)]
names = sys.argv[1:] or ["ray", "farmer"]


def frames(sheet_png, sheet_json):
    sheet = Image.open(sheet_png).convert("RGBA")
    meta = json.load(open(sheet_json))
    start = {t["name"]: t["from"] for t in meta["meta"]["frameTags"]}
    out = []
    for tag, k in TAGS:
        fr = meta["frames"][start[tag] + k]["frame"]
        out.append(sheet.crop((fr["x"] + 8, fr["y"] + 10, fr["x"] + 40, fr["y"] + 46)))
    return out


cw, chh = 32 * Z, 36 * Z
img = Image.new("RGBA", (len(TAGS) * len(names) * cw, 2 * chh), (74, 147, 59, 255))
for n, name in enumerate(names):
    old = frames(os.path.join(TD, "characters", name, f"{name}-sheet.png"), os.path.join(TD, "characters", name, f"{name}-sheet.json"))
    new = frames(os.path.join(OUT, f"{name}-sheet.png"), os.path.join(OUT, f"{name}-sheet.json"))
    for i, (a, b) in enumerate(zip(old, new)):
        x = (n * len(TAGS) + i) * cw
        img.alpha_composite(a.resize((cw, chh), Image.NEAREST), (x, 0))
        img.alpha_composite(b.resize((cw, chh), Image.NEAREST), (x, chh))
img.save(os.path.join(OUT, "compare.png"))
print(img.size)
