#!/usr/bin/env python3
"""The Homestead: StackAcres' first area and its hub.

44x32 tiles. Ray's house and the barn face a shared farmyard; one lane runs from the
shore road in the south through the yard to the north gate, where a fallen log blocks
the way to the Old Fields. Crop beds flank the lane, the pond and dock sit south-west,
Hen Haven east, and the east road ends at a broken cart before Town Square. Three more
exits: the west trail (brambles) to the Ancestral Oak, the hill trail (rockfall) to the
Mine, and Hen Haven's back gate (overgrown hedge) to the Fold. A stream comes out of the
north-west woods, runs down the west side under a plank bridge on the west trail, feeds
the pond, and drains south to the shore. Writes the full render, phone-scale views with
the characters standing in them, animated views, and the shared tileset.
"""
import os

import crops
import kit
import props
from area import AREAS, Area, T

MW, MH = 44, 32
WEST_BED, EAST_BED = (4, 15, 11, 20), (19, 15, 26, 19)


def build(for_game=False):
    a = Area("homestead", MW, MH)
    a.line("path", (6, 11), (MW, 11))                  # the farm road past both doors to the east exit
    a.rect("path", 6, 10, 11, 11)                      # apron at Ray's door
    a.rect("path", 20, 10, 25, 11)                     # apron at the barn doors
    a.rect("path", 30, 10, 33, 11)                     # apron at the workshop doors
    a.line("path", (14, 0), (14, 11))                  # north lane to the fallen log
    a.line("path", (14, 12), (14, MH))                 # south lane: the shore road
    a.line("path", (35, 11), (35, 8))                  # spur to the greenhouse footing
    a.line("path", (35, 8), (42, 8))                   # hill trail east along the footing, then north
    a.line("path", (42, 0), (42, 8))
    a.line("path", (15, 22), (28, 22))                 # spur to Hen Haven's gate
    a.line("path", (0, 12), (6, 12))                   # west trail into the woods
    a.line("path", (41, 21), (MW, 21))                 # Hen Haven's back gate, east to the Fold
    a.rect("soil", *WEST_BED)
    a.rect("soil", *EAST_BED)
    a.ellipse("water", 7, 26, 4.6, 3.2)                # the pond, with a lobe reaching the dock
    a.ellipse("water", 10, 26.5, 2.6, 2.0)
    a.line("stream", (1, 0), (1, 7), width=1)          # the stream: down the west side, under the bridge, into the pond
    a.line("stream", (1, 7), (2, 13), width=1)
    a.line("stream", (2, 13), (2, 21), width=1)
    a.line("stream", (2, 21), (4, 24), width=1)
    a.line("stream", (6, 29), (6, MH), width=1)        # and out of the pond, south to the shore

    # `tag` is what tapping it does in the game; see components/arcade/stackacres-td/scene.ts.
    a.add(kit.farmhouse(), 120, 150, (44, 5), tag="farmhouse")
    a.add(props.smoke(), 139, 74)                      # the chimney is lit
    a.add(kit.barn(), 360, 150, (48, 5), tag="barn")
    a.add(kit.workshop(), 488, 147, (36, 5), tag="workshop")
    a.add(props.smoke(), 503, 72)                       # the workshop's own stove is lit
    # Walk in through the doors. A door's exit is named for the building's tag, which is how a tap on the
    # building knows to walk inside rather than open a menu at the door (scene.ts).
    a.door("barn", 340, 144, 40, 12, (192, 150))       # arriving just inside, on the mat (interiors.BARN.arrive)
    a.door("workshop", 480, 144, 16, 12, (48, 134))     # (interiors.WORKSHOP.arrive)
    a.door("farmhouse", 112, 144, 16, 12, (160, 150))   # (interiors.HOUSE.arrive)
    a.add(kit.greenhouse_ruin(), 600, 116, ground=True)
    a.zone("greenhouse", 560, 60, 80, 56)
    a.add(kit.well(), 186, 160, (10, 3), tag="well")
    a.add(kit.signpost(), 262, 226, (5, 2), tag="signpost")
    a.add(kit.mailbox(), 276, 470, (4, 2))
    a.add(kit.loose_board(), 414, 150, tag="secret:loose-board")
    a.add(kit.fallen_log(), 232, 42, (30, 4), tag="gate:oldfields")          # north gate: the Old Fields
    a.add(kit.broken_cart(), 672, 206, (18, 4), tag="locked:townsquare")     # east gate: Town Square
    a.add(props.bridge(32), 32, 216, ground=True)      # the west trail crosses the stream
    a.add(props.brambles(), 78, 214, (20, 3), tag="locked:oak")              # west gate: the Ancestral Oak
    a.add(props.rockfall(), 676, 40, (24, 4), tag="locked:mine")             # hill gate: Mine Entrance
    a.add(props.hedge_overgrown(), 660, 362, (16, 3), tag="locked:wallow")   # back gate: the Fold
    a.add(props.boardwalk_washed(), 240, 500, tag="locked:coast")            # south gate: Coastal Market
    a.add(kit.dock(), 196, 428, tag="dock")
    a.exit("oldfields", 208, 0, 48, 14, (352, 596))   # up the north lane once the log is cleared
    a.exit("fold", 694, 328, 10, 32, (22, 184))      # through Hen Haven's back gate once the Fold is cleared
    a.exit("oak", 0, 184, 10, 32, (492, 216))       # the west trail, past the brambles
    a.exit("mine", 664, 0, 32, 18, (88, 334))        # the hill trail, past the rockfall; tall enough to reach under the HUD
    a.exit("coast", 216, 502, 32, 10, (312, 22))     # the shore road, over the washed-out boardwalk
    a.exit("townsquare", 694, 168, 10, 32, (22, 216))  # the east road, past the broken cart
    a.add(kit.hay_bale(), 298, 150, (9, 2))            # farm clutter so the yard isn't bare
    a.add(kit.hay_bale(), 290, 164, (9, 2))
    a.add(kit.crate(), 422, 150, (7, 2))
    a.add(kit.crate(), 436, 156, (7, 2))
    a.add(kit.barrel(), 72, 150, (6, 2))
    a.add(kit.woodpile(), 52, 164, (13, 2))
    a.add(kit.trough(), 600, 318, (11, 2))

    a.add(kit.fence(176), 552, 288)                    # Hen Haven
    a.add(kit.fence(176), 552, 414)
    a.add(kit.fence(48, vertical=True), 467, 344)
    a.add(kit.fence(32, vertical=True), 467, 414)
    a.add(kit.fence(42, vertical=True), 643, 328)      # east fence, split around the back gate
    a.add(kit.fence(44, vertical=True), 643, 414)
    a.add(kit.coop(), 520, 334, (14, 3), tag="pen:henhaven")
    a.zone("pen:henhaven", 470, 290, 172, 124)
    for tx0, ty0, tx1, ty1 in (WEST_BED, EAST_BED):   # the home beds are a kitchen garden; crops go in the Old Fields
        a.zone("homebeds", tx0 * T - 8, ty0 * T - 8, (tx1 - tx0 + 1) * T, (ty1 - ty0 + 1) * T)
    if for_game:                                       # the game draws the player's real hens and crops itself
        a.zone("hen-spots", 500, 330, 130, 70)
    else:
        for i, (x, y) in enumerate(((560, 350), (590, 372), (540, 390), (610, 330))):
            a.add(kit.hen(i % 2 == 0), x, y, (4, 1))

    for bed, (x0, y0, x1, y1) in enumerate((WEST_BED, EAST_BED)):
        if for_game:
            break
        for ty in range(y0, y1 + 1):
            name = ("wheat" if ty - y0 < 2 else "radish") if bed else ("carrot", "potato")[(ty - y0) // 2 % 2]
            for tx in range(x0, x1 + 1):
                roll = kit.hash2(tx, ty, 21 + bed)
                if roll < 0.12:
                    continue
                stage = 0 if roll < 0.3 else 1 if roll < 0.55 else 2
                a.add(crops.crop(name, stage), tx * T, ty * T + 4)

    def kind(x, y):
        r = kit.hash2(x, y, 5)
        return "spruce_big" if r < 0.3 else "spruce" if r < 0.65 else "round"

    def jig(x, y, seed):
        return round((kit.hash2(x, y, seed) - 0.5) * 10)

    trees = []
    for x in range(10, MW * T, 22):                    # north tree line, gaps at the gate and the hill trail
        if 184 < x < 290 or x > 640:
            continue
        trees.append((x + jig(x, 0, 6), 30 + jig(x, 0, 7) // 2, kind(x, 0)))
        if not (150 < x < 300 or 300 < x < 420 or 540 < x < 660) and kit.hash2(x, 1, 8) < 0.7:
            trees.append((x + 11 + jig(x, 1, 6), 58 + jig(x, 1, 7) // 2, kind(x, 1)))
    for y in range(84, MH * T - 30, 24):               # west tree line, on the far bank of the stream
        if 166 < y < 232:
            continue
        trees.append((-4 + jig(0, y, 6) // 2, y + jig(0, y, 7), kind(0, y)))
    for y in range(64, MH * T - 30, 23):               # east tree line, gaps for the trail, road and back gate
        if y < 130 or 130 < y < 240 or 300 < y < 380:
            continue
        trees.append((692 + jig(1, y, 6) // 2, y + jig(1, y, 7), kind(1, y)))
        if y > 250 and kit.hash2(2, y, 8) < 0.55:
            trees.append((670 + jig(2, y, 6), y + 11, kind(2, y)))
    for x in range(30, MW * T, 22):                    # south edge, gaps for the lane, the pilgrim's bank and the outflow
        if 196 < x < 290 or 44 < x < 112:
            continue
        trees.append((x + jig(x, 3, 6), 506 + jig(x, 3, 7) // 3, kind(x, 3)))
    trees += [(438, 470, "round"), (300, 470, "spruce"), (560, 470, "spruce_big"), (660, 100, "round")]
    a.trees(trees)

    for x, y, k in ((88, 230, "Y"), (416, 236, "R"), (300, 340, "W"), (40, 350, "Y"),
                    (620, 240, "W"), (470, 452, "R"), (150, 470, "Y")):
        a.add(kit.flowers(k), x, y, ground=True)
    for x, y, b in ((208, 132, True), (452, 250, True), (26, 300, False), (650, 440, True), (360, 440, False),
                    (620, 120, False), (104, 232, False), (36, 500, True)):
        a.add(kit.bush(berries=b), x, y, (7, 2))
    for x, y, big in ((126, 348, True), (400, 360, False), (520, 240, False), (630, 460, True), (176, 470, False),
                      (48, 120, False), (14, 260, False)):
        a.add(kit.rock(big), x, y, (5, 2))
    for x, y in ((150, 250), (596, 470)):
        a.add(kit.stump(), x, y, (5, 2))
    for x, y in ((44, 372), (24, 412), (170, 380), (36, 462), (120, 474), (46, 90), (18, 330), (112, 494)):
        a.add(kit.reeds(), x, y)
    for x, y, f in ((82, 404, True), (130, 432, False), (58, 440, False)):
        a.add(kit.lily_pad(f), x, y, ground=True)

    a.character("ray", 140, 190)
    a.spawn = (236, 196)                               # the player starts on the lane in front of the barn
    a.character("farmer", *a.spawn)
    a.character("pilgrim", 64, 484)
    a.character("pierre", 336, 226)                    # farmstead travelers
    a.character("ivy", 540, 108)
    if for_game:
        a.character("merchant", 312, 180)              # shown only while the Midnight Merchant is visiting
    return a


VIEWS = {  # 13x8 tiles: what a landscape phone shows at 4x
    "farmyard": (96, 64),
    "pond-and-dock": (24, 368),
    "barn-and-mill": (296, 44),
    "hen-haven": (440, 264),
    "north-gate": (128, 0),
    "west-trail": (0, 130),
    "hill-trail": (496, 0),
    "fold-gate": (496, 280),
    "shore-road": (136, 384),
    "the-beds": (48, 224),
}
ANIMATED = ["farmyard", "west-trail", "pond-and-dock"]


def main():
    build().save(VIEWS, ANIMATED)
    kit.tileset_image().save(os.path.join(AREAS, "tileset.png"))


if __name__ == "__main__":
    main()
