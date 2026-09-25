#!/usr/bin/env python3
"""Scatters clearable-wilderness-style props across the empty 'empire' district.

This is not the runtime clearing mechanic (that's future work, see
docs/stackacres-second-map-direction.md section 6a) -- it only makes the district
LOOK like uncleared land: trees, boulders and scrub scattered across the field the
way lib/stackacres/land-clearing.ts's LandObstacleKind ("tree" | "boulder" | "scrub")
already names them for the Homestead's Crop Fields.

It reuses the Homestead's own wilderness-prop generators (kit.round_tree, kit.spruce,
kit.bush, props.rockfall) rather than inventing new art or hand-copying pixels out of
homestead/area.json -- those functions ARE the wilderness system; homestead.py calls
the same ones for its own treeline and hill trees. This script does not run the full
rich export pipeline (art/stackacres-td/rich/export_rich.py): that pipeline renders a
whole area's terrain/lighting/water from an authored Area with verts, npcs, etc, which
is real, heavier work belonging to a future "build out the empire district" pass, not
this props-only scaffold. The empire district's ground art, spawn, exits and the
perimeter-wall `blocked` list were hand-authored by earlier scripts in this same
directory (gen-empire-area-art.py, add-empire-bridge-exit.py) and are left untouched
here -- this script only replaces `props`, `props.png` and `props.json`.

Run: python3 scripts/gen-empire-wilderness-props.py
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
RIG = os.path.join(REPO, "art", "stackacres-td", "areas", "rig")
sys.path.insert(0, RIG)

import kit  # noqa: E402
import props  # noqa: E402
from export import atlas, prop_blocks  # noqa: E402  (the areas/rig export helpers, reused as-is)

T = kit.T
OUT = os.path.join(REPO, "public", "stackacres-td", "areas", "empire")
AREA_JSON = os.path.join(OUT, "area.json")

random.seed(20260924)

# --- keep-clear zones, matching the map's untouched dimensions/doorway/spawn ---
SPAWN = (40, 240)
SPAWN_CLEAR_RADIUS = 40          # px around the spawn point; nothing may block here
DOORWAY = {"x": 0, "y": 224, "w": 10, "h": 32}          # tile units, per area.json's exit
DOOR_CLEAR = {                                          # generous pixel buffer around the doorway
    "x0": 0, "x1": (DOORWAY["x"] + DOORWAY["w"]) * T + 40,
    "y0": DOORWAY["y"] * T - 40, "y1": (DOORWAY["y"] + DOORWAY["h"]) * T + 40,
}
MAP_W, MAP_H = 40, 30            # tiles, must match area.json exactly (not touched, just read below)


def in_door_clear(x, y):
    return DOOR_CLEAR["x0"] <= x <= DOOR_CLEAR["x1"] and DOOR_CLEAR["y0"] <= y <= DOOR_CLEAR["y1"]


def near_spawn(x, y):
    return (x - SPAWN[0]) ** 2 + (y - SPAWN[1]) ** 2 <= SPAWN_CLEAR_RADIUS ** 2


class FakeArea:
    """A minimal stand-in for rig.area.Area: prop_blocks() only reads .w/.h off it."""
    def __init__(self, w, h):
        self.w, self.h = w, h


def make_prop(kind, seed):
    if kind == "tree_round":
        return props_from(kit.round_tree(seed))
    if kind == "tree_spruce":
        return props_from(kit.spruce(seed, big=(seed % 3 == 0)))
    if kind == "boulder":
        return props_from(props.rockfall())
    if kind == "scrub":
        return props_from(kit.bush(seed, berries=(seed % 2 == 0)))
    raise ValueError(kind)


def props_from(made):
    sprite, anchor = made
    return sprite.image(), anchor


def main():
    with open(AREA_JSON) as fh:
        area_data = json.load(fh)
    assert area_data["width"] == MAP_W and area_data["height"] == MAP_H, "map dimensions changed unexpectedly"
    assert area_data["spawn"] == {"x": SPAWN[0], "y": SPAWN[1]}, "spawn point changed unexpectedly"
    exit_back = next(e for e in area_data["exits"] if e["to"] == "homestead")
    assert (exit_back["x"], exit_back["y"], exit_back["w"], exit_back["h"]) == \
        (DOORWAY["x"], DOORWAY["y"], DOORWAY["w"], DOORWAY["h"]), "doorway changed unexpectedly"

    fake_area = FakeArea(MAP_W, MAP_H)
    blocked_tiles = {tuple(t) for t in area_data["blocked"]}

    # Roughly one prop per 24 tiles of the (mostly open) field -- enough to read as
    # "uncleared wilderness", not a wallpapered grid. Weighted toward trees, per the
    # Homestead's own treeline mix (spruce/round dominate, boulders and scrub sparser).
    kinds = (["tree_round"] * 5 + ["tree_spruce"] * 6 + ["boulder"] * 3 + ["scrub"] * 6)
    random.shuffle(kinds)

    named, entries = [], []
    placed_rects = []  # (x0, y0, x1, y1) in px, for a light overlap check between props
    seed_counter = 0
    for kind in kinds:
        for _attempt in range(60):
            seed_counter += 1
            x = random.randint(2 * T, (MAP_W - 2) * T)
            y = random.randint(2 * T, (MAP_H - 2) * T)
            if near_spawn(x, y) or in_door_clear(x, y):
                continue
            img, (ax, ay) = make_prop(kind, seed_counter)
            w, h = img.width, img.height
            rect = (x - ax, y - ay, x - ax + w, y - ay + h)  # bounding rect, for a light overlap check
            if any(not (rect[2] < o[0] or rect[0] > o[2] or rect[1] > o[3] or rect[3] < o[1])
                   for o in placed_rects):
                continue
            blocks = prop_blocks([img], (ax, ay), x, y, fake_area)
            block_set = {tuple(b) for b in blocks}
            if any(near_spawn(bx * T + T // 2, by * T + T // 2) for bx, by in block_set):
                continue
            if any(in_door_clear(bx * T, by * T) for bx, by in block_set):
                continue
            if block_set & blocked_tiles:
                continue
            index = len(entries)
            frame_name = f"p{index}_0"
            named.append((frame_name, img))
            entries.append({
                "frame": frame_name, "frames": [frame_name], "x": x, "y": y,
                "ax": ax, "ay": ay, "w": w, "h": h, "scale": 1, "blocks": sorted(block_set),
            })
            placed_rects.append(rect)
            break

    sheet, atlas_json = atlas(named, "props.png")
    sheet.save(os.path.join(OUT, "props.png"))
    with open(os.path.join(OUT, "props.json"), "w") as fh:
        json.dump(atlas_json, fh, separators=(",", ":"))

    area_data["props"] = entries
    with open(AREA_JSON, "w") as fh:
        json.dump(area_data, fh, separators=(",", ":"))

    print(f"placed {len(entries)} wilderness props ->", OUT)


if __name__ == "__main__":
    main()
