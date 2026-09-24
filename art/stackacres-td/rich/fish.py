#!/usr/bin/env python3
"""The pond's three fish, drawn by hand for the catch: the one that jumps out of the water, lands in the
farmer's hands and is held up over his head (lib/stackacres-td/fish-catch.ts).

16x16 each, one tile, at the characters' own pixel size so a fish in his hands is drawn at the same scale as
the hands. Stardew's fish are a tile too. Facing right; the scene flips them.

Each picture is the fill only. The outline is added round the silhouette afterwards, in each fish's own
darkest tone rather than black, which is how the characters are outlined.

    python3 fish.py             # public/stackacres-td/common/fish.png: 18x18 cells, bluegill, trout, catfish
    python3 fish.py --preview   # and an 8x picture of the three beside the farmer, in scratch/
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "public", "stackacres-td", "common", "fish.png")
SIZE = 16
# Each picture fills up to 16x16; the cell is a pixel bigger all round so the outline never hits its edge.
CELL = SIZE + 2


def hx(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


# Bluegill: a deep, round sunfish. Blue-olive back, a yellow-orange belly and the black ear flap behind
# the eye that gives it its name.
BLUEGILL = dict(
    outline="#18283a",
    colours={"t": "#3a6d8f", "B": "#2f5f82", "b": "#4b88ab", "l": "#86bcd0", "y": "#e2952f", "Y": "#f4c460",
             "k": "#141c26", "f": "#3d6f8f", "e": "#f4f0e2", "p": "#10161e", "v": "#2a5270"},
    rows=[
        "................",
        "................",
        "................",
        "......fffff.....",
        ".....BBBBBBBf...",
        "t..BBBvBBBvBBB..",
        "tt.BbbbvbbbvbbB.",
        "ttbbbbbvbbbvkepb",
        "tttbbbbvbbbvkbbb",
        "ttblllllvllllllb",
        "tt.yyyyyyyyyyyy.",
        "t...YyyyyyyyyY..",
        ".....fff..yy....",
        "................",
        "................",
        "................",
    ],
)

# Rainbow trout: long and slim, olive back peppered black, a pink stripe down the side, silver below.
TROUT = dict(
    outline="#1d2a17",
    colours={"t": "#6b8646", "G": "#4e6b33", "g": "#7d9a52", "s": "#26331a", "p": "#e5838c", "P": "#f2aab0",
             "w": "#dfe3dc", "W": "#b9c2bb", "f": "#6b8646", "e": "#f4f0e2", "k": "#10161e"},
    rows=[
        "................",
        "................",
        "................",
        "................",
        "t.......ff......",
        "tt....GGGGGG....",
        ".tt.GGsGGsGGGG..",
        "..tgggggsgggggeG",
        "..tgsgggggggggkg",
        "..tppppPPPPPpppp",
        ".ttwwwwwwwwwwww.",
        "tt..WwwwwwwwwW..",
        "t......f..f.....",
        "................",
        "................",
        "................",
    ],
)

# Channel catfish: long, grey-brown, flat broad head, pale belly and the whiskers it is named for.
CATFISH = dict(
    outline="#1f1b16",
    colours={"t": "#6e665a", "C": "#5d554a", "c": "#877d6d", "d": "#433d35", "w": "#d6cfbd", "W": "#b2aa96",
             "f": "#6e665a", "e": "#f4f0e2", "k": "#10161e", "h": "#2b2620"},
    rows=[
        "................",
        "................",
        "................",
        "................",
        "t.......ff......",
        "tt...CCCCCCC....",
        ".tt.CCcccdcccCC.",
        "..tcccdcccccccek",
        "..tcccccccdccccc",
        "..twwwwwwwwwwwwh",
        ".ttWwwwwwwwwwWh.",
        "tt...f...f...h.h",
        "t...........h...",
        "................",
        "................",
        "................",
    ],
)

FISH = [("bluegill", BLUEGILL), ("trout", TROUT), ("catfish", CATFISH)]
# Whiskers are single dark pixels that must not get an outline of their own, or they read as a blob.
BARE = {"h"}


def draw(spec):
    img = Image.new("RGBA", (CELL, CELL))
    px = img.load()
    rows = spec["rows"]
    assert len(rows) == SIZE and all(len(r) == SIZE for r in rows), "every fish is 16x16"
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                px[x + 1, y + 1] = hx(spec["colours"][ch])
    edge = hx(spec["outline"])
    solid = {(x, y) for y, row in enumerate(rows) for x, ch in enumerate(row) if ch not in ".h"}
    for y in range(-1, SIZE + 1):
        for x in range(-1, SIZE + 1):
            if 0 <= x < SIZE and 0 <= y < SIZE and rows[y][x] != ".":
                continue
            if any((x + dx, y + dy) in solid for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[x + 1, y + 1] = edge
    return img


def sheet():
    out = Image.new("RGBA", (CELL * len(FISH), CELL))
    for i, (_, spec) in enumerate(FISH):
        out.alpha_composite(draw(spec), (i * CELL, 0))
    return out


def preview(img, path):
    """The three at 8x, on water and on grass, beside the farmer's hold-up frame for scale."""
    farmer = Image.open(os.path.join(REPO, "public", "stackacres-td", "characters", "farmer.png")).convert("RGBA")
    hold = farmer.crop((3 * 48, 48 * 48, 4 * 48, 49 * 48))
    scale = 8
    board = Image.new("RGBA", ((CELL * 3 + 8 + 48) * scale, 48 * scale), hx("#3f6f3a"))
    water = Image.new("RGBA", (CELL * 3 * scale, CELL * scale), hx("#2c5d9c"))
    board.alpha_composite(water, (0, 0))
    big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    board.alpha_composite(big, (0, 0))
    board.alpha_composite(big, (0, CELL * scale))
    stage = Image.new("RGBA", (48, 48))
    stage.alpha_composite(hold, (0, 0))
    stage.alpha_composite(draw(TROUT), (15, -1))
    board.alpha_composite(stage.resize((48 * scale, 48 * scale), Image.NEAREST), ((CELL * 3 + 8) * scale, 0))
    board.save(path)


if __name__ == "__main__":
    img = sheet()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, optimize=True)
    print("wrote", os.path.relpath(OUT, REPO), img.size)
    if "--preview" in sys.argv:
        path = sys.argv[sys.argv.index("--preview") + 1] if len(sys.argv) > sys.argv.index("--preview") + 1 else "fish-preview.png"
        preview(img, path)
        print("preview", path)
