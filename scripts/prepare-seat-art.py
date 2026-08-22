#!/usr/bin/env python3
"""Build the 2.5D table's player seat cutouts from the supplied turnarounds.

    scripts/prepare-seat-art.py [source-dir]      (default: art/seats)

Same idea as scripts/prepare-dealer.py, one level deeper: a player isn't
drawn face-on like the dealer, so each character is a BUCKET OF ANGLES rather
than one plate. `art/seats/<character>/<angle>.png`, where <angle> is the
turn away from facing the camera in degrees (0, 20, 40, ...). The seat picks
the nearest angle it has and mirrors it for the opposite side of the table --
see lib/scene/seat-art.ts for that half.

WHAT A SOURCE PLATE HAS TO BE
  - Framed from the top of the head to the hands on the table, character
    running off the BOTTOM edge -- same contract as a dealer plate.
  - The SAME turn convention in every character's bucket: increasing angle
    turns the face toward screen-LEFT (matching the first character's own
    turnaround). A character shot turning the other way mirrors backwards at
    every seat it's placed at -- it ends up looking away from the pot rather
    than at it. Normalise it on the way IN (slice-seat-sheet.py --mirror, or
    flip the plates yourself) rather than teaching the app two conventions;
    character13-21 arrived turning screen-right and were flipped this way.
  - RGB on a solid black plate, or already cut out with real alpha.

WHAT COMES OUT
  - public/table2d5/seats/<character>/<angle>.webp, every angle in a
    character's own bucket sharing one box (so switching angle mid-seat never
    jumps size) -- but NOT shared across characters, unlike the dealer's one
    shared box, because nothing here ever cross-fades one character into
    another.
  - lib/scene/seat-art.generated.ts, listing each character's ids, its
    available angles and its box.

THE KEY IS CONNECTIVITY, NOT COLOUR -- see prepare-dealer.py's note. Same
recipe: flood inward from the border, luma <= 1 only.
"""

import os
import sys
from collections import deque

from PIL import Image

SOURCE_DIR = "art/seats"
OUT_DIR = "public/table2d5/seats"
MANIFEST = "lib/scene/seat-art.generated.ts"

LUMA_MAX = 1
HEAD_BAND = 0.35
WEBP_QUALITY = 96


def cutout(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    rgb = im.convert("RGB").load()
    alpha = im.split()[-1]

    if alpha.getextrema()[0] == 255:
        bg = bytearray(w * h)
        q = deque()

        def dark(x, y):
            r, g, b = rgb[x, y]
            return (r * 299 + g * 587 + b * 114) // 1000 <= LUMA_MAX

        def push(x, y):
            i = y * w + x
            if not bg[i] and dark(x, y):
                bg[i] = 1
                q.append((x, y))

        for x in range(w):
            push(x, 0)
            push(x, h - 1)
        for y in range(h):
            push(0, y)
            push(w - 1, y)
        while q:
            x, y = q.popleft()
            if x > 0:
                push(x - 1, y)
            if x < w - 1:
                push(x + 1, y)
            if y > 0:
                push(x, y - 1)
            if y < h - 1:
                push(x, y + 1)

        alpha = Image.frombytes("L", (w, h), bytes(255 - v * 255 for v in bg))
        im.putalpha(alpha)

    box = alpha.getbbox()
    if box is None:
        raise SystemExit(f"{path}: nothing left after the key -- is the plate solid?")
    return im.crop(box)


def head_centre(im):
    w, h = im.size
    a = im.split()[-1].load()
    total = weighted = 0
    for y in range(max(1, int(h * HEAD_BAND))):
        for x in range(w):
            v = a[x, y]
            if v:
                total += v
                weighted += x * v
    if not total:
        raise SystemExit("head band is empty -- is the plate framed head-to-hands?")
    return weighted / total


def process_character(char_id, src_dir, out_dir):
    names = sorted(
        f for f in os.listdir(src_dir)
        if f.lower().endswith((".png", ".webp")) and not f.startswith(".")
    )
    if not names:
        raise SystemExit(f"{src_dir} holds no angle plates")

    angles = []
    for name in names:
        angle_id = os.path.splitext(name)[0]
        try:
            angle_deg = int(angle_id)
        except ValueError:
            raise SystemExit(f"{name}: filename must be the angle in degrees (e.g. 20.png)")
        art = cutout(os.path.join(src_dir, name))
        angles.append({"angle": angle_deg, "art": art})

    # Shared box for this character only, from its own bucket -- crown-to-hands
    # height first (the tallest plate sets it, same idea as the dealer box),
    # then the widest half-span either side of any plate's own head centre.
    box_height = max(a["art"].size[1] for a in angles)
    for a in angles:
        art = a["art"]
        scale = box_height / art.size[1]
        width = max(1, round(art.size[0] * scale))
        a["art"] = art.resize((width, box_height), Image.LANCZOS)
        a["centre"] = head_centre(a["art"])

    half = max(max(a["centre"], a["art"].size[0] - a["centre"]) for a in angles)
    box_width = 2 * int(-(-half // 1))

    os.makedirs(out_dir, exist_ok=True)
    for a in angles:
        canvas = Image.new("RGBA", (box_width, box_height), (0, 0, 0, 0))
        canvas.alpha_composite(a["art"], (round(box_width / 2 - a["centre"]), 0))
        out = os.path.join(out_dir, f"{a['angle']}.webp")
        canvas.save(out, quality=WEBP_QUALITY, method=6)
        print(f"  {char_id}/{a['angle']:<3d} -> {out}  ({os.path.getsize(out) // 1024} KiB)")

    angles.sort(key=lambda a: a["angle"])
    return {"id": char_id, "angles": [a["angle"] for a in angles], "box": {"width": box_width, "height": box_height}}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SOURCE_DIR
    if not os.path.isdir(src):
        raise SystemExit(f"usage: {sys.argv[0]} [source-dir]   (no such directory: {src})")

    char_ids = sorted(
        d for d in os.listdir(src)
        if os.path.isdir(os.path.join(src, d)) and not d.startswith(".")
    )
    if not char_ids:
        raise SystemExit(f"{src} holds no character directories")

    characters = []
    for char_id in char_ids:
        characters.append(process_character(char_id, os.path.join(src, char_id), os.path.join(OUT_DIR, char_id)))

    with open(MANIFEST, "w", encoding="utf-8") as manifest:
        manifest.write("""/**
 * GENERATED by scripts/prepare-seat-art.py -- do not edit.
 *
 * Every character with seat art in `public/table2d5/seats/`, the angles
 * available for each (degrees off facing the camera, always the "turns
 * toward screen-left" convention -- see the script's own docstring), and the
 * box its own bucket was normalised onto.
 */

export interface SeatArtCharacter {
  id: string;
  /** Degrees off facing the camera, ascending. Always includes 0. */
  angles: readonly number[];
  /** The shared box this character's angles were normalised onto, in pixels
   *  of the art. Only the ratio matters -- drawn size comes from the camera. */
  box: { width: number; height: number };
}

export const SEAT_ART_CHARACTERS: readonly SeatArtCharacter[] = [
""" + "".join(
            f'  {{ id: "{c["id"]}", angles: [{", ".join(str(a) for a in c["angles"])}] as const, '
            f'box: {{ width: {c["box"]["width"]}, height: {c["box"]["height"]} }} }},\n'
            for c in characters
        ) + "] as const;\n")
    print(f"  manifest   -> {MANIFEST}  ({len(characters)} character(s))")


if __name__ == "__main__":
    main()
