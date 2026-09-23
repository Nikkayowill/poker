"""The house, barn and workshop rooms, built from the LPC Revised interior art.

Every wall, floor, window, rug and piece of furniture here is cut from Eliza
Wyatt's LPC Revised sheets (CC-BY 3.0 / OGA-BY 3.0, credited in
art/stackacres-td/lpc/interior/CREDITS.md), vendored under
art/stackacres-td/lpc/interior/ with the pack's own folder names. Nothing is
shaded by formula: this module only cuts, tiles and places.

The pack is drawn at 32px per map tile and the game's maps are 16, the same
as the terrain and trees outside (lpc_trees.py), so a room is painted at twice
the size and every piece travels as a half-size stand-in carrying its
full-detail picture in `img.info["hires"]`. Coordinates in this file are pack
pixels (HT per tile); `interiors.py` halves them for the rig.

How a room is put together, back to front, the way Stardew Valley draws its
rooms (16px tiles, a back wall three tiles tall, the room floating on near-black
with a warm band round it, from its decompiled FarmHouse.cs and the screenshot
Kayo gave as the bar):

- the dark around the room is the camera's own background (#140c1c),
- the floor fills the room,
- the back wall is three tiles tall across the top, with its windows, curtains,
  shelves, clocks and pictures hung on it,
- rugs lie flat on the floor,
- a warm band runs round the room's outer edge like the top of its walls seen
  from above, thick along the bottom where the front wall faces the camera,
  and broken where the door is.
"""

import os

import numpy as np
from PIL import Image

HT = 32                                   # pack pixels per map tile
SCALE = 0.5                               # pack picture -> map pixels
VOID = (20, 12, 28, 255)                  # the camera's background, topdown-world.tsx
HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(os.path.dirname(HERE), "lpc", "interior")
UPSTREAM = os.path.expanduser("~/deps/lpc-eliza")    # a checkout of github.com/ElizaWy/LPC, only to vendor from

USED = set()
_sheets = {}


def sheet(rel):
    """One of the pack's sheets by its path in the pack, from the vendored copy."""
    if rel not in _sheets:
        path = os.path.join(VENDOR, rel)
        if not os.path.exists(path):
            path = os.path.join(UPSTREAM, rel)
        _sheets[rel] = Image.open(path).convert("RGBA")
        USED.add(rel)
    return _sheets[rel]


def cut(rel, x, y, w, h):
    return sheet(rel).crop((x, y, x + w, y + h))


def tiles(rel, tx, ty, tw=1, th=1):
    """A block of whole tiles."""
    return cut(rel, tx * HT, ty * HT, tw * HT, th * HT)


def trim(img):
    """The picture cropped to what is drawn, and where that crop starts in the original."""
    box = img.getbbox()
    if not box:
        return img, (0, 0)
    return img.crop(box), (box[0], box[1])


def piece(rel, tx, ty, tw=1, th=1):
    """A drawing that sits in a block of tiles, trimmed to itself."""
    return trim(tiles(rel, tx, ty, tw, th))[0]


def over(*layers):
    """Pictures laid on one another at offsets: (img, x, y), ...; the result is sized to hold them all."""
    w = max(x + img.width for img, x, y in layers)
    h = max(y + img.height for img, x, y in layers)
    out = Image.new("RGBA", (w, h))
    for img, x, y in layers:
        out.alpha_composite(img, (x, y))
    return out


def hflip(img):
    return img.transpose(Image.FLIP_LEFT_RIGHT)


# ------------------------------------------------------------------ the room shell

