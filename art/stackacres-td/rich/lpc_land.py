"""The rocks and brush on the Homestead's wild land, built from LPC terrain pieces.

Writes public/stackacres-td/common/land-*.png, drawn by the engine at half size:
    python3 art/stackacres-td/rich/lpc_land.py
"""

import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
ATLAS = os.path.join(os.path.dirname(HERE), "lpc", "terrain", "terrain_atlas.png")
OUT = os.path.join(REPO, "public", "stackacres-td", "common")

# Pieces of the pack, by pixel box (found by scanning the atlas for separate drawings).
GREY_ROCK = (926, 768, 36, 27)
GREY_LUMP = (834, 803, 28, 27)
TAN_ROCK = (768, 676, 31, 22)
TAN_LUMP = (674, 675, 28, 27)
PEBBLES_GREY = [(869, 816, 15, 11), (864, 804, 9, 7), (930, 744, 10, 7), (937, 757, 11, 6), (898, 808, 10, 7)]
PEBBLES_TAN = [(709, 688, 15, 11), (738, 680, 10, 7), (745, 693, 11, 6), (704, 676, 9, 7)]
BUSH = (289, 448, 31, 30)
STUMP = (740, 582, 25, 19)
OLD_STUMP = (391, 395, 50, 41)
SHOOTS = [(295, 814, 18, 15), (328, 818, 11, 15), (295, 839, 19, 21), (328, 842, 12, 20), (357, 809, 18, 21)]
BRAMBLE = (192, 768, 32, 32)
# Tall grass is laid in 32px tiles, so its top row stacked on its bottom row makes a clump with no seam.
TALL_GRASS_COLUMNS = {"one": 256, "left": 288, "middle": 320, "right": 352}
TALL_GRASS_TOP, TALL_GRASS_MIDDLE, TALL_GRASS_BOTTOM = 512, 544, 608

_atlas = None


def atlas():
    global _atlas
    if _atlas is None:
        _atlas = Image.open(ATLAS).convert("RGBA")
    return _atlas


def cut(box, flip=False, whole=False):
    """One drawing off the atlas; `whole` drops bits of neighbouring drawings the box catches."""
    x, y, w, h = box
    img = atlas().crop((x, y, x + w, y + h))
    if whole:
        arr = np.array(img)
        labels, count = ndimage.label(arr[..., 3] > 0, structure=np.ones((3, 3)))
        if count > 1:
            sizes = ndimage.sum(np.ones(labels.shape), labels, range(1, count + 1))
            arr[labels != 1 + int(np.argmax(sizes)), 3] = 0
            img = Image.fromarray(arr, "RGBA")
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    return img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img


def tall_grass(columns, rows=1):
    """A tall grass clump, `columns` wide, with `rows` - 1 middle rows."""
    band = [TALL_GRASS_TOP] + [TALL_GRASS_MIDDLE] * (rows - 1) + [TALL_GRASS_BOTTOM]
    img = Image.new("RGBA", (32 * len(columns), 32 * len(band)))
    for i, column in enumerate(columns):
        x = TALL_GRASS_COLUMNS[column]
        for j, y in enumerate(band):
            img.alpha_composite(atlas().crop((x, y, x + 32, y + 32)), (32 * i, 32 * j))
    return img.crop(img.getbbox())


