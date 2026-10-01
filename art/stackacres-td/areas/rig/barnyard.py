#!/usr/bin/env python3
"""The Barnyard: the working farm the barn crew runs (lib/stackacres-td/barnsite.ts).

56x60 tiles. A lane comes in through the west treeline past the crew's farmhouse to a worn yard in front
of the barn, with the hay stack (the feed store), the well under the windmill and the notice board the
crew work from. Pens open off the yard through gates: the hens' run with its coop, the sheep fold with its
shelter, and the big cattle pasture down the east side with its shed, pond, shade trees and three milking
posts by the gate. The farm lane runs on south past the pig sty, with its tin ark, wallow and straw beds,
and the stable, a row of four stalls and a feed room facing its own yard, with the horses' paddock below
it. An old orchard fills the west. The wheat and corn beds that grow the animals' feed run along the
south, with the tool shed and the beehives beside them, and there's a muck heap by the lane at each end.

The troughs and crops are not drawn here: the sim fills and empties the troughs and grows the crops, so the
page draws them live. Their squares are walled off (`solid`) and `troughbox:` zones say where to draw.

Every square the sim reads is a zone (see barnsite.ts `barnLayout` for the contract). An `aisle:` keeps the
animals off the way in from a gate to its troughs.
"""
import os
import sys

import kit
import props
from area import Area, T

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "rich"))
import farm_extras  # noqa: E402
import gable_buildings  # noqa: E402
import lpc_trees  # noqa: E402

MW, MH = 56, 60
BORDER = 2
# How far the field and everything south of it sit below where they were before the sty and the stable.
SOUTH = 20

# Pens, as inside tiles (x0, y0, x1, y1), inclusive. The fence runs round the outside of each.
PENS = {
    "coop": (3, 16, 13, 24),
    "sheep": (17, 16, 27, 24),
    "cattle": (36, 4, 52, 25),
    "sty": (18, 29, 27, 37),
    "paddock": (36, 36, 52, 43),
}
# The gate in each pen's fence: the fence square people walk through.
GATES = {"coop": (8, 15), "sheep": (22, 15), "cattle": (35, 13), "sty": (22, 28), "paddock": (38, 35)}
# Beds two rows deep with a furrow above and below each, the way a worked field is laid out.
BEDS = {"wheat": (4, 17), "corn": (21, 31)}
BED_ROWS = ((27, 28), (30, 31))              # before the shift south (_field)


def tile_zone(a, tag, tx, ty, w=1, h=1):
    a.zone(tag, tx * T, ty * T, w * T, h * T)


