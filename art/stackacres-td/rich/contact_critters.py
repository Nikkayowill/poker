"""Writes out/sheet-critters.png: every ambient-life frame at 6x, on grass, fish on water, fireflies at night."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import critters as C  # noqa: E402

Z, PAD = 6, 8
GRASS, WATER, NIGHT = (74, 147, 59, 255), (58, 132, 205, 255), (18, 20, 44, 255)


def strip(images, bg, additive=False):
    w = sum(i.width * Z + PAD for i in images) + PAD
    h = max(i.height * Z for i in images) + PAD * 2
    sheet = Image.new("RGBA", (w, h), bg)
    x = PAD
    for img in images:
        big = img.resize((img.width * Z, img.height * Z), Image.NEAREST)
        if additive:
            base = np.array(sheet).astype(int)
            a = np.array(big).astype(int)
            region = base[PAD:PAD + big.height, x:x + big.width, :3]
            region += (a[..., :3] * a[..., 3:4] // 255)
            base[PAD:PAD + big.height, x:x + big.width, :3] = np.clip(region, 0, 255)
            sheet = Image.fromarray(base.astype(np.uint8), "RGBA")
        else:
            sheet.alpha_composite(big, (x, PAD))
        x += big.width + PAD
    return sheet


rows = [
    strip(C.butterfly_frames("white") + C.butterfly_frames("yellow") + C.butterfly_frames("blue")
          + C.dragonfly_frames() + C.bird_frames() + [C.bird_shadow()], GRASS),
    strip(C.leaf_frames() + [C.firefly_glow()], GRASS),
    strip(C.fish_jump_frames(), WATER),
    strip([C.firefly_glow(), C.firefly_glow()], NIGHT, additive=True),
    strip([C.cloud_shadow(0), C.cloud_shadow(1)], GRASS),
]
sheet = Image.new("RGBA", (max(r.width for r in rows), sum(r.height for r in rows)), (30, 30, 30, 255))
y = 0
for r in rows:
    sheet.alpha_composite(r, (0, y))
    y += r.height
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
sheet.save(os.path.join(HERE, "out", "sheet-critters.png"))
print(sheet.size)
