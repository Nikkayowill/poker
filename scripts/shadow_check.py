"""Renders candidate plates on a light ground so a baked shadow is visible.

This is the ONLY reliable test for whether a new plate needs adding to the
shadow strip: the pack previews itself on a dark background, where the wash is
invisible. Prints the stripped aspect alongside, which is what a box in
prepare-stackacres-plants.py's FRAMES has to be built from.
"""

from PIL import Image, ImageDraw
import math
import os
import sys

import numpy as np

OUT = os.environ.get("OUT", "/tmp/shadow-check.png")
SRC = "scripts/iso/isometric tiles/%s.png"
SHADOW_ALPHA = 190
SHADOW_VALUE = 10

DEFAULT = [
    "bigtree01", "bigtree02", "bigtree03",
    "pine-none04", "pine-none06", "pine-none08",
    "bush01", "bush02", "bush03", "bush04", "bush05",
    "shrub1-01", "shrub1-03", "shrub2-01", "shrub2-04",
    "tropical01", "tropical03", "tropical05",
    "weed01", "weed02", "weed03", "weed05", "weed06",
    "grasses01", "grasses02", "grasses03", "grasses04", "grasses05",
    "swirl01", "swirl02",
]

PLATES = sys.argv[1:] or DEFAULT


def strip(im):
    a = np.array(im).astype(np.int16)
    al = a[..., 3]
    mx = a[..., :3].max(axis=2)
    a[..., 3] = np.where((al > 0) & (al < SHADOW_ALPHA) & (mx <= SHADOW_VALUE), 0, al)
    out = Image.fromarray(a.astype(np.uint8), "RGBA")
    bb = out.getbbox()
    return out.crop(bb) if bb else out


cell = 190
cols = min(6, len(PLATES))
rows = math.ceil(len(PLATES) / cols)
sheet = Image.new("RGBA", (cols * cell, rows * (cell + 18)), (242, 240, 230, 255))
d = ImageDraw.Draw(sheet)
for i, n in enumerate(PLATES):
    im = Image.open(SRC % n).convert("RGBA")
    s = strip(im)
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    print("%-14s stripped %3dx%-3d aspect %.2f" % (n, s.width, s.height, s.width / max(s.height, 1)))
    im.thumbnail((cell - 12, cell - 12))
    x = (i % cols) * cell + (cell - im.width) // 2
    y = (i // cols) * (cell + 18) + (cell - im.height) // 2
    sheet.alpha_composite(im, (x, y))
    d.text(((i % cols) * cell + 4, (i // cols) * (cell + 18) + cell + 2), n, fill=(30, 30, 30, 255))
sheet.convert("RGB").save(OUT)
print("wrote", OUT, sheet.size)
