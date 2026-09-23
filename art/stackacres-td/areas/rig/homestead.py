#!/usr/bin/env python3
"""The Homestead: StackAcres' one map, farmyard and Crop Fields together.

44x70 tiles, authored as two blocks. The north half is the Crop Fields, the 32x32
soil field the player hoes and plants (`CROP_FIELD_BEDS` in lib/stackacres/world.ts,
laid out tile for tile from map tile (FIELD_TX, FIELD_TY)), with Ray's old shed and
plough in the margin and a field road along its south fence. The south half is the
farmyard: Ray's house and the barn facing a shared yard, the pond and dock south-west,
Hen Haven east, and one lane running the whole height of the map, from the shore road
in the south, through the yard, up to the field gate.

The fields used to be their own scene behind a fallen log. They are not any more: it is
one walk from the dock to the far hedge, which is why the log, the farmyard's north tree
line and the `oldfields` exit are gone from here. The farmyard block still keeps its
original numbers -- `a.shift(HOME_SHIFT)` pushes it down the map, so nothing in it was
renumbered by hand and it still reads against the yard as it was drawn.

Writes the full render, phone-scale views with the characters standing in them, animated
views, and the shared tileset. The art that ships is the rich pass over this same layout
(art/stackacres-td/rich/export_rich.py), not the DawnBringer render here.
"""
import os

import kit
import props
from area import AREAS, Area, T

MW, MH = 44, 70

# The Crop Fields ARE the game's `CROP_FIELD_BEDS`: 32 by 32 soil tiles, world tiles
# -16..15 on both axes, with world tile (-16, -16) at map tile (FIELD_TX, FIELD_TY).
# lib/stackacres-td/field.ts holds the same two numbers and must move with them.
FIELD_TX, FIELD_TY, FIELD_TILES = 6, 2, 32
FIELD_ROAD = FIELD_TY + FIELD_TILES + 2                 # the field road, along the south fence

# Rows the farmyard starts down the map. lib/stackacres-td/field.ts's HOME_SHIFT is this
# same number: every Homestead landmark it pins moved down by exactly this much.
HOME_SHIFT = 38
HS = HOME_SHIFT * T

LANE_TX = 14                                            # the one lane, top of the map to the bottom


def _fields(a):
    """The north half: the Crop Fields and the margin around them."""
    fx, fy, size = FIELD_TX * T, FIELD_TY * T, FIELD_TILES * T
    a.line("path", (LANE_TX, FIELD_TY + FIELD_TILES + 1), (LANE_TX, MH))   # the lane, from the gate down to the yard
    a.line("path", (1, FIELD_ROAD), (MW - 1, FIELD_ROAD))              # the field road
    a.zone("field", fx, fy, size, size)

    a.add(kit.fence(size - 4, vertical=True), fx - 6, fy + size + 2)   # west and east rails
    a.add(kit.fence(size - 4, vertical=True), fx + size + 6, fy + size + 2)
    a.add(kit.fence(116), fx - 4, fy + size + 10)                      # south rail, open at the lane
    a.add(kit.fence(348), LANE_TX * T + 40, fy + size + 10)

    a.add(props.shed_old(), 48, 300, (30, 5))                          # Ray's old shed and plough
    a.add(props.plough(), 50, 364, (18, 3))
    a.add(props.scarecrow(), 60, 180, (7, 2))
    a.add(kit.hay_bale(), 36, 430, (9, 2))
    a.add(kit.hay_bale(), 58, 444, (9, 2))
    a.add(kit.crate(), 70, 500, (7, 2))
    a.add(kit.woodpile(), 660, 540, (13, 2))
    for x, y, big in ((650, 300, True), (40, 610, False), (664, 140, False)):
        a.add(kit.rock(big), x, y, (5, 2))
    for x, y in ((652, 420), (44, 120)):
        a.add(kit.stump(), x, y, (5, 2))
    for x, y, k in ((120, 580, "W"), (560, 580, "Y"), (660, 470, "R"), (36, 220, "Y")):
        a.add(kit.flowers(k), x, y, ground=True)
    # The margin either side of the field, so the walk up the lane is not bare.
    for x, y in ((36, 268), (664, 232), (78, 560), (630, 600)):
        a.add(kit.bush(berries=False), x, y, (7, 2))


