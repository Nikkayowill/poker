"""The Homestead's terrace: a fieldstone retaining wall across the farm with a stone stair cut into it.

Laid tile by tile from the "Oblong Grey" cliff in bluecarrot16's [LPC] Mountains
(art/stackacres-td/lpc/mountains/, CC-BY-SA, credits in CREDITS-mountains.txt), using the
wide wall and the carved stair exactly as that template draws them side by side:

    wall column  sheet col 31: rows 59 (top course), 60 (face), 61 (foot)
    stair        sheet cols 32, 33, 34: the same three rows

Row 60 repeats to make the wall taller, and the stair's middle column repeats to make it wider;
both are drawn to join themselves.

The Oblong styles are one drawing in six colours, recoloured per style. This one is swapped
colour for colour onto the warm ramp of the same sheet's "Round Tan" stones, which step down in
value alongside the grey: the wall keeps the grey's darkness (a face darker than the grass it
rises from reads as standing up) in the warm stone of a farm wall.

Above the top course the template draws its own paving, its two lightest colours; each column is
cleared down to the first stone so the map's grass is the top of the wall. A short shadow, under a
tile, lies on the grass at the wall's foot.

Handed to the rig like lpc_cliffs: a half-size stand-in carrying the full drawing, laid as GROUND.

Pure: pictures in, pictures out.
"""
import os

import numpy as np
from PIL import Image

import lpc_cliffs

SHEET = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lpc", "mountains", "oblong_grey.png")
ORIGIN = (30, 49)                   # sheet tile the crop in oblong_grey.png starts at
WALL, STAIR_L, STAIR_M, STAIR_R = 31, 32, 33, 34
TOP, FACE, FOOT = 59, 60, 61
T = 32
# Oblong Grey's six colours, darkest first, and Round Tan's, matched by value.
GREY = [(48, 39, 50), (58, 49, 58), (75, 68, 76), (94, 82, 82), (126, 112, 104), (134, 126, 127)]
WARM = [(43, 28, 29), (62, 38, 19), (98, 53, 28), (116, 75, 48), (153, 107, 74), (174, 118, 75)]
PAVING = set(GREY[4:])
FOOT_SHADOW = 12                    # px of shadow on the grass under the wall

_sheet = None


def _tile(col, row):
    global _sheet
    if _sheet is None:
        _sheet = Image.open(SHEET).convert("RGBA")
    x, y = (col - ORIGIN[0]) * T, (row - ORIGIN[1]) * T
    return _sheet.crop((x, y, x + T, y + T))


def terrace(tiles_wide, stairs_from, stairs_wide, rows):
    """A wall `tiles_wide` tiles long and `rows` tiles tall (at least 3), with a stair `stairs_wide` tiles
    wide (at least 3) starting at tile `stairs_from`. Base point at the bottom-left corner of its tiles."""
    heights = [TOP] + [FACE] * (rows - 2) + [FOOT]
    img = Image.new("RGBA", (tiles_wide * T, rows * T + FOOT_SHADOW))
    for tx in range(tiles_wide):
        i = tx - stairs_from
        col = WALL if not 0 <= i < stairs_wide else STAIR_L if i == 0 else STAIR_R if i == stairs_wide - 1 else STAIR_M
        for ty, row in enumerate(heights):
            img.alpha_composite(_tile(col, row), (tx * T, ty * T))
    a = np.array(img)
    solid = a[..., 3] > 0
    rgb = [tuple(p) for p in a[..., :3].reshape(-1, 3)]
    paving = np.array([p in PAVING for p in rgb]).reshape(solid.shape) & solid
    for x in range(a.shape[1]):
        stone = np.nonzero(solid[:T, x] & ~paving[:T, x])[0]
        a[: stone[0] if len(stone) else T, x, 3] = 0
    for g, w in zip(GREY, WARM):
        a[(a[..., :3] == g).all(-1), :3] = w
    # The shadow at the foot, darkest against the stones, gone within FOOT_SHADOW px.
    for x in range(a.shape[1]):
        ys = np.nonzero(a[:, x, 3] > 0)[0]
        if len(ys):
            for k in range(FOOT_SHADOW):
                if ys[-1] + 1 + k < a.shape[0]:
                    a[ys[-1] + 1 + k, x] = (20, 24, 12, int(150 * (1 - k / FOOT_SHADOW) ** 1.4))
    return lpc_cliffs._made(Image.fromarray(a, "RGBA"), (0, rows * T))
