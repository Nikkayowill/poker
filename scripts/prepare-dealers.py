#!/usr/bin/env python3
"""Build the 2.5D table's dealer cutouts from the supplied plates.

    scripts/prepare-dealers.py [source-dir]      (default: art/dealers)

DROP A PLATE IN THE BUCKET, RUN THIS, AND THE NEW DEALER LANDS EXACTLY WHERE
EVERY OTHER ONE DOES. That is the whole point of this script. The table has one
dealer place at far centre and the app holds ONE set of numbers for it, so the
thing that has to be made consistent is the artwork itself -- every plate
arrives at a different crop, a different framing and a different idea of where
the middle is, and normalising that here means nothing downstream has to know
which dealer it is drawing.

The file name is the dealer's id (`loki.png` -> `loki`), and the id is the
contract: rotation order is derived from it and it is what the generated
manifest lists. Matching by file order instead would reshuffle every table's
dealer the day somebody adds a plate that sorts early.

WHAT A SOURCE PLATE HAS TO BE
  - Framed from the top of the head to the hands on the table, with the
    character running off the BOTTOM edge. Those two extremes are what the
    normalisation lines up, so a plate with air under the hands hangs its
    dealer high and one cropped at the chin blows them up.
  - Facing the camera, seated/standing at the table. Nothing here can fix a
    three-quarter turn.
  - RGB on a solid black plate (what has arrived every time so far) or already
    cut out with real alpha. Both work; see the keying note below.

WHAT COMES OUT
  - public/table2d5/dealers/<id>.webp, every one of them on the same box, with
    the crown at the top edge, the hands at the bottom edge and the head
    centred.
  - lib/scene/dealer-art.generated.ts, listing the ids and that shared box.

THE KEY IS CONNECTIVITY, NOT COLOUR, and it is not a preference. Loki is a
black dog in a black shirt on a black plate: every colour key wide enough to
catch the background also catches him. So the cutout floods INWARD FROM THE
BORDER, and only at luma <= 1 -- parts of these plates are literally (0, 0, 0)
inside the clothing, and one step more generous lets the flood escape through a
sleeve and eat the whole figure. That has happened here twice.
"""

import os
import sys
from collections import deque

from PIL import Image

SOURCE_DIR = "art/dealers"
OUT_DIR = "public/table2d5/dealers"
MANIFEST = "lib/scene/dealer-art.generated.ts"

# Background flood threshold. See the module note -- this is not a knob.
LUMA_MAX = 1

# Height of the shared box. Every dealer is scaled so their crown-to-hands
# height is exactly this, which is what makes a shift change invisible.
BOX_HEIGHT = 794

# The head is centred on this band of the image, alpha-weighted. The top third
# is head and hair on any plate framed the way the docstring requires, and
# weighting by alpha rather than taking the bounding box's middle is what
# keeps a ponytail or a spray of ears from dragging the face off centre.
HEAD_BAND = 0.35

WEBP_QUALITY = 96


def cutout(path):
    """Key a plate to RGBA and trim it to the character."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    rgb = im.convert("RGB").load()
    alpha = im.split()[-1]

    # An already-cut-out plate keeps its own alpha; only a solid plate is keyed.
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
    """Alpha-weighted centre of the head band, in pixels from the left edge."""
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


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SOURCE_DIR
    if not os.path.isdir(src):
        raise SystemExit(f"usage: {sys.argv[0]} [source-dir]   (no such directory: {src})")

    names = sorted(
        f for f in os.listdir(src)
        if f.lower().endswith((".png", ".webp")) and not f.startswith(".")
    )
    if not names:
        raise SystemExit(f"{src} holds no plates")

    # Pass one: key, scale to the shared height, and find how far each dealer
    # reaches either side of their own head.
    dealers = []
    for name in names:
        dealer_id = os.path.splitext(name)[0].lower()
        art = cutout(os.path.join(src, name))
        scale = BOX_HEIGHT / art.size[1]
        width = max(1, round(art.size[0] * scale))
        art = art.resize((width, BOX_HEIGHT), Image.LANCZOS)
        centre = head_centre(art)
        dealers.append({
            "id": dealer_id,
            "art": art,
            "centre": centre,
            "left": centre,
            "right": width - centre,
        })

    # The box is the smallest that holds every dealer centred on their own
    # head. Computed over the whole bucket rather than fixed, so a new plate
    # with wider hair widens the box for everyone instead of being clipped --
    # which is why this rebuilds every file on every run.
    half = max(max(d["left"], d["right"]) for d in dealers)
    box_width = 2 * int(-(-half // 1))

    os.makedirs(OUT_DIR, exist_ok=True)
    for dealer in dealers:
        canvas = Image.new("RGBA", (box_width, BOX_HEIGHT), (0, 0, 0, 0))
        canvas.alpha_composite(dealer["art"], (round(box_width / 2 - dealer["centre"]), 0))
        out = os.path.join(OUT_DIR, f"{dealer['id']}.webp")
        canvas.save(out, quality=WEBP_QUALITY, method=6)
        print(f"  {dealer['id']:10s} -> {out}  ({os.path.getsize(out) // 1024} KiB)")

    ids = ", ".join(f'"{d["id"]}"' for d in dealers)
    with open(MANIFEST, "w", encoding="utf-8") as manifest:
        manifest.write(f"""/**
 * GENERATED by scripts/prepare-dealers.py -- do not edit.
 *
 * Every dealer whose art is in `public/table2d5/dealers/`, and the one box
 * they were all normalised onto. Regenerate after adding a plate to the
 * bucket; the box is recomputed from the whole set, so every file is rewritten
 * on each run.
 */

/** Dealer ids, in the order they take the table. */
export const DEALER_IDS = [{ids}] as const;

/**
 * The shared box, in pixels of the normalised art. Only its ratio is used --
 * the drawn size comes from the camera -- but both numbers are kept so a
 * regeneration that changes the box is visible in the diff.
 */
export const DEALER_BOX = {{ width: {box_width}, height: {BOX_HEIGHT} }} as const;
""")
    print(f"  manifest   -> {MANIFEST}  (box {box_width}x{BOX_HEIGHT}, {len(dealers)} dealers)")


if __name__ == "__main__":
    main()
