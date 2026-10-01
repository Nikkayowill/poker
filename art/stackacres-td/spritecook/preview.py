"""Render the Homestead with the SpriteCook props swapped in, to look at it.

Reads the shipped ground-0.png, props atlas and area.json, so the layout, the
anchors and the draw order are exactly what the game does. Nothing here writes
into public/; it only produces review images.

A tree is a trunk plus a separate canopy frame that the wind sways, so both are
drawn for the rig's trees.

Run: python3 art/stackacres-td/spritecook/preview.py [out_dir]
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
AREA = os.path.join(REPO, "public/stackacres-td/areas/homestead")
OUT = os.path.join(HERE, "out")

# Which of the rig's prop frames each new sprite stands in for. The frames were
# identified from their placement coordinates in areas/rig/homestead.py.
BY_FRAME = {
    "p0_0": "farmhouse", "p2_0": "barn", "p3_0": "workshop",
    "p6_0": "well", "p7_0": "signpost", "p31_0": "coop",
    "p18_0": "haybale", "p19_0": "haybale", "p20_0": "crate", "p21_0": "crate",
    "p22_0": "barrel", "p23_0": "woodpile", "p24_0": "trough", "p143_0": "stump",
}
TREE_BY_SIZE = {(40, 44): "oak", (22, 36): "sapling"}
# Kept on the rig's art: its pine has a fuller silhouette than the generated
# one, and its rocks read as grey stone where the generated ones read as moss.
KEEP_RIG = {"pine", "rock_big", "rock_small"}


def load():
    area = json.load(open(os.path.join(AREA, "area.json")))
    frames = json.load(open(os.path.join(AREA, "props.json")))["frames"]
    atlas = Image.open(os.path.join(AREA, "props.png")).convert("RGBA")
    ground = Image.open(os.path.join(AREA, "ground-0.png")).convert("RGBA")
    new = {os.path.splitext(f)[0]: Image.open(os.path.join(OUT, f)).convert("RGBA")
           for f in os.listdir(OUT) if f.endswith(".png")}
    return area, frames, atlas, ground, new


def key_for(prop):
    key = BY_FRAME.get(prop["frame"])
    if key is None and (prop["w"], prop["h"]) == (18, 14):
        key = "berrybush" if (prop.get("tag") or "").startswith("forage") else "bush"
    if key is None and "sway" in prop:
        key = TREE_BY_SIZE.get((prop["w"], prop["h"]))
    return None if key in KEEP_RIG else key


def render(use_new):
    area, frames, atlas, ground, new = load()

    def frame(name):
        f = frames[name]["frame"]
        return atlas.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))

    out = ground.copy()
    swaps = 0
    for p in sorted(area["props"], key=lambda p: p["y"]):
        key = key_for(p) if use_new else None
        if key and key in new:
            swaps += 1
            im = new[key]
            out.alpha_composite(im, (p["x"] - im.width // 2, p["y"] - im.height))
        else:
            out.alpha_composite(frame(p["frame"]), (p["x"] - p["ax"], p["y"] - p["ay"]))
            if p.get("sway"):
                out.alpha_composite(frame(p["sway"]["frame"]), (p["x"] - p["ax"], p["y"] - p["ay"]))
    return out, swaps


SHOTS = {"yard": (300, 190), "pens": (560, 360), "north": (360, 100)}


def main(dest):
    os.makedirs(dest, exist_ok=True)
    old, _ = render(False)
    new, swaps = render(True)
    old.save(os.path.join(dest, "homestead-rig.png"))
    new.save(os.path.join(dest, "homestead-spritecook.png"))
    for tag, (cx, cy) in SHOTS.items():
        for name, im in (("rig", old), ("spritecook", new)):
            x = max(0, min(im.width - 256, cx - 128))
            y = max(0, min(im.height - 160, cy - 80))
            c = im.crop((x, y, x + 256, y + 160))
            c.resize((c.width * 3, c.height * 3), Image.NEAREST).save(
                os.path.join(dest, f"shot-{tag}-{name}.png"))
    print(f"swapped {swaps} props, wrote review images to {dest}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "review"))
