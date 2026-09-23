#!/usr/bin/env python3
"""The Homestead: where every player starts, and the farm they grow out of it.

64x44 tiles. The house, barn and workshop stand in a cleared yard in the middle.
A lake runs along the whole north edge and off the top of the map, reached by a
path and dock between the workshop and the house. Everything else inside the
treeline is wild land: grass the Crop Fields' clearing rules cover with trees,
boulders and scrub (lib/stackacres/crop-field-obstacles.ts deals them onto the
tiles `area.wild` names), to clear and build on. Trails lead out through the
wild to the gates at the map's edges.

The design this is built from, with a later-on version of the same farm:
art/stackacres-td/farm-map/.
"""
import math
import os
import sys

import kit
import props
from area import AREAS, Area, T

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "rich"))
import farm_extras  # noqa: E402
import gable_buildings  # noqa: E402
import lpc_trees  # noqa: E402

MW, MH = 64, 44
HS = 0                                                  # kept for callers that still offset by the old farmyard shift
SPAWN = (496, 344)

# The yard and the two clearings the player starts with: grass, no overgrowth. Tile rects, inclusive.
CLEARED = [(15, 9, 48, 30), (1, 25, 11, 32), (51, 28, 60, 34)]
BORDER = 2                                              # tiles of treeline round the west, east and south edges


def lake_line(x):
    """How far down the map the lake reaches at map pixel x: its south shore. It runs off the top edge."""
    taper = max(0.0, min(1.0, min(x - 96, 952 - x) / 90.0)) ** 0.5
    return (116 + 16 * math.sin(x * 0.029) + 9 * math.sin(x * 0.083 + 1.0)) * taper


DOCK_X = 416
DOCK_SHORE = int(lake_line(DOCK_X)) + 6
DOCK_LEN = 76
DOCK_END = DOCK_SHORE - DOCK_LEN


def _terrain(a):
    for vy in range(MH + 1):
        for vx in range(MW + 1):
            if vy * T < lake_line(vx * T):
                a.verts["water"].add((vx, vy))
    roads = [
        (15, 19, 32, 20), (30, 21, 40, 22), (38, 19, 63, 20), (38, 21, 39, 22),     # the farm road, both ways
        (30, 17, 31, 20), (21, 17, 22, 18), (39, 17, 40, 18),                        # aprons at the three doors
        (30, 23, 31, 25), (31, 25, 32, 43),                                          # south, out to the coast gate
        (33, 26, 37, 27),                                                            # spur to Hen Haven
        (25, 5, 26, 18),                                                             # up to the lake and the dock
        (0, 19, 14, 20), (5, 21, 6, 26),                                             # west, to the oak gate and a clearing
        (56, 21, 57, 28), (56, 29, 63, 30),                                          # east trail, to the Fold gate
        (48, 10, 63, 11), (48, 12, 49, 18),                                          # north-east, to the mine gate
    ]
    for x0, y0, x1, y1 in roads:
        a.rect("path", x0, y0, x1, y1)


