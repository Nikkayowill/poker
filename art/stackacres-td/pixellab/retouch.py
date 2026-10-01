#!/usr/bin/env python3
"""Hand fixes to PixelLab faces, applied as pixel edits over the pristine source.

PixelLab drew some faces without enough contrast to read at 48x48. The worst
cases are characters whose skin `build.py` recolours brown: their pupils were
drawn dark against light skin, and once the skin goes brown the pupil and the
skin land on nearly the same value, so the face reads as a smear.

The fix is what a pixel artist does at this size: put one light pixel beside
each pupil. Eyes then read as a light/dark pair whatever the skin tone. Kept to
single named pixels rather than any kind of filter, so every change here is one
decision that can be read off the page and undone.

`source/` is never written. This writes `retouch/<name>/rotations/<view>.png`,
which `build.py` loads in place of the source file. Colours are source colours,
before `brown()` runs.

Run: python3 art/stackacres-td/pixellab/retouch.py
Then: python3 art/stackacres-td/pixellab/build.py
"""
import colorsys
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "source")
RETOUCH = os.path.join(HERE, "retouch")

# An off-white that is not a skin hue, so brown() leaves it alone. Slightly warm
# and below pure white so it does not glare on a 48px face.
SCLERA = (216, 207, 196, 255)
# Each character's own darkest brown and own mid skin tone, taken from their
# sprite so a fix never introduces a colour the artwork did not already use.
PUPIL = (58, 32, 29, 255)
WES_SKIN = (225, 172, 157, 255)
PILGRIM_SKIN = (237, 162, 143, 255)

# (character, view): [(x, y, colour), ...]. Coordinates are source-image pixels.
# Every entry says which feature it is building.
EDITS = {
    ("ray", "south"): [
        (21, 13, SCLERA),   # left eye, light side
        (24, 13, SCLERA),   # right eye, light side
    ],
    ("ray", "east"): [
        (27, 13, SCLERA),   # the one visible eye
    ],
    # Wes had no eyes at all: the rows under his hat brim were asymmetric shadow
    # noise, and a light grey block sat mid-face where a mouth should be. Nobody
    # gets a drawn mouth; at this size it reads as a smudge, and Stardew leaves
    # it off too. His skin is light, so the eyes are pupils only. A sclera beside
    # them reads as a stare, which is why only the brown-skinned faces get one.
    ("wes", "south"): [
        (22, 14, PUPIL),    # left eye
        (25, 14, PUPIL),    # right eye
        (23, 16, WES_SKIN), (24, 16, WES_SKIN),   # clear the grey smudge
        (21, 14, WES_SKIN), (24, 14, WES_SKIN),   # and the brim noise beside each eye
    ],
    # The Pilgrim's left eye was swallowed by a vertical hood shadow running down
    # x=22, so the face read as a blank blob with a stripe. Trim the stripe back
    # to one pixel and it becomes an eye that matches the right one.
    ("pilgrim", "south"): [
        (22, 12, PILGRIM_SKIN), (22, 14, PILGRIM_SKIN),   # cut the stripe to eye height
        (21, 13, SCLERA), (24, 13, SCLERA),               # light side of each eye
    ],
    # Brayden's eyes were drawn dark on light skin, then brown() moved his skin
    # down onto them. Same fix as Ray.
    ("brayden", "south"): [
        (21, 14, SCLERA),   # left eye, light side
        (24, 14, SCLERA),   # right eye, light side
    ],
}


# Characters PixelLab drew almost flat: one colour per garment, so a shirt or an
# apron is a single block with no form. Counted on their front standing frame.
# The farmer and Ray carry 48 and 40 colours and are left alone.
FLAT = {"wes": 15, "leo": 18, "miles": 18, "pierre": 19, "bea": 20}
# A region has to be this big before it gets a shadow, so a drawn detail, an eye
# or a single-pixel highlight is never mistaken for a garment.
MIN_REGION = 14


def darker(rgb):
    """One shadow step: a little darker, a little more saturated, hue toward blue.

    This is the hue shift a pixel artist uses rather than a straight multiply,
    which goes muddy. One step only. It is never used to build a gradient.
    """
    h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in rgb])
    out = colorsys.hls_to_rgb((h - 0.02) % 1.0, max(0.0, l - 0.10), min(1.0, s * 1.05))
    return tuple(round(v * 255) for v in out)


