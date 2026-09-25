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
import lpc_cliffs  # noqa: E402
import lpc_terrace  # noqa: E402
import lpc_trees  # noqa: E402

MW, MH = 64, 52
HS = 0                                                  # kept for callers that still offset by the old farmyard shift
SPAWN = (496, 344)

# The yard and the two clearings the player starts with: grass, no overgrowth. Tile rects, inclusive.
CLEARED = [(15, 9, 48, 30), (1, 25, 11, 32), (51, 28, 60, 34)]
BORDER = 2                                              # tiles of treeline round the west, east and south edges


# The hill in the north-east corner: a rise of wooded land the lake stops short of, with its earth face
# looking south over the mine trail. Tiles, inclusive; the face's foot is the row under HILL_ROWS.
HILL_X0, HILL_ROWS = 52, 9
HILL_FOOT = (HILL_ROWS + 1) * T
CAVE_X = 976                                            # the middle of the cave mouth: the way to the mine

# The terrace: the yard stands a level above the fields, and the wooden stair between the house and the south
# gate is the only way between them. Rows of the face, inclusive; its foot is the row under them.
TERRACE_ROWS = (31, 35)
TERRACE_FOOT = (TERRACE_ROWS[1] + 1) * T
STAIRS = (29, 34)                                       # tile columns of the stair, inclusive: under the house


def lake_line(x):
    """How far down the map the lake reaches at map pixel x: its south shore. It runs off the top edge,
    and stops short of the hill in the north-east."""
    taper = max(0.0, min(1.0, min(x - 96, HILL_X0 * T - 12 - x) / 90.0)) ** 0.5
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
    # No roads (Kayo, 2026-09-23): the yard, the lake and the gates are all reached over the grass.
    roads = []
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
            if not _cleared(tx, ty) or fy < lake_line(fx) + 20 or _on_terrace(ty):
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
    a.add(props.rockfall(), CAVE_X, HILL_FOOT + 12, (24, 4), tag="locked:mine")
    a.exit("mine", CAVE_X - 16, HILL_FOOT - 4, 32, 12, (88, 334))
    a.add(props.hedge_overgrown(), 1000, 494, (16, 3), tag="locked:wallow")
    a.exit("fold", 1014, 464, 10, 32, (22, 184))
    a.add(props.boardwalk_washed(), 512, MH * T - 14, tag="locked:coast")
    a.exit("coast", 496, MH * T - 10, 32, 10, (312, 22))
    # The bridge onto the empire district, on the west edge (docs/stackacres-second-map-direction.md 6a).
    a.exit("empire", 0, 448, 10, 32, (48, 240))


GAPS = {"east": [(304, 336), (464, 496)], "west": [(304, 336), (448, 480)], "south": [(496, 528)]}


def _hill(a):
    """The north-east hill: its face along the top of the mine trail, the cave mouth the trail ends at,
    and the trees standing on top of it. The land it covers never walks."""
    x0 = HILL_X0 * T
    width = MW * T - x0
    a.add(lpc_cliffs.hill_face(width * 2, cave_at=(CAVE_X - x0) * 2), x0, HILL_FOOT, ground=True)
    a.wall(HILL_X0, 0, MW - 1, HILL_ROWS)
    # Kept clear of the cave, so the way in is always in plain sight.
    for i, (x, y) in enumerate(((838, 156), (884, 60), (922, 104), (940, 52), (1010, 46), (868, 20), (990, 12), (850, 70))):
        a.add(lpc_trees.crown(i * 5 + 1), x, y, (12, 4))


def _terrace(a):
    """The stone wall across the whole map with the stair cut into it, walled off either side of the stair.
    The stair walks but never hoes. A few bushes at the wall's foot and trees along its top break the run."""
    s0, s1 = STAIRS
    rows = TERRACE_ROWS[1] - TERRACE_ROWS[0] + 1
    a.add(lpc_terrace.terrace(MW, s0, s1 - s0 + 1, rows), 0, TERRACE_FOOT, ground=True)
    a.wall(0, TERRACE_ROWS[0], s0 - 1, TERRACE_ROWS[1])
    a.wall(s1 + 1, TERRACE_ROWS[0], MW - 1, TERRACE_ROWS[1])
    a.no_hoe = {(tx, ty) for tx in range(s0, s1 + 1) for ty in range(TERRACE_ROWS[0], TERRACE_ROWS[1] + 2)}
    for i, tx in enumerate((5, 12, 21, 42, 50, 58)):
        a.add(kit.bush(i + 60), tx * T + 8, TERRACE_FOOT + 10, (7, 2))
    for i, tx in enumerate((8, 19, 48, 55)):
        a.add(lpc_trees.crown(i * 7 + 3), tx * T + 8, TERRACE_ROWS[0] * T - 24, (11, 4))


def _on_terrace(ty):
    """The face, and a row either side of it: the lip above and the shadow at the foot."""
    return TERRACE_ROWS[0] - 1 <= ty <= TERRACE_ROWS[1] + 1


def _treeline(a):
    """Pine crowns round the west, east and south edges, and along the top where the lake doesn't reach.
    The engine's forest carries on past the map's edge, so this is the near side of it."""
    def gap(side, v):
        return any(lo - 24 <= v <= hi + 24 for lo, hi in GAPS.get(side, ()))

    seed = 0
    for y in range(40, MH * T + 20, 30):
        for side, x in (("west", 8), ("west", 24), ("east", MW * T - 8), ("east", MW * T - 24)):
            if gap(side, y) or (side == "east" and y < HILL_FOOT + 96):     # the hill stands there, and a tree
                continue                                                    # below it would hang over the cave
            seed += 1
            a.add(lpc_trees.crown(seed), x + int(kit.hash2(x, y, 31) * 8) - 4, y, (11, 4))
    for x in range(20, MW * T, 30):
        for y in (MH * T - 6, MH * T - 22):
            if gap("south", x):
                continue
            seed += 1
            a.add(lpc_trees.crown(seed), x + int(kit.hash2(x, y, 32) * 8) - 4, y - int(kit.hash2(x, y, 33) * 8), (11, 4))
        if lake_line(x) < 8:                            # the corners the lake doesn't reach
            seed += 1
            a.add(lpc_trees.crown(seed), x, 24, (11, 4))
    for tx in range(MW):
        for ty in range(MH):
            edge = tx < BORDER or tx >= MW - BORDER or ty >= MH - BORDER
            if not edge or (tx >= HILL_X0 and ty <= HILL_ROWS):
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
            if _cleared(tx, ty) or ty * T < lake_line(tx * T + 8) + 2 * T or (tx, ty) in a.solid:
                continue
            if tx >= HILL_X0 - 1 and ty <= HILL_ROWS + 1:            # the hill and the shadow at its foot
                continue
            if _on_terrace(ty):
                continue
            if any((tx + dx, ty + dy) in _ROAD for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                continue
            wild.add((tx, ty))
    a.wild = wild


def build(for_game=False):
    a = Area("homestead", MW, MH)
    _terrain(a)
    _terrace(a)
    _ROAD.clear()
    _ROAD.update((x, y) for (x, y) in a.verts["path"])
    _buildings(a)
    _yard(a)
    _lake(a)
    _hill(a)
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