def _farmyard(a, for_game):
    """The south half, in the coordinates it has always been drawn in."""
    a.line("path", (6, 11), (MW, 11))                  # the farm road past both doors to the east exit
    a.rect("path", 6, 10, 11, 11)                      # apron at Ray's door
    a.rect("path", 20, 10, 25, 11)                     # apron at the barn doors
    a.rect("path", 30, 10, 33, 11)                     # apron at the workshop doors
    a.line("path", (LANE_TX, 0), (LANE_TX, 11))        # north lane, up to the field road
    a.line("path", (LANE_TX, 12), (LANE_TX, 32))       # south lane: the shore road
    a.line("path", (35, 11), (35, 8))                  # spur to the greenhouse footing
    a.line("path", (35, 8), (42, 8))                   # hill trail east along the footing, then north
    a.line("path", (42, 0), (42, 8))
    a.line("path", (15, 22), (28, 22))                 # spur to Hen Haven's gate
    a.line("path", (0, 12), (6, 12))                   # west trail into the woods
    a.line("path", (41, 21), (MW, 21))                 # Hen Haven's back gate, east to the Fold
    # No tilled beds are painted here: the player hoes their own, anywhere on the grass.
    a.ellipse("water", 7, 26, 4.6, 3.2)                # the pond, with a lobe reaching the dock
    a.ellipse("water", 10, 26.5, 2.6, 2.0)
    a.line("stream", (1, 0), (1, 7), width=1)          # the stream: down the west side, under the bridge, into the pond
    a.line("stream", (1, 7), (2, 13), width=1)
    a.line("stream", (2, 13), (2, 21), width=1)
    a.line("stream", (2, 21), (4, 24), width=1)
    a.line("stream", (6, 29), (6, 32), width=1)        # and out of the pond, south to the shore

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
    a.add(kit.broken_cart(), 672, 206, (18, 4), tag="locked:townsquare")     # east gate: Town Square
    a.add(props.bridge(32), 32, 216, ground=True)      # the west trail crosses the stream
    a.add(props.brambles(), 78, 214, (20, 3), tag="locked:oak")              # west gate: the Ancestral Oak
    a.add(props.rockfall(), 676, 40, (24, 4), tag="locked:mine")             # hill gate: Mine Entrance
    a.add(props.hedge_overgrown(), 660, 362, (16, 3), tag="locked:wallow")   # back gate: the Fold
    a.add(props.boardwalk_washed(), 240, 500, tag="locked:coast")            # south gate: Coastal Market
    a.add(kit.dock(), 196, 428, tag="dock")
    a.exit("fold", 694, 328, 10, 32, (22, 184))      # through Hen Haven's back gate once the Fold is cleared
    a.exit("oak", 0, 184, 10, 32, (492, 216))       # the west trail, past the brambles
    a.exit("mine", 664, 0, 32, 18, (88, 334))        # the hill trail, past the rockfall
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
    # No paddock zones: the hoe works on any grass on the map now, and which squares
    # count is written out from this map by export_rich.py (`write_hoeable`).
    if for_game:                                       # the game draws the player's real hens and crops itself
        a.zone("hen-spots", 500, 330, 130, 70)
    else:
        for i, (x, y) in enumerate(((560, 350), (590, 372), (540, 390), (610, 330))):
            a.add(kit.hen(i % 2 == 0), x, y, (4, 1))

    for x, y, k in ((88, 230, "Y"), (416, 236, "R"), (300, 340, "W"), (40, 350, "Y"),
                    (620, 240, "W"), (470, 452, "R"), (150, 470, "Y")):
        a.add(kit.flowers(k), x, y, ground=True)
    # The four berried bushes are the farm's forage nodes: picking one gives
    # crop seed (lib/stackacres/forage.ts, FORAGE_NODE_IDS), which is where
    # seed comes from before there is Gold to buy any. They are numbered in
    # the order they are placed here. The berry-less four stay scenery, so
    # "this one has something on it" is readable off the drawing.
    forage = 0
    for x, y, b in ((208, 132, True), (452, 250, True), (26, 300, False), (650, 440, True), (360, 440, False),
                    (620, 120, False), (104, 232, False), (36, 500, True)):
        if b:
            forage += 1
        a.add(kit.bush(berries=b), x, y, (7, 2), tag=f"forage:homestead-{forage}" if b else None)
    for x, y, big in ((126, 348, True), (400, 360, False), (520, 240, False), (630, 460, True), (176, 470, False),
                      (48, 120, False), (14, 260, False)):
        a.add(kit.rock(big), x, y, (5, 2))
    for x, y in ((150, 250), (596, 470)):
        a.add(kit.stump(), x, y, (5, 2))
    # The four choppable trees (lib/stackacres/tree-nodes.ts's WOOD_NODE_IDS), which
    # are the whole of the first chapter: fifteen Wood builds the Mill. They used to
    # be four of the north tree line, hand-tagged into the committed area.json after
    # every export; that line is gone with the fallen log, so they stand in the yard
    # itself now, numbered in the order they are placed here. In the open on purpose
    # -- "chop the trees around the farm" is the first thing a new player is told,
    # and they have to be able to find them without hunting the treeline.
    for i, (x, y) in enumerate(((196, 96), (326, 82), (566, 250), (322, 432))):
        a.add(kit.round_tree(i + 40), x, y, (14, 4), tag=f"tree:homestead-{i + 1}")
    for x, y in ((44, 372), (24, 412), (170, 380), (36, 462), (120, 474), (46, 90), (18, 330), (112, 494)):
        a.add(kit.reeds(), x, y)
    for x, y, f in ((82, 404, True), (130, 432, False), (58, 440, False)):
        a.add(kit.lily_pad(f), x, y, ground=True)

    a.character("ray", 140, 190)
    a.spawn = (236, 196)                               # the player starts on the lane in front of the barn
    a.character("farmer", 236, 196)
    a.character("pilgrim", 64, 484)
    a.character("pierre", 336, 226)                    # farmstead travelers
    a.character("ivy", 540, 108)