def shade(img):
    """Darken the bottom edge of each large flat region, so garments get form.

    Only the lowest row of a colour in each column, and only where more of the
    same colour sits above it, so the shadow follows the shape the artist drew
    instead of being painted from a light vector.
    """
    a = np.array(img)
    out = a.copy()
    opaque = a[:, :, 3] > 0
    for colour in {tuple(v) for v in a[opaque]}:
        region = np.all(a == np.array(colour), axis=2) & opaque
        if region.sum() < MIN_REGION:
            continue
        shadow = darker(colour[:3])
        for x in range(a.shape[1]):
            ys = np.where(region[:, x])[0]
            if len(ys) and region[:ys[-1], x].any():
                out[ys[-1], x, :3] = shadow
    return Image.fromarray(out, "RGBA")


# Stardew draws a 16x32 character on a 16x16 tile, so a body is about 1.9 tiles
# tall. Our tiles are 16 too, which puts the target at 31 pixels. The farmer is
# already 31; PixelLab drew the rest of the cast at 33 to 37, which is where
# "the characters are too big" comes from.
BODY_HEIGHT = 31
# Rows from the top of the body that are head and face. Never cut, so a shrink
# never touches an eye.
HEAD_GUARD = 17
# Cut rows stay this far apart, or the run of plain trousers scores as the most
# redundant thing on the sprite and the character loses its legs.
CUT_SPACING = 3


def shorten(img, target=BODY_HEIGHT):
    """Bring a body down to `target` rows by deleting its most redundant rows.

    Removing whole rows keeps every remaining pixel exactly as drawn, where
    resampling to 0.87 would blur the art and lose the one-pixel eyes. A row is
    redundant when it is nearly a copy of the row above it, which is true of a
    plain trouser leg or a run of coat, and false of a belt, a cuff or a hem.
    The result is bottom-aligned so the feet stay on the row build.py anchors to.
    """
    a = np.array(img)
    rows = np.where((a[:, :, 3] > 0).any(axis=1))[0]
    cut = (rows.max() - rows.min() + 1) - target
    if cut <= 0:
        return img
    ranked = sorted((np.abs(a[r].astype(int) - a[r - 1].astype(int)).sum(), r)
                    for r in range(rows.min() + HEAD_GUARD, rows.max()))
    chosen = []
    for _, r in ranked:
        if len(chosen) == cut:
            break
        if all(abs(r - c) >= CUT_SPACING for c in chosen):
            chosen.append(r)
    for _, r in ranked:                       # if spacing was too strict, fill up
        if len(chosen) == cut:
            break
        if r not in chosen:
            chosen.append(r)
    out = np.zeros_like(a)
    out[cut:] = a[[r for r in range(a.shape[0]) if r not in chosen]]
    return Image.fromarray(out, "RGBA")


def retouched(name, view):
    """Source image plus this character's face edits, shrink and shading.

    Face edits run first, on source coordinates, because `shorten` only ever
    deletes rows below the head, so the eyes travel with it.
    """
    img = Image.open(os.path.join(SOURCE, name, "rotations", f"{view}.png")).convert("RGBA")
    px = img.load()
    for x, y, colour in EDITS.get((name, view), []):
        if px[x, y][3] == 0:
            raise SystemExit(f"{name}/{view}: ({x},{y}) is transparent, so that is not on the face")
        px[x, y] = colour
    img = shorten(img) if name != "farmer" else img
    return shade(img) if name in FLAT else img


def main():
    names = sorted(n for n in os.listdir(SOURCE) if os.path.isdir(os.path.join(SOURCE, n)))
    views = [(n, v) for n in names if n != "farmer" for v in ("south", "east", "north")]
    for name, view in views:
        dst = os.path.join(RETOUCH, name, "rotations", f"{view}.png")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        retouched(name, view).save(dst)
    faces = sum(len(e) for e in EDITS.values())
    print(f"retouched {len(views)} views: {faces} face pixels, "
          f"{len(names) - 1} shrunk to {BODY_HEIGHT}px, {len(FLAT)} shaded")


if __name__ == "__main__":
    main()
