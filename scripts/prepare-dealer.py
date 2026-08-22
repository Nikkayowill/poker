#!/usr/bin/env python3
"""Normalise the house dealer's plate into the cutout the app draws.

    scripts/prepare-dealer.py [plate]      (default: art/dealers/claira.jpg)

THERE IS ONE DEALER and she has the 2.5D table's single dealer place to
herself. This used to build a bucket of plates and emit a rotation order; that
is gone, and so is every number that went with it. (The Blackjack room draws
its own dealers from `public/dealer/` and is not touched by this script.)

What remains is the reason the script existed in the first place: a supplied
plate arrives at its own crop, at its own size, with its own idea of where the
middle is, and the app holds ONE placement for the dealer's slot. Normalising
here is what lets a redraw drop in without a single number changing downstream.

WHAT A SOURCE PLATE HAS TO BE
  - Framed from the top of the head to the hands. Those two extremes are what
    the normalisation lines up, so a plate with air under the hands hangs the
    dealer high and one cropped at the chin blows her up. The figure may run
    off the bottom edge or float clear of it; only the alpha bounds matter.
  - Facing the camera, seated at the table. Nothing here can fix a
    three-quarter turn.
  - A solid plate -- black or white, both arrive -- or already cut out with
    real alpha. All three work; see the keying note below.
  - Captions are fine. See the labelled-sheet note below.

WHAT COMES OUT
  - public/table2d5/dealer.webp, crown at the top edge, hands at the bottom
    edge, head centred.
  - lib/scene/dealer-art.generated.ts, holding that path and the box it was
    normalised onto.

THE KEY IS CONNECTIVITY, NOT COLOUR, and it is not a preference. The plates
this project has been handed include a black dog in a black shirt on a black
plate, a black shirt on a white one, and a dark uniform on black again: any
colour key wide enough to catch the background also catches the figure wearing
it. So the cutout floods INWARD FROM THE BORDER, and only the direction and the
tightness of the threshold vary.

DIRECTION IS READ OFF THE PLATE, not configured -- the border ring's median
luma says whether the background is dark or light.

TIGHTNESS IS READ OFF THE FILE FORMAT, and that split is the hard-won part:

  - A LOSSLESS dark plate (.png/.webp) keys at luma <= 1. Parts of these are
    literally (0, 0, 0) inside the clothing and one step more generous lets the
    flood escape through a sleeve and eat the whole figure. That has happened
    here twice, which is why this stays as tight as it possibly can.
  - A LOSSY dark plate (.jpg) keys at luma <= 6, because a JPEG "black" plate
    is not black: it carries ringing up around 6, and at <= 1 the flood dies in
    the noise and the whole rectangle comes out opaque. Same threshold and same
    reason as scripts/slice-seat-sheet.py, which hit this first on the seat
    turnaround sheets. Measured on the current plate: the cut bbox is identical
    at 4, 6 and 10, so 6 sits in the middle of a plateau rather than on a cliff.
  - A light plate keys at luma >= 200 whatever the format -- far looser, and
    safe for the opposite reason: the figure is drawn with a hard dark outline
    all the way round. Measured on the white-plate portrait, moving from 245
    down to 200 changed the kept pixel count by 0.17% and put the cut edge on
    the outline itself rather than on a rim of near-white JPEG noise.

Interior highlights (the whites of an eye, a tooth) survive at any threshold
because they are enclosed and a border flood can never reach them.

A LABELLED SHEET IS A VALID PLATE. Art has arrived as an "ANGLE SHEET" -- the
figure with a boxed title above it and a paragraph of caption plus a decorative
graphic below, all on the same plate. Keying that as-is leaves the captions
behind as opaque islands, and since the crop is taken from the alpha bounds,
the box would span the whole sheet and the dealer would come out as a stamp in
the middle of it. So the figure is isolated FIRST, as the tallest run of rows
holding anything but background -- captions are short bands and never have to
be located, only out-grown. Same rule as slice-seat-sheet.py. On a plain plate
with no captions the tallest run is the whole image, so this costs nothing.

STRAY ISLANDS ARE DROPPED. Only the largest connected piece of the figure
survives the key; ringing specks that clear the threshold would otherwise widen
the normalised box for nothing, since the box is built to hold whatever the
alpha bounds say is there.

IT NEVER UPSCALES. `BOX_MAX_HEIGHT` is a ceiling, not a target. The drawn size
comes from the camera and is a few hundred pixels at most, so a plate that
arrives smaller than the ceiling is left at its own resolution -- blowing it up
would ship a bigger, blurrier file carrying no more detail than the source had.
"""

import os
import sys
from collections import deque

from PIL import Image

DEFAULT_PLATE = "art/dealers/claira.jpg"
OUT_PATH = "public/table2d5/dealer.webp"
MANIFEST = "lib/scene/dealer-art.generated.ts"

# Background flood thresholds. See the module note -- none of these is a knob.
DARK_MAX_LOSSLESS = 1
DARK_MAX_LOSSY = 6
LIGHT_MIN = 200

LOSSY_SUFFIXES = (".jpg", ".jpeg")

# Ceiling on the normalised box's height, never a target -- see the module
# note. Only the ratio reaches the app; the drawn size comes from the camera.
BOX_MAX_HEIGHT = 794

