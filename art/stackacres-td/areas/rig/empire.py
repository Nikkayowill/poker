#!/usr/bin/env python3
"""The Far Field: open land behind the Homestead's east gate, empty so the player can build on it.

40x30 tiles. The same grass, litter, flowers and tree crowns as the Homestead, so walking through the gate
reads as the next field over and not another game. A treeline runs round the edge with a gap at the west
edge, where the gate is. Inside it the field is open: nothing stands in it and nothing is built, so the player
has the whole of it to clear and build on (docs/stackacres-second-map-direction.md section 6a).
"""
import os
import sys

import kit
from area import Area, T

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "rich"))
import direction_sign  # noqa: E402
import farm_extras  # noqa: E402
import lpc_trees  # noqa: E402

MW, MH = 40, 30
SPAWN = (40, 240)
BORDER = 2                                  # tiles of treeline round the edge
GAPS = {"west": [(224, 256)]}               # the gate: map pixels along the west edge

def _gap(side, v):
    return any(lo - 24 <= v <= hi + 24 for lo, hi in GAPS.get(side, ()))


def _treeline(a):
    """Crowns two deep along every edge, and the tiles under them walled. The west edge is open at the gate."""
    seed = 0
    for y in range(40, MH * T + 20, 30):
        for side, x in (("west", 8), ("west", 24), ("east", MW * T - 8), ("east", MW * T - 24)):
            if _gap(side, y):
                continue
            seed += 1
            a.add(lpc_trees.crown(seed), x + int(kit.hash2(x, y, 31) * 8) - 4, y, (11, 4))
    for x in range(20, MW * T, 30):
        for y in (MH * T - 6, MH * T - 22):
            seed += 1
            a.add(lpc_trees.crown(seed), x + int(kit.hash2(x, y, 32) * 8) - 4, y - int(kit.hash2(x, y, 33) * 8), (11, 4))
        for y in (22, 40):
            seed += 1
            a.add(lpc_trees.crown(seed), x + int(kit.hash2(x, y, 34) * 8) - 4, y + int(kit.hash2(x, y, 35) * 6), (11, 4))
    for tx in range(MW):
        for ty in range(MH):
            side = "west" if tx < BORDER else "east" if tx >= MW - BORDER else None
            if side is None and not (ty < BORDER or ty >= MH - BORDER):
                continue
            if side == "west" and _gap(side, ty * T + 8):
                continue
            a.solid.add((tx, ty))


def _flowers(a):
    """Clumps scattered through the open field, thin, the way the Homestead's meadow carries them."""
    kinds = farm_extras.KINDS
    placed = 0
    for y in range(8, MH * T, 11):
        for x in range(8, MW * T, 11):
            fx = x + int(kit.hash2(x, y, 21) * 8) - 4
            fy = y + int(kit.hash2(x, y, 22) * 8) - 4
            tx, ty = fx // T, fy // T
            if tx < BORDER + 1 or tx >= MW - BORDER - 1 or ty < BORDER + 1 or ty >= MH - BORDER - 1:
                continue
            if kit.hash2(x, y, 23) < 0.05:
                kind = kinds[int(kit.hash2(x, y, 24) * len(kinds))]
                a.add(farm_extras.flower_clump(kind, placed), fx, fy, ground=True)
                placed += 1


def build(for_game=False):
    a = Area("empire", MW, MH)
    # The way back: the west edge, onto the Homestead's east gate.
    a.exit("homestead", 0, 224, 10, 32, (984, 480))
    _treeline(a)
    _flowers(a)
    # A board above the lane in, so the way back reads from the first step.
    a.add(direction_sign.sign("HOMESTEAD", "west"), 130, 207, (6, 2))
    a.spawn = SPAWN
    return a


VIEWS = {"gate": (0, 160), "middle": (200, 120)}


if __name__ == "__main__":
    build().save(VIEWS)
