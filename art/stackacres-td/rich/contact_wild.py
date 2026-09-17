"""Writes out/sheet-wild.png: every Oak and Mine sprite at 4x on grass, animation frames side by side."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = os.path.join(os.path.dirname(HERE), "areas", "rig")
sys.path[:0] = [HERE, RIG]

from PIL import Image  # noqa: E402

import area_wild as W  # noqa: E402

rows = [
    [W.oak_tree(), W.mural(), W.beehive(), W.mushrooms(0), W.mushrooms(1), W.mushrooms(2), W.log_bench(),
     W.standing_stone()],
    [W.cave_mouth(), W.cliff(120, 64), W.rails(64), W.mine_cart(), W.mine_cart(False), W.lantern_post(), W.tent(),
     W.ore_rock("Y"), W.ore_rock("C"), W.warning_sign()],
    W.campfire_lit() + W.waterfall(60),
]
BG, pad, Z = (74, 147, 59, 255), 6, 4
sheets = []
for row in rows:
    w = sum(img.width for img, _ in row) + pad * (len(row) + 1)
    h = max(img.height for img, _ in row) + pad * 2
    sheet = Image.new("RGBA", (w, h), BG)
    x = pad
    for img, _ in row:
        sheet.alpha_composite(img, (x, h - pad - img.height))
        x += img.width + pad
    sheets.append(sheet)
W_ = max(s.width for s in sheets)
out = Image.new("RGBA", (W_, sum(s.height for s in sheets)), BG)
y = 0
for s in sheets:
    out.alpha_composite(s, (0, y))
    y += s.height
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
out.resize((out.width * Z, out.height * Z), Image.NEAREST).save(os.path.join(HERE, "out", "sheet-wild.png"))
print(out.size)
