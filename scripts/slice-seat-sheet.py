#!/usr/bin/env python3
"""Cut a supplied turnaround SHEET into the per-angle plates prepare-seat-art.py eats.

    scripts/slice-seat-sheet.py <sheet.jpg|png> <character-id> [angle,angle,...]

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
  - Drops every stray island but the figure. JPEG ringing across a gutter
    leaves specks that would otherwise widen the plate's box for nothing.

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
# A row/column counts as "content" only past this many lit pixels, so a single
# stray speck can't bridge a gutter or stretch the band.
MIN_RUN_PIXELS = 3
MARGIN = 10


def luma_of(im):
    a = np.asarray(im.convert("RGB")).astype(int)
    return (a[:, :, 0] * 299 + a[:, :, 1] * 587 + a[:, :, 2] * 114) // 1000


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


def key_panel(panel):
    """Flood the black plate in from the border, then keep only the figure."""
    luma = luma_of(panel)
    h, w = luma.shape
    dark = luma <= LUMA_MAX
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
        raise SystemExit("panel keyed to nothing -- is the plate really black?")

    rgba = np.dstack([np.asarray(panel.convert("RGB")), np.where(label == best_label, 255, 0).astype(np.uint8)])
    out = Image.fromarray(rgba, "RGBA")
    return out.crop(out.getbbox()), best_size, current - 1


def main():
    if len(sys.argv) < 3:
        raise SystemExit(f"usage: {sys.argv[0]} <sheet> <character-id> [angle,angle,...]")
    sheet_path, char_id = sys.argv[1], sys.argv[2]
    angles = [int(a) for a in sys.argv[3].split(",")] if len(sys.argv) > 3 else list(DEFAULT_ANGLES)

    sheet = Image.open(sheet_path)
    luma = luma_of(sheet)
    lit = luma > LUMA_MAX * 2

    bands = runs(lit.sum(axis=1))
    if not bands:
        raise SystemExit(f"{sheet_path}: nothing on the plate")
    top, bottom = max(bands, key=lambda b: b[1] - b[0])

    columns = runs(lit[top:bottom].sum(axis=0))
    if len(columns) != len(angles):
        raise SystemExit(
            f"{sheet_path}: found {len(columns)} panel(s) in the figure band but {len(angles)} angle(s) "
            f"were asked for -- pass the angles explicitly, or check the sheet's gutters"
        )

    out_dir = os.path.join(OUT_ROOT, char_id)
    os.makedirs(out_dir, exist_ok=True)
    print(f"{sheet_path}: figure band rows {top}-{bottom}, {len(columns)} panel(s)")
    for angle, (x0, x1) in zip(angles, columns):
        panel = sheet.crop((
            max(0, x0 - MARGIN),
            max(0, top - MARGIN),
            min(sheet.width, x1 + MARGIN),
            min(sheet.height, bottom + MARGIN),
        ))
        art, size, strays = key_panel(panel)
        dest = os.path.join(out_dir, f"{angle}.png")
        art.save(dest)
        print(f"  {angle:<3d} -> {dest}  {art.size[0]}x{art.size[1]}, {size} px kept, {strays} stray island(s) dropped")
    print("now run scripts/prepare-seat-art.py")


if __name__ == "__main__":
    main()
