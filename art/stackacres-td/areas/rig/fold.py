#!/usr/bin/env python3
"""The Fold: a shaded mud hollow and the Sheep Pens, through Hen Haven's back gate.

28x22 tiles. The path runs east along the hollow to a fallen fence, the way on to the
Cattle Pasture. The wallow sits north of the path under a canvas canopy; the sheep pen
south of it.
"""
import creatures
import kit
import props
from area import Area

MW, MH = 28, 22


def build():
    a = Area("fold", MW, MH)
    a.line("path", (0, 11), (MW, 11))                  # in from Hen Haven, out over the fallen fence
    a.ellipse("mud", 15, 7, 5.2, 2.6)                  # the wallow
    a.ellipse("mud", 11, 8, 2.4, 1.6)

    for x, y, w in ((150, 118, 26), (200, 150, 20), (290, 96, 22), (310, 160, 28), (120, 146, 16)):
        a.add(props.puddle(w, w // 2 - 1), x, y, ground=True)
    a.add(props.canopy(), 240, 138, (34, 5))
    a.add(kit.reeds(), 100, 150)
    a.add(kit.reeds(), 330, 148)
    a.add(kit.rock(True), 340, 100, (5, 2))
    a.add(kit.rock(False), 130, 106, (5, 2))
    a.add(kit.trough(), 160, 140, (11, 2))

    a.add(kit.fence(208), 304, 210)                    # the sheep pen
    a.add(kit.fence(208), 304, 322)
    a.add(kit.fence(96, vertical=True), 195, 322)
    a.add(kit.fence(96, vertical=True), 413, 322)
    a.add(kit.hay_bale(), 380, 300, (9, 2))
    a.add(kit.trough(), 240, 300, (11, 2))
    for i, (x, y) in enumerate(((230, 250), (280, 280), (330, 240), (360, 275), (260, 310))):
        a.add(creatures.sheep(i % 2 == 0), x, y, (7, 2))
    a.add(creatures.sheep(True), 120, 250, (7, 2))     # one out, as one always is

    a.add(props.hedge(120), 120, 62)                   # hedges under the north trees
    a.add(props.hedge(120), 330, 66)
    a.add(props.fallen_fence(), 420, 184, (26, 3))     # the way on to the Pasture
    a.add(kit.stump(), 60, 300, (5, 2))
    for x, y in ((70, 110), (400, 120), (50, 200)):
        a.add(props.mushrooms(x), x, y, (4, 1))
    for x, y, b in ((70, 250, True), (420, 260, False), (200, 200, True)):
        a.add(kit.bush(berries=b), x, y, (7, 2))
    for x, y, k in ((90, 330, "W"), (300, 340, "Y"), (140, 90, "R")):
        a.add(kit.flowers(k), x, y, ground=True)

    a.tree_line("north", depth=2, seed=2)
    a.tree_line("south", depth=1, seed=2)
    a.tree_line("west", gaps=((150, 210),), seed=2)
    a.tree_line("east", gaps=((150, 210),), seed=2)
    a.character("farmer", 96, 200)
    return a


VIEWS = {
    "the-wallow": (96, 40),
    "sheep-pen": (176, 176),
    "in-from-hen-haven": (0, 96),
    "on-to-the-pasture": (240, 96),
}


if __name__ == "__main__":
    build().save(VIEWS)
