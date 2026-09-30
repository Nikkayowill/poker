#!/usr/bin/env python3
"""The City: the old market town over the river from the Homestead, where the grocery is.

60x57 tiles, laid out the way English market towns grew (docs/stackacres-second-map-direction.md; Kayo's
picks of 2026-09-27: a small town in three areas, old market town style):

- THE MARKET PLACE. The road from the Homestead crosses the river on a stone bridge and widens into the square,
  narrow at the bridge and broad at its far end, the way markets were made by widening the road to a
  crossing. Along its north side, stepping down toward the river: the Wheatsheaf inn with its coaching arch,
  the tailor, the GROCERY (Kayo's sketch, with its generator and hand cart in the service alley on its left)
  and the bakery, with a flagged pavement and a kerb along their fronts. On the square: the pillared market
  hall with its clock, the market cross in a ring of sandstone, a row of stalls facing the shops across it, the
  town well and lamps at the corners and the ways in. Mill Row's terrace closes its south side.
- THE LANE leaves the square's far corner, climbs past the manager's house and runs east along the cottages
  behind their picket gardens, then down the riverside to the bridge, so the town is a loop you can walk.
- THE RIVERSIDE: the bank path with a fishing jetty north of the bridge; below it the quay where the
  grocery's deliveries land, with its crane and a boat; the watermill turning further down, its yard of flour
  sacks in front. The green, the chapel in its walled churchyard and the allotments fill the south.

Buildings face the street and the viewer. The square, the lanes, the paths and the forest edge follow the
land rather than a grid.

How it is dressed follows what the good top-down towns do (Stardew's Pelican Town, Chef RPG's town devlog, the
Level Design Book): walkable ground kept calm so people and doors stand out on it, the busy detail at the shop
fronts and the edges, something different either side of each door, lamps on the beats of the street rather than
in the middle, no walkable ground hidden behind a building, and the pack's own drawn pieces (city_pack.py) rather
than code-drawn ones wherever the pack has one.
"""
import math
import os
import sys

from PIL import Image

import kit
import props
from area import Area, T

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "rich"))
import area_town  # noqa: E402
import city_buildings as C  # noqa: E402
import city_ground as G  # noqa: E402
import city_kit as K  # noqa: E402
import city_pack as Q  # noqa: E402
import extras  # noqa: E402
import farm_extras  # noqa: E402
import lpc_trees  # noqa: E402

MW, MH = 60, 57
RIVER_HALF = 2.6
BRIDGE_ROWS = (27, 29)                         # the road's three rows across the bridge
MILL_FOOT = 50.4                               # the watermill's front, clear of Mill Lane behind it


def river_x(y):
    """The river's centre line: east across the top of the map, west under the bridge, east again past the mill."""
    return 50 + 2.0 * math.sin((y + 4) / 8)


def bank(y):
    """The river's west bank, where the town stops."""
    return river_x(y) - RIVER_HALF


MILL_X = bank(MILL_FOOT - 1) - 3.8             # the watermill's middle, its wheel out in the river


# ---------------------------------------------------------------- the town's outline, in map squares

def frontage(x):
    """The square's north edge: the frontage's feet, stepping down toward the river."""
    return 21.9 if x < 18.6 else 22.3 if x < 23.8 else 22.7 if x < 36.9 else 23.7


def square_south(x):
    """The square's south edge: round under the market hall, then in a long easing curve to the bridge."""
    if x < 12:
        return 33.4 + 0.8 * math.sqrt(max(0.0, 1 - ((x - 10) / 6.2) ** 2)) - 1.2 * max(0.0, (6 - x) / 2.5) ** 2
    return 33.4 - 3.9 * max(0.0, min(1.0, (x - 12) / 29)) ** 1.2 + 0.35 * math.sin(x / 2.1)


def square_west(y):
    """The square's west edge, bowing out round the back of the market hall."""
    return 5.4 - 1.6 * math.sqrt(max(0.0, 1 - ((y - 28.6) / 6.0) ** 2)) + 0.2 * math.sin(y / 1.3)


def in_square(x, y):
    if x < square_west(y) or x > bank(y) + 0.2:
        return False
    if x > 42.5:                                               # the bridge approach: just the road
        return BRIDGE_ROWS[0] - 0.1 <= y <= BRIDGE_ROWS[1] + 1.1
    return frontage(x) <= y <= square_south(x)


def lane_y(x):
    return 11.3 + 0.5 * math.sin(x / 4.9)


def on_lane(x, y):
    across = lane_y(x) <= y <= lane_y(x) + 1.35 and 8.4 <= x <= 44.5
    link = 8.4 <= x <= 9.8 + 0.25 * math.sin(y / 1.6) and 12 <= y <= 22.5
    down = 12 <= y <= BRIDGE_ROWS[0] and bank(y) - 3.0 <= x <= bank(y) - 1.6 + 0.2 * math.sin(y / 2)
    return across or link or down


