#!/usr/bin/env python3
"""Read the sheets that were just built, the way the game reads them, and draw them.

Everything else here composites from LPC directly. This one goes through the built PNG and its tag
table, so a mistake in the sheet layout shows up as a broken picture instead of passing unnoticed.
Usage: python3 verify.py <out dir>"""
import json
import os
import sys

from PIL import Image

import mockup
import review

NEW = os.path.join(mockup.REPO, "public", "stackacres-td", "characters")


def tag_frames(name, tag, where=NEW):
    im = Image.open(os.path.join(where, f"{name}.png")).convert("RGBA")
    with open(os.path.join(where, f"{name}.json")) as fh:
        meta = json.load(fh)
    t = next(t for t in meta["meta"]["frameTags"] if t["name"] == tag)
    out = []
    for i in range(t["from"], t["to"] + 1):
        f = meta["frames"][str(i)]["frame"]
        out.append((im.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])),
                    meta["frames"][str(i)]["duration"]))
    return out


def standing(name, direction="down"):
    return review.lpc.cutout(tag_frames(name, f"walk_{direction}")[1][0])


def main(out):
    os.makedirs(out, exist_ok=True)
    area = mockup.Area()
    # The Homestead as the game lays it out: Ray and the Pilgrim where area.json puts them, the
    # player on the spawn.
    people = [(standing(n["name"]), n["x"], n["y"]) for n in area.data["npcs"]
              if os.path.exists(os.path.join(NEW, f"{n['name']}.png"))]
    spawn = area.data["spawn"]
    people.append((standing("farmer"), spawn["x"], spawn["y"]))
    shot = (0, 60, 352, 220)
    mockup.zoom(area.render(shot, people), 3).save(f"{out}/homestead-built.png")
    # The same shot with the sprites the game ships today, for a straight comparison.
    was = [(review.lpc.cutout(review.shipped(n["name"])), n["x"], n["y"]) for n in area.data["npcs"]]
    was.append((review.lpc.cutout(review.shipped("farmer")), spawn["x"], spawn["y"]))
    mockup.zoom(area.render(shot, was), 3).save(f"{out}/homestead-today.png")

    for tag, ms in (("walk_down", 100), ("water_down", None), ("chop_down", None),
                    ("fish_right", None), ("harvest_down", None), ("shoot_down", None)):
        frames = tag_frames("farmer", tag)
        review.gif([review.lpc.cutout(f) for f, _ in frames], f"{out}/built-{tag}.gif",
                   ms or frames[0][1], scale=6)
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
