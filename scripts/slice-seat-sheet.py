#!/usr/bin/env python3
"""Cut a supplied turnaround SHEET into the per-angle plates prepare-seat-art.py eats.

    scripts/slice-seat-sheet.py [--mirror] <sheet.jpg|png> <character-id> [angle,angle,...]

The characters arrive as one image holding the whole turnaround side by side on
a black plate, usually with a caption above and below each panel ("ANGLE 20
(THREE-QUARTER)"). prepare-seat-art.py wants `art/seats/<id>/<angle>.png`, one
figure per file, so something has to do the cutting -- doing it by hand in an
editor is how a panel ends up a few pixels off and a character's angles stop
sharing a frame.

WHAT IT DOES
  - Finds the figure band as the TALLEST run of non-black rows. Captions are
    short bands; the figures are the tall one. That is the whole trick, and it
    means the captions never have to be located or matched, only out-grown.
  - Splits that band into panels on the black gutters between them, then keys
    each panel on its own.
  - Keys by CONNECTIVITY, flooding in from the panel border, same recipe as
    prepare-seat-art.py -- but at luma <= 6 rather than <= 1, because these
    sheets arrive as JPEG and the "black" plate carries ringing up around 6.
    A colour key at any threshold eats the dark hair and the black chair back;
    see the seat/dealer scripts' own notes.
  - Reads the plate's DIRECTION off its border ring, black or white, the same
    way prepare-dealer.py does -- it's a fact about the file, not a flag. A
    white plate floods at luma >= 200 instead. Sheets have arrived both ways
    (character36's was white where every earlier one was black), and a white
    sheet's sticker-style outline is flooded away with the plate, leaving the
    cut on the illustration's own dark outline.
  - Drops every stray island but the figure. JPEG ringing across a gutter
    leaves specks that would otherwise widen the plate's box for nothing.

WHICH WAY THE SHEET TURNS -- CHECK THIS BEFORE RUNNING
  The app's whole seat system assumes one turn convention: a rising angle turns
  the face toward screen-LEFT, so the un-mirrored plate serves a seat sitting to
  the dealer's right and lib/scene/seat-art.ts flips it with CSS for a seat on
  the other side. A sheet that turns the other way is not a little bit off -- it
  faces AWAY from the pot at every seat it lands in, and no code flag fixes that
  for one character without splitting the convention in two. Open the widest
  panel: if the chair back is on the figure's screen-LEFT and the profile looks
  screen-right, pass --mirror and it comes in the right way round. (This is how
  character13-21 arrived; they were mirrored on 2026-08-21 and rebuilt.)

The output is RGBA with real alpha, which prepare-seat-art.py detects and
passes through instead of re-keying (its own luma <= 1 flood would not survive
the JPEG noise). Run that script afterwards to build the webps and manifest.
"""

import os
import sys
from collections import deque

import numpy as np
from PIL import Image

OUT_ROOT = "art/seats"
DEFAULT_ANGLES = (0, 20, 40)

# Black-plate tolerance. JPEG ringing on these sheets tops out around 6; the
# darkest real ink (hair, the chair) sits well above it.
LUMA_MAX = 6
# White-plate tolerance, same number prepare-dealer.py measured on the one
# light plate it has seen: anywhere from 245 down to 200 keeps the same pixels
# to within 0.17%, because these illustrations carry a hard dark outline all
# the way round, so a looser cut lands on the outline rather than on a rim of
# near-white JPEG ringing.
LIGHT_MIN = 200
# How far past the plate's own threshold a pixel has to be before it counts as
# content when finding the figure band and the gutters -- stricter than the
# flood, so ringing can't stretch a band or bridge a gutter.
CONTENT_MARGIN = 6
# A row/column counts as "content" only past this many lit pixels, so a single
# stray speck can't bridge a gutter or stretch the band.
MIN_RUN_PIXELS = 3
MARGIN = 10
# When panels touch and the seam has to be found rather than read off a gutter,
# ignore this fraction of the run at each end -- a figure thins to nothing at
# its own edges, so the darkest column there is the edge, not the seam.
SEAM_SEARCH_INSET = 0.2


def plate_is_light(luma):
    """Read the plate's direction off its border ring rather than a flag.

    Sheets have arrived both ways (black plates through character35, then a
    white one), and which it is is a fact about the file, not a choice.
    """
    border = np.concatenate([luma[0, :], luma[-1, :], luma[:, 0], luma[:, -1]])
    return np.median(border) >= 128


def plate_masks(luma, light):
    """(what the flood may cross, what counts as content) for this plate."""
    if light:
        return luma >= LIGHT_MIN, luma < LIGHT_MIN - CONTENT_MARGIN
    return luma <= LUMA_MAX, luma > LUMA_MAX + CONTENT_MARGIN


def luma_of(im):
    a = np.asarray(im.convert("RGB")).astype(int)
    return (a[:, :, 0] * 299 + a[:, :, 1] * 587 + a[:, :, 2] * 114) // 1000


