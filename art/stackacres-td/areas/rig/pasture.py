#!/usr/bin/env python3
"""Cattle Pasture: the Cattle Pens past the Fold's fallen fence.

36x26 tiles. Heavy, rustic, worked: the road comes in from the west to a pole shed,
a big fenced pasture holds the cattle, hitching posts line the road, and ploughed
furrows lie in the south-west corner. Wes stands at the gate.
"""
import creatures
import kit
import people
import props
from area import Area

MW, MH = 36, 26


def build():
    a = Area("pasture", MW, MH)
    a.line("path", (0, 12), (12, 12))                  # in from the Fold
    a.line("path", (12, 12), (12, 7))                  # up to the shed
    a.rect("soil", 3, 16, 9, 21)                       # the furrows

    a.add(props.cattle_shed(), 250, 104, (44, 5))
    a.add(kit.hay_bale(), 320, 110, (9, 2))
    a.add(kit.barrel(), 300, 114, (6, 2))
    for x in (40, 90, 140):
        a.add(props.hitching_post(), x, 182, (5, 2))
    a.add(kit.trough(), 60, 210, (11, 2))

    a.add(kit.fence(336), 372, 130)                    # the pasture
    a.add(kit.fence(336), 372, 354)
    a.add(kit.fence(48, vertical=True), 203, 178)
    a.add(kit.fence(112, vertical=True), 203, 354)
    a.add(kit.fence(208, vertical=True), 541, 354)
    a.add(kit.trough(), 470, 300, (11, 2))
    a.add(kit.hay_bale(), 500, 180, (9, 2))
    a.add(kit.round_tree(7), 420, 250, (14, 4))
    for i, (x, y, p) in enumerate(((260, 220, True), (330, 260, False), (300, 320, True), (450, 210, True),
                                   (380, 330, False))):
        a.add(creatures.cattle(i % 2 == 0, patches=p), x, y, (12, 3))
    a.add(creatures.bird(), 440, 150, (3, 1))

    for x, y, big in ((80, 300, True), (540, 60, False), (100, 380, False)):
        a.add(kit.rock(big), x, y, (5, 2))
    for x, y in ((160, 380), (30, 100)):
        a.add(kit.stump(), x, y, (5, 2))
    for x, y, k in ((140, 100, "Y"), (500, 390, "W"), (30, 260, "R")):
        a.add(kit.flowers(k), x, y, ground=True)
    for x, y in ((60, 60), (520, 100)):
        a.add(kit.bush(berries=False), x, y, (7, 2))

    a.tree_line("north", gaps=((180, 330),), depth=1, seed=3)
    a.tree_line("south", seed=3)
    a.tree_line("west", gaps=((170, 230),), seed=3)
    a.tree_line("east", seed=3)
    a.character("wes", 176, 226)
    a.character("farmer", 110, 230)
    return a


VIEWS = {
    "cattle-pens": (240, 160),
    "the-shed": (144, 32),
    "wes-at-the-gate": (64, 128),
    "furrows": (0, 224),
}


if __name__ == "__main__":
    build().save(VIEWS)
