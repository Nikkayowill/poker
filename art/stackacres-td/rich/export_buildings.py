"""The buildings a player places on the Far Field, as one atlas the scene loads.

Each building is its gable_buildings.py drawing at full size (the scene shows it at half, like the
Homestead's), plus a soft shadow along its base drawn on the ground under it. The Homestead bakes the
same kind of shadow into its ground; a placed building can go anywhere, so its shadow travels with it.

    python3 art/stackacres-td/rich/export_buildings.py

writes public/stackacres-td/common/buildings.png and buildings.json (a Phaser hash atlas) and a small
picture of each for the build tray. Footprints in tiles live in lib/stackacres/empire-buildings.ts.
"""
import json
import os

import numpy as np
from PIL import Image

import gable_buildings as G

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "public", "stackacres-td", "common")
# The grocery (G.grocery) belongs to the city, which draws it there, not to the Far Field.
BUILDINGS = {"barn": G.barn}
PAD = 2


def crop(img):
    """Trimmed to the drawing, on even pixels so half size lands on whole map pixels."""
    l, t, r, b = img.getbbox()
    l, t, r, b = l - l % 2, t - t % 2, r + r % 2, b + b % 2
    return img.crop((l, t, r, b))


def shadow(width):
    """A soft band of shade along the base: wider than the building to the right, where the sun
    (top left) throws it, feathered at the ends and dithered at its edge like the Homestead's."""
    w, h = width + 40, 28
    a = np.zeros((h, w, 4), np.uint8)
    cx, cy = w / 2 + 10, h / 2
    for y in range(h):
        for x in range(w):
            d = ((x - cx) / (w / 2)) ** 2 + ((y - cy) / (h / 2)) ** 2
            if d > 1:
                continue
            alpha = 0.34 if d < 0.55 else 0.22
            if 0.55 <= d < 0.8 and (x + y) % 2:
                alpha = 0.34
            if d >= 0.8 and (x + y) % 2:
                continue
            a[y, x] = (20, 12, 28, int(alpha * 255))
    return Image.fromarray(a, "RGBA")


def main():
    frames = {}
    for name, draw in BUILDINGS.items():
        art = crop(draw())
        frames[name] = art
        frames[f"{name}-shadow"] = shadow(art.width)
    # One row, padded apart so filtering never bleeds a neighbour in.
    width = sum(img.width + PAD for img in frames.values()) + PAD
    height = max(img.height for img in frames.values()) + PAD * 2
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    atlas = {"frames": {}, "meta": {"image": "buildings.png", "size": {"w": width, "h": height}, "scale": "1"}}
    x = PAD
    for name, img in frames.items():
        sheet.alpha_composite(img, (x, PAD))
        atlas["frames"][name] = {
            "frame": {"x": x, "y": PAD, "w": img.width, "h": img.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": img.width, "h": img.height},
            "sourceSize": {"w": img.width, "h": img.height},
        }
        x += img.width + PAD
    sheet.save(os.path.join(OUT, "buildings.png"), optimize=True)
    with open(os.path.join(OUT, "buildings.json"), "w") as f:
        json.dump(atlas, f, indent=1)
        f.write("\n")
    for name in BUILDINGS:
        art = frames[name]
        art.resize((art.width // 2, art.height // 2), Image.NEAREST).save(os.path.join(OUT, f"building-{name}.png"), optimize=True)
    print({name: frames[name].size for name in BUILDINGS}, sheet.size)


if __name__ == "__main__":
    main()
