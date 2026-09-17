"""Writes out/sheet-town.png: every Town Square sprite at 4x on a cobble-grey ground."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from PIL import Image  # noqa: E402

import area_town as A  # noqa: E402

rows = [
    [A.townhouse(k) for k in ("store", "inn", "bakery", "hall")],
    [A.fountain(), A.notice_board(), A.bench(), A.planter("R"), A.planter("Y"), A.lamppost(), A.lamppost(False),
     A.market_cart(), A.beacon()],
]
pad, Z = 6, 4
sheets = []
for items in rows:
    w = sum(img.width for img, _ in items) + pad * (len(items) + 1)
    h = max(img.height for img, _ in items) + pad * 2
    sheet = Image.new("RGBA", (w, h), (122, 116, 110, 255))
    x = pad
    for img, _ in items:
        sheet.alpha_composite(img, (x, h - pad - img.height))
        x += img.width + pad
    sheets.append(sheet)
W = max(s.width for s in sheets)
out = Image.new("RGBA", (W, sum(s.height for s in sheets)), (122, 116, 110, 255))
y = 0
for s in sheets:
    out.alpha_composite(s, (0, y))
    y += s.height
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
out.resize((out.width * Z, out.height * Z), Image.NEAREST).save(os.path.join(HERE, "out", "sheet-town.png"))
print(out.size)