class Plan:
    """A room: its size in map tiles, its doorway's tiles in the front wall, and what is painted on it."""

    def __init__(self, w, h, door):
        self.w, self.h = w, h
        self.door = door                                          # (first tile, last tile) of the doorway
        self.px, self.py = w * HT, h * HT
        self.img = Image.new("RGBA", (self.px, self.py), VOID)
        self.lights = []                                          # (x, y, kind) in pack px
        self.beams = []                                           # (picture, x, y) in pack px

    def floor(self, tile, stagger=0):
        """Tile the floor over the whole room; the wall and the band cover what they cover. `stagger` slides
        each column of tiles down by that many px more than the last, so the boards' butt joints and nail
        marks don't line up into a grid across the room."""
        for i, x in enumerate(range(0, self.px, tile.width)):
            shift = (i * stagger) % tile.height
            for y in range(-shift, self.py, tile.height):
                self.img.alpha_composite(tile, (x, y)) if y >= 0 else self.img.paste(
                    tile.crop((0, -y, tile.width, tile.height)), (x, 0))

    def wall(self, strip, top=0):
        """Repeat a wall strip (one tile or more wide, full wall height) across the back."""
        for x in range(0, self.px, strip.width):
            self.img.alpha_composite(strip, (x, top))

    def put(self, img, x, y):
        """Something painted flat onto the room: on the wall, or lying on the floor."""
        self.img.alpha_composite(img, (int(x), int(y)))

    def wall_foot_shadow(self, y, depth=6, strength=0.4):
        """The back wall's shadow on the floor at its foot: Stardew's 40% black drop shadow, fading down."""
        arr = np.array(self.img).astype(np.float32)
        for k in range(depth):
            f = 1 - strength * (1 - k / depth)
            arr[y + k, :, :3] *= f
        self.img = Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGBA")

    def band(self, box):
        """The warm band round the room, from a Wall Borders three-by-three box (96x96, see `band_box`).

        The box's corners and edges are laid round the room's outer ring of tiles as they are drawn: 8px of
        band down the sides and along the top, and along the bottom the band plus the front wall's face and
        its shadow line, 16px deep, broken where the door is."""
        part = lambda cx, cy: box.crop((cx * HT, cy * HT, cx * HT + HT, cy * HT + HT))
        tl, t, tr = part(0, 0), part(1, 0), part(2, 0)
        l, r = part(0, 1), part(2, 1)
        bl, b, br = part(0, 2), part(1, 2), part(2, 2)
        W, H = self.w, self.h
        d0, d1 = self.door
        for tx in range(W):
            self.put(tl if tx == 0 else tr if tx == W - 1 else t, tx * HT, 0)
        for ty in range(1, H - 1):
            self.put(l, 0, ty * HT)
            self.put(r, (W - 1) * HT, ty * HT)
        y = (H - 1) * HT
        for tx in range(W):
            if not d0 <= tx <= d1:
                self.put(bl if tx == 0 else br if tx == W - 1 else b, tx * HT, y)
        # Either end of the doorway, the bottom band is closed with the column the box closes its own left
        # side with, over the rows the bottom band and face take up.
        arr = np.array(self.img)
        edge = np.array(bl)[:, 0]
        rows = np.nonzero(np.array(b)[:, HT // 2, 3])[0]
        for x in (d0 * HT - 1, (d1 + 1) * HT):
            for ry in rows:
                arr[y + ry, x] = edge[ry] if edge[ry, 3] else arr[y + ry, x]
        self.img = Image.fromarray(arr, "RGBA")

    def picture(self):
        return self.img


def window_light(w, h, lean):
    """The patch of sun a window throws on the floor: a slanted block of warm light, strongest at the wall,
    in four flat steps of alpha rather than a smooth ramp, so it reads as pixel art. The engine adds it by day
    and fades it out at dusk (daylight-layer.ts, kind "sun")."""
    out = np.zeros((h, w + abs(lean), 4), np.uint8)
    steps = (0.34, 0.26, 0.18, 0.1)
    for y in range(h):
        k = min(3, int(4 * y / h))
        shift = round(lean * y / h) + (abs(lean) if lean < 0 else 0)
        a = int(255 * steps[k])
        out[y, shift:shift + w] = (255, 236, 190, a)
        if y % 2 == 1 and k == 3:
            out[y, shift:shift + w:2, 3] = 0          # the far end breaks up
    return Image.fromarray(out, "RGBA")


# ------------------------------------------------------------------ pieces

F = "Objects/Furniture/"
SI = "Objects/Small Items/"
WI = "Objects/Wall Items/"
ST = "Structure/"

# Wall Borders/Plain Edged Border.png's gold variant, re-coloured to the band round Stardew Valley's rooms:
# measured on the reference screenshot Kayo gave (a plum outline, an orange band, a pale lip on the inside
# and a brown shadow line), each gold shade swapped for the orange shade in the same place.
BAND_RECOLOUR = {
    (121, 65, 23): (94, 17, 49),       # outline along the top and bottom
    (161, 96, 24): (122, 30, 50),      # outline down the sides
    (243, 195, 95): (240, 138, 65),    # band
    (253, 208, 130): (255, 197, 94),   # lip
    (209, 148, 40): (200, 96, 44),     # front face
    (96, 52, 41): (58, 12, 36),        # the face's shadow on the dark
}


def recolour(img, table):
    arr = np.array(img)
    out = arr.copy()
    for src, dst in table.items():
        hit = (arr[..., 0] == src[0]) & (arr[..., 1] == src[1]) & (arr[..., 2] == src[2])
        out[hit, :3] = dst
    return Image.fromarray(out, "RGBA")


class Prop:
    """Something standing in a room: its picture, its base point (bottom centre unless given), and what it does."""

    def __init__(self, img, x, y, tag=None, shadow=None, base=None, solid=None, lights=(), passable=False, lift=0):
        """`lift` stands it that many px up off its base point: a thing on a counter or a table has its base
        on the floor in front of what it sits on, so it draws after it, and is lifted back up onto the top."""
        self.img, self.x, self.y = img, x, y
        self.tag, self.shadow, self.passable = tag, shadow, passable
        self.base = base if base else (img.width // 2, img.height - 1 + lift)
        self.solid = solid                    # pack px of floor it covers behind its base, for beds and tables
        self.lights = lights                  # (x, y, kind) in its own pixels


class Room:
    """A finished room: the flat picture, what stands in it, the sun patches, and its plan."""

    def __init__(self, plan, props, spawn):
        self.plan, self.props, self.spawn = plan, props, spawn


def band_box():
    """Wall Borders/Plain Edged Border.png's gold three-by-three box, in Stardew's orange."""
    return recolour(cut(ST + "Wall Borders/Plain Edged Border.png", 384 + 32, 256, 96, 96), BAND_RECOLOUR)


def rug(rel, cx, cy, w, h):
    """A rug of w x h tiles from a nine-slice rug sheet whose three-by-three box starts at tile (cx, cy)."""
    out = Image.new("RGBA", (w * HT, h * HT))
    for ty in range(h):
        for tx in range(w):
            sx = 0 if tx == 0 else 2 if tx == w - 1 else 1
            sy = 0 if ty == 0 else 2 if ty == h - 1 else 1
            out.alpha_composite(tiles(rel, cx + sx, cy + sy), (tx * HT, ty * HT))
    return out


# ------------------------------------------------------------------ the player's house

WALL_H = 3 * HT            # the back wall's height: three tiles, as in Stardew Valley's farmhouse


def window(x, plan, curtains=True, bloom=None):
    """A window in the back wall: LPC's lattice window by day, its pale pane, a sill, and curtains tied back.
    Its patch of sun goes to the plan."""
    pane = cut(ST + "Windows/Ornamental Windows A.png", 32, 30, 32, 78)      # the daylight column, no pediment
    plan.put(pane, x, 10)
    if bloom is not None:
        pot = piece(SI + "Flowers.png", bloom, 1)                           # a posy on the sill
        plan.put(pot, x + 16 - pot.width // 2, 74)
    if curtains:
        drape = piece(WI + "Curtains.png", 5, 1, 2, 3)                      # gold, tied back
        plan.put(drape, x + 16 - drape.width // 2, 6)
    plan.beams.append((window_light(26, 70, 18), x + 3, WALL_H))


def counter():
    """A kitchen run four tiles long: the countertop's whole slab as the pack draws its island (a left end, two
    middle boards, a right end), over a base of cupboard doors, an open shelf of plates and a stack of drawers."""
    ct = F + "Countertop.png"
    slab = cut(ct, 64, 140, 128, 24)
    base = over((cut(ct, 16, 192, 48, 18), 0, 0), (cut(ct, 64, 192, 32, 18), 48, 0), (cut(ct, 48, 160, 48, 18), 80, 0))
    return over((base, 0, 20), (slab, 0, 0))


def stove(pipe_tiles):
    """The cast-iron cookstove: its firebox burning, the cooktop, and the pipe run up the wall to the ceiling."""
    ci = F + "Fireplace, Cast Iron.png"
    parts = [(tiles(ci, 2, 0), 0, 32 * i) for i in range(pipe_tiles)]
    parts += [(tiles(ci, 2, 1), 0, 32 * pipe_tiles), (tiles(ci, 1, 1), 0, 32 * pipe_tiles + 32),
              (tiles(ci, 0, 2), 0, 32 * pipe_tiles + 64)]
    return trim(over(*parts))[0]


def house():
    plan = Plan(20, 11, (9, 10))
    plan.floor(tiles(ST + "Floor/Wood Floor A.png", 1, 1, 1, 2), stagger=24)
    plan.wall(cut(ST + "Walls/Floral Wallpaper A.png", 32, 0, 32, 96))
    plan.wall(cut(ST + "Walls/Half-Wall Paneling A.png", 32, 0, 32, 32), 64)
    for x, bloom in ((56, 3), (264, 6), (488, 1), (560, 8)):
        window(x, plan, bloom=bloom)
    plan.put(piece(SI + "Kitchen Clutter A.png", 5, 1), 104, 34)                  # pans on a rail
    plan.put(piece(WI + "Paintings, Landscape.png", 0, 2, 3, 1), 150, 20)          # a farm at dusk
    plan.put(piece(WI + "Paintings, Still Life.png", 2, 0, 1, 2), 382, 14)
    plan.put(piece(WI + "Lighting, Wall.png", 0, 0), 226, 22)
    plan.put(piece(WI + "Lighting, Wall.png", 0, 0), 438, 22)
    plan.lights += [(236, 32, "lantern"), (448, 32, "lantern")]
    plan.put(rug(F + "Rugs/Diamond Rug, tiling.png", 3, 0, 5, 3), 256, 160)        # green, before the fire
    plan.put(rug(F + "Rugs/Diamond Rug, tiling.png", 0, 0, 3, 2), 76, 208)         # blue, under the table
    plan.put(rug(F + "Rugs/Diamond Rug, tiling.png", 9, 0, 3, 2), 496, 216)        # gold, at the foot of the bed
    plan.wall_foot_shadow(WALL_H)
    plan.put(rug(F + "Rugs/Diamond Rug, tiling.png", 9, 0, 2, 1), 288, 308)        # the doormat
    plan.band(band_box())

    P = []
    # The kitchen along the back wall on the left. The counter, the stove and the larder chest all open the
    # house panel (Cook, Eat, Cellar).
    P.append(Prop(counter(), 112, 136, tag="farmhouse", solid=36))
    P.append(Prop(piece(F + "Sink, Countertop.png", 0, 0), 72, 137, lift=17))
    P.append(Prop(piece(SI + "Kitchen Clutter A.png", 3, 2), 118, 137, lift=16))     # herbs on a board
    P.append(Prop(piece(SI + "Kitchen Clutter A.png", 4, 1), 156, 137, lift=18))     # a mixing bowl
    P.append(Prop(stove(1), 208, 140, tag="farmhouse", solid=20, lights=((16, 104, "lamp"),)))
    P.append(Prop(piece(SI + "Baskets A.png", 2, 0), 250, 132))
    # the hearth in the middle of the back wall, a clock and a bookcase either side, a loveseat facing the fire
    P.append(Prop(cut(F + "Fireplace.png", 108, 15, 72, 70), 320, 124, lights=((36, 52, "lamp"),)))
    P.append(Prop(piece(F + "Clock, Grandfather.png", 1, 0, 1, 3), 368, 122))
    P.append(Prop(piece(F + "Cabinet.png", 2, 3, 1, 3), 412, 124))
    P.append(Prop(piece(F + "Seating/Loveseat, Small - Casual Solid A.png", 0, 11, 2, 1), 320, 250))
    P.append(Prop(piece(F + "Seating/Chair, Sofa D.png", 0, 3), 264, 214))
    P.append(Prop(hflip(piece(F + "Seating/Chair, Sofa D.png", 0, 3)), 376, 214))
    P.append(Prop(piece(F + "End Table.png", 0, 1), 234, 214))
    P.append(Prop(piece(SI + "Flowers.png", 4, 2), 234, 215, lift=16))
    # supper table on the blue rug
    P.append(Prop(cut(F + "Table, Rough Wood.png", 8, 86, 80, 42), 124, 256, solid=30))
    P.append(Prop(piece(F + "Seating/Chair, Dining A.png", 1, 4), 72, 252))
    P.append(Prop(piece(F + "Seating/Chair, Dining A.png", 4, 4), 176, 252))
    P.append(Prop(piece(SI + "Flowers.png", 0, 3), 124, 257, lift=22))
    P.append(Prop(piece(SI + "Dishes A.png", 4, 0), 100, 257, lift=20))
    P.append(Prop(piece(SI + "Dishes A.png", 4, 0), 148, 257, lift=20))
    # the bed, head to the wall between the windows, a lamp on the nightstand, a dresser by the far wall
    P.append(Prop(bed(), 528, 206, tag="bed", solid=90))
    P.append(Prop(piece(F + "End Table.png", 0, 2), 478, 148))
    P.append(Prop(piece(SI + "Lighting, Table.png", 0, 0), 478, 149, lights=((10, 8, "lamp"),), lift=16))
    P.append(Prop(piece(F + "Cabinet.png", 1, 0, 1, 2), 604, 190))                   # the wardrobe
    P.append(Prop(piece(F + "Chest.png", 0, 0, 2, 1), 560, 304, tag="farmhouse"))
    # plants in every corner and either side of the door
    for (tx, ty, tw, th), x, y in (((0, 1, 1, 2), 40, 316), ((2, 0, 1, 3), 606, 128), ((4, 1, 1, 2), 262, 318),
                                   ((4, 1, 1, 2), 378, 318), ((1, 0, 1, 3), 454, 316), ((4, 0, 1, 1), 34, 170),
                                   ((4, 0, 1, 1), 440, 214), ((0, 1, 1, 2), 606, 316)):
        P.append(Prop(piece(F + "Planter.png", tx, ty, tw, th), x, y))
    return Room(plan, P, (320, 300))


def bed():
    """A double bed from its parts: the carved headboard, the mattress, two pillows, a plaid quilt, the footboard."""
    head = cut(F + "Beds/Beds, Double Headboards.png", 0, 203, 64, 21)
    mattress = cut(F + "Beds/Beds, Double Mattresses.png", 66, 19, 60, 70)
    pillows = cut(F + "Beds/Beds, Double Mattresses.png", 2, 24, 60, 14)
    quilt = cut(F + "Beds/Beds, Double C.png", 64, 384, 64, 62)
    foot = cut(F + "Beds/Beds, Double Headboards.png", 0, 271, 64, 17)
    return over((head, 0, 0), (mattress, 2, 12), (pillows, 2, 16), (quilt, 0, 34), (foot, 0, 88))


# ------------------------------------------------------------------ the barn

SIDING = ST + "Walls/Siding, Plain.png"      # ten colours 160px apart, four shades 96px apart


def siding(colour, shade):
    """One tile of plank siding from the middle of a block (the block's own ends carry corner posts)."""
    return cut(SIDING, colour * 160 + 64, shade * 96, 32, 96)


def post(colour, shade):
    """The corner post down the left end of a siding block: a timber upright to stand in a long wall."""
    return cut(SIDING, colour * 160, shade * 96, 8, 96)


def lattice_window(x, plan, y=18):
    """A small leaded window for a barn or a workshop: LPC's lattice pane by day and its arched cap."""
    ow = ST + "Windows/Ornamental Windows B.png"
    plan.put(piece(ow, 1, 2, 1, 2), x, y)
    plan.beams.append((window_light(22, 60, 14), x + 5, WALL_H))


def grain_bin(i):
    """A market bin heaped with one of the pack's grains (Grains, Grasses.png's bottom row)."""
    return piece(SI + "Food/Grains, Grasses.png", i, 3, 1, 2)


def barn():
    plan = Plan(24, 11, (11, 12))
    plan.floor(tiles(ST + "Floor/Wood Floor A.png", 3, 1, 1, 2), stagger=24)
    plan.wall(siding(8, 1))
    for x in range(0, 24 * HT, 4 * HT):
        plan.put(post(8, 2), x + 124, 0)
    for x in (88, 280, 472):
        lattice_window(x, plan)
    rack = piece(SI + "Tools, Carpentry.png", 0, 0, 2, 1)
    plan.put(rack, 150, 26)
    for x in (224, 408, 664):
        plan.put(piece(WI + "Lighting, Wall.png", 0, 0), x, 22)
        plan.lights.append((x + 10, 32, "lantern"))
    shelf = piece(F + "Shelf.png", 0, 0, 3, 1)
    for y in (22, 52):
        plan.put(shelf, 548, y)
    for i, (tx, ty) in enumerate(((5, 2), (4, 2), (5, 2))):
        plan.put(piece(SI + "Kitchen Clutter A.png", tx, ty), 556 + i * 28, 6)
    for i, tx in enumerate((0, 2, 1)):
        plan.put(piece(SI + "Baskets A.png", tx, 0), 556 + i * 28, 30)
    # straw under the feed troughs, and loose hay about the floor
    straw = piece(SI + "Hay & Straw.png", 2, 0, 2, 3)
    hay = piece(SI + "Hay & Straw.png", 0, 0, 2, 3)
    plan.put(straw, 40, 100)
    plan.put(straw.rotate(90, expand=True), 96, 250)
    plan.put(hay, 150, 236)
    plan.put(rug(F + "Rugs/Diamond Rug, tiling.png", 9, 0, 4, 2), 528, 208)     # the rug before Ray's counter
    plan.wall_foot_shadow(WALL_H)
    plan.put(rug(F + "Rugs/Diamond Rug, tiling.png", 9, 0, 2, 1), 352, 308)     # the doormat
    plan.band(band_box())

    P = []
    # Ray's shop counter: the thing to tap. Produce and a jar on top.
    P.append(Prop(counter(), 592, 196, tag="barn", solid=36))
    for i, (sheet_, tx, ty) in enumerate(((SI + "Food/Vegetables A.png", 4, 5), (SI + "Baskets A.png", 2, 1),
                                          (SI + "Food/Vegetables A.png", 9, 4))):
        P.append(Prop(piece(sheet_, tx, ty), 548 + i * 44, 197, lift=18))
    # the feed bay on the left: troughs on the straw
    P.append(Prop(piece(F + "Trough.png", 2, 0, 2, 1), 70, 140))
    P.append(Prop(piece(F + "Trough.png", 2, 2, 2, 1), 150, 140))
    # market bins of grain down the middle of the back wall
    for i in range(5):
        P.append(Prop(grain_bin((2, 3, 4, 6, 9)[i]), 312 + i * 34, 136))
    # stock stacked at the ends and by the door
    P.append(Prop(piece(F + "Crate.png", 0, 1, 2, 1), 700, 140))
    P.append(Prop(piece(F + "Crate.png", 0, 0), 724, 106))
    P.append(Prop(piece(F + "Barrel.png", 3, 0, 2, 2), 44, 320))
    P.append(Prop(piece(F + "Crate.png", 0, 3, 2, 1), 700, 320))
    P.append(Prop(piece(F + "Crate.png", 2, 3), 740, 290))
    P.append(Prop(piece(SI + "Kitchen Clutter A.png", 1, 3), 250, 136))                # sacks of seed
    P.append(Prop(piece(SI + "Kitchen Clutter A.png", 1, 3), 268, 150))
    P.append(Prop(piece(SI + "Buckets.png", 0, 0), 208, 150))
    P.append(Prop(piece(F + "Barrel.png", 1, 0), 226, 316))
    P.append(Prop(piece(F + "Barrel.png", 0, 0), 488, 316))
    P.append(Prop(piece(F + "Planter.png", 0, 1, 1, 2), 324, 318))
    # produce crates beside the counter, a bucket by the troughs, sacks by the bins
    for i, (tx, ty) in enumerate(((0, 0), (7, 0), (4, 5))):
        cx = 462 + (i % 2) * 34
        cy = 196 + (i // 2) * 30
        P.append(Prop(piece(F + "Crate.png", 0, 1), cx, cy))
        P.append(Prop(piece(SI + "Food/Vegetables A.png", tx, ty), cx, cy + 1, lift=22))
    P.append(Prop(piece(SI + "Buckets.png", 0, 1), 214, 136))
    P.append(Prop(piece(SI + "Kitchen Clutter A.png", 1, 3), 486, 140))
    P.append(Prop(piece(F + "Barrel.png", 2, 0), 30, 150))
    P.append(Prop(piece(F + "Planter.png", 2, 0, 1, 3), 744, 200))
    P.append(Prop(piece(F + "Planter.png", 0, 1, 1, 2), 444, 318))
    return Room(plan, P, (384, 300))


# ------------------------------------------------------------------ the workshop

def spinning_wheel():
    """The spinning wheel: its bench, with the wheel and the thread drawn on the frame above it."""
    sw = F + "Sewing & Weaving/Spinning Wheel.png"
    return trim(over((tiles(sw, 0, 0, 2, 2), 0, 0), (tiles(sw, 2, 0, 2, 2), 0, 0)))[0]


def workshop():
    plan = Plan(15, 10, (2, 3))
    plan.floor(tiles(ST + "Floor/Wood Floor A.png", 0, 1, 1, 2), stagger=24)
    plan.wall(siding(2, 0))
    for x in (0, 7 * HT, 14 * HT):
        plan.put(post(2, 1), x + 28, 0)
    lattice_window(40, plan)
    lattice_window(344, plan)
    racks = [piece(SI + "Tools, Carpentry.png", a, 0, b, 1) for a, b in ((0, 2), (2, 2), (4, 2))]
    x = 104
    for r in racks:
        plan.put(r, x, 22)
        x += r.width + 6
    plan.put(piece(WI + "Lighting, Wall.png", 0, 0), 300, 22)
    plan.lights.append((310, 32, "lantern"))
    for i, (tx, ty) in enumerate(((0, 0), (1, 0), (0, 1), (1, 1))):
        plan.put(piece(SI + "Sawdust.png", tx, ty), (150, 330, 360, 210)[i], (230, 190, 250, 280)[i])
    plan.put(rug(F + "Rugs/Diamond Rug, tiling.png", 0, 0, 4, 2), 176, 196)       # blue, before the bench
    plan.wall_foot_shadow(WALL_H)
    plan.put(rug(F + "Rugs/Diamond Rug, tiling.png", 9, 0, 2, 1), 64, 276)
    plan.band(band_box())

    P = []
    P.append(Prop(piece(F + "Workbench, Carpentry.png", 0, 0, 3, 2), 240, 190, tag="workshop", solid=40))
    P.append(Prop(stove(1), 440, 142, lights=((16, 104, "lamp"),), solid=20))
    P.append(Prop(spinning_wheel(), 56, 150))
    P.append(Prop(piece(F + "Sewing & Weaving/Loom.png", 0, 0, 2, 2), 120, 136))
    P.append(Prop(piece(F + "Sawhorse.png", 0, 0), 372, 262))
    P.append(Prop(piece(SI + "Lumber.png", 0, 2, 2, 1), 400, 296))
    P.append(Prop(piece(SI + "Lumber.png", 4, 1), 440, 250))
    P.append(Prop(piece(F + "Shavehorse.png", 0, 0, 2, 2), 336, 226))
    P.append(Prop(piece(F + "Workbench, Wire Drawing.png", 0, 1, 2, 2), 352, 150))
    P.append(Prop(piece(F + "Crate.png", 0, 1), 176, 300))
    P.append(Prop(piece(F + "Crate.png", 2, 1), 206, 296))
    P.append(Prop(piece(SI + "Tools, Carpentry.png", 10, 3, 2, 1), 290, 300))       # a toolbox on the floor
    P.append(Prop(piece(F + "Barrel.png", 3, 0, 2, 2), 44, 240))
    P.append(Prop(piece(SI + "Baskets A.png", 2, 1), 92, 180))
    P.append(Prop(piece(F + "Crate.png", 0, 3, 2, 1), 440, 206))
    P.append(Prop(piece(F + "Planter.png", 0, 1, 1, 2), 448, 300))
    P.append(Prop(piece(F + "Planter.png", 4, 1, 1, 2), 30, 170))
    return Room(plan, P, (96, 262))
