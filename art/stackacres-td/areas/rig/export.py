#!/usr/bin/env python3
"""Export areas and shared sprites for the top-down engine.

Usage: python3 export.py [--out <dir>] [area ...]   (default: the repo's public/stackacres-td, every playable area)

Per area, <out>/areas/<name>/:
  ground-<f>.png   terrain, ground-level items and prop shadows, one per water frame
  props.png/json   every standing prop, as a Phaser JSON-hash atlas
  area.json        {
    width, height, tile, frames, spawn: {x, y},
    props:   [{ frame, frames, x, y, ax, ay, w, h, tag?, blocks: [[tx, ty]...] }],   base point + anchor
    npcs:    [{ name, x, y }],
    blocked: [[tx, ty]...],        ground you can't walk on (water), not counting props
    zones:   [{ tag, x, y, w, h }],
    exits:   [{ to, x, y, w, h, spawn: {x, y} }]
  }
Shared, <out>/common/sprites.png/json: soil tiles by tier and neighbour mask, the four drawn crops
and a generic crop at three stages, a withered crop, hens, and cue bubbles.
Characters, <out>/characters/<name>.png/json: the rig's Aseprite sheets, frames keyed by index.
"""
import hashlib
import inspect
import json
import os
import shutil
import sys

from PIL import Image

import crops
import homestead
import kit
import oldfields
from area import CHARACTERS, T
from kit import Sprite

WALKABLE_GROUND = {"grass", "sand", "gravel", "mud", "cobble", "path", "soil"}
PLAYABLE = [homestead, oldfields]
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))


def atlas(named, image_name):
    """named: [(name, image)]. Rows by height; identical images share a frame under each name."""
    placed, frames, by_hash = [], {}, {}
    max_w, x, y, row_h = 1024, 0, 0, 0
    for name, img in sorted(named, key=lambda kv: -kv[1].height):
        key = hashlib.md5(img.tobytes()).hexdigest() + f"{img.width}x{img.height}"
        if key in by_hash:
            frames[name] = frames[by_hash[key]]
            continue
        if x + img.width > max_w:
            x, y, row_h = 0, y + row_h, 0
        frames[name] = {"frame": {"x": x, "y": y, "w": img.width, "h": img.height}, "rotated": False, "trimmed": False,
                        "spriteSourceSize": {"x": 0, "y": 0, "w": img.width, "h": img.height},
                        "sourceSize": {"w": img.width, "h": img.height}}
        by_hash[key] = name
        placed.append((img, x, y))
        x += img.width
        row_h = max(row_h, img.height)
    sheet = Image.new("RGBA", (max_w, max(1, y + row_h)))
    for img, px, py in placed:
        sheet.alpha_composite(img, (px, py))
    return sheet, {"frames": frames, "meta": {"image": image_name, "size": {"w": sheet.width, "h": sheet.height}}}