def shadow(width, height=None):
    """The same soft blot the farmer casts."""
    height = height or max(4, width // 3)
    img = Image.new("RGBA", (width, height))
    px = img.load()
    for y in range(height):
        for x in range(width):
            d = ((x + 0.5 - width / 2) / (width / 2)) ** 2 + ((y + 0.5 - height / 2) / (height / 2)) ** 2
            if d <= 1:
                px[x, y] = (20, 12, 28, 76 if d < 0.55 else 44)
    return img


class Pile:
    """Pieces on one ground line: x from the tile's middle, y up from its bottom, back row first."""

    def __init__(self):
        self.pieces = []

    def add(self, img, x, y=0):
        self.pieces.append((img, x, y))
        return self

    def picture(self):
        half = max(max(abs(x - img.width / 2), abs(x + img.width / 2)) for img, x, _ in self.pieces)
        width = int(round(half * 2)) + 2
        height = max(img.height + y for img, _, y in self.pieces)
        canvas = Image.new("RGBA", (width, height))
        for img, x, y in self.pieces:
            canvas.alpha_composite(img, (int(round(width / 2 + x - img.width / 2)), height - y - img.height))
        return canvas


def boulders():
    """What the pick breaks: a rock with the weeds grown up round it."""
    return [
        Pile().add(shadow(34), 1, 0).add(cut(SHOOTS[2]), -9, 2).add(cut(GREY_ROCK, whole=True), 0).add(cut(PEBBLES_GREY[0]), 12)
        .add(cut(SHOOTS[1]), -13).picture(),
        Pile().add(shadow(30), 0, 0).add(cut(SHOOTS[4], True), 8, 3).add(cut(GREY_LUMP, whole=True), -2).add(cut(PEBBLES_GREY[3]), -14)
        .add(cut(SHOOTS[0]), 10).picture(),
        Pile().add(shadow(34), 1, 0).add(cut(SHOOTS[3]), 11, 3).add(cut(TAN_ROCK, True, whole=True), 0).add(cut(PEBBLES_TAN[0]), -13)
        .add(cut(SHOOTS[1], True), 5).picture(),
        Pile().add(shadow(30), 0, 0).add(cut(SHOOTS[2], True), -8, 3).add(cut(TAN_LUMP, whole=True), 1).add(cut(PEBBLES_TAN[1]), 13)
        .add(cut(SHOOTS[0], True), -10).picture(),
    ]


def scrub():
    """What the axe clears: tall grass, brambles, thickets and the stumps they grow out of."""
    return [
        # Tall grass standing on its own square.
        Pile().add(shadow(30), 0, 0).add(tall_grass(["one"]), 0).add(cut(SHOOTS[1]), 12).picture(),
        # A bramble grown up into a bush.
        Pile().add(shadow(36), 0, 0).add(cut(BUSH), 5, 3).add(cut(BRAMBLE, True), -6).add(cut(SHOOTS[0]), 12).picture(),
        # A thicket: two bushes grown into each other, grass at their feet.
        Pile().add(shadow(40), 0, 0).add(cut(BUSH, True), -7, 4).add(cut(BUSH), 7).add(cut(SHOOTS[0]), -12)
        .add(cut(SHOOTS[1]), 13).picture(),
        # A felled tree's stump, a bramble and shoots coming up round it.
        Pile().add(shadow(30), 0, 0).add(cut(BRAMBLE), 7, 4).add(cut(STUMP), -2, 1).add(cut(SHOOTS[3], True), -12)
        .add(cut(SHOOTS[1]), 9).picture(),
        # An old stump, roots and all, gone over with tall grass.
        Pile().add(shadow(44), 0, 0).add(tall_grass(["one"]), 8, 6).add(cut(OLD_STUMP), -2).add(cut(SHOOTS[0], True), -15)
        .picture(),
        # Tall grass round a young bush.
        Pile().add(shadow(38), 0, 0).add(tall_grass(["one"]), -7, 2).add(cut(BUSH), 6).add(cut(SHOOTS[4]), -12).picture(),
    ]


def land_art():
    """Every land picture by its texture name, in the order LAND_ART lists them."""
    named = {}
    for i, img in enumerate(boulders()):
        named[f"land-boulder-{i}"] = img
    for i, img in enumerate(scrub()):
        named[f"land-scrub-{i}"] = img
    return named


def main(out=OUT):
    os.makedirs(out, exist_ok=True)
    for name, img in land_art().items():
        img.save(os.path.join(out, f"{name}.png"))
        print(name, img.size)


if __name__ == "__main__":
    import sys

    main(sys.argv[1] if len(sys.argv) > 1 else OUT)
