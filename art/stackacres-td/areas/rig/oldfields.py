#!/usr/bin/env python3
"""The Old Fields: Ray's big fields north of the Homestead, past the fallen log.

40x30 tiles. The lane comes up from the south to a field road. Three fields: the west
one cleared and planted again, the east one still furrowed under scrub, the north one
gone to bush entirely. The old shed and Ray's plough stand at the road's west end.
"""
import crops
import kit
import props
from area import Area, T

MW, MH = 40, 30

# The game's Old Fields ARE the live game's Crop Fields: `CROP_FIELD_BEDS` in lib/stackacres/world.ts,
# 32 by 32 soil tiles (world tiles -16..15 on both axes), laid here tile for tile with world tile
# (-16, -16) at map tile (FIELD_TX, FIELD_TY). lib/stackacres-td/field.ts holds the same numbers.
GAME_W, GAME_H = 44, 40
FIELD_TX, FIELD_TY, FIELD_TILES = 6, 2, 32


def build_game():
    """The playable Old Fields: one open, fenced field the player tills and plants themselves,
    with the shed, plough and scarecrow in the margins so nothing stands on plantable ground."""
    a = Area("oldfields", GAME_W, GAME_H)
    fx, fy, size = FIELD_TX * T, FIELD_TY * T, FIELD_TILES * T
    a.line("path", (22, FIELD_TY + FIELD_TILES + 1), (22, GAME_H))       # the lane back down to the Homestead
    a.line("path", (1, 36), (GAME_W - 1, 36))                            # the field road along the south fence
    a.add(kit.fence(size - 4, vertical=True), fx - 6, fy + size + 2)     # west rail
    a.add(kit.fence(size - 4, vertical=True), fx + size + 6, fy + size + 2)
    a.add(kit.fence(15 * T), fx + 8 * T - 4, fy + size + 10)            # south rail, open where the lane comes in
    a.add(kit.fence(15 * T), fx + 25 * T + 4, fy + size + 10)
    a.zone("field", fx, fy, size, size)

    a.add(props.shed_old(), 48, 300, (30, 5))
    a.add(props.plough(), 50, 364, (18, 3))
    a.add(props.scarecrow(), 60, 180, (7, 2))
    a.add(kit.hay_bale(), 36, 430, (9, 2))
    a.add(kit.hay_bale(), 58, 444, (9, 2))
    a.add(kit.crate(), 70, 500, (7, 2))
    a.add(kit.woodpile(), 660, 600, (13, 2))
    for x, y, big in ((650, 300, True), (40, 610, False)):
        a.add(kit.rock(big), x, y, (5, 2))
    for x, y, k in ((120, 616, "W"), (560, 616, "Y"), (660, 470, "R")):
        a.add(kit.flowers(k), x, y, ground=True)

    a.tree_line("north", depth=1, seed=12)
    a.tree_line("east", span=(0, 560), seed=12)
    a.tree_line("south", gaps=((300, 410),), depth=1, seed=12)
    a.exit("homestead", 320, GAME_H * T - 14, 64, 14, (232, 76))
    a.spawn = (352, 596)
    return a


def build(for_game=False):
    if for_game:
        return build_game()
    a = Area("oldfields", MW, MH)
    a.line("path", (19, 14), (19, MH))                 # the lane up from the fallen log
    a.line("path", (4, 14), (36, 14))                  # the field road
    a.rect("soil", 4, 17, 16, 27)                      # west field, cleared and planted
    a.rect("soil", 23, 17, 36, 27)                     # east field, furrows under scrub
    for y in (5, 8, 11):                               # north field: only strips of furrow left
        for x0, x1 in ((8, 14), (18, 25), (28, 33)):
            if kit.hash2(x0, y, 40) < 0.7:
                a.rect("soil", x0, y, x1, y)

    a.add(props.shed_old(), 84, 190, (30, 5))
    a.add(props.plough(), 150, 206, (18, 3))
    a.add(kit.hay_bale(), 40, 236, (9, 2))
    a.add(kit.hay_bale(), 60, 248, (9, 2))
    a.add(kit.crate(), 130, 236, (7, 2))
    a.add(kit.fence(192), 168, 264)                    # rail along the west field's road side
    a.add(kit.fence(200), 476, 264)                    # and the east field's
    a.add(props.scarecrow(), 168, 360, (7, 2))

    for ty in range(17, 28):                           # west field: a crop per row, most rows ready
        name = crops.NAMES[(ty - 17) // 2 % 3]
        for tx in range(4, 17):
            roll = kit.hash2(tx, ty, 41)
            if roll < 0.1:
                continue
            stage = 2 if (ty - 17) % 4 != 3 else 1
            a.add(crops.crop(name, stage), tx * T, ty * T + 4)
    for ty in range(17, 28):                           # east field: scrub over the furrows
        for tx in range(23, 37):
            roll = kit.hash2(tx, ty, 42)
            if roll < 0.55:
                continue
            if roll < 0.85:
                a.add(props.wild_growth(tx * 7 + ty), tx * T + 8, ty * T + 12, (8, 2))
            else:
                a.add(kit.bush(berries=roll > 0.95), tx * T + 8, ty * T + 12, (7, 2))
    for ty in range(4, 12):                            # north field: gone to bush
        for tx in range(6, 34):
            roll = kit.hash2(tx, ty, 43)
            if roll < 0.7:
                continue
            if roll < 0.9:
                a.add(props.wild_growth(tx * 3 + ty), tx * T + 8, ty * T + 12, (8, 2))
            elif roll < 0.96:
                a.add(kit.bush(berries=False), tx * T + 8, ty * T + 12, (7, 2))
            else:
                a.add(kit.round_tree(tx + ty), tx * T + 8, ty * T + 12, (14, 4))
    for x, y in ((520, 120), (110, 90), (460, 400)):
        a.add(kit.stump(), x, y, (5, 2))
    for x, y, big in ((600, 240, True), (60, 420, False), (350, 60, True)):
        a.add(kit.rock(big), x, y, (5, 2))
    for x, y, k in ((300, 250, "W"), (350, 440, "Y"), (120, 300, "R"), (600, 440, "W")):
        a.add(kit.flowers(k), x, y, ground=True)

    a.tree_line("north", depth=1)
    a.tree_line("west", gaps=((150, 230),))
    a.tree_line("east")
    a.tree_line("south", gaps=((270, 350),))
    a.character("farmer", 312, 320)
    return a


VIEWS = {
    "crossroad": (208, 128),
    "old-shed": (0, 96),
    "west-field": (64, 260),
    "gone-to-bush": (360, 260),
    "north-field": (208, 0),
}


if __name__ == "__main__":
    build().save(VIEWS)
