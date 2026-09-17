#!/usr/bin/env python3
"""Mine Entrance: a way in, and nothing on the other side of it yet.

28x22 tiles. Hill country: spruce on the sides, a rock face across the north with the
cave mouth in it, rails running out to a cart on a spoil apron. Brayden's camp is off to
the west. The trail climbs in from the south-west, off the Homestead's hill trail.
"""
import kit
import people
import props
from area import Area

MW, MH = 28, 22


def build(for_game=False):
    a = Area("mine", MW, MH)
    a.line("path", (5, MH), (5, 14))                   # the trail up from the Homestead
    a.line("path", (5, 14), (13, 14))
    a.line("path", (13, 14), (13, 10))
    a.ellipse("gravel", 14, 7.5, 7.5, 2.8)             # the spoil apron
    a.rect("gravel", 12, 4, 16, 9)
    a.ellipse("stream", 22.5, 5.2, 2.0, 1.3)           # the plunge pool under the falls
    a.line("stream", (22, 6), (24, MH), width=1)       # and its stream, south off the map

    a.add(props.cliff(MW * 16, 64), MW * 8, 64)
    a.add(props.cave_mouth(), 224, 64)
    a.add(props.waterfall(60), 360, 72)                # off the rock face into the pool
    a.add(props.rails(64), 224, 128)
    a.add(props.mine_cart(), 224, 142, (12, 3))
    a.add(props.lantern_post(), 176, 100, (4, 1))
    a.add(props.lantern_post(), 272, 100, (4, 1))
    a.add(props.warning_sign(), 150, 168, (5, 2))
    a.add(props.ore_rock("Y"), 330, 150, (6, 2))
    a.add(props.ore_rock("C"), 412, 200, (6, 2))
    a.add(props.ore_rock("Y"), 300, 236, (6, 2))
    a.add(kit.rock(True), 400, 130, (8, 3))
    a.add(kit.rock(True), 410, 270, (8, 3))
    a.add(kit.rock(False), 120, 130, (5, 2))
    a.add(kit.rock(False), 340, 110, (5, 2))
    a.add(kit.reeds(), 336, 130)
    a.add(props.tent(), 80, 200, (20, 4))
    a.add(props.campfire_lit(), 124, 232, (8, 2))
    a.add(kit.crate(), 56, 240, (7, 2))
    a.add(kit.crate(), 68, 250, (7, 2))
    a.add(kit.barrel(), 140, 196, (6, 2))
    a.add(kit.woodpile(), 40, 270, (13, 2))
    a.add(kit.stump(), 320, 300, (5, 2))
    for x, y in ((190, 300), (360, 320)):
        a.add(props.wild_growth(x), x, y, (8, 2))

    a.tree_line("west", spruce=True, span=(70, 352), seed=6)
    a.tree_line("east", spruce=True, span=(70, 352), seed=6)
    a.tree_line("south", spruce=True, gaps=((50, 130), (350, 410)), seed=6)
    a.character("brayden", 200, 214)
    a.exit("homestead", 72, 342, 32, 10, (680, 24))    # back down the hill trail
    a.spawn = (88, 334)
    if not for_game:
        a.character("farmer", 100, 300)
    return a


VIEWS = {
    "the-cave": (120, 0),
    "the-falls": (232, 0),
    "the-camp": (16, 128),
    "spoil-apron": (232, 96),
    "trail-up": (0, 224),
}
ANIMATED = ["the-falls", "the-camp"]


if __name__ == "__main__":
    build().save(VIEWS)
