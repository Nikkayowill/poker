#!/usr/bin/env python3
"""Coastal Market: market stalls on the shore, and a dock to work from.

40x22 tiles. The shore road comes down from the Homestead to a row of stalls, then onto
the sand. A pier runs out into the sea. Miles works the stalls; Barnaby is out on the pier.
"""
import creatures
import kit
import people
import props
from area import Area

MW, MH = 40, 22


def build(for_game=False):
    a = Area("coast", MW, MH)
    a.line("path", (19, 0), (19, 11))                  # the shore road
    a.rect("sand", 0, 12, MW, MH)                      # the beach, with a wandering top edge
    a.ellipse("sand", 6, 11.5, 5, 1.6)
    a.ellipse("sand", 33, 11.5, 6, 1.8)
    a.ellipse("sand", 20, 11, 3, 1.2)
    a.rect("water", 0, 17, MW, MH)                     # the sea
    a.ellipse("water", 8, 17, 6, 1.6)
    a.ellipse("water", 30, 16.5, 8, 1.8)
    a.ellipse("water", 18, 17.5, 3, 1.4)
    a.line("stream", (4, 0), (4, 11), width=1)         # the Homestead's stream, down across the beach into the sea
    a.line("stream", (4, 11), (5, 17), width=1)

    for x, color, goods in ((104, "R", "fish"), (184, "L", "fruit"), (408, "v", "bread"), (488, "o", "cloth")):
        a.add(props.stall(color, goods), x, 150, (22, 3))
    a.add(props.lamppost(), 276, 150, (4, 1))
    a.add(props.lamppost(), 348, 150, (4, 1))
    a.add(kit.crate(), 140, 170, (7, 2))
    a.add(kit.barrel(), 236, 168, (6, 2))
    a.add(kit.barrel(), 448, 170, (6, 2))
    a.add(props.fish_rack(), 570, 160, (14, 2))
    a.add(props.pier(130), 440, 336, ground=True)      # flat, so people stand on it
    a.add(props.lobster_trap(), 400, 204, (8, 2))
    a.add(props.lobster_trap(), 418, 214, (8, 2))
    a.add(props.boat(), 150, 236, (20, 3))
    a.add(props.driftwood(), 250, 254, (14, 2))
    for x, y in ((90, 300), (580, 290), (300, 320)):
        a.add(props.buoy(), x, y)
    for x, y, big in ((40, 276, True), (610, 250, False), (560, 330, True), (20, 200, False)):
        a.add(kit.rock(big), x, y, (5, 2))
    for x, y, f in ((60, 190, False), (520, 200, True), (600, 180, False)):
        a.add(creatures.seagull(f), x, y, (3, 1))
    a.add(kit.reeds(), 30, 168)
    a.add(kit.reeds(), 620, 172)
    a.add(kit.reeds(), 330, 176)

    a.tree_line("north", gaps=((260, 370),), seed=4)
    a.tree_line("west", span=(0, 150), seed=4)
    a.tree_line("east", span=(0, 150), seed=4)
    a.add(kit.rock(False), 90, 120, (5, 2))
    a.add(kit.reeds(), 40, 60)
    a.character("miles", 250, 196)
    a.character("barnaby", 440, 262)
    a.exit("homestead", 296, 0, 32, 10, (512, 792))    # back up the shore road, to the Homestead's south gate
    a.spawn = (312, 22)
    if not for_game:
        a.character("farmer", 312, 190)
    return a


VIEWS = {
    "the-stalls": (176, 64),
    "the-pier": (320, 160),
    "boat-on-the-sand": (32, 140),
    "shore-road-in": (208, 0),
    "stream-mouth": (0, 150),
}
ANIMATED = ["the-pier", "stream-mouth"]


if __name__ == "__main__":
    build().save(VIEWS)