def tile_zone(a, tag, tx, ty, w=1, h=1):
    a.zone(tag, tx * T, ty * T, w * T, h * T)


def paint(a, material, inside):
    a.verts[material].update((x, y) for y in range(a.h + 1) for x in range(a.w + 1) if inside(x, y))


SMOKING = {"inn", "bakery", "home:mabel", "home:hank", "home:tomas", "home:manager", "millrow"}


def place(a, made, cx, foot, tag=None, shadow=None):
    """A building from city_buildings, its base point on (cx, foot) in map squares. The inn, the bakery's oven and
    a few of the houses have a fire in, and smoke from their chimneys."""
    (img, base), meta = made
    a.add((img, base), round(cx * T), round(foot * T), shadow or (img.width // 2 - 8, 6), tag=tag)
    if tag in SMOKING:
        for dx, dy in meta.get("chimneys", ())[:1]:
            a.add(props.smoke(), round(cx * T) + dx, round(foot * T) + dy)
    return meta


def put(a, made, x, y, shadow=None, tag=None, ground=False):
    """Anything standing at map square (x, y), its base point there."""
    a.add(made, round(x * T), round(y * T), shadow, tag=tag, ground=ground)


# ---------------------------------------------------------------- the ground

def ground(a):
    paint(a, "water", lambda x, y: abs(x - river_x(y)) <= RIVER_HALF)
    # The square is paved in setts over a cobble underlay the pack paints at its ragged edge, with a York-stone
    # pavement and a granite kerb along the shop fronts and a ring of sandstone round the market cross
    # (city_ground.py).
    paint(a, "cobble", in_square)
    a.add(G.ground_item(market_paving()), 0, 18 * T, ground=True)
    a.add(G.ground_item(mill_row_pavement()), 21 * T, 39 * T, ground=True)
    paint(a, "cobble", lambda x, y: 23.6 <= x <= 25.8 and 17.5 <= y <= 23)     # the service alley
    paint(a, "path", on_lane)
    # Mill Lane, in front of the terrace, from the churchyard gate to the quay
    paint(a, "path", lambda x, y: 13.5 <= x <= bank(y) - 1 and 40.5 + 0.3 * math.sin(x / 3) <= y <= 41.8 + 0.3 * math.sin(x / 3))
    # the path from the square round the green to the churchyard gate
    paint(a, "path", lambda x, y: 32 <= y <= 42.4 and abs(x - (14.2 + 1.2 * math.sin(y / 2.2))) <= 0.7)
    # in through the lych gate, down the chapel's east side and round to its door
    paint(a, "path", lambda x, y: 42.4 <= y <= CHAPEL_FOOT + 1.4 and abs(x - (GATE_X + 0.2 * math.sin(y / 1.7))) <= 0.6)
    paint(a, "path", lambda x, y: CHAPEL_X + 0.4 <= x <= GATE_X + 0.6
          and abs(y - (CHAPEL_FOOT + 0.8 + 0.2 * math.sin(x / 1.9))) <= 0.6)
    # the mill track, off Mill Lane down the mill's west side to its door
    mx = MILL_X
    paint(a, "path", lambda x, y: 41.8 <= y <= MILL_FOOT + 1.2 and abs(x - (mx - 4.4 + 0.2 * math.sin(y / 2))) <= 0.6)
    paint(a, "path", lambda x, y: mx - 4.9 <= x <= mx + 0.6 and MILL_FOOT + 0.2 <= y <= MILL_FOOT + 1.3)
    # the quay lane down from the square's corner, and the quay's paving
    paint(a, "path", lambda x, y: 29 <= y <= 40 and 41.2 + (y - 29) * 0.12 <= x <= 42.8 + (y - 29) * 0.12)

    def quay(x, y):
        return 33.5 <= y <= 40.5 and bank(y) - 3.4 <= x <= bank(y) + 0.15

    paint(a, "cobble", quay)
    a.add(G.ground_item(G.square_setts(quay, 40, 33, 50, 42, seed=6, fringe=0.3, tone=wear)), 40 * T, 33 * T, ground=True)
    # the road on east to the Homestead, dirt once it leaves the town
    paint(a, "path", lambda x, y: x >= 52 and BRIDGE_ROWS[0] - 0.1 <= y <= BRIDGE_ROWS[1] + 1.1 + 0.3 * math.sin(x))


# ---------------------------------------------------------------- the paving

PAVEMENT = (9.8, 42.9)                          # where the shop fronts' pavement runs, west to east
CROSS_AT = (21.5, 27.0)                         # the middle of the market cross's steps


def kerb_y(x):
    """The kerb along the shop fronts: level past the inn and the tailor, easing down past the grocery to the bakery,
    which stands a step lower toward the river."""
    t = max(0.0, min(1.0, (x - 26) / 12))
    return 23.3 + 1.7 * t * t * (3 - 2 * t)


def on_pavement(x, y):
    return PAVEMENT[0] <= x <= PAVEMENT[1] and frontage(x) - 0.35 <= y <= kerb_y(x)


def wear(x, y):
    """How worn the square's stones are, a whole shade either way: grimy in slow patches and in front of the stalls,
    rubbed smooth along the way from the bridge to the grocery's door."""
    n = G.value_noise(x, y, 5.0, 7)
    shift = -1 if n < 0.28 else 1 if n > 0.8 else 0
    for cx, foot, *_ in STALLS:
        if abs(x - cx) < 1.6 and 0 <= y - foot < 1.2:
            shift = -1
    for (ax, ay), (bx, by) in (((46, 28.4), (38, 27.2)), ((38, 27.2), (31.2, 24.4))):
        t = max(0.0, min(1.0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
        if math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) < 0.9:
            shift = max(shift, 1)
    return shift


def market_paving():
    """The market place's ground picture, from map square (0, 18) to (47, 36)."""
    x0, y0, x1, y1 = 0, 18, 47, 36

    def setts_here(x, y):
        return in_square(x, y) and not on_pavement(x, y)

    img = G.square_setts(setts_here, x0, y0, x1, y1, seed=5, fringe=0.4, tone=wear,
                         bands=[(CROSS_AT[0], CROSS_AT[1], 1.75, 2.55)],
                         cover=lambda x, y: in_square(x, y) or on_pavement(x, y))
    img.alpha_composite(G.flagstones(on_pavement, x0, y0, x1, y1, seed=3))
    img = G.kerb_line(img, x0, y0, PAVEMENT[0], PAVEMENT[1], kerb_y)
    for x in PAVEMENT:
        img = G.kerb_end(img, x0, y0, x - (0 if x == PAVEMENT[0] else 5 / 32), frontage(x) - 0.2, kerb_y(x) + 0.3)
    return img


def mill_row_pavement():
    """A strip of flags in front of Mill Row, its kerb stepping down to the lane (no gutter: the lane is earth)."""
    x0, y0, x1, y1 = 21, 39, 37, 42
    inside = lambda x, y: 21.9 <= x <= 35.9 and 40.0 <= y <= 41.0      # noqa: E731
    img = G.flagstones(inside, x0, y0, x1, y1, seed=8)
    img = G.kerb_line(img, x0, y0, 21.9, 35.9, lambda x: 41.0, gutter=False)
    for x in (21.9, 35.9 - 5 / 32):
        img = G.kerb_end(img, x0, y0, x, 40.0, 41.3)
    return img


def bridge(a):
    """The stone bridge, drawn into the ground so everyone walks over it; its parapets don't walk."""
    c = river_x(28)
    x0, x1 = int(c - RIVER_HALF - 1.4), int(c + RIVER_HALF + 1.4) + 1
    img = C.stone_bridge((x1 - x0) * 32)
    a.add(G.ground_item(img), x0 * T, BRIDGE_ROWS[0] * T - img.info["deck"] // 2, ground=True)
    for tx in range(x0, x1):
        a.solid.update({(tx, BRIDGE_ROWS[0] - 1), (tx, BRIDGE_ROWS[1] + 1)})


# ---------------------------------------------------------------- the market place

INN = dict(width=256, storeys=2, wall="stone", upper="timber", roof="slate", bays=4, ground="arch", door_bay=1,
           sign="sheaf", chimneys=(0.12, 0.88), board="THE WHEATSHEAF", seed=2)
TAILOR = dict(width=128, storeys=2, wall="plaster", wash="yellow", roof="tile", bays=2, ground="shop", name="TAILOR",
              paint="plum", sign="scissors", chimneys=(0.7,), seed=6)
BAKERY = dict(width=160, storeys=2, wall="brick", roof="tile", bays=2, ground="shop", name="BAKERY", paint="red",
              sign="loaf", chimneys=(0.78,), awning=K.CANVAS_RED, seed=1)
MILL_ROW = [
    dict(width=128, storeys=2, wall="brick", roof="slate", bays=2, door_bay=1, paint="green", chimneys=(0.2,), seed=21),
    dict(width=128, storeys=2, wall="plaster", wash="sage", roof="slate", bays=2, door_bay=0, paint="red",
         chimneys=(0.8,), seed=22),
    dict(width=128, storeys=2, wall="plaster", wash="cream", roof="tile", bays=2, door_bay=1, paint="blue",
         chimneys=(0.2,), seed=23),
]
STALLS = [
    # (centre x, foot y, canvas, goods): a gently bowed row south of the market cross, facing the shops across
    # it, and two more out toward the bridge
    (16.7, 29.9, K.CANVAS_RED, "fruit"), (19.9, 30.4, K.CANVAS_GREEN, "greens"),
    (23.2, 30.4, K.CANVAS_BLUE, "bread"), (26.4, 29.9, K.CANVAS_RED, "fruit"),
    (32.0, 27.6, K.CANVAS_GREEN, "greens"), (35.6, 28.4, K.CANVAS_BLUE, "fruit"),
]
# Street lamps on the beats a town puts them (Stardew does the same): at the corners and the ways in, in pairs at
# either end of the bridge, and along the kerb; never out in the middle where people cross.
LAMPS = [(12.6, None), (24.3, None), (36.9, None),
         (43.6, 26.7), (43.6, 30.95), (53.4, 26.7), (53.4, 30.95),
         (15.9, 33.9), (40.3, 31.4)]


def market(a):
    shops(a)
    square(a)
    shop_fronts(a)
    # Mill Row, closing the square's south side: its fronts face Mill Lane
    for spec, cx in zip(MILL_ROW, (24.4, 28.9, 33.4)):
        place(a, C.kit(spec, depth_tiles=4), cx, 40.4, tag="millrow")
    mill_row_gardens(a)


def shops(a):
    place(a, C.kit(INN, depth_tiles=6), 14.3, 21.9, tag="inn")
    place(a, C.kit(TAILOR), 20.95, 22.3, tag="tailor")
    g = C.market_grocery()
    grocery = C.made(g, g.info["foot"], g.info["base_x"], 7 * T, g.info["lights"], g.info["door"])
    meta = place(a, grocery, 31.4, 22.7, tag="grocery", shadow=(88, 7))
    door_x = round(31.4 * T) + meta["door"]
    a.door("grocery", door_x - 16, round(22.7 * T) - 12, 32, 12, (224, 262))
    place(a, C.kit(BAKERY), 39.45, 23.7, tag="bakery")
    # the service alley beside the grocery: its hand cart, crates waiting to go in, the bins
    a.add((C.hand_cart(), (32, 42)), 24 * T + 14, 20 * T + 10, (14, 3))
    put(a, Q.crate(0), 24.5, 21.9, (7, 2))
    put(a, Q.crate(3), 24.5, 22.8, (7, 2))
    put(a, Q.bin_(0), 23.9, 20.4, (5, 2))
    a.wall(24, 20, 24, 22)


def square(a):
    """The market place itself: the hall, the cross in its ring of sandstone, the stalls round it, the well, lamps."""
    hall = C.made(C.market_hall(), 288, depth=6 * T,
                  lights=[(60, 176, "window"), (116, 176, "window"), (172, 176, "window"), (228, 176, "window")])
    place(a, hall, 10.2, 32.8, tag="markethall")
    place(a, C.made(C.market_cross(), 132, depth=16), 21.5, 27.6, tag="cross", shadow=(14, 4))
    for x in (18.3, 24.7):                                             # benches either side of the cross's ring
        put(a, area_town.bench(), x, 26.8, (10, 2))
        a.solid.add((int(x), 26))
    for i, (cx, foot, cloth, goods) in enumerate(STALLS):
        place(a, C.made(C.market_stall(cloth, goods, seed=i), 92, depth=16), cx, foot, tag=f"stall:{i + 1}", shadow=(24, 4))
    # stock beside the stalls: baskets and crates set down by whoever runs them
    for x, y, piece in ((14.8, 29.8, Q.basket(2)), (28.3, 29.9, Q.crate(1)), (30.0, 27.7, Q.basket(1)),
                        (37.7, 28.5, Q.crate(5))):
        put(a, piece, x, y, (6, 2))
    # the town well by the market hall, where the square is widest
    a.add(kit.well(), round(15.8 * T), round(25.9 * T), (10, 3), tag="well")
    a.solid.update({(15, 25), (16, 25)})
    a.add(area_town.notice_board(), 7 * T + 8, 23 * T + 14, (12, 2), tag="noticeboard")
    a.solid.add((7, 23))
    put(a, Q.planter("tree_box"), 5.6, 33.3, (8, 2))                    # a bay tree at the hall's corner
    for x, foot in LAMPS:
        put(a, Q.street_lamp(), x, kerb_y(x) - 0.2 if foot is None else foot, (4, 1))
    for tx, ty in ((38.6, 35.4), (4.8, 23.4)):
        a.add(kit.round_tree(40 + int(tx)), round(tx * T), round(ty * T), (14, 4))
    # the carrier's cart by the way down to the quay, unloaded barrels beside it
    a.add(area_town.market_cart(), 41 * T, 30 * T + 12, (16, 3))
    a.wall(40, 30, 41, 30)
    put(a, Q.barrels(), 39.4, 29.8, (12, 3))


def shop_fronts(a):
    """What stands out on the pavement, a different thing either side of each door, the way Stardew dresses them."""
    # the Wheatsheaf: the horse trough left of its coaching arch, a table and a barrel for drinkers right of it
    put(a, Q.water_trough(), 11.1, 23.15, (14, 2))
    put(a, Q.table(0), 16.3, 23.2, (22, 3))
    put(a, Q.barrel(0), 18.25, 23.05, (6, 2))
    # the tailor: rolls of cloth by the window, a bay tree in a box by the door
    put(a, Q.fabric_rolls(3), 19.3, 23.05, (6, 2))
    put(a, Q.fabric_rolls(0), 19.9, 23.15, (6, 2))
    put(a, Q.planter("fern_box"), 22.75, 23.1, (7, 2))
    # the bakery: the day's loaves on a trestle under the awning, a pot of geraniums the other side
    put(a, Q.bread_table(), 37.95, 24.95, (22, 3))
    put(a, Q.planter("red_pot"), 41.75, 24.9, (6, 2))


def mill_row_gardens(a):
    """Mill Row's back gardens, between the square and the terrace. The terrace's roofs are the edge you see, so
    the gardens behind them are simply out of bounds: nobody walks in where the roofs would hide them. An apple
    tree shows over the roofs."""
    a.solid.update((tx, ty) for tx in range(21, 37) for ty in range(32, 37))
    a.add(kit.round_tree(66), round(22.2 * T), round(35.4 * T), (12, 3))


# ---------------------------------------------------------------- the lane

COTTAGES = [
    # (centre x, foot y, who lives there, the house)
    (13.4, 9.8, "mabel", dict(width=128, storeys=1, wall="plaster", wash="white", roof="thatch", bays=3, dormers=1,
                                paint="blue", shutters="green", chimneys=(0.8,), seed=11)),
    (18.6, 10.1, "gus", dict(width=128, storeys=2, wall="plaster", wash="pink", roof="slate", bays=2, door_bay=0,
                              paint="black", chimneys=(0.5,), seed=12)),
    (23.8, 9.8, "priya", dict(width=128, storeys=2, wall="brick", roof="tile", bays=2, door_bay=1, paint="teal",
                                chimneys=(0.25,), seed=13)),
    (29.0, 10.2, "hank", dict(width=128, storeys=1, wall="plaster", wash="yellow", roof="thatch", bays=3, dormers=1,
                               paint="red", shutters="blue", chimneys=(0.2,), seed=14)),
    (34.2, 9.9, "lena", dict(width=128, storeys=2, wall="timber", roof="tile", bays=2, door_bay=0, paint="green",
                               chimneys=(0.75,), seed=15)),
    (39.4, 10.1, "tomas", dict(width=128, storeys=2, wall="plaster", wash="blue", roof="slate", bays=2, door_bay=1,
                                paint="mustard", chimneys=(0.3,), seed=16)),
]
MANAGER = dict(width=192, storeys=3, wall="brick", roof="slate", bays=3, hip=12, paint="black", quoins=K.STONE,
               chimneys=(0.12, 0.88), boxes=False, seed=5)


DOORSTEP = {                                    # what each cottage keeps by its door, and which side
    "mabel": (lambda: Q.planter("pink_pot"), 1), "gus": (lambda: Q.potted_plant(0), -1),
    "priya": (lambda: Q.planter("red_pot"), 1), "hank": (lambda: Q.potted_plant(1), 1),
    "lena": (lambda: Q.planter("pink_pot"), -1), "tomas": (lambda: Q.bin_(2), -1),
}


def picket(a, x0, w, foot, gate_x):
    """A white picket fence `w` map px long from x0 along a front garden, its gate at gate_x."""
    pic = C.picket(w * 2, gate_at=max(2, (gate_x - x0 - 7) * 2))
    a.add(C.stand_in(pic, (0, pic.height - 2)), x0, foot)


def lane(a):
    for cx, foot, who, spec in COTTAGES:
        meta = place(a, C.kit(spec), cx, foot, tag=f"home:{who}")
        door = round(cx * T) + meta["door"]
        tile_zone(a, f"door:{who}", door // T, int(foot))
        fx0 = round(cx * T) - 38
        picket(a, fx0, 76, round(foot * T) + 15, door)
        a.doorways.add((door // T, (round(foot * T) + 15) // T))       # the garden gate walks
        for k, kind in enumerate(("red", "yellow", "white", "pink")):
            fx = fx0 + 8 + k * 17
            if abs(fx - door) > 12:
                a.add(farm_extras.flower_clump(kind, int(cx * 10) + k), fx, round(foot * T) + 8, ground=True)
        pot, side = DOORSTEP[who]                                       # something by each door, never the same
        a.add(pot(), door + side * 13, round(foot * T) + 6)
    for x in (16.0, 26.4, 36.8):
        a.add(props.hedge(12), round(x * T), 9 * T + 14, (6, 2))
    meta = place(a, C.kit(MANAGER, depth_tiles=6), 4.9, 12.2, tag="home:manager")
    door = round(4.9 * T) + meta["door"]
    tile_zone(a, "door:manager", door // T, 12)
    # the manager's house is the smart one: a clipped bay in an urn each side of the door
    for dx in (-1.0, 1.0):
        put(a, Q.planter("topiary_urn"), door / T + dx, 12.6, (7, 2))
    for tx, ty in ((3.0, 17.0), (5.6, 19.8)):
        a.add(kit.round_tree(52 + int(ty)), round(tx * T), round(ty * T), (14, 4))
    back_yards(a)


def back_yards(a):
    """The market row's back yards, walled off from the lane: nobody walks in behind the shops where their roofs
    would hide them. Washing is out over the wall behind the bakery."""
    x = 10.2
    while x < 43.0:
        w = min(1.3, 43.0 - x)
        y = lane_y(x + w / 2) + 1.35 + 1.1
        a.add(C.low_wall(round(w * T)), round(x * T), round(y * T))
        for tx in range(int(x), int(math.ceil(x + w))):
            a.solid.update((tx, ty) for ty in range(int(y), 20))
        x += w
    a.add(C.washing_line(), round(39.4 * T), round(15.6 * T), (26, 2))


# ---------------------------------------------------------------- the riverside

def riverside(a):
    for ty in (6, 15, 20):
        a.add(kit.round_tree(60 + ty), round((bank(ty) - 4.2) * T), ty * T + 12, (14, 4))
    for ty in range(3, 26, 3):
        a.add(kit.reeds(), round((bank(ty) + 0.3) * T), ty * T + 8)
        a.add(kit.reeds(), round((river_x(ty) + RIVER_HALF - 0.3) * T), ty * T + 14)
    jy = 17
    a.add(farm_extras.dock(40), round((bank(jy) - 0.4) * T), jy * T + 8, ground=True)
    # Water lilies where the river runs slow, on the inside of its bends, and bulrushes on the banks (the
    # pack's own, like Stardew's river edges).
    for k, (side, y) in enumerate((("w", 8.5), ("e", 19.0), ("w", 12.2), ("e", 35.6), ("w", 41.0), ("e", 44.6))):
        x = river_x(y) - 1.9 if side == "w" else river_x(y) + 1.8
        put(a, Q.lily(k), x, y)
    for side, y in (("w", 7.2), ("w", 23.2), ("e", 12.6), ("e", 42.2), ("e", 31.8)):
        x = bank(y) - 0.2 if side == "w" else river_x(y) + RIVER_HALF + 0.3
        put(a, Q.cattails(), x, y, (4, 1))
    put(a, area_town.bench(), 54.6, 18.8, (10, 2))                    # a seat on the far bank, looking at the water
    # the quay: the crane, the grocery's crates and barrels waiting, a boat tied up, bollards on the edge
    qx = bank(37)
    place(a, C.made(C.crane(), 148, depth=10), qx - 1.0, 37.4, tag="crane", shadow=(10, 3))
    for k, (tx, ty) in enumerate(((qx - 3.0, 34.6), (qx - 3.6, 35.6), (qx - 2.8, 38.8), (qx - 3.4, 39.8))):
        put(a, Q.crate((0, 2, 3, 1)[k]), tx, ty, (7, 2))
    put(a, Q.barrels(), qx - 1.6, 40.4, (12, 3))
    for ty in (34.8, 39.6):
        a.add((C.bollard(), (9, 20)), round((bank(ty) - 0.1) * T), round(ty * T), (4, 1))
    a.add(farm_extras.boat(), round((bank(38) + 1.3) * T), 39 * T)
    # the watermill and its wheel turning in the river, its yard in front: flour sacks, a spare millstone, a cart
    mill = C.made(C.watermill(), 280, depth=6 * T, lights=[(50, 178, "window"), (174, 178, "window")])
    mx = MILL_X
    place(a, mill, mx, MILL_FOOT, tag="mill")
    frames = [(f.resize((f.width // 2, f.height // 2), Image.NEAREST), (f.width // 4, f.height // 2 - 8)) for f in C.mill_wheel()]
    a.add(frames, round((mx + 4.0) * T), round((MILL_FOOT - 0.5) * T))
    wheel = (int(mx + 3.6), int(mx + 4.6))
    a.solid.update({(tx, ty) for tx in wheel for ty in (int(MILL_FOOT) - 2, int(MILL_FOOT) - 1)})
    a.add(C.millstone(), round((mx - 2.9) * T), round((MILL_FOOT + 0.3) * T), (10, 2))
    a.add(C.flour_sacks(), round((mx - 1.5) * T), round((MILL_FOOT + 0.4) * T), (12, 2))
    a.add((C.hand_cart(), (32, 42)), round((mx + 2.4) * T), round((MILL_FOOT + 1.6) * T), (14, 3))
    a.wall(int(mx + 1.8), int(MILL_FOOT + 1.6), int(mx + 3.0), int(MILL_FOOT + 1.6))


# ---------------------------------------------------------------- the green, the churchyard, the allotments

def south(a):
    a.add(kit.round_tree(71), 5 * T, 40 * T + 12, (16, 5))            # the old oak on the green
    a.add(kit.round_tree(73), 2 * T + 8, 35 * T + 12, (14, 4))
    for tx, ty in ((8, 39), (3, 42)):
        a.add(area_town.bench(), tx * T + 8, ty * T + 12, (10, 2))
        a.solid.add((tx, ty))
    for i, kind in enumerate(("yellow", "white", "purple", "red", "pink", "yellow")):
        a.add(farm_extras.flower_clump(kind, 80 + i), round((3 + i * 1.6) * T), (35 + i % 2) * T + 6, ground=True)
    put(a, Q.birdbath(), 6.8, 36.6, (7, 2))
    churchyard(a)
    allotments(a)


# The churchyard, the way English ones are laid out: the church near its north wall, the lych gate on the lane
# and a path round to the door on its south side, the graves mostly on that sunny south side, a yew by the
# gate and another in the corner, and a clipped hedge on the side it shares with the allotments.
CHAPEL_X, CHAPEL_FOOT = 9.6, 49.4
GATE_X = 14.2
HEDGE_X = 19.9


def churchyard(a):
    place(a, C.made(C.chapel(), 348, depth=7 * T, lights=[(158, 210, "window")]), CHAPEL_X, CHAPEL_FOOT, tag="chapel")
    for x0, x1, y in ((3.0, GATE_X - 0.8, 42.4), (GATE_X + 0.8, HEDGE_X - 0.3, 42.4)):
        a.add(C.low_wall(round((x1 - x0) * T)), round(x0 * T), round(y * T))
        a.solid.update({(tx, int(y)) for tx in range(int(x0), int(math.ceil(x1)))})
    a.add(C.lychgate(), round(GATE_X * T), round(42.6 * T), (14, 3))
    for k in range(22):                                               # the hedge down the east side
        ty = 43.0 + k * 0.5
        a.add(props.hedge(18), round((HEDGE_X - 0.7 + 0.12 * (k % 2)) * T), round(ty * T), (6, 2))
        a.solid.add((int(HEDGE_X), int(ty)))
    graves = ((16.4, 44.6), (18.2, 45.2), (16.8, 46.9), (18.4, 47.8), (4.6, 49.6),
              (5.4, 51.4), (7.0, 52.3), (8.6, 51.5), (6.2, 53.5), (11.8, 52.3), (13.4, 53.2), (15.6, 51.6),
              (17.4, 52.5), (15.0, 53.7), (18.6, 50.4))
    for i, (tx, ty) in enumerate(graves):
        stone = (lambda: (C.gravestone(0), (11, 27)), Q.headstone, lambda: (C.gravestone(1), (11, 27)), Q.stone_cross)[i % 4]
        put(a, stone(), tx, ty, (6, 2))
        a.solid.add((int(tx), int(ty)))
        if i in (2, 7, 11):                                            # fresh flowers on a few
            put(a, Q.flowers(i), tx + 0.1, ty + 0.35)
    a.add(kit.round_tree(75), round(4.4 * T), round(46.6 * T), (14, 4))  # the yews
    a.add(kit.round_tree(77), round(17.8 * T), round(43.8 * T), (12, 4))
    a.add(area_town.bench(), 16 * T + 8, 49 * T + 12, (10, 2))
    a.solid.add((16, 49))


def allotments(a):
    """Two rows of beds between the churchyard hedge and the mill: carrots, potatoes, wheat and radishes, a
    scarecrow in the potatoes, runner beans up their canes, beehives and fruit bushes at the bottom, the shed."""
    rows = ((43.6, ("carrot", "potato", "wheat", "radish")), (47.2, ("radish", "potato", "carrot", None)))
    for by, crops in rows:
        for i, crop in enumerate(crops):
            bx = 21.2 + i * 3.4
            a.add(G.ground_item(C.raised_bed(3, 2, seed=i + int(by))), round(bx * T), round(by * T), ground=True)
            if crop is None:
                for k in range(3):                                    # runner beans up their canes
                    a.add(C.bean_canes(k), round((bx + 0.6 + k * 0.9) * T), round((by + 1.6 + (k % 2) * 0.2) * T), (8, 2))
                    a.solid.add((int(bx + 0.6 + k * 0.9), int(by + 1.6)))
                continue
            for k in range(3):
                for r in range(2):
                    if crop == "potato" and by > 45 and k == 1:
                        continue                                      # the scarecrow's place
                    a.add(extras.crop(crop, 1 if (k + r + i) % 3 else 2), round((bx + 0.55 + k * 0.95) * T),
                          round((by + 0.7 + r * 0.95) * T))
    a.add(props.scarecrow(), round(26.1 * T), round(48.9 * T), (8, 2))
    a.solid.add((26, 48))
    for tx, ty in ((22.0, 51.2), (23.4, 51.5)):
        a.add(props.beehive(), round(tx * T), round(ty * T), (8, 2))
        a.solid.add((int(tx), int(ty)))
    for tx, ty in ((26.2, 51.6), (27.8, 51.2), (29.4, 51.7), (31.0, 51.3)):
        a.add(kit.bush(berries=True), round(tx * T), round(ty * T), (8, 2))
    a.add(props.shed_old(), round(36.4 * T), round(51.0 * T), (30, 4))
    a.wall(35, 50, 37, 50)
    put(a, Q.barrel(1), 34.2, 50.8, (6, 2))                          # the water butt off the shed roof
    a.solid.add((34, 50))
    put(a, Q.basket(0), 24.6, 46.5, (5, 2))                            # a basket of what's been dug today


# ---------------------------------------------------------------- the edges

def east_bank(a):
    for tx, ty in ((54, 22), (57, 24), (55, 32), (58, 34), (54, 37)):
        a.add(kit.round_tree(90 + tx + ty), tx * T + 8, ty * T + 12, (14, 4))
    a.add(kit.signpost(), 54 * T + 8, 26 * T + 10, (5, 2))
    a.solid.add((54, 26))
    a.exit("homestead", MW * T - 10, BRIDGE_ROWS[0] * T, 10, 3 * T, (40, 464))     # over to the Homestead's west bridge


UNDERGROWTH = [(2.9, 25.6), (3.3, 30.8), (2.7, 38.4), (56.8, 12.4), (57.2, 19.8), (56.6, 40.2), (57.0, 47.2),
               (24.4, 54.5), (33.2, 54.3), (46.2, 3.9), (12.0, 3.4), (47.8, 53.2)]


def undergrowth(a):
    for k, (x, y) in enumerate(UNDERGROWTH):
        put(a, kit.bush(), x, y, (8, 2))
        a.add(farm_extras.flower_clump(("yellow", "white", "purple", "pink")[k % 4], 120 + k),
              round((x + 0.9) * T), round((y + 0.2) * T), ground=True)


def treeline(a):
    """Forest round every edge, ragged, deeper in places and thin where the town comes close, broken by the river
    at top and bottom and by the road east."""
    seed = 200

    def depth(side, t):
        return 1.3 + 0.9 * math.sin(t / 3.7 + side) + 0.5 * math.sin(t / 1.9 + side * 2)

    for tx in range(MW):
        if abs(tx - river_x(0)) < RIVER_HALF + 0.5:
            continue
        for k in range(int(depth(1, tx)) + 1):
            seed += 1
            a.add(lpc_trees.crown(seed), tx * T + int(kit.hash2(tx, k, 31) * 10) - 5, round((k * 1.2 + 1.0) * T))
    for tx in range(MW):
        if abs(tx - river_x(MH)) < RIVER_HALF + 0.5:
            continue
        near_town = 4 <= tx <= 44
        for k in range(1 if near_town else int(depth(2, tx)) + 1):
            seed += 1
            a.add(lpc_trees.crown(seed), tx * T + int(kit.hash2(tx, k, 32) * 10) - 5, round((MH - k * 1.2 - 0.1) * T))
    for ty in range(3, MH - 1):
        for k in range(int(depth(3, ty)) + 1):
            seed += 1
            a.add(lpc_trees.crown(seed), round((k * 1.1 + 0.2) * T) + int(kit.hash2(ty, k, 33) * 8) - 4, ty * T + 12)
        if BRIDGE_ROWS[0] - 1 <= ty <= BRIDGE_ROWS[1] + 1:
            continue
        for k in range(int(depth(4, ty)) + 1):
            seed += 1
            a.add(lpc_trees.crown(seed), round((MW - k * 1.1 - 0.4) * T) + int(kit.hash2(ty, k, 34) * 8) - 4, ty * T + 12)
    for tx in range(MW):
        for ty in range(MH):
            edge = tx < 2 or ty < 3 or ty >= MH - 1 or (tx >= MW - 2 and not (BRIDGE_ROWS[0] <= ty <= BRIDGE_ROWS[1]))
            if edge and abs(tx - river_x(ty)) > RIVER_HALF:
                a.solid.add((tx, ty))


# ---------------------------------------------------------------- the townsfolk, where the day finds them

PEOPLE = [
    # shopping along the stalls, at the cross, outside the grocery and the bakery
    ("mabel", 16.4, 31.3), ("cora", 20.6, 31.6), ("priya", 24.2, 31.4), ("lena", 27.0, 31.2),
    ("gus", 20.2, 25.6), ("sam", 17.4, 24.4), ("iris", 29.2, 24.3), ("felix", 34.8, 25.0), ("hank", 38.4, 26.4),
    # about the town
    ("tomas", 43.2, 18.0), ("ned", 14.6, 12.2), ("olive", 28.2, 12.5), ("dale", 45.5, 35.8),
    ("hugo", 9.2, 38.0), ("winnie", 17.0, 50.6), ("tilly", 42.2, 31.6),
]


def townsfolk(a):
    for name, x, y in PEOPLE:
        a.character(name, round(x * T), round(y * T))


def build(for_game=False):
    a = Area("city", MW, MH)
    ground(a)
    bridge(a)
    market(a)
    lane(a)
    riverside(a)
    south(a)
    east_bank(a)
    treeline(a)
    undergrowth(a)
    townsfolk(a)
    a.spawn = (56 * T, 28 * T)
    return a


VIEWS = {"square": (160, 320), "lane": (128, 96), "quay": (560, 480), "green": (32, 560)}


if __name__ == "__main__":
    build().save(VIEWS)
