#!/usr/bin/env python3
"""The Ancestral Oak: something old stands here.

32x28 tiles. Deep woods on every side, a clearing in the middle, and the oak at its
head. Skye's mural stands on the south edge of the clearing, Bea's hives on the east.
Standing stones half-ring the tree. The trail comes in from the east, off the
Homestead's west trail.
"""
import kit
import people
import props
from area import Area

MW, MH = 32, 28


def build():
    a = Area("oak", MW, MH)
    a.line("path", (MW, 13), (24, 13))                 # the trail in from the Homestead
    a.line("path", (24, 13), (21, 15))

    a.add(props.oak_tree(), 256, 190, (52, 7))
    for x, y in ((150, 250), (256, 286), (362, 250)):
        a.add(props.standing_stone(), x, y, (6, 2))
    a.add(props.mural(), 124, 336, (24, 3))
    a.add(props.log_bench(), 296, 330, (14, 2))
    for x, y in ((392, 300), (424, 316), (456, 300)):
        a.add(props.beehive(), x, y, (7, 2))
    for x, y in ((196, 216), (322, 222), (238, 246), (100, 210), (420, 220), (180, 380)):
        a.add(props.mushrooms(x), x, y, (4, 1))
    for x, y in ((84, 190), (440, 380)):
        a.add(kit.stump(), x, y, (5, 2))
    for x, y, k in ((380, 340, "Y"), (410, 356, "W"), (450, 340, "R"), (120, 280, "W"), (200, 300, "Y"),
                    (330, 380, "R"), (90, 380, "Y"), (260, 120, "W")):
        a.add(kit.flowers(k), x, y, ground=True)
    for x, y, b in ((100, 140, True), (420, 150, False), (60, 330, True), (470, 360, True), (300, 400, False)):
        a.add(kit.bush(berries=b), x, y, (7, 2))
    for x, y, big in ((380, 120, False), (140, 400, True)):
        a.add(kit.rock(big), x, y, (5, 2))

    a.tree_line("north", depth=3, seed=5)
    a.tree_line("south", depth=2, seed=5)
    a.tree_line("west", depth=3, seed=5)
    a.tree_line("east", depth=3, gaps=((180, 250),), seed=5)
    a.trees([(120, 100, "round"), (400, 90, "spruce_big"), (80, 250, "spruce"), (450, 240, "round"),
             (170, 440, "round"), (360, 430, "spruce_big")], seed=9)
    a.character("skye", 176, 362)
    a.character("bea", 400, 352)
    a.character("farmer", 330, 260)
    return a


VIEWS = {
    "the-oak": (152, 40),
    "the-mural": (40, 260),
    "the-hives": (304, 240),
    "trail-in": (304, 120),
}


if __name__ == "__main__":
    build().save(VIEWS)
