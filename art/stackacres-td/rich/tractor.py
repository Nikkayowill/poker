"""A small mid-century row-crop tractor, hand drawn as character grids like the animals in area_farm.py: generic red
with cream wheels and no badge or lettering. Facing right, down (toward the camera) and up; left is right mirrored.

Every view comes empty and driven. The driver is the farmer himself, from the waist up, off his standing frame in
public/stackacres-td/characters/farmer.png, seated so the parts of the tractor in front of him (the hood, the wheel)
still cover him. Two frames per view: the tread lugs swap between them, which reads as the wheels turning.
Frames are 64x54 with the rear wheels on the bottom row, about two tiles long from the side."""
import json
import os

from PIL import Image

from pal import Canvas

W, H = 64, 54
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FARMER = os.path.join(REPO, "public", "stackacres-td", "characters", "farmer")

# key: (ramp, level). `k` and `j` are the tread lugs, lit and shaded on frame 0 and the other way round on frame 1.
KEYS = {
    "R": ("red", 4.8), "r": ("red", 3.6), "d": ("red", 2.3), "D": ("red", 1.3),
    "K": ("coal", 0.5), "T": ("coal", 1.5), "k": ("coal", 2.2), "j": ("coal", 0.9),
    "W": ("linen", 5.4), "w": ("linen", 4.2), "v": ("linen", 3.0),
    "G": ("stone", 4.8), "g": ("stone", 3.2), "x": ("coal", 1.0),
    "H": ("stone", 3.6), "h": ("coal", 0.8), "y": ("lamp", 4.6),
    "e": ("coal", 1.3), "E": ("stone", 2.6),
    "S": ("coal", 2.2), "s": ("coal", 0.9), "q": ("coal", 1.1),
}
# The driver's own lap and hands, in the farmer's colours off his sheet; drawn only when he is aboard.
DRIVER = {"O": (79, 120, 212), "o": (58, 69, 150), "f": (251, 207, 177)}
DRIVER_LINE = (36, 41, 70)
# Which keys stand between the camera and the driver, per view.
OVER = {"right": set("qRrd"), "down": set("RrdHhyqeExKTkjG"), "up": set("Ss")}
# The farmer's hips go on this row of the tractor, and his centre on this column.
SEAT = {"right": (13, 24), "down": (32, 32), "up": (32, 34)}
# Rows of the farmer's standing frame that sit on the tractor: hat to hip.
TOP, HIP = 12, 38