def _fences(a):
    """Rails round each pen, left open at its gate."""
    for pen, (x0, y0, x1, y1) in PENS.items():
        gx, gy = GATES[pen]
        left, right, top, bottom = (x0 - 1) * T + 8, (x1 + 1) * T + 8, (y0 - 1) * T + 12, (y1 + 1) * T + 12

        def run(xa, xb, y):
            if xb - xa >= 8:
                a.add(kit.fence(xb - xa), (xa + xb) // 2, y)

        def column(x, ya, yb):
            if yb - ya >= 8:
                a.add(kit.fence(yb - ya, vertical=True), x, yb)

        if gy == y0 - 1:                              # the gate is in the top rail
            run(left, gx * T, top)
            run(gx * T + T, right, top)
        else:
            run(left, right, top)
        run(left, right, bottom)
        if gx == x0 - 1:                              # the gate is in the left rail
            column(left, top, gy * T)
            column(left, gy * T + T + 4, bottom)
        else:
            column(left, top, bottom)
        column(right, top, bottom)
        for tx in range(x0 - 1, x1 + 2):
            for ty in (y0 - 1, y1 + 1):
                if (tx, ty) != (gx, gy):
                    a.solid.add((tx, ty))
        for ty in range(y0 - 1, y1 + 2):
            for tx in (x0 - 1, x1 + 1):
                if (tx, ty) != (gx, gy):
                    a.solid.add((tx, ty))
        a.zone(f"pen:{pen}", x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T)
        tile_zone(a, f"gate:{pen}", gx, gy)


def _trough(a, pen, kind, tx, ty, w=2):
    """A trough the page draws, `w` squares wide at (tx, ty): the crew fill it from the square above, on their
    way in from the gate, and the animals come to it from the pen side below."""
    for dx in range(w):
        a.solid.add((tx + dx, ty))
    tile_zone(a, f"troughbox:{pen}:{kind}", tx, ty, w, 1)
    tile_zone(a, f"{'eat' if kind == 'feed' else 'drink'}:{pen}", tx, ty + 1, w, 1)
    tile_zone(a, f"trough:{pen}:{kind}", tx, ty - 1)


def _bale(a, tx, ty, dx=0, dy=0):
    a.add(kit.hay_bale(), tx * T + 8 + dx, ty * T + 12 + dy, (9, 2))


def _house(a):
    """The crew's farmhouse by the lane, with its garden, bench and woodpile."""
    made, meta = gable_buildings.made("farmhouse")
    bx, by = 8 * T, 9 * T
    a.add(made, bx, by, (meta["size"][0] // 2 - 6, 5), tag="farmhouse")
    dx, dy = meta["chimney"]
    a.add(props.smoke(), bx + dx, by + dy)
    for tx, kind in ((4, "red"), (5, "yellow"), (9, "pink"), (10, "white")):
        a.add(farm_extras.flower_clump(kind, tx), tx * T + 8, 9 * T + 12, ground=True)
        a.add(farm_extras.flower_clump(kind, tx + 20), tx * T + 2, 9 * T + 6, ground=True)
    a.add(props.planter("R"), 3 * T + 8, 8 * T + 12, (5, 2))
    a.add(kit.woodpile(), 13 * T + 8, 5 * T + 12, (13, 2))
    a.wall(13, 5, 14, 5)
    a.add(props.log_bench(), 14 * T, 8 * T + 12, (12, 2))
    a.wall(13, 8, 14, 8)
    tile_zone(a, "break", 14, 9)
    a.add(props.lantern_post(), 11 * T + 8, 10 * T + 10, (4, 2))
    a.solid.add((11, 10))
    # The lane in from the west, and the farm's gate on it.
    a.add(kit.signpost(), 3 * T + 8, 10 * T + 10, (5, 2))
    a.add(kit.mailbox(), 4 * T + 8, 13 * T + 12, (4, 2))
    a.solid.update({(3, 10), (4, 13)})


def _yard(a):
    """The barn and everything round the yard in front of it."""
    made, meta = gable_buildings.made("barn")
    bx, by = 22 * T, 9 * T
    a.add(made, bx, by, (meta["size"][0] // 2 - 6, 5), tag="barn")
    door = (bx + meta["door_dx"]) // T
    # Milk and eggs go in through the barn doors to the cool room; milk cans and egg crates stand beside them.
    tile_zone(a, "barn:dairy", door - 1, 9, 2, 1)
    a.add(kit.barrel(), (door - 3) * T + 8, 9 * T + 12, (6, 2))
    a.add(kit.crate(), (door - 2) * T + 8, 9 * T + 12, (7, 2))
    a.wall(door - 3, 9, door - 2, 9)
    # The hay stack east of the barn is the feed store: the crew take feed from it and the field's sheaves
    # go onto it. Three squares along its front so three hands can work it at once.
    for tx, ty, dx, dy in ((25, 7, 0, 0), (26, 7, 4, -2), (27, 7, 0, 1), (25, 8, 3, 2), (26, 8, 6, 0), (27, 8, 2, 3),
                           (26, 7, 0, -9), (25, 7, 8, -8)):
        _bale(a, tx, ty, dx, dy)
    a.wall(25, 6, 27, 8)
    tile_zone(a, "barn:feed", 25, 9, 3, 1)

    # The windmill pumps the well; the crew draw from the well.
    a.add(kit.windmill(), 30 * T + 8, 6 * T + 14, (22, 4))
    a.add(kit.well(), 31 * T + 8, 9 * T + 12, (10, 3), tag="well")
    a.wall(31, 8, 31, 9)
    tile_zone(a, "well", 31, 10)
    a.add(props.market_cart(), 34 * T, 11 * T + 12, (16, 3))
    a.wall(33, 11, 34, 11)

    # The notice board the jobs go up on.
    a.add(props.notice_board(), 17 * T + 8, 10 * T + 14, (12, 2))
    a.solid.add((17, 10))
    a.add(props.lantern_post(), 23 * T + 8, 10 * T + 6, (4, 2))
    a.solid.add((23, 10))

    # Where each job waits for the next: the stock hands by the hay stack, the dairy by the barn doors,
    # the field hands at the tool shed (see _field), the stable hands in the stable yard (see _stable). A few
    # spare squares in the middle of the yard.
    for tx in (24, 26, 28, 30):
        tile_zone(a, "post:hand", tx, 11)
    for tx in (18, 20, 22):
        tile_zone(a, "post:dairy", tx, 11)
    for tx in (13, 15, 16):
        tile_zone(a, "post", tx, 12)

    # The yard is worn to dirt, with tracks down to the gates and the lane in from the west.
    a.rect("path", 12, 10, 34, 13)
    a.rect("path", 0, 11, 12, 12)
    a.rect("path", 7, 13, 8, 14)
    a.rect("path", 21, 13, 22, 14)
    a.rect("path", 29, 13, 31, 26 + SOUTH - 2)


def _pens(a):
    # Hens: the coop at the back of the run, a dust bath, feeder and water up by the gate.
    a.add(kit.coop(), 5 * T + 2, 20 * T + 14, (14, 3))
    a.wall(4, 19, 5, 20)
    tile_zone(a, "roost", 5, 21)
    tile_zone(a, "nest", 7, 20)
    a.ellipse("mud", 11, 22, 1.6, 1.1)
    _bale(a, 12, 17)
    a.solid.add((12, 17))
    _trough(a, "coop", "feed", 6, 17)
    _trough(a, "coop", "water", 10, 17, 1)
    tile_zone(a, "muck:coop", 9, 22)

    # Sheep: hay rack and water by the gate, a canvas shelter and bales at the back.
    _trough(a, "sheep", "feed", 19, 17)
    _trough(a, "sheep", "water", 24, 17)
    a.add(props.canopy(), 22 * T + 8, 24 * T + 12, (34, 5))
    a.wall(20, 24, 24, 24)
    _bale(a, 26, 23)
    _bale(a, 26, 24, 2, 0)
    a.wall(26, 23, 26, 24)
    tile_zone(a, "muck:sheep", 22, 21)
    tile_zone(a, "muck:sheep", 18, 23)

    # Cattle: the shed up the top, three milking posts by the gate, troughs by the yard side, the pond and
    # two shade trees out in the grass.
    a.add(props.cattle_shed(), 48 * T, 8 * T + 8, (40, 5))
    for n, ty in ((1, 5), (2, 8), (3, 11)):
        a.add(props.hitching_post(), 37 * T + 8, ty * T + 12, (4, 2))
        a.solid.add((37, ty))
        tile_zone(a, f"stand:{n}", 38, ty)
        tile_zone(a, f"stand:{n}:hand", 38, ty + 1)
    # Three squares long: six cows side by side at a trough, fed from the pen side only.
    _trough(a, "cattle", "feed", 39, 15, 3)
    _trough(a, "cattle", "water", 44, 15, 3)
    a.ellipse("water", 46, 21, 3.6, 2.2)
    for x, y in ((42 * T + 6, 20 * T + 4), (43 * T, 22 * T + 10), (49 * T + 10, 20 * T), (50 * T, 22 * T + 6)):
        a.add(kit.reeds(), x, y)
    for x, y in ((45 * T, 20 * T + 12), (47 * T + 8, 22 * T)):
        a.add(kit.lily_pad(), x, y, ground=True)
    a.add(kit.round_tree(3), 40 * T, 22 * T + 8, (14, 4))
    a.add(kit.round_tree(7), 51 * T, 13 * T + 8, (14, 4))
    a.add(kit.rock(True), 44 * T + 8, 10 * T + 12, (5, 2))
    for tx, ty in ((42, 10), (48, 12), (38, 23)):
        tile_zone(a, "muck:cattle", tx, ty)

    # The muck heap in the lane down to the field, handy for the pens and the beds it goes back onto.
    a.ellipse("mud", 33, 19, 1.7, 1.3)
    a.wall(32, 18, 33, 19)
    tile_zone(a, "heapbox", 32, 18, 2, 2)
    tile_zone(a, "heap", 31, 19)


def _sty(a):
    """The pigs, west of the lane below the sheep: a bare-earth sty with the feed and water troughs up by the
    gate, a tin ark at the back with straw beds at its mouth, and a mud wallow they lie in through the heat
    of the day."""
    a.rect("path", 17, 26, 28, 27)                        # the track in from the lane to the gate
    a.rect("path", 18, 29, 27, 37)
    # The wallow: mud, with the dirt floor lifted off it (path paints over mud).
    wallow = {(x, y) for x in range(16, 26) for y in range(32, 40) if ((x - 20.5) / 2.6) ** 2 + ((y - 35.5) / 1.6) ** 2 <= 1}
    a.verts["mud"] |= wallow
    a.verts["path"] -= wallow
    _trough(a, "sty", "feed", 19, 30)
    _trough(a, "sty", "water", 24, 30)
    tile_zone(a, "aisle:sty", 19, 29, 6, 1)               # the way in along the troughs, kept clear of pigs
    # The ark stands clear of the fence so the piglets have room to lie round their mothers.
    a.add(props.pig_ark(), 24 * T + 8, 34 * T + 15, (22, 4))
    a.wall(23, 33, 25, 34)
    tile_zone(a, "bed:sty", 23, 35, 3, 1)
    tile_zone(a, "wallow:sty", 19, 35, 3, 1)
    tile_zone(a, "wallow:sty", 20, 36, 2, 1)
    for tx, ty in ((21, 32), (26, 32)):
        tile_zone(a, "muck:sty", tx, ty)
    _bale(a, 18, 37)
    a.solid.add((18, 37))


def _stable(a):
    """The horses, east of the lane: the stable faces its own yard, four stalls and the feed room, with a
    water butt at the west end and the stable hands' posts at the east; the paddock lies below with its gate
    off the yard, the two squares inside it where a horse waits to be brought in, troughs and a shade tree."""
    a.add(props.stable(), 39 * T, 31 * T, (70, 5), tag="stable")
    a.wall(42, 31, 43, 31)                                # the feed room; the stall row stays open
    for n, tx in enumerate((34, 36, 38, 40), start=1):
        tile_zone(a, f"stall:{n}", tx, 31)
        tile_zone(a, f"stall:{n}:hand", tx + 1, 31)
    # Hay and feed are kept in the feed room as well as on the stack, so the pens down here and the field
    # are fed and stacked from its door.
    tile_zone(a, "barn:feed", 43, 32)
    a.add(kit.barrel(), 33 * T + 8, 31 * T + 12, (6, 2))
    a.solid.add((33, 31))
    tile_zone(a, "well", 33, 32)
    a.rect("path", 32, 32, 46, 33)
    for tx in (45, 47):
        tile_zone(a, "post:stable", tx, 33)
    tile_zone(a, "muck:paddock", 38, 32)
    # In the paddock: where a horse waits by the gate to be caught, and the hand's square beside her.
    for n, tx in enumerate((37, 39), start=1):
        tile_zone(a, f"catch:{n}", tx, 37)
        tile_zone(a, f"catch:{n}:hand", tx, 36)
    _trough(a, "paddock", "feed", 42, 37)
    _trough(a, "paddock", "water", 46, 37)
    tile_zone(a, "aisle:paddock", 38, 36, 9, 1)
    tile_zone(a, "muck:paddock", 45, 41)
    a.add(kit.round_tree(11), 50 * T, 42 * T + 8, (14, 4))
    for tx, ty in ((36, 43), (52, 36)):
        _bale(a, tx, ty)
        a.solid.add((tx, ty))
    # The second muck heap, between the lane and the paddock.
    a.ellipse("mud", 33, 40, 1.7, 1.3)
    a.wall(32, 39, 33, 40)
    tile_zone(a, "heapbox", 32, 39, 2, 2)
    tile_zone(a, "heap", 31, 40)


def _orchard(a):
    """Old fruit trees in the grass west of the sty, where the forest was cleared first."""
    for tx, ty, seed in ((4, 31, 21), (9, 29, 22), (13, 32, 23), (6, 36, 24), (11, 37, 25), (4, 42, 26), (14, 41, 27)):
        a.add(kit.round_tree(seed), tx * T, ty * T + 8, (14, 4))
    for tx, kind in ((8, "yellow"), (12, "white"), (3, "purple")):
        a.add(farm_extras.flower_clump(kind, tx + 40), tx * T + 4, 34 * T + 6, ground=True)
    a.add(props.log_bench(), 8 * T, 39 * T + 12, (12, 2))
    a.wall(7, 39, 8, 39)


def _field(a):
    """Everything here is authored where it stood before the sty and the stable went in, and shifted south."""
    a.shift(SOUTH)
    for crop, (x0, x1) in BEDS.items():
        for y0, y1 in BED_ROWS:                          # the page lays the tilled soil and the crops
            a.zone(f"plot:{crop}", x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T)
    # The scarecrows stand in the gap between the beds and at the end of the corn, never on a bed.
    a.add(props.scarecrow(), 19 * T + 8, 28 * T + 12, (6, 2))
    a.wall(19, 28, 19, 28)
    a.add(props.scarecrow(), 33 * T + 8, 28 * T + 12, (6, 2))
    a.wall(33, 28, 33, 28)
    # The tool shed the field hands work out of, and their squares in front of it.
    a.add(props.shed_old(), 36 * T + 8, 31 * T + 12, (30, 4))
    for tx in (35, 37, 39):
        tile_zone(a, "post:field", tx, 32)
    a.add(props.plough(), 41 * T + 8, 28 * T + 12, (20, 3))
    a.wall(40, 28, 42, 28)
    _bale(a, 1, 26, 12, 0)
    _bale(a, 19, 33)
    _bale(a, 20, 33, 4, -2)
    a.wall(19, 33, 20, 33)
    # Beehives at the field's edge, among flowers, for the pollination.
    for i, tx in enumerate((44, 46, 48, 50)):
        a.add(props.beehive(), tx * T + 8, 30 * T + 12, (6, 2))
        a.wall(tx, 30, tx, 30)
        for j, kind in enumerate(("yellow", "purple", "white")):
            a.add(farm_extras.flower_clump(kind, i * 3 + j), tx * T + 2 + j * 7, 32 * T + 4 + (j % 2) * 6, ground=True)
    for x, y, b in ((53 * T, 30 * T, True), (2 * T + 8, 33 * T, False), (15 * T, 35 * T, False), (52 * T, 34 * T, True)):
        a.add(kit.bush(berries=b), x, y, (7, 2))
    a.add(kit.stump(), 34 * T + 4, 35 * T, (5, 2))
    a.shift(0)


def _treeline(a):
    """Pine and oak crowns round every edge, the near side of the forest the farm was cleared from. Open
    where the lane comes in from the west."""
    seed = 0
    for y in range(20, MH * T + 20, 30):
        for x in (8, 24, MW * T - 8, MW * T - 24):
            if x < 40 and 10 * T <= y <= 14 * T + 8:
                continue
            seed += 1
            a.add(lpc_trees.crown(seed), x + int(kit.hash2(x, y, 31) * 8) - 4, y, (11, 4))
    for x in range(40, MW * T - 30, 30):
        for y in (40, MH * T - 6, MH * T - 22):
            if y == 40 and 3 * T < x < 34 * T:              # the farmhouse, barn and windmill stand there
                continue
            seed += 1
            a.add(lpc_trees.crown(seed), x + int(kit.hash2(x, y, 32) * 8) - 4, y - int(kit.hash2(x, y, 33) * 6), (11, 4))
    for tx in range(MW):
        for ty in range(MH):
            if tx < BORDER or tx >= MW - BORDER or ty < BORDER or ty >= MH - BORDER:
                a.solid.add((tx, ty))


def build(for_game=False):
    a = Area("barnyard", MW, MH)
    _house(a)
    _yard(a)
    _fences(a)
    _pens(a)
    _sty(a)
    _stable(a)
    _orchard(a)
    _field(a)
    _treeline(a)
    a.spawn = (18 * T, 12 * T)
    return a


VIEWS = {"yard": (160, 64), "pasture": (560, 64), "sty": (240, 416), "stable": (512, 432), "field": (48, 720)}


if __name__ == "__main__":
    build().save(VIEWS)
