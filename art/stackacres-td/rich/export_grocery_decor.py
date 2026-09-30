"""The decor an owner can buy for the city grocery, as one atlas the scene loads alongside the room's own.

Each piece is its lpc_rooms.grocery_decor() picture at the pack's full 32px a tile (the scene shows it at half,
like the room's own props), and where it stands on its plan: a standing thing on the middle of its plan's
bottom edge, a rug from its top-left corner, flat on the floor.

    python3 art/stackacres-td/rich/export_grocery_decor.py

writes public/stackacres-td/areas/grocery/decor.png and decor.json (a Phaser hash atlas) and decor-pieces.json,
which lib/stackacres/grocery-layout.ts reads. Prices, appeal and plans in tiles live there too.
"""
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "areas", "rig"))
import lpc_rooms as L  # noqa: E402
from export import atlas  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "public", "stackacres-td", "areas", "grocery")
MAP_TILE = 16


def even(img):
    """Padded out to even pixels, at the top and right, so half size lands on whole map pixels and the base
    stays where it was."""
    w, h = img.width + img.width % 2, img.height + img.height % 2
    out = Image.new("RGBA", (w, h))
    out.alpha_composite(img, (0, h - img.height))
    return out


def main():
    named, pieces = [], {}
    for kind, (img, w, h, flat) in L.grocery_decor().items():
        img = even(img)
        named.append((kind, img))
        mw, mh = img.width // 2, img.height // 2
        if flat:
            piece = {"frame": kind, "x": 0, "y": 0, "ax": 0, "ay": 0, "w": mw, "h": mh, "scale": 0.5, "flat": True}
        else:
            piece = {"frame": kind, "x": w * MAP_TILE // 2, "y": h * MAP_TILE - 1, "ax": mw // 2, "ay": mh, "w": mw, "h": mh,
                     "scale": 0.5}
        pieces[kind] = [piece]
    sheet, atlas_json = atlas(named, "decor.png")
    os.makedirs(OUT, exist_ok=True)
    sheet.save(os.path.join(OUT, "decor.png"))
    with open(os.path.join(OUT, "decor.json"), "w") as fh:
        json.dump(atlas_json, fh, separators=(",", ":"))
    with open(os.path.join(OUT, "decor-pieces.json"), "w") as fh:
        json.dump(pieces, fh, separators=(",", ":"), sort_keys=True)
    print(f"grocery decor -> {OUT} | {len(pieces)} kinds, sheet {sheet.width}x{sheet.height}")


if __name__ == "__main__":
    main()