SIDE = [
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................eeee............",
    ".................................................eE.............",
    ".................................................eE.............",
    ".................................................eE.............",
    ".................................................eE.............",
    ".................................................eE.............",
    "........Ss..........ff..q................GGGG....eE.............",
    "........Ss.........qqqqq..................gG.....eE.............",
    "........Ss........q....O..................gG.....eE.............",
    "........Ss.....OOOOOOOOoo.................gG.....eE.............",
    "........Ss.....oooooooo...................gG.....eE.............",
    "........SsSSSSSSSSRRRRxx..................gG.....eE.............",
    ".........sssssssssrrrrRRxx................gG.....eE.............",
    "..........RRrrrdddddddrrrRxx..............gG.....eE.....yy......",
    ".........RrrdddjjjkkkkdddrrRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRHHH....",
    ".......RRrrdkkkjTTTTTkjjjdrrRRrrrrrrrrrrrrrrrrrrrrrrrrrrrhhh....",
    "......RRrddjkTTTTTTTTTTKjkddrRRrrrrrrrrrrrrrrrrrdddddddrrHHH....",
    "......RrdjjTTTKKWWWWWKKKKKkkdrRddrrrrrrrrrrrrrrrrrrrrrrrrhhh....",
    ".....RrdkjTTKWWWWWWWWWWWKKKjjdrRdrrrrrrrrrrrrrrrdddddddrrHHH....",
    "....RrrdkTTKWWWwwwwwwwWWWKKKjdrrRrrrrrrrrrrrrrrrrrrrrrrrrhhh....",
    "....RrdkTTKWWwwwwwwwwwwwWWKKKjdrRrrrrrrrrrrrrrrrdddddddrrHHH....",
    "...RrdjjTKWWwwwwwwwwwwwwwWWKKkkdrRdddddddddddddddddddddddhhh....",
    "...RrdjTTWWwwwwwwwwwwwwwwwwwKKkdrRdddddddddddddddddddddddHHH....",
    "...RrdjTKWWwwwwwwwwwwwwwwvwwKKkdrRGgggGgggGgggGggggg.....hhh....",
    "..RrdkkTKWwwwwwwGGGGGvwwvvvwKKjjdrRgggGgggGgggGggggg.....HHH....",
    ".....kTTWWwwwwwGGGxGGgvvvvvwwKKjdgGgggGgggGgggGggggg............",
    ".....kTTWWwwwwwGGxxxggvvvvvwwKKjdggggggggggggggggggg............",
    ".....kTTWWwwwwwGxxxxxgvvvvvwwKKkdxxxxxxxxxxxxxxxxxxkkjjj........",
    ".....jTTWWwwwwwGGxxxggvvvvvwwKKkxxxxxxxxxxxxxxxxxjkkTTTjjk......",
    ".....jTTWWwwwwwGGgxgggvvvvvwwKKk................jjTKKWKKKkk.....",
    ".....jjTKWwwwwwvgggggvvvvvvwKKkk...............jjTKWWWWWKKkk....",
    "......kTKWWwwwwwvvvvvvvvvvwwKKj................kTKWwGGGvWKKj....",
    "......kKKWWwwwwwvvvvvvvvvvwwKKj................kTWwGGGGgvwKj....",
    "......kkKKWWwwwvvvvvvvvvvwwKKjj................kKWwGxxxgvwKj....",
    ".......jKKKWWwvvvvvvvvvvwwKKKk.................jKWwGxxxgvwKk....",
    "........jKKKWwwvvvvvvvwwwKKKk..................jTWwGggggvwKk....",
    "........jjKKKwwwwwwwwwwwKKKjk..................jKKWvgggvwKKk....",
    ".........kkKKKKKwwwwwKKKKKjj...................kkKKwwwwwKKjj....",
    "...........kjKKKKKKKKKKKkj......................kkKKKwKKKjj.....",
    "............jjjkKKKKKjkkk........................kjjKKKkkj......",
    "...............kkkkjjj.............................jjjkk........",
]

