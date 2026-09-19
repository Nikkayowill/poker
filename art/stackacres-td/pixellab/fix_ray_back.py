#!/usr/bin/env python3
"""PixelLab drew Ray's back view as a second front view (face, beard and overall bib). This repaints it as the
back of him: white hair under the cap, the neck, and the plaid shirt with the overall straps crossing, using only
colours PixelLab already gave him. The original is kept beside it as north.original.png.

Run once after fetching Ray; build.py then reads the fixed north.png.
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWS = os.path.join(HERE, "source", "ray", "rotations")
X0, Y0 = 17, 10  # where these rows start in the 48x48 view

KEY = {"D": "847475", "G": "e2d6d5", "I": "f7f5f4", "J": "bfb8ba", "A": "875546", "N": "efbca6", "H": "e9af96",
       "M": "cf917d", "O": "143058", "P": "11213f", "S": "c3475c", "T": "b8384b", "W": "9b2537", "Q": "761d2e",
       "Z": "aa293a", "Y": "a53e5b", "b": "8b2232", "e": "11192e", "K": "1a1d2d"}

ROWS = [
    ".DJJJJJJJJJJA.",  # 10 white hair under the cap, in its shadow at the top
    ".DJIJIIJIJIJD.",
    ".DIJIIJIIJIJD.",
    ".DJIJIIIIJIJD.",
    "..DJJIJJIJJD..",
    "...NHHHHHHN...",  # 15 the neck
    "...JHMMMMHJ...",
    "...JHHMMHHJ...",
    "...OSTSSTSP...",  # 18 collar, the straps coming over the shoulders
    "..QOSTWSTWOW..",
    ".WSSOSTWSOSWZ.",
    ".ZYTSOWWOSTTT.",
    "WQbTSZOOZSTWbW",  # 22 the straps cross
    "TTWSTWOOWTSTTT",
    "WWeSTWOOWSTeZS",
    "TTeSWTOOTWSeWT",
    "WbeTSWOOWSTKbW",
]


def main():
    path = os.path.join(VIEWS, "north.png")
    original = os.path.join(VIEWS, "north.original.png")
    if not os.path.exists(original):
        os.rename(path, original)
    img = Image.open(original).convert("RGBA")
    for j, row in enumerate(ROWS):
        assert len(row) == 14, (j, row)
        for i, k in enumerate(row):
            xy = (X0 + i, Y0 + j)
            if k == ".":
                img.putpixel(xy, (0, 0, 0, 0))
            else:
                img.putpixel(xy, tuple(int(KEY[k][n:n + 2], 16) for n in (0, 2, 4)) + (255,))
    img.save(path)
    print("fixed", path)


if __name__ == "__main__":
    main()