def _treelines(a):
    """The woods around the whole map, authored unshifted in map pixels.

    The farmyard's own north tree line is gone: north of the yard is the field road
    now, not forest. The west and east lines run the full height instead of stopping
    where the old map ended, and their gaps are the farmyard's own, pushed down by HS.
    """
    def kind(x, y):
        r = kit.hash2(x, y, 5)
        return "spruce_big" if r < 0.3 else "spruce" if r < 0.65 else "round"

    def jig(x, y, seed):
        return round((kit.hash2(x, y, seed) - 0.5) * 10)

    trees = []
    for x in range(10, MW * T, 22):                    # north edge, one tree deep: a second row would stand in the field
        trees.append((x + jig(x, 0, 6), 30 + jig(x, 0, 7) // 2, kind(x, 0)))
    for y in range(84, MH * T - 30, 24):               # west line, on the far bank of the stream
        if HS + 166 < y < HS + 232:                    # the west trail's gap
            continue
        trees.append((-4 + jig(0, y, 6) // 2, y + jig(0, y, 7), kind(0, y)))
    for y in range(64, MH * T - 30, 23):               # east line, gaps for the trail, road and back gate
        if HS + 130 < y < HS + 240 or HS + 300 < y < HS + 380:
            continue
        trees.append((692 + jig(1, y, 6) // 2, y + jig(1, y, 7), kind(1, y)))
        if y > HS + 250 and kit.hash2(2, y, 8) < 0.55:
            trees.append((670 + jig(2, y, 6), y + 11, kind(2, y)))
    for x in range(30, MW * T, 22):                    # south edge, gaps for the lane, the pilgrim's bank and the outflow
        if 196 < x < 290 or 44 < x < 112:
            continue
        trees.append((x + jig(x, 3, 6), HS + 506 + jig(x, 3, 7) // 3, kind(x, 3)))
    trees += [(438, HS + 470, "round"), (300, HS + 470, "spruce"), (560, HS + 470, "spruce_big"),
              (660, HS + 100, "round")]
    a.trees(trees)


def build(for_game=False):
    a = Area("homestead", MW, MH)
    _fields(a)
    a.shift(HOME_SHIFT)
    _farmyard(a, for_game)
    a.shift(0)
    _treelines(a)
    return a


VIEWS = {  # 13x8 tiles: what a landscape phone shows at 4x
    "farmyard": (96, HS + 64),
    "pond-and-dock": (24, HS + 368),
    "barn-and-mill": (296, HS + 44),
    "hen-haven": (440, HS + 264),
    "field-gate": (128, HS - 112),
    "crop-fields": (128, 96),
    "old-shed": (0, 224),
    "west-trail": (0, HS + 130),
    "hill-trail": (496, HS + 0),
    "fold-gate": (496, HS + 280),
    "shore-road": (136, HS + 384),
    "the-beds": (48, HS + 224),
}
ANIMATED = ["farmyard", "west-trail", "pond-and-dock"]


def main():
    build().save(VIEWS, ANIMATED)
    kit.tileset_image().save(os.path.join(AREAS, "tileset.png"))


if __name__ == "__main__":
    main()