FRONT = [
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    ".......................................eeee.....................",
    ".....RRRRRRRRRRRRRR.....................eE....RRRRRRRRRRRRRR....",
    ".....rrrrrrrrrrrrrr.....................eE....rrrrrrrrrrrrrr....",
    ".....rrrrrrrrrrrrrr.....................eE....rrrrrrrrrrrrrr....",
    ".....dddddddddddddd......SSSSSSSSSSSSSSSeE....dddddddddddddd....",
    ".....dd..TjjjK...dd......SSSSSSSSSSSSSSSeE....dd...TjjjK..dd....",
    ".....dd.TjkkkkK..dd......SSSSSSSSSSSSSSSeE....dd..TjkkkkK.dd....",
    ".....dd.TkkkkjK..dd......SSqqqqqqqqqqqSSeE....dd..TkkkkjK.dd....",
    ".....ddTkkjjjjjK.dd.GGGG.sfsssssssssssfseE....dd.TkkjjjjjKdd....",
    ".......TjjjjjkkK.....Gg..sqsssssssssssqseE.......TjjjjjkkK......",
    ".......TjjkkkkkKw....Gg....qqqqqqqqqqq..eE......wTjjkkkkkK......",
    ".......TkkkkkjjKw....Gg.........q.......eE......wTkkkkkjjK......",
    ".......TkkjjjjjKw....Gg..drrrrRRRRRrrrrdeE......wTkkjjjjjK......",
    ".......TjjjjjkkKw....Gg..drrrrRRRRRrrrrdeE......wTjjjjjkkK......",
    ".......TjjkkkkkKwddddGgdddrrrrRRRRRrrrrdeEddddddwTjjkkkkkK......",
    ".......TkkkkkjjKwddddGgdddrrrrRRRRRrrrrdeEddddddwTkkkkkjjK......",
    ".......TkkjjjjjKwdddddddddrrrrRRRRRrrrrdddddddddwTkkjjjjjK......",
    ".......KjjjjjkkKvdddddddddrrrrRRRRRrrrrdddddddddvKjjjjjkkK......",
    ".......KjjkkkkkKv........drrrrRRRRRrrrrd........vKjjkkkkkK......",
    ".......KkkkkkjjKv........drrrrRRRRRrrrrd........vKkkkkkjjK......",
    ".......KkkjjjjjKv......ydddddddddddddddddy......vKkkjjjjjK......",
    ".......KjjjjjkkKv.......ddddddddddddddddd.......vKjjjjjkkK......",
    ".......KjjkkkkkKv.......ddHHHHHHHHHHHHHdd.......vKjjkkkkkK......",
    ".......KkkkkkjjKv.......ddhhhhhhhhhhhhhdd.......vKkkkkkjjK......",
    ".......KkkjjjjjK........ddHHTHHxxxHHTHHdd........KkkjjjjjK......",
    ".......KjjjjjkkK........ddhTjKhxxxhTjKhdd........KjjjjjkkK......",
    "........KjkkkkK.........ddHTjKHxxxHTjKHdd.........KjkkkkK.......",
    "........KkkkkjK.........ddTkkkKxxxTkkkKdd.........KkkkkjK.......",
    ".........KjjjK..........ddKkkjKxxxKkkjKdd..........KjjjK........",
    "..........................KjjjKxxxKjjjK.........................",
    "...........................KjK.....KjK..........................",
    "...........................KkK.....KkK..........................",
    "............................K.......K...........................",
]

BACK = [
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "................................................................",
    ".........................................eeee...................",
    "..........................................eE....................",
    "..........................................eE....................",
    "..........................................eE....................",
    "..........................................eE....................",
    "..........................................eE....................",
    "..........................................eE....................",
    "...RRRRRRRRRRRRRRR........................eE...RRRRRRRRRRRRRRR..",
    "...rrrrrrrrrrrrrrr........................eE...rrrrrrrrrrrrrrr..",
    "...rrrrrrrrrrrrrrr........................eE...rrrrrrrrrrrrrrr..",
    "...ddddddddddddddd........................eE...ddddddddddddddd..",
    "...dd..TkkkkkK..dd........................eE...dd..TkkkkkK..dd..",
    "...dd.TkkkkjjjK.dd........................eE...dd.TkkkkjjjK.dd..",
    "...dd.TkjjjjjjK.dd........................eE...dd.TkjjjjjjK.dd..",
    "...ddTjjjjjkkkkKdd.......SSSSSSSSSSSSSSS.......ddTjjjjjkkkkKdd..",
    ".....TjjkkkkkkjK........RSSSSSSSSSSSSSSSR........TjjkkkkkkjK....",
    ".....TkkkkkjjjjKw.......rSSSSSSSSSSSSSSSr.......wTkkkkkjjjjK....",
    ".....TkkjjjjjjkKw.......rSSSSSSSSSSSSSSSr.......wTkkjjjjjjkK....",
    ".....TjjjjjkkkkKwddddddddsssssssssssssssddddddddwTjjjjjkkkkK....",
    ".....TjjkkkkkkjKwddddddddsssssssssssssssddddddddwTjjkkkkkkjK....",
    ".....TkkkkkjjjjKwdddddddRRRRRRRRRRRRRRRRRdddddddwTkkkkkjjjjK....",
    ".....TkkjjjjjjkKwddddddyrrrrrrrrrrrrrrrrryddddddwTkkjjjjjjkK....",
    ".....TjjjjjkkkkKwdddddddrrrrrrrrrrrrrrrrrdddddddwTjjjjjkkkkK....",
    ".....TjjkkkkkkjKwdddddddrrrrrrrrrrrrrrrrrdddddddwTjjkkkkkkjK....",
    ".....KkkkkkjjjjKw.......rrrrrrrrrrrrrrrrr.......wKkkkkkjjjjK....",
    ".....KkkjjjjjjkKv.......rrrrrrrrrrrrrrrrr.......vKkkjjjjjjkK....",
    ".....KjjjjjkkkkKv.......rrrrrrrrrrrrrrrrr.......vKjjjjjkkkkK....",
    ".....KjjkkkkkkjKv.......rrrrrrrrrrrrrrrrr.......vKjjkkkkkkjK....",
    ".....KkkkkkjjjjKv.......rrrrrrrxxxrrrrrrr.......vKkkkkkjjjjK....",
    ".....KkkjjjjjjkKv.......dddddddxxxddddddd.......vKkkjjjjjjkK....",
    ".....KjjjjjkkkkKv.......dddddddxxxddddddd.......vKjjjjjkkkkK....",
    ".....KjjkkkkkkjKv..............xxx..............vKjjkkkkkkjK....",
    ".....KkkkkkjjjjKv............xxxxxxx............vKkkkkkjjjjK....",
    ".....KkkjjjjjjkK.............xxxxxxx.............KkkjjjjjjkK....",
    ".....KjjjjjkkkkK.................................KjjjjjkkkkK....",
    "......KjkkkkkkK...................................KjkkkkkkK.....",
    "......KkkkkjjjK...................................KkkkkjjjK.....",
    ".......KjjjjjK.....................................KjjjjjK......",
]

