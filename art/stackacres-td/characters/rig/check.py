#!/usr/bin/env python3
"""Rebuild checks: Ray's approved walk must be unchanged, and one review image per animation."""
import json
import os
import sys

from PIL import Image

RIG = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(RIG)
APPROVED_WALK = os.path.join(os.path.dirname(ROOT), "ray-walk.gif")
ANIMATIONS = ["walk", "harvest", "water", "chop", "fish", "shoot"]
SIZE, SCALE, DIRS = 48, 3, 4


def approved_walk_unchanged():
    expected = Image.open(os.path.join(RIG, "build", "ray-expected.png")).convert("RGBA")
    ref = Image.open(APPROVED_WALK)
    total = 0
    for i in range(4):
        ref.seek(i)
        old = Image.new("RGBA", (SIZE, SIZE))
        old.alpha_composite(ref.convert("RGBA"), (8, 14))
        new = expected.crop((i * SIZE, 0, (i + 1) * SIZE, SIZE))
        total += sum(1 for a, b in zip(old.get_flattened_data(), new.get_flattened_data())
                     if not (a[3] == 0 and b[3] == 0) and a != b)
    return total


def review_crops():
    out = os.path.join(RIG, "build", "review")
    os.makedirs(out, exist_ok=True)
    for name in sorted(os.listdir(ROOT)):
        contact = os.path.join(ROOT, name, f"{name}-contact.png")
        if not os.path.exists(contact):
            continue
        img = Image.open(contact)
        band = SIZE * SCALE * DIRS
        for i, anim in enumerate(ANIMATIONS):
            img.crop((0, i * band, img.width, (i + 1) * band)).save(os.path.join(out, f"{name}-{anim}.png"))


def sheets_match():
    """Every frame of Aseprite's exported sheet must equal rig.py's composite, with the same tags and timing."""
    failures = 0
    for fname in sorted(os.listdir(os.path.join(RIG, "build"))):
        if not fname.endswith(".json"):
            continue
        name = fname[:-5]
        payload = json.load(open(os.path.join(RIG, "build", fname)))
        expected = Image.open(os.path.join(RIG, "build", f"{name}-expected.png")).convert("RGBA")
        sheet = Image.open(os.path.join(ROOT, name, f"{name}-sheet.png")).convert("RGBA")
        data = json.load(open(os.path.join(ROOT, name, f"{name}-sheet.json")))
        frames = data["frames"]
        tags = {t["name"]: t for t in data["meta"]["frameTags"]}
        diffs = bad_timing = bad_tags = 0
        if len(frames) != len(payload["frames"]):
            print(f"  {name}: sheet has {len(frames)} frames, expected {len(payload['frames'])}")
            failures += 1
            continue
        for row, tag in enumerate(payload["tags"]):
            meta = tags.get(tag["name"])
            if not meta or (meta["from"], meta["to"]) != (tag["from"] - 1, tag["to"] - 1):
                bad_tags += 1
            for col, index in enumerate(range(tag["from"] - 1, tag["to"])):
                r = frames[index]["frame"]
                got = sheet.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
                want = expected.crop((col * SIZE, row * SIZE, (col + 1) * SIZE, (row + 1) * SIZE))
                diffs += sum(1 for a, b in zip(got.get_flattened_data(), want.get_flattened_data())
                             if not (a[3] == 0 and b[3] == 0) and a != b)
                bad_timing += frames[index]["duration"] != payload["frames"][index]["duration"]
        print(f"  {name}: sheet {sheet.size[0]}x{sheet.size[1]}, {len(frames)} frames, {len(tags)} tags, "
              f"{diffs} differing pixels, {bad_timing} timing mismatches, {bad_tags} tag mismatches")
        failures += bool(diffs or bad_timing or bad_tags)
    return failures


if __name__ == "__main__":
    diffs = approved_walk_unchanged()
    print(f"ray walk_down vs approved ray-walk.gif: {diffs} differing pixels")
    review_crops()
    print("review images:", os.path.join(RIG, "build", "review"))
    have_sheets = all(os.path.exists(os.path.join(ROOT, n[:-5], f"{n[:-5]}-sheet.json"))
                      for n in os.listdir(os.path.join(RIG, "build")) if n.endswith(".json"))
    sheet_failures = sheets_match() if have_sheets else 0
    sys.exit(1 if diffs or sheet_failures else 0)
