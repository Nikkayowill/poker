#!/usr/bin/env python3
"""Town Square: the town itself, instead of a board you post to.

36x26 tiles. The farm road comes in from the west onto a cobbled square. Shopfronts
along the north side, the fountain in the middle, the Town Contracts board by the road
in, and Leo's beacon on the south side. Arthur keeps his post by the board.
"""
import kit
import people
import props
from area import Area

MW, MH = 36, 26


def build():
    a = Area("townsquare", MW, MH)
    a.line("path", (0, 13), (8, 13))                   # the farm road in from the broken cart
    a.rect("cobble", 8, 6, 30, 21)                     # the square

    for x, kind in ((200, "store"), (290, "inn"), (380, "bakery"), (470, "hall")):
        a.add(props.townhouse(kind), x, 112, (36, 4))
    a.add(props.fountain(), 300, 270, (20, 3))
    a.add(props.notice_board(), 150, 240, (12, 2))
    a.add(props.bench(), 230, 300, (11, 2))
    a.add(props.bench(), 370, 300, (11, 2))
    a.add(props.planter("R"), 170, 300, (8, 2))
    a.add(props.planter("Y"), 430, 300, (8, 2))
    for x, y in ((150, 190), (450, 190), (200, 340), (400, 340)):
        a.add(props.lamppost(), x, y, (4, 1))
    a.add(props.market_cart(), 480, 250, (16, 3))
    a.add(kit.crate(), 500, 270, (7, 2))
    a.add(props.beacon(), 300, 372, (18, 3))
    for x, y, k in ((60, 300, "W"), (540, 360, "R"), (80, 120, "Y"), (520, 80, "W")):
        a.add(kit.flowers(k), x, y, ground=True)
    for x, y, b in ((80, 250, True), (530, 300, False), (100, 80, False)):
        a.add(kit.bush(berries=b), x, y, (7, 2))
    a.add(kit.rock(False), 60, 380, (5, 2))

    a.tree_line("north", depth=1, seed=7)
    a.tree_line("south", seed=7)
    a.tree_line("west", gaps=((170, 250),), span=(0, 170), seed=7)
    a.tree_line("west", span=(250, 416), seed=7)
    a.tree_line("east", seed=7)
    a.character("arthur", 190, 262)
    a.character("leo", 340, 384)
    a.character("farmer", 110, 218)
    return a


VIEWS = {
    "the-square": (184, 128),
    "shopfronts": (176, 16),
    "the-beacon": (184, 272),
    "road-in": (0, 128),
}


if __name__ == "__main__":
    build().save(VIEWS)
