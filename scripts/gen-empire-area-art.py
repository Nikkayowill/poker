"""One-off generator for the empty StackAcres 'empire' district's ground art.

The v1 scaffold's map starts empty (no pre-placed buildings or terraces, per
docs/stackacres-second-map-direction.md section 6a), so there is nothing here
for PixelLab/Aseprite to paint yet -- a flat grass field with a little tonal
noise is the honest picture of "nothing built here." Re-run this if the
field's tile dimensions ever change; it is not part of the build.
"""

from PIL import Image
import random
import json
import os

random.seed(20260924)

TILE = 16
W, H = 40, 30  # tiles
IMG_W, IMG_H = W * TILE, H * TILE
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "stackacres-td", "areas", "empire")

base = (43, 97, 40)
im = Image.new("RGBA", (IMG_W, IMG_H), base + (255,))
px = im.load()
for y in range(IMG_H):
    for x in range(IMG_W):
        jitter = random.randint(-4, 4)
        r, g, b = base
        px[x, y] = (
            max(0, min(255, r + jitter)),
            max(0, min(255, g + jitter)),
            max(0, min(255, b + jitter)),
            255,
        )
im.save(os.path.join(OUT, "ground-0.png"))

# Empty props atlas: no props placed yet. Still a valid TexturePacker pair
# since the scene loads one for every area unconditionally.
props_img = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
props_img.save(os.path.join(OUT, "props.png"))
props_json = {"frames": {}, "meta": {"image": "props.png", "size": {"w": 1, "h": 1}}}
with open(os.path.join(OUT, "props.json"), "w") as f:
    json.dump(props_json, f)

print("wrote", im.size, "to", OUT)
