#!/usr/bin/env python3
"""Normalise the house dealer's plate into the cutout the app draws.

    scripts/prepare-dealer.py [plate]      (default: art/dealers/claira.jpg)

THERE IS ONE DEALER. Claira, with Finn and Loki, and she has the 2.5D table's
single dealer place to herself. This used to build a bucket of plates and emit
a rotation order; that is gone, and so is every number that went with it.
(The Blackjack room draws its own dealers from `public/dealer/` and is not
touched by this script.)

What remains is the reason the script existed in the first place: a supplied
plate arrives at its own crop, with its own idea of where the middle is, and
the app holds ONE placement for the dealer's slot. Normalising here is what
lets a redraw drop in without a single number changing downstream.

WHAT A SOURCE PLATE HAS TO BE
  - Framed from the top of the head to the hands, with the figure running off
    the BOTTOM edge. Those two extremes are what the normalisation lines up, so
    a plate with air under the hands hangs the dealer high and one cropped at
    the chin blows her up.
  - Facing the camera, seated at the table. Nothing here can fix a
    three-quarter turn.
  - A solid plate -- black or white, both arrive -- or already cut out with
    real alpha. All three work; see the keying note below.

WHAT COMES OUT
  - public/table2d5/dealer.webp, crown at the top edge, hands at the bottom
    edge, head centred.
  - lib/scene/dealer-art.generated.ts, holding that path and the box it was
    normalised onto.

THE KEY IS CONNECTIVITY, NOT COLOUR, and it is not a preference. The plates
this project has been handed include a black dog in a black shirt on a black
plate and, now, a black shirt on a white one: any colour key wide enough to
catch either background also catches the figure wearing it. So the cutout
floods INWARD FROM THE BORDER, and the only thing that varies is which way the
threshold points.

WHICH WAY IT POINTS IS READ OFF THE PLATE, not configured. The border ring's
median luma says whether the background is dark or light, and the two
thresholds are as tight as their source format allows:

  - A dark plate keys at luma <= 1. Parts of these are literally (0, 0, 0)
    inside the clothing and one step more generous lets the flood escape
    through a sleeve and eat the whole figure. That has happened here twice.
  - A light plate keys at luma >= 200, which is far looser and safe for the
    opposite reason: these arrive as JPEG, so the boundary carries ringing, and
    the figure is drawn with a hard dark outline all the way round. Measured on
    Claira's plate, moving the threshold from 245 down to 200 changes the kept
    pixel count by 0.17% and leaves the cut edge sitting on the outline itself
    rather than on a rim of near-white JPEG noise. Interior highlights (the
    whites of an eye, a tooth) survive because they are enclosed and the flood
    can never reach them.
"""

import os
import sys
from collections import deque

from PIL import Image

DEFAULT_PLATE = "art/dealers/claira.jpg"
OUT_PATH = "public/table2d5/dealer.webp"
MANIFEST = "lib/scene/dealer-art.generated.ts"

# Background flood thresholds, one per plate polarity. See the module note --
# neither of these is a knob.
DARK_MAX = 1
LIGHT_MIN = 200

# Height of the normalised box. Only the ratio reaches the app -- the drawn
# size comes from the camera -- but fixing the height keeps a redraw's diff
# readable.
BOX_HEIGHT = 794

# The head is centred on this band of the image, alpha-weighted. The top third
# is head and hair on any plate framed the way the docstring requires, and
# weighting by alpha rather than taking the bounding box's middle is what keeps
# a ponytail from dragging the face off centre.
HEAD_BAND = 0.35

WEBP_QUALITY = 96


def luma(pixel):
    r, g, b = pixel
    return (r * 299 + g * 587 + b * 114) // 1000


def cutout(path):
    """Key a plate to RGBA and trim it to the figure."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    rgb = im.convert("RGB").load()
    alpha = im.split()[-1]

    # An already-cut-out plate keeps its own alpha; only a solid plate is keyed.
    if alpha.getextrema()[0] == 255:
        border = [luma(rgb[x, y]) for x in range(w) for y in (0, h - 1)]
        border += [luma(rgb[x, y]) for y in range(h) for x in (0, w - 1)]
        border.sort()
        light_plate = border[len(border) // 2] >= 128

        def background(x, y):
            value = luma(rgb[x, y])
            return value >= LIGHT_MIN if light_plate else value <= DARK_MAX

        bg = bytearray(w * h)
        q = deque()

        def push(x, y):
            i = y * w + x
            if not bg[i] and background(x, y):
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
        print(f"  plate      -> {'light' if light_plate else 'dark'}, keyed from the border")

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
    plate = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PLATE
    if not os.path.isfile(plate):
        raise SystemExit(f"usage: {sys.argv[0]} [plate]   (no such file: {plate})")

    art = cutout(plate)
    scale = BOX_HEIGHT / art.size[1]
    width = max(1, round(art.size[0] * scale))
    art = art.resize((width, BOX_HEIGHT), Image.LANCZOS)
    centre = head_centre(art)

    # The box is the smallest that holds the figure centred on her own head, so
    # the head lands dead centre of the file and the slot needs no per-plate
    # offset to place it.
    half = max(centre, width - centre)
    box_width = 2 * int(-(-half // 1))

    canvas = Image.new("RGBA", (box_width, BOX_HEIGHT), (0, 0, 0, 0))
    canvas.alpha_composite(art, (round(box_width / 2 - centre), 0))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    canvas.save(OUT_PATH, quality=WEBP_QUALITY, method=6)
    print(f"  dealer     -> {OUT_PATH}  ({os.path.getsize(OUT_PATH) // 1024} KiB)")

    with open(MANIFEST, "w", encoding="utf-8") as manifest:
        manifest.write(f"""/**
 * GENERATED by scripts/prepare-dealer.py -- do not edit.
 *
 * The house dealer's normalised cutout, and the box it was normalised onto.
 * Regenerate after redrawing the plate in `art/dealers/`.
 */

/** The dealer's artwork, served from public/. */
export const DEALER_ART_SRC = "/{OUT_PATH.split('/', 1)[1]}";

/**
 * The normalised box, in pixels of the artwork. Only its ratio is used -- the
 * drawn size comes from the camera -- but both numbers are kept so a
 * regeneration that changes the box is visible in the diff.
 */
export const DEALER_BOX = {{ width: {box_width}, height: {BOX_HEIGHT} }} as const;
""")
    print(f"  manifest   -> {MANIFEST}  (box {box_width}x{BOX_HEIGHT})")


if __name__ == "__main__":
    main()