def prop_blocks(imgs, anchor, bx, by, area):
    """The tiles a standing prop's footprint covers: its base strip, not its whole picture."""
    (ax, ay), w, h = anchor, imgs[0].width, imgs[0].height
    if w < 16 and h < 16:                              # crops, small flowers: walk over them
        return []
    foot_h = max(6, min(h // 4, 20))
    x0, x1 = bx - ax + max(1, w // 10), bx - ax + w - max(1, w // 10)
    y0, y1 = by - foot_h, by
    return [[tx, ty] for ty in range(max(0, y0 // T), min(area.h, (y1 - 1) // T + 1))
            for tx in range(max(0, x0 // T), min(area.w, (x1 - 1) // T + 1))]


def ground_blocked(area, owner):
    """Water tiles, minus anything a bridge or pier (a large ground-level item) lies across."""
    blocked = set()
    for ty in range(area.h):
        for tx in range(area.w):
            wet = sum(1 for y in range(ty * T, ty * T + T) for x in range(tx * T, tx * T + T)
                      if owner[y][x] not in WALKABLE_GROUND)
            if wet > T * T // 2:
                blocked.add((tx, ty))
    for imgs, (ax, ay), bx, by, _, ground, _ in area.items:
        w, h = imgs[0].width, imgs[0].height
        if not ground or (w < 24 and h < 24):
            continue
        for ty in range((by - ay) // T, (by - ay + h - 1) // T + 1):
            for tx in range((bx - ax) // T, (bx - ax + w - 1) // T + 1):
                blocked.discard((tx, ty))
    return sorted(blocked)


def export_area(module, out_root):
    takes_game = "for_game" in inspect.signature(module.build).parameters
    area = module.build(for_game=True) if takes_game else module.build()
    out = os.path.join(out_root, "areas", area.name)
    os.makedirs(out, exist_ok=True)
    _, owner = kit.render_terrain(area.w, area.h, area.verts, 0, with_owner=True)
    for f in range(kit.FRAMES):
        area.render_ground(f, character_shadows=False).save(os.path.join(out, f"ground-{f}.png"))

    named, props = [], []
    for index, (imgs, anchor, bx, by, _, ground, name) in enumerate(area.items):
        if ground or name:
            continue
        frame_names = []
        for f, img in enumerate(imgs):
            frame_name = f"p{index}_{f}"
            named.append((frame_name, img))
            frame_names.append(frame_name)
        entry = {"frame": frame_names[0], "frames": frame_names, "x": bx, "y": by, "ax": anchor[0], "ay": anchor[1],
                 "w": imgs[0].width, "h": imgs[0].height, "blocks": prop_blocks(imgs, anchor, bx, by, area)}
        if index in area.tags:
            entry["tag"] = area.tags[index]
        props.append(entry)
    sheet, atlas_json = atlas(named, "props.png")
    sheet.save(os.path.join(out, "props.png"))
    with open(os.path.join(out, "props.json"), "w") as fh:
        json.dump(atlas_json, fh, separators=(",", ":"))

    spawn = area.spawn or (area.w * T // 2, area.h * T // 2)
    data = {
        "name": area.name, "width": area.w, "height": area.h, "tile": T, "frames": kit.FRAMES,
        "spawn": {"x": spawn[0], "y": spawn[1]},
        "props": props,
        "npcs": [{"name": n, "x": x, "y": y} for n, x, y in area.npcs if n != "farmer"],
        "blocked": ground_blocked(area, owner),
        "zones": [{"tag": t, "x": x, "y": y, "w": w, "h": h} for t, x, y, w, h in area.zones],
        "exits": [{"to": to, "x": x, "y": y, "w": w, "h": h, "spawn": {"x": sx, "y": sy}}
                  for to, x, y, w, h, sx, sy in area.exits],
    }
    with open(os.path.join(out, "area.json"), "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(area.name, "->", out, "|", len(props), "props,", len(data["npcs"]), "npcs,",
          len(data["zones"]), "zones,", len(data["exits"]), "exits")


# ------------------------------------------------------------------ shared sprites

SOIL_TIERS = {  # base, furrow, lit edge, shadow edge
    "dirt": ("N", "P", "o", "P"),
    "enriched": ("P", "K", "N", "K"),
    "hydro": ("N", "B", "C", "P"),
}


def soil_tile(tier, mask):
    """One bed tile. mask bits: 1 north, 2 east, 4 south, 8 west neighbour is also soil."""
    base, furrow, lit, shade = SOIL_TIERS[tier]
    s = Sprite(T, T)
    for y in range(T):
        for x in range(T):
            k = furrow if y % 4 == 2 and 1 <= x <= 14 else base
            if tier == "hydro" and y % 4 == 2 and x % 5 == 1:
                k = "C"
            s.put(x, y, k)
    if not mask & 1:
        s.rect(0, 0, T, 1, "G")
        s.rect(0, 1, T, 1, shade)
    if not mask & 8:
        s.rect(0, 0, 1, T, "G")
        s.rect(1, 1, 1, T - 1, shade)
    if not mask & 4:
        s.rect(0, T - 1, T, 1, lit)
    if not mask & 2:
        s.rect(T - 1, 0, 1, T, lit)
    return s.image()


def bubble(content):
    s = Sprite(11, 12)
    s.rect(1, 0, 9, 9, "W")
    s.rect(0, 1, 11, 7, "W")
    s.stamp([".W.", "..W"], 4, 9)
    s.stamp(content, 2, 1)
    return s.outline().image()


CUES = {
    "cue_water": [".....L.", "....LC.", "...LLCL", "...LLLL", "....LL."],
    "cue_ready": ["Y..Y..Y", ".YoYoY.", "..YWY..", ".YoYoY.", "Y..Y..Y"],
    "cue_hungry": ["..Y.Y..", ".YoYoY.", "..YoY..", "...o...", "...N..."],
    "cue_available": ["...R...", "...R...", "...R...", ".......", "...R..."],
    "cue_quest_ready": ["......Y", ".....Y.", "Y...Y..", ".Y.Y...", "..Y...."],
}


def withered():
    s = Sprite(9, 8)
    s.stamp(["N...N", ".N.P.", "..NP.", ".PN..", "..P.."], 2, 1)
    return s.outline("P").image()


def export_common(out_root):
    out = os.path.join(out_root, "common")
    os.makedirs(out, exist_ok=True)
    named = []
    for tier in SOIL_TIERS:
        for mask in range(16):
            named.append((f"soil_{tier}_{mask}", soil_tile(tier, mask)))
    drawn = {"carrot": "carrot", "potato": "potato", "radish": "radish", "wheatsheaf": "wheat"}
    for stock, art in drawn.items():
        for stage in (0, 1, 2):
            sprite, _ = crops.crop(art, stage)
            named.append((f"crop_{stock}_{stage}", sprite.image()))
    for stage in (0, 1, 2):
        sprite, _ = kit.crop(stage)
        named.append((f"crop_generic_{stage}", sprite.image()))
    named.append(("crop_withered", withered()))
    for side, left in (("left", True), ("right", False)):
        sprite, _ = kit.hen(left)
        named.append((f"hen_{side}", sprite.image()))
    for name, grid in CUES.items():
        named.append((name, bubble(grid)))
    sheet, atlas_json = atlas(named, "sprites.png")
    sheet.save(os.path.join(out, "sprites.png"))
    with open(os.path.join(out, "sprites.json"), "w") as fh:
        json.dump(atlas_json, fh, separators=(",", ":"))
    print("common ->", out, "|", len(named), "frames")


def export_characters(out_root):
    out = os.path.join(out_root, "characters")
    os.makedirs(out, exist_ok=True)
    for name in sorted(os.listdir(CHARACTERS)):
        sheet = os.path.join(CHARACTERS, name, f"{name}-sheet.png")
        if not os.path.exists(sheet):
            continue
        shutil.copyfile(sheet, os.path.join(out, f"{name}.png"))
        # Phaser's createFromAseprite looks frames up by index ("0".."95"), which is Aseprite's
        # hash export, so the array export is re-keyed here and the filenames dropped.
        data = json.load(open(sheet[:-4] + ".json"))
        data["frames"] = {str(i): {k: v for k, v in f.items() if k != "filename"} for i, f in enumerate(data["frames"])}
        with open(os.path.join(out, f"{name}.json"), "w") as fh:
            json.dump(data, fh, separators=(",", ":"))
    print("characters ->", out)


def main():
    args = sys.argv[1:]
    out_root = os.path.join(REPO, "public", "stackacres-td")
    if args[:1] == ["--out"]:
        out_root, args = args[1], args[2:]
    for module in PLAYABLE:
        if not args or module.__name__ in args:
            export_area(module, out_root)
    export_common(out_root)
    export_characters(out_root)


if __name__ == "__main__":
    main()
