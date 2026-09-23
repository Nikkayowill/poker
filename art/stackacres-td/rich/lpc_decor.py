"""The standing pieces that give the Homestead's margins some life: mushrooms at
the feet of trees, rocks and stumps along the edges, flowers by the buildings,
lily pads on the pond. All the LPC pack's (./lpc_props.py).

Kept to the MARGINS on purpose. The open yard is where a player hoes, and every
piece here stands on its square and keeps a bed off it; the Crop Fields are
left alone entirely, since filling those is a job of its own (the field is
meant to start overgrown with things to clear). So pieces go where nobody would
dig anyway: under trees, along the treeline, beside buildings.

Every spot is checked before anything goes on it: grass, not a road or the
water; outside the Crop Fields, the hen pen and the greenhouse footing; clear of
every doorway; and not on top of something already standing there. Placed by a
hash of the spot, so each export lays out the same farm.

Run only for the shipped art (export_rich.py), after the ground is worked out
and before the scene is, so shadows and draw order take these in like anything
else.
"""

import numpy as np

import lpc_props
import terrain

T = 16
CLEARANCE = 12            # map px kept between a new piece and anything already standing
EXIT_CLEARANCE = 24       # and between a new piece and any doorway


def _hash(x, y, salt):
    h = (int(x) * 374761393 + int(y) * 668265263 + salt * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) / 0xFFFFFFFF


def decorate(area, ground):
    owner = ground.owner
    height, width = owner.shape
    shut = [(x, y, w, h) for tag, x, y, w, h in area.zones if tag != "hen-spots"]   # the field, the pen, the footing
    taken = [(bx, by) for _, _, bx, by, _, ground_level, _ in area.items if not ground_level]
    doors = [(x + w / 2, y + h / 2) for _, x, y, w, h, _, _ in area.exits]

    def grass_at(x, y):
        return 0 <= x < width and 0 <= y < height and owner[int(y), int(x)] == 0

    def free(x, y):
        if not grass_at(x, y) or not grass_at(x - 6, y) or not grass_at(x + 6, y):
            return False
        if any(zx - 4 <= x <= zx + zw + 4 and zy - 4 <= y <= zy + zh + 4 for zx, zy, zw, zh in shut):
            return False
        if any(abs(x - dx) < EXIT_CLEARANCE and abs(y - dy) < EXIT_CLEARANCE for dx, dy in doors):
            return False
        return all(abs(x - tx) >= CLEARANCE or abs(y - ty) >= CLEARANCE for tx, ty in taken)

    def put(made, x, y, shadow=(5, 2)):
        area.add(made, int(x), int(y), shadow)
        taken.append((int(x), int(y)))

    # Mushrooms at the feet of about a third of the trees, on whichever side is free.
    trees = [(bx, by) for imgs, _, bx, by, _, ground_level, _ in list(area.items)
             if not ground_level and imgs[0].info.get("hires") and imgs[0].info.get("sway")]
    for n, (bx, by) in enumerate(trees):
        if _hash(bx, by, 11) > 0.34:
            continue
        for dx in (10, -10, 14, -14):
            if free(bx + dx, by + 3):
                put(lpc_props.mushrooms(n), bx + dx, by + 3, (4, 1))
                break

    # Rocks and stumps along the inside of the treeline, where nobody would dig.
    for n, (x, y) in enumerate(_margin_spots(width, height)):
        if _hash(x, y, 21) > 0.3 or not free(x, y):
            continue
        roll = _hash(x, y, 22)
        made = lpc_props.stump() if roll < 0.3 else lpc_props.rock(roll > 0.8, n)
        put(made, x, y)

    # Flowers by the buildings, a step off their walls.
    buildings = [(bx, by) for i, (_, _, bx, by, _, _, _) in enumerate(area.items)
                 if area.tags.get(i) in ("farmhouse", "barn", "workshop")]
    for n, (bx, by) in enumerate(buildings):
        for k, (dx, dy) in enumerate(((-34, 10), (34, 10), (-40, 22), (40, 22))):
            if _hash(bx + dx, by + dy, 31) < 0.6 and free(bx + dx, by + dy):
                put(lpc_props.flower(n + k), bx + dx, by + dy, (3, 1))

    # More lily pads on the pond, well in from its edge. The pond, not the stream: a stream is too narrow to float one.
    water = owner == terrain.CODE["water"]
    ys, xs = np.nonzero(water)
    for k in range(0, len(xs), max(1, len(xs) // 40)):
        x, y = int(xs[k]), int(ys[k])
        inner = all(0 <= y + dy < height and 0 <= x + dx < width and water[y + dy, x + dx]
                    for dx, dy in ((-10, 0), (10, 0), (0, -10), (0, 10)))
        if inner and _hash(x, y, 41) < 0.12 and all(abs(x - tx) >= 18 or abs(y - ty) >= 18 for tx, ty in taken):
            area.add(lpc_props.lily_pad(), x, y, ground=True)
            taken.append((x, y))
    return area


def _margin_spots(width, height):
    """Candidate spots in a band two to four squares in from each edge of the map."""
    spots = []
    for inset in (2.5 * T, 3.5 * T):
        for x in range(int(inset), width - int(inset), 36):
            spots += [(x, inset), (x, height - inset)]
        for y in range(int(inset), height - int(inset), 36):
            spots += [(inset, y), (width - inset, y)]
    return spots

