"""Writes out/sheet-extras.png: every sprite in extras.py at 4x, crops in all three stages."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = os.path.join(os.path.dirname(HERE), "areas", "rig")
sys.path[:0] = [HERE, RIG]

from PIL import Image  # noqa: E402

import extras as X  # noqa: E402

rows = [
    [X.brambles(), X.rockfall(), X.hedge_overgrown(), X.boardwalk_washed(), X.bridge(32), X.broken_cart(),
     X.loose_board()] + X.smoke(),
    [X.greenhouse_ruin()] + [X.crop(n, s) for n in ("carrot", "potato", "radish", "wheat") for s in (0, 1, 2)],
]
BG = (74, 147, 59, 255)
SOIL = (74, 45, 32, 255)
pad = 6
sheets = []
for r, items in enumerate(rows):
    w = sum(img.width for img, _ in items) + pad * (len(items) + 1)
    h = max(img.height for img, _ in items) + pad * 2
    sheet = Image.new("RGBA", (w, h), BG)
    x = pad
    for i, (img, _) in enumerate(items):
        if r == 1 and i > 0:
            sheet.paste(SOIL, (x - 2, h - pad - img.height - 2, x + img.width + 2, h - pad + 2))
        sheet.alpha_composite(img, (x, h - pad - img.height))
        x += img.width + pad
    sheets.append(sheet)
W = max(s.width for s in sheets)
out = Image.new("RGBA", (W, sum(s.height for s in sheets)), BG)
y = 0
for s in sheets:
    out.alpha_composite(s, (0, y))
    y += s.height
out = out.resize((out.width * 4, out.height * 4), Image.NEAREST)
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
out.save(os.path.join(HERE, "out", "sheet-extras.png"))
print(out.size)
