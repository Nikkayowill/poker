"""The Homestead's hill: a grass-topped earth face from the LPC cliff set.

Stardew's farm has a hill along its north edge, and that hill is what makes
the top of the map read as a place with an edge rather than a wall of trees:
a band of brown earth face under a lip of grass, with a cave mouth in it and
a path that leaves through it. This builds the same thing from
art/stackacres-td/lpc/terrain/LPC_cliffs_grass.png (CC-BY-SA 3.0 / GPL 3.0,
credited in Attribution.txt), which is Sharm's LPC cliffs with a grass top.

The sheet is a handful of drawn pieces, not an autotile, so a long face is
laid the way a mason lays a wall: an interior slice of the face repeated
across with a little jitter so the cracks never line up, a straight grass lip
along the top, drawn ends at the west and east from the sheet's own rounded
column, and the cave mouth piece dropped in where the path goes in.

Handed to the rig as a half-size stand-in carrying the full drawing, like
lpc_trees.py, and laid as GROUND: it is the edge of the land, not a thing
standing on it, so nothing casts a shadow off it and the trees on top draw
over it. The tiles it covers are walled off by the area script.

Pure: pictures in, pictures out.
"""
import os

import numpy as np
from PIL import Image

SHEET = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lpc", "terrain", "LPC_cliffs_grass.png")
SCALE = 0.5

# Pixel boxes on the sheet (x, y, w, h), found by scanning it for separate drawings.
COLUMN = (171, 10, 75, 130)        # a grass-domed column: rounded grass top, face, ragged sides
CAVE = (32, 150, 68, 85)           # a cave mouth under a straight grass lip, with its own face either side
LIP = (104, 160, 68, 28)           # a straight run of grass lip: the dark edge and the blades over the face
FACE_SLICE = (184, 60, 48, 78)     # the solid interior of the column's face; its two edges match closely
FACE_H = 108                       # how tall the face is drawn, pack px: the slice and half of it again, stacked
FOOT_SHADOW = 12                   # pack px of soft shadow laid on the ground at the foot of the face
# The sheet's own flat grass, which is NOT this map's grass: everything above the lip's dark edge is
# cut away so the map's ground shows there instead, and only the edge and the hanging blades stay.
FRINGE = {(0, 107, 70), (0, 67, 55)}

_sheet = None


def sheet():
    global _sheet
    if _sheet is None:
        _sheet = Image.open(SHEET).convert("RGBA")
    return _sheet


def _cut(box):
    x, y, w, h = box
    return sheet().crop((x, y, x + w, y + h))


def _hash(a, b, seed=0):
    h = (a * 374761393 + b * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296


def _lip_only(img):
    """The piece with the sheet's flat grass above its dark edge cut away, column by column."""
    arr = np.array(img)
    for x in range(arr.shape[1]):
        col = arr[:, x]
        edge = [y for y in range(arr.shape[0]) if col[y, 3] and tuple(col[y, :3]) in FRINGE]
        if edge:
            col[:edge[0], 3] = 0
    return Image.fromarray(arr, "RGBA")


def _half(img):
    return img.resize((max(1, round(img.width * SCALE)), max(1, round(img.height * SCALE))), Image.LANCZOS)


def _made(hires, base):
    """(stand-in picture, its base point), carrying the full drawing for the export to lay at scale 0.5."""
    proxy = _half(hires)
    proxy.info["hires"] = {"img": hires, "scale": SCALE}
    return proxy, (round(base[0] * SCALE), round(base[1] * SCALE))


def _tall_face(piece, height):
    """The face slice stacked on itself to `height`, the upper copy feathered into the lower over 8px."""
    out = Image.new("RGBA", (piece.width, height))
    out.alpha_composite(piece, (0, height - piece.height))
    upper = np.array(piece.transpose(Image.FLIP_TOP_BOTTOM).transpose(Image.FLIP_LEFT_RIGHT))
    cut = height - piece.height + 8
    upper = upper[piece.height - cut:]
    upper[-8:, :, 3] = (upper[-8:, :, 3] * np.linspace(1, 0.1, 8)[:, None]).astype(np.uint8)
    out.alpha_composite(Image.fromarray(upper, "RGBA"), (0, 0))
    return out


def hill_face(width, cave_at=None, seed=0):
    """A south-facing hill edge `width` PACK px wide, base point at its bottom-left corner.

    `cave_at` puts the cave mouth with its middle that many pack px from the
    west end. The picture is the face plus the lip over it and the foot shadow
    under it; the hill's top is the map's own grass carrying on behind the lip.
    """
    lip, cave = _lip_only(_cut(LIP)), _lip_only(_cut(CAVE))
    face = _tall_face(_cut(FACE_SLICE), FACE_H)
    column = _cut(COLUMN)
    top = 10                                         # room over the face for the lip
    h = top + face.height + FOOT_SHADOW
    img = Image.new("RGBA", (width, h))
    # The face: the seamless slice laid end to end, each one a pixel up or down so the cracks stagger.
    # Every other slice is mirrored and each is feathered into the last over 6px, so no seam shows.
    x, n = 0, 0
    while x < width:
        piece = face.transpose(Image.FLIP_LEFT_RIGHT) if n % 2 else face
        if n:
            arr = np.array(piece)
            arr[:, :6, 3] = (arr[:, :6, 3] * np.linspace(0.1, 1, 6)[None, :]).astype(np.uint8)
            piece = Image.fromarray(arr, "RGBA")
        img.alpha_composite(piece, (x, top + int(_hash(n, seed, 3) * 3) - 1))
        x += face.width - 6
        n += 1
    # The ends: the column's own ragged silhouette, so the face does not stop at a ruler line.
    left = column.crop((0, 50, 4, column.height))
    right = column.crop((column.width - 4, 50, column.width, column.height))
    img.alpha_composite(left, (0, top + face.height - left.height))
    img.alpha_composite(right, (width - right.width, top + face.height - right.height))
    # The foot: the face's bottom row nibbled so it is not a ruler line, then a soft shadow on the
    # ground below it, darkest where it meets the earth.
    arr = np.array(img)
    for x in range(width):
        nib = int(_hash(x, seed, 6) * 3)
        arr[top + face.height - 2 - nib:top + face.height + 1, x, 3] = 0
    y0 = top + face.height - 3
    for i in range(FOOT_SHADOW + 3):
        a = int(170 * (1 - i / (FOOT_SHADOW + 3)) ** 1.4)
        row = arr[y0 + i]
        under = row[..., 3] < 40
        row[under] = (20, 24, 12, a)
    img = Image.fromarray(arr, "RGBA")
    # The lip along the top: the same run repeated, jittered sideways so the blades never line up.
    x, n = -int(_hash(seed, 1, 4) * 30), 0
    while x < width:
        img.alpha_composite(lip, (x, top - 8 + int(_hash(n, seed, 5) * 2)))
        x += lip.width - 6
        n += 1
    if cave_at is not None:
        cx = int(cave_at - cave.width / 2)
        img.alpha_composite(cave, (cx, top + face.height - cave.height + 2))
    return _made(img, (0, top + face.height))


def cave_floor_offset():
    """How far the cave's floor (where the path goes in) sits above the face's foot, in map px."""
    return 4
