"""Lays every generated plant out at TRUE relative world scale, next to Ray,
a cow and the barn, on the real grass tile. Review image only -- the boxes are
read straight out of prepare-stackacres-plants.py so this cannot drift."""

import importlib.util
import os
from pathlib import Path

from PIL import Image, ImageDraw

OUT = os.environ.get("OUT", "/tmp/flora-scale.png")
SPR = Path("public/stackacres/sprites")

spec = importlib.util.spec_from_file_location("prep", "scripts/prepare-stackacres-plants.py")
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)
FRAMES = prep.FRAMES

REF = [("Ray", "grandfather-ray.png", 25.125, 40), ("cow", "cow.png", 24, 18), ("barn", "barn.png", 74, 62)]

ROWS = [
    ("SCALE REFERENCE (unchanged art)", [(n, f, w, h) for n, f, w, h in REF]),
    ("CANOPY", ["tree1", "tree2", "tree3"]),
    ("CONIFERS", ["pine", "pine2", "pine3", "pine4", "pine5", "pine6", "pine7", "pine8"]),
    ("BUSH", ["bush", "bush2", "bush3"]),
    ("SCRUB", ["scrub-fan", "scrub-plume", "scrub-thicket", "scrub-bristle", "scrub-mound",
               "scrub-rosette", "scrub-broad", "scrub-leafy", "scrub-low", "scrub-round",
               "scrub-patch", "scrub-sprig"]),
    ("GROUND COVER", ["frond1", "frond2", "frond3", "frond4", "frond5",
                      "weed-tall", "weed3", "weed4", "weed5", "weed6", "weed-short"]),
    ("GRASS", ["grass-tall", "grass-mid", "grass-stubble", "tuft", "tuft2", "swirl1", "swirl2"]),
]

PX = 4.4
GAP = 12
MARGIN = 26


def entries(items):
    out = []
    for it in items:
        if isinstance(it, tuple):
            out.append(it)
        else:
            _, w, h, _, _ = FRAMES[it]
            out.append((it, it + ".png", w, h))
    return out


rows = [(label, entries(items)) for label, items in ROWS]
row_h = [max(h for _, _, _, h in items) * PX + 42 for _, items in rows]
width = int(max(sum(w * PX + GAP for _, _, w, _ in items) for _, items in rows) + MARGIN * 2)
height = int(sum(row_h) + MARGIN * 2)

grass = Image.open(SPR / "grass-tile.png").convert("RGBA")
canvas = Image.new("RGBA", (width, height))
for y in range(0, height, grass.height):
    for x in range(0, width, grass.width):
        canvas.alpha_composite(grass, (x, y))
d = ImageDraw.Draw(canvas)

y = MARGIN
for (label, items), rh in zip(rows, row_h):
    base = y + rh - 24
    d.rectangle([0, y - 6, width, y + 12], fill=(22, 26, 18, 215))
    d.text((MARGIN, y - 3), label, fill=(255, 232, 160, 255))
    x = MARGIN
    for name, fname, uw, uh in items:
        im = Image.open(SPR / fname).convert("RGBA")
        tw, th = max(1, round(uw * PX)), max(1, round(uh * PX))
        im = im.resize((tw, th), Image.LANCZOS)
        canvas.alpha_composite(im, (int(x), int(base - th)))
        d.text((int(x), int(base + 3)), name, fill=(18, 28, 8, 255))
        x += tw + GAP
    y += rh

canvas.convert("RGB").save(OUT)
print("ok", canvas.size, "|", sum(len(i) for _, i in rows) - 3, "plants")
