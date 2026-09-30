"""The City's street furniture and garden things from the licensed packs, in place of drawing them in code.

- LPC Revised (lpc/interior/, credited in its CREDITS.md): the street lamp, planters and topiary, flower pots,
  the rough table, barrels, crates, baskets, the water trough, bread, rolls of cloth and bins.
- The LPC terrain set (lpc/terrain/terrain_atlas.png and base_out_atlas.png, credited in its Attribution.txt):
  the headstone and the stone cross, lily pads, cattails and the stone birdbath.

Every piece is cut by its box on the sheet and trimmed to its drawing, and comes as the export takes the pack's
other pieces (lpc_props.py): a half-size stand-in with the full drawing in info["hires"], and its base point
where it meets the ground.
"""
import os

import numpy as np
from PIL import Image

import lpc_rooms
from lpc_trees import SCALE, _half

TERRAIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lpc", "terrain")
_atlases = {}


def _atlas(name):
    if name not in _atlases:
        _atlases[name] = Image.open(os.path.join(TERRAIN, name)).convert("RGBA")
    return _atlases[name]


def _trim(img):
    box = img.getbbox()
    return img.crop(box) if box else img


def _rev(rel, box):
    x, y, w, h = box
    return _trim(lpc_rooms.cut(rel, x, y, w, h))


def _terrain(box, sheet="terrain_atlas.png"):
    x, y, w, h = box
    return _trim(_atlas(sheet).crop((x, y, x + w, y + h)))


def made(hires, base=None, lights=()):
    """(stand-in, base point) for a full-detail piece; the base is the middle of its lowest row unless given."""
    if base is None:
        alpha = np.asarray(hires)[..., 3]
        bottom = int(np.nonzero(alpha.max(axis=1))[0][-1])
        base = (hires.width // 2, bottom)
    proxy = _half(hires)
    proxy.info["hires"] = {"img": hires, "scale": SCALE}
    if lights:
        proxy.info["lights"] = [(round(x * SCALE), round(y * SCALE), kind) for x, y, kind in lights]
    return proxy, (round(base[0] * SCALE), round(base[1] * SCALE))


# ---------------------------------------------------------------- LPC Revised

LAMP = ("Objects/Furniture/Lighting, Outdoors.png", (32, 0, 32, 84))
PLANTERS = {
    "fern_box": (0, 36, 32, 52), "tree_box": (32, 0, 32, 88), "topiary_urn": (64, 0, 32, 86),
    "urn": (96, 44, 32, 44), "fern_urn": (128, 36, 32, 52), "red_pot": (96, 0, 32, 32), "pink_pot": (128, 0, 32, 32),
}
FLOWERS = "Objects/Small Items/Flowers.png"


def street_lamp():
    """The pack's iron street lamp, its lantern dark by day; the engine lights it at dusk."""
    img = _rev(*LAMP)
    return made(img, lights=[(img.width // 2, 12, "lamp")])


def planter(kind):
    return made(_rev("Objects/Furniture/Planter.png", PLANTERS[kind]))


def flowers(k):
    """A bunch of flowers, nine colours: the ones laid on graves and set along the foot of a wall."""
    return made(_rev(FLOWERS, ((k % 9) * 32, 32, 32, 32)))


def potted_plant(k):
    return made(_rev(FLOWERS, (128, 64 + (k % 2) * 32, 32, 32)))


def table(shade=0):
    """A long rough table, dark, mid or pale."""
    return made(_rev("Objects/Furniture/Table, Rough Wood.png", ((0, 16, 96, 60), (0, 80, 96, 60), (0, 144, 96, 48))[shade]))


def barrel(k=0):
    return made(_rev("Objects/Furniture/Barrel.png", ((k % 3) * 32, 0, 32, 48)))


def barrels():
    return made(_rev("Objects/Furniture/Barrel.png", (96, 0, 64, 64)))


def crate(k=0):
    return made(_rev("Objects/Furniture/Crate.png", ((0, 0, 32, 32), (0, 32, 32, 32), (32, 32, 32, 32), (64, 32, 32, 32),
                                                    (0, 96, 32, 32), (32, 96, 32, 32))[k % 6]))


def basket(k=0):
    return made(_rev("Objects/Small Items/Baskets A.png", ((k % 3) * 32, 0, 32, 32)))


def water_trough():
    return made(_rev("Objects/Furniture/Trough.png", (64, 64, 64, 34)))


def bread(k=0):
    return _rev("Objects/Small Items/Food/Bread B.png", ((k % 6) * 32, 64, 32, 32))


def fabric_rolls(k=0):
    return made(_rev("Objects/Small Items/Fabric/Fabric Rolls, Groups.png",
                     ((0, 0, 32, 32), (0, 32, 32, 32), (32, 0, 32, 64), (64, 0, 32, 64))[k % 4]))


def bin_(k=0):
    return made(_rev("Objects/Furniture/Bin.png", ((64, 32, 32, 32), (96, 32, 32, 32), (64, 96, 32, 32))[k % 3]))


def bread_table():
    """The bakery's trestle out on the pavement: the pack's rough table heaped with its loaves."""
    top = _rev("Objects/Furniture/Table, Rough Wood.png", (0, 144, 96, 48))
    img = Image.new("RGBA", (top.width, top.height + 14))
    img.alpha_composite(top, (0, 14))
    for k, dx in ((2, 2), (0, 26), (5, 52)):
        loaf = bread(k)
        img.alpha_composite(loaf, (dx + (24 - loaf.width) // 2, max(0, 22 - loaf.height)))
    return made(img)


# ---------------------------------------------------------------- the LPC terrain set

def headstone():
    return made(_terrain((449, 672, 30, 56)))


def stone_cross():
    return made(_terrain((481, 672, 30, 56)))


LILIES = [(192, 961, 32, 52), (224, 962, 33, 62), (256, 962, 32, 58)]


def lily(k=0):
    return made(_terrain(LILIES[k % 3]))


def cattails():
    return made(_terrain((832, 924, 32, 60)))


def birdbath():
    return made(_terrain((544, 392, 32, 64), "base_out_atlas.png"))
