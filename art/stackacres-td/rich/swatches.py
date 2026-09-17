"""Writes out/swatches.png: every ramp as a row of shades, for checking hue drift by eye."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from PIL import Image, ImageDraw  # noqa: E402

from pal import NAMES, RGB, SHADES  # noqa: E402

S = 28
img = Image.new("RGB", (110 + SHADES * S, len(NAMES) * S), (21, 18, 14))
d = ImageDraw.Draw(img)
for row, name in enumerate(NAMES):
    d.text((6, row * S + 8), name, fill=(220, 210, 190))
    for i, c in enumerate(RGB[name]):
        d.rectangle((110 + i * S, row * S, 110 + (i + 1) * S - 2, (row + 1) * S - 2), fill=c)
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
img.save(os.path.join(HERE, "out", "swatches.png"))