def _buildings(a):
    doors = {}
    for name, bx, by in (("farmhouse", 494, 296), ("barn", 640, 281), ("workshop", 350, 278)):
        made, meta = gable_buildings.made(name)
        a.add(made, bx, by, (meta["size"][0] // 2 - 6, 5), tag=name)
        if meta["chimney"]:
            dx, dy = meta["chimney"]
            a.add(props.smoke(), bx + dx, by + dy)
        doors[name] = bx + meta["door_dx"]
    # Walk in through the doors; the spawn is inside each room (interiors.py), as before.
    a.door("farmhouse", doors["farmhouse"] - 8, 284, 16, 12, (160, 150))
    a.door("barn", doors["barn"] - 20, 268, 40, 12, (192, 150))
    a.door("workshop", doors["workshop"] - 8, 266, 16, 12, (48, 134))


def _yard(a):
    a.add(kit.well(), 430, 300, (10, 3), tag="well")
    a.add(kit.signpost(), 540, 358, (5, 2), tag="signpost")
    a.add(kit.mailbox(), 458, 302, (4, 2))
    a.add(kit.loose_board(), 704, 284, tag="secret:loose-board")
    a.add(kit.greenhouse_ruin(), 712, 430, ground=True)
    a.zone("greenhouse", 672, 374, 80, 56)
    a.add(kit.coop(), 578, 430, (14, 3), tag="pen:henhaven")
    a.zone("pen:henhaven", 534, 390, 130, 96)
    a.zone("hen-spots", 552, 438, 100, 40)
    a.add(kit.trough(), 640, 470, (11, 2))
    for x, y in ((700, 300), (712, 312)):
        a.add(kit.hay_bale(), x, y, (9, 2))
    for x, y in ((402, 284), (414, 292)):
        a.add(kit.crate(), x, y, (7, 2))
    a.add(kit.barrel(), 552, 300, (6, 2))
    a.add(kit.woodpile(), 300, 290, (13, 2))
    # The four choppable trees (lib/stackacres/tree-nodes.ts) and the four berried forage bushes
    # (lib/stackacres/forage.ts), numbered in the order placed. In the open, where a new player finds them.
    for i, (x, y) in enumerate(((268, 196), (360, 168), (566, 170), (740, 236))):
        a.add(kit.round_tree(i + 40), x, y, (14, 4), tag=f"tree:homestead-{i + 1}")
    forage = 0
    for (x, y), b in (((250, 300), True), ((764, 300), True), ((290, 450), True), ((742, 470), True),
                      ((470, 450), False), ((620, 350), False)):
        if b:
            forage += 1
        a.add(kit.bush(berries=b), x, y, (7, 2), tag=f"forage:homestead-{forage}" if b else None)


def _lake(a):
    pier, base = farm_extras.dock(DOCK_LEN)
    a.add((pier, base), DOCK_X, DOCK_SHORE, ground=True)
    a.add(farm_extras.mooring_post(), DOCK_X - 11, DOCK_END + 14, tag="dock")   # west side: he stands east of it and casts west
    a.add(farm_extras.boat(), DOCK_X + 30, DOCK_END + 40)
    for x in range(130, 900, 46):
        if abs(x - DOCK_X) < 60:
            continue
        if kit.hash2(x, 3, 11) < 0.55:
            a.add(kit.reeds(), x, int(lake_line(x)) + 4)


def _flowers(a):
    """Beds either side of the porch steps, then clumps along the roads and through the yard."""
    for i, x in enumerate(range(452, 478, 6)):
        a.add(farm_extras.flower_clump("red" if i % 2 else "yellow", i), x, 306, ground=True)
    for i, x in enumerate(range(506, 534, 6)):
        a.add(farm_extras.flower_clump("pink" if i % 2 else "white", i + 9), x, 306, ground=True)
    kinds = farm_extras.KINDS
    placed = 0
    for y in range(8, MH * T, 11):
        for x in range(8, MW * T, 11):
            fx = x + int(kit.hash2(x, y, 21) * 8) - 4
            fy = y + int(kit.hash2(x, y, 22) * 8) - 4
            tx, ty = fx // T, fy // T
            if not _cleared(tx, ty) or fy < lake_line(fx) + 20:
                continue
            near_road = any((tx + dx, ty + dy) in _ROAD for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if (tx, ty) in _ROAD:
                continue
            if kit.hash2(x, y, 23) < (0.22 if near_road else 0.05):
                kind = kinds[int(kit.hash2(x, y, 24) * len(kinds))]
                a.add(farm_extras.flower_clump(kind, placed), fx, fy, ground=True)
                placed += 1


_ROAD = set()


def _cleared(tx, ty):
    return any(x0 <= tx <= x1 and y0 <= ty <= y1 for x0, y0, x1, y1 in CLEARED)


def _gates(a):
    """The ways out, each shut until its place opens. Same destinations and arrival spots as before."""
    a.add(kit.broken_cart(), 1000, 336, (18, 4), tag="locked:townsquare")
    a.exit("townsquare", 1014, 304, 10, 32, (22, 216))
    a.add(props.brambles(), 26, 334, (20, 3), tag="locked:oak")
    a.exit("oak", 0, 304, 10, 32, (492, 216))
    a.add(props.rockfall(), 1000, 190, (24, 4), tag="locked:mine")
    a.exit("mine", 1014, 160, 10, 32, (88, 334))
    a.add(props.hedge_overgrown(), 1000, 494, (16, 3), tag="locked:wallow")
    a.exit("fold", 1014, 464, 10, 32, (22, 184))
    a.add(props.boardwalk_washed(), 512, 690, tag="locked:coast")
    a.exit("coast", 496, 694, 32, 10, (312, 22))


GAPS = {"east": [(160, 192), (304, 336), (464, 496)], "west": [(304, 336)], "south": [(496, 528)]}


def _treeline(a):
    """Pine crowns round the west, east and south edges, and along the top where the lake doesn't reach.
    The engine's forest carries on past the map's edge, so this is the near side of it."""
    def gap(side, v):
        return any(lo - 24 <= v <= hi + 24 for lo, hi in GAPS.get(side, ()))

    seed = 0
    for y in range(40, MH * T + 20, 30):
        for side, x in (("west", 8), ("west", 24), ("east", MW * T - 8), ("east", MW * T - 24)):
            if gap(side, y):
                continue
            seed += 1
            a.add(lpc_trees.crown(seed), x + int(kit.hash2(x, y, 31) * 8) - 4, y, (11, 4))
    for x in range(20, MW * T, 30):
        for y in (MH * T - 6, MH * T - 22):
            if gap("south", x):
                continue
            seed += 1
            a.add(lpc_trees.crown(seed), x + int(kit.hash2(x, y, 32) * 8) - 4, y, (11, 4))
        if lake_line(x) < 8:                            # the corners the lake doesn't reach
            seed += 1
            a.add(lpc_trees.crown(seed), x, 24, (11, 4))
    for tx in range(MW):
        for ty in range(MH):
            edge = tx < BORDER or tx >= MW - BORDER or ty >= MH - BORDER
            if not edge:
                continue
            px, py = tx * T + 8, ty * T + 8
            side = "west" if tx < BORDER else "east" if tx >= MW - BORDER else "south"
            if gap(side, py if side != "south" else px):
                continue
            a.solid.add((tx, ty))


def _wild(a):
    """The tiles the Crop Fields' overgrowth may stand on: inside the treeline, off the roads,
    away from the water and outside the yard and the clearings."""
    wild = set()
    for ty in range(MH):
        for tx in range(MW):
            if tx < BORDER + 1 or tx >= MW - BORDER - 1 or ty >= MH - BORDER - 1:
                continue
            if _cleared(tx, ty) or ty * T < lake_line(tx * T + 8) + 2 * T:
                continue
            if any((tx + dx, ty + dy) in _ROAD for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                continue
            wild.add((tx, ty))
    a.wild = wild


def build(for_game=False):
    a = Area("homestead", MW, MH)
    _terrain(a)
    _ROAD.clear()
    _ROAD.update((x, y) for (x, y) in a.verts["path"])
    _buildings(a)
    _yard(a)
    _lake(a)
    _gates(a)
    _treeline(a)
    _flowers(a)
    _wild(a)
    a.character("ray", 460, 330)
    a.character("pilgrim", 260, 150)
    a.character("pierre", 580, 352)
    a.character("ivy", 690, 370)
    a.spawn = SPAWN
    a.character("farmer", *SPAWN)
    return a


VIEWS = {  # 13x8 tiles: what a landscape phone shows at 4x
    "farmyard": (376, 176),
    "lake-dock": (312, 16),
    "hen-haven": (488, 336),
    "west-trail": (0, 256),
    "east-road": (816, 256),
}
ANIMATED = ["farmyard", "lake-dock"]


def main():
    build().save(VIEWS, ANIMATED)
    kit.tileset_image().save(os.path.join(AREAS, "tileset.png"))


if __name__ == "__main__":
    main()