def split_touching(spans, counts, wanted):
    """Subdivide runs that hold more than one panel, until there are `wanted`.

    Some sheets are laid out with no gutter at all between a pair of panels --
    a shoulder from one overlapping the next -- so the gutter split hands back
    fewer runs than there are angles. The seam is still the darkest column in
    that run, so cut the WIDEST run there and repeat. Only the middle of a run
    is considered, or the "seam" lands just inside the run's own edge, where
    the figure has already thinned out to nothing.

    character33 (2026-08-22) and character36 both needed this; it was done by
    hand the first time.
    """
    spans = list(spans)
    seams = []
    while len(spans) < wanted:
        widest = max(range(len(spans)), key=lambda i: spans[i][1] - spans[i][0])
        x0, x1 = spans[widest]
        inset = int((x1 - x0) * SEAM_SEARCH_INSET)
        lo, hi = x0 + inset, x1 - inset
        if hi - lo < 2:
            raise SystemExit("no room left to split a run -- check the sheet's layout")
        seam = lo + int(np.argmin(counts[lo:hi]))
        seams.append(seam)
        spans[widest : widest + 1] = [(x0, seam), (seam, x1)]
    return spans, sorted(seams)


def runs(counts):
    """Contiguous [start, end) spans where counts is over the noise floor."""
    spans = []
    start = None
    for i, v in enumerate(counts):
        lit = v > MIN_RUN_PIXELS
        if lit and start is None:
            start = i
        elif not lit and start is not None:
            spans.append((start, i))
            start = None
    if start is not None:
        spans.append((start, len(counts)))
    return spans


def key_panel(panel, light):
    """Flood the plate in from the border, then keep only the figure."""
    luma = luma_of(panel)
    h, w = luma.shape
    dark, _ = plate_masks(luma, light)
    bg = np.zeros((h, w), bool)
    q = deque()

    def push(x, y):
        if 0 <= x < w and 0 <= y < h and not bg[y, x] and dark[y, x]:
            bg[y, x] = True
            q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)
    while q:
        x, y = q.popleft()
        push(x - 1, y)
        push(x + 1, y)
        push(x, y - 1)
        push(x, y + 1)

    kept = ~bg
    label = np.zeros((h, w), np.int32)
    best_size = 0
    best_label = 0
    current = 0
    for sy in range(h):
        for sx in range(w):
            if not kept[sy, sx] or label[sy, sx]:
                continue
            current += 1
            size = 0
            stack = [(sx, sy)]
            label[sy, sx] = current
            while stack:
                x, y = stack.pop()
                size += 1
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h and kept[ny, nx] and not label[ny, nx]:
                        label[ny, nx] = current
                        stack.append((nx, ny))
            if size > best_size:
                best_size, best_label = size, current

    if not best_size:
        raise SystemExit("panel keyed to nothing -- is the plate really one flat colour?")

    rgba = np.dstack([np.asarray(panel.convert("RGB")), np.where(label == best_label, 255, 0).astype(np.uint8)])
    out = Image.fromarray(rgba, "RGBA")
    return out.crop(out.getbbox()), best_size, current - 1


def main():
    argv = [a for a in sys.argv[1:] if a != "--mirror"]
    mirror = len(argv) != len(sys.argv) - 1
    if len(argv) < 2:
        raise SystemExit(f"usage: {sys.argv[0]} [--mirror] <sheet> <character-id> [angle,angle,...]")
    sheet_path, char_id = argv[0], argv[1]
    angles = [int(a) for a in argv[2].split(",")] if len(argv) > 2 else list(DEFAULT_ANGLES)

    sheet = Image.open(sheet_path)
    luma = luma_of(sheet)
    light = plate_is_light(luma)
    _, lit = plate_masks(luma, light)

    bands = runs(lit.sum(axis=1))
    if not bands:
        raise SystemExit(f"{sheet_path}: nothing on the plate")
    top, bottom = max(bands, key=lambda b: b[1] - b[0])

    counts = lit[top:bottom].sum(axis=0)
    columns = runs(counts)
    if len(columns) > len(angles):
        raise SystemExit(
            f"{sheet_path}: found {len(columns)} panel(s) in the figure band but {len(angles)} angle(s) "
            f"were asked for -- pass the angles explicitly, or check the sheet's gutters"
        )
    columns, seams = split_touching(columns, counts, len(angles))

    out_dir = os.path.join(OUT_ROOT, char_id)
    os.makedirs(out_dir, exist_ok=True)
    print(f"{sheet_path}: {'white' if light else 'black'} plate, figure band rows {top}-{bottom}, "
          f"{len(columns)} panel(s)"
          + (f", {len(seams)} touching seam(s) cut at {seams}" if seams else "")
          + (", mirrored to the screen-left turn convention" if mirror else ""))
    for angle, (x0, x1) in zip(angles, columns):
        panel = sheet.crop((
            max(0, x0 - MARGIN),
            max(0, top - MARGIN),
            min(sheet.width, x1 + MARGIN),
            min(sheet.height, bottom + MARGIN),
        ))
        art, size, strays = key_panel(panel, light)
        # Per panel, not per sheet: mirroring the whole sheet would also reverse
        # the panel ORDER, handing 40deg's plate to the 0deg slot.
        if mirror:
            art = art.transpose(Image.FLIP_LEFT_RIGHT)
        dest = os.path.join(out_dir, f"{angle}.png")
        art.save(dest)
        print(f"  {angle:<3d} -> {dest}  {art.size[0]}x{art.size[1]}, {size} px kept, {strays} stray island(s) dropped")
    print("now run scripts/prepare-seat-art.py")


if __name__ == "__main__":
    main()