# The head is centred on this band of the image, alpha-weighted. The top third
# is head and hair on any plate framed the way the docstring requires, and
# weighting by alpha rather than taking the bounding box's middle is what keeps
# a ponytail from dragging the face off centre.
HEAD_BAND = 0.35

WEBP_QUALITY = 96


def luma(pixel):
    r, g, b = pixel
    return (r * 299 + g * 587 + b * 114) // 1000


def background_test(rgb, size, lossy):
    """Which pixels count as plate, and a word for what was decided."""
    w, h = size
    border = [luma(rgb[x, y]) for x in range(w) for y in (0, h - 1)]
    border += [luma(rgb[x, y]) for y in range(h) for x in (0, w - 1)]
    border.sort()

    if border[len(border) // 2] >= 128:
        return (lambda x, y: luma(rgb[x, y]) >= LIGHT_MIN), f"light, luma >= {LIGHT_MIN}"

    cut = DARK_MAX_LOSSY if lossy else DARK_MAX_LOSSLESS
    kind = "lossy" if lossy else "lossless"
    return (lambda x, y: luma(rgb[x, y]) <= cut), f"dark {kind}, luma <= {cut}"


def figure_band(rgb, size, is_background):
    """The tallest run of rows holding anything but plate.

    A labelled sheet puts a boxed title above the figure and a caption below
    it; both are short bands, so the figure wins on height without anything
    having to know they exist. A plain plate yields the whole image.
    """
    w, h = size
    rows = [any(not is_background(x, y) for x in range(w)) for y in range(h)]
    runs = []
    start = None
    for y, occupied in enumerate(rows):
        if occupied and start is None:
            start = y
        elif not occupied and start is not None:
            runs.append((start, y - 1))
            start = None
    if start is not None:
        runs.append((start, h - 1))
    if not runs:
        raise SystemExit("nothing but background on this plate -- is it solid?")
    return max(runs, key=lambda run: run[1] - run[0])


def largest_island(bg, size):
    """Keep only the biggest connected piece of foreground."""
    w, h = size
    seen = bytearray(w * h)
    best = None
    for sy in range(h):
        for sx in range(w):
            if bg[sy * w + sx] or seen[sy * w + sx]:
                continue
            stack = [(sx, sy)]
            seen[sy * w + sx] = 1
            island = []
            while stack:
                x, y = stack.pop()
                island.append(y * w + x)
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not bg[j] and not seen[j]:
                            seen[j] = 1
                            stack.append((nx, ny))
            if best is None or len(island) > len(best):
                best = island
    keep = bytearray(w * h)
    for i in best:
        keep[i] = 1
    dropped = sum(1 for i in range(w * h) if not bg[i] and not keep[i])
    if dropped:
        print(f"  strays     -> dropped {dropped} px outside the figure")
    return bytearray(0 if keep[i] else 1 for i in range(w * h))


def cutout(path):
    """Key a plate to RGBA and trim it to the figure."""
    im = Image.open(path).convert("RGBA")
    alpha = im.split()[-1]

    # An already-cut-out plate keeps its own alpha; only a solid plate is keyed.
    if alpha.getextrema()[0] != 255:
        box = alpha.getbbox()
        if box is None:
            raise SystemExit(f"{path}: the supplied alpha is empty")
        return im.crop(box)

    lossy = path.lower().endswith(LOSSY_SUFFIXES)
    rgb = im.convert("RGB").load()
    is_background, how = background_test(rgb, im.size, lossy)
    print(f"  plate      -> {how}")

    top, bottom = figure_band(rgb, im.size, is_background)
    if (top, bottom) != (0, im.size[1] - 1):
        print(f"  sheet      -> figure band is rows {top}-{bottom}, captions out-grown")

    w = im.size[0]
    h = bottom - top + 1
    bg = bytearray(w * h)
    q = deque()

    def push(x, y):
        i = y * w + x
        if not bg[i] and is_background(x, y + top):
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

    bg = largest_island(bg, (w, h))
    alpha = Image.frombytes("L", (w, h), bytes(255 - v * 255 for v in bg))
    box = alpha.getbbox()
    if box is None:
        raise SystemExit(f"{path}: nothing left after the key -- is the plate solid?")

    band = im.crop((0, top, w, bottom + 1))
    band.putalpha(alpha)
    return band.crop(box)


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
    print(f"  figure     -> {art.size[0]}x{art.size[1]} as supplied")

    # Down to the ceiling if it is over it, never up to it. See the module note.
    if art.size[1] > BOX_MAX_HEIGHT:
        width = max(1, round(art.size[0] * BOX_MAX_HEIGHT / art.size[1]))
        art = art.resize((width, BOX_MAX_HEIGHT), Image.LANCZOS)
        print(f"  scaled     -> {width}x{BOX_MAX_HEIGHT} (ceiling {BOX_MAX_HEIGHT})")

    width, box_height = art.size
    centre = head_centre(art)

    # The box is the smallest that holds the figure centred on her own head, so
    # the head lands dead centre of the file and the slot needs no per-plate
    # offset to place it.
    half = max(centre, width - centre)
    box_width = 2 * int(-(-half // 1))

    canvas = Image.new("RGBA", (box_width, box_height), (0, 0, 0, 0))
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
export const DEALER_BOX = {{ width: {box_width}, height: {box_height} }} as const;
""")
    print(f"  manifest   -> {MANIFEST}  (box {box_width}x{box_height})")


if __name__ == "__main__":
    main()