GRIDS = {"right": SIDE, "down": FRONT, "up": BACK}


def _canvas(grid, frame, only=None):
    c = Canvas(W, H)
    for y, row in enumerate(grid):
        for x, k in enumerate(row):
            if k == "." or k in DRIVER or (only is not None and k not in only):
                continue
            if k in "kj" and frame:
                k = "j" if k == "k" else "k"
            ramp, level = KEYS[k]
            c.put(x, y, ramp, level)
    return c


def _farmer(view):
    """The farmer's standing frame for this view, from the shipped sheet."""
    with open(FARMER + ".json") as fh:
        meta = json.load(fh)
    sheet = Image.open(FARMER + ".png").convert("RGBA")
    tag = next(t for t in meta["meta"]["frameTags"] if t["name"] == f"idle_{view}")
    f = meta["frames"][str(tag["from"])]["frame"]
    return sheet.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))


def _lap(img, grid):
    """The driver's lap and hands, outlined in his own outline colour where they meet open air."""
    px = img.load()
    cells = {(x, y): DRIVER[k] for y, row in enumerate(grid) for x, k in enumerate(row) if k in DRIVER}
    for (x, y), rgb in cells.items():
        px[x, y] = rgb + (255,)
    for (x, y) in cells:
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H and px[nx, ny][3] == 0:
                px[nx, ny] = DRIVER_LINE + (255,)


def tractor(view, frame=0, driven=False):
    """One frame: `view` is right, left, down or up. Anchor is the bottom centre."""
    left = view == "left"
    view = "right" if left else view
    grid = GRIDS[view]
    img = _canvas(grid, frame).outline(rim_amount=0.4, lit_bonus=0.05).image()
    if driven:
        body = _farmer(view).crop((0, TOP, 48, HIP + 1))
        sx, sy = SEAT[view]
        img.alpha_composite(body, (sx - 24, sy - (HIP - TOP)))
        over = _canvas(grid, frame, OVER[view]).outline(rim_amount=0.4, lit_bonus=0.05).image()
        img.alpha_composite(over)
        _lap(img, grid)
    if left:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    return img, (W // 2, H - 1)


def frames():
    """[(name, image)] for the atlas: tractor_<dir>_<frame> and tractor_<dir>_driven_<frame>."""
    out = []
    for view in ("down", "up", "left", "right"):
        for driven in (False, True):
            for frame in (0, 1):
                name = f"tractor_{view}{'_driven' if driven else ''}_{frame}"
                out.append((name, tractor(view, frame, driven)[0]))
    return out
