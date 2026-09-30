"""Ripe crops, hand-pixelled: each one ends the season looking like what it is.

The carrot, potato, radish and wheat are drawn by extras.crop from the rig's grids. Every other crop
used to finish as the same generic sprout, so a ripe tomato and a ripe onion looked alike. These are
drawn pixel by pixel instead of shaded by formula: one grid per crop, letters naming colours.

Shared letters: `K` outline, `k` dark leaf edge, `1`-`6` the leaf ramp from shadow to highlight, all
lifted from the approved carrot so the foliage matches. `A`-`F` are each crop's own produce ramp,
outline to shine. The bottom row of every grid sits on the bed.
"""
from PIL import Image

LEAF = {
    "K": "#0b1912", "k": "#112e1d", "1": "#308023", "2": "#449328", "3": "#5ba52f",
    "4": "#74b437", "5": "#8ec043", "6": "#a0b962",
}

# Each crop: its produce ramp (A outline .. F shine) and its grid.
RIPE = {
    "tomato": (
        {"A": "#3a0d10", "B": "#8e1a1f", "C": "#c6232a", "D": "#e2473a", "E": "#f07a5a", "F": "#fbe3d0"},
        [
            "......kk......",
            ".....k54k.....",
            "..kk.k43k.kk..",
            ".k54kk3kkk45k.",
            ".k3kAAkk2kk3k.",
            "..kACDAkk2k...",
            "..ACFEDAk2kAA.",
            "..ACEDCAk2ACDA",
            "..ABCCBA2kCFEA",
            ".k2AAAAk1kCEDA",
            "k45k2k1k1kBCBA",
            "k3kAAk.k1k.AA.",
            ".kACDA.k1kk5k.",
            ".ACFEDAk1k3k..",
            ".ACDDCAk1kk...",
            ".ABCCBA.k1k...",
            "..AAAA..k1k...",
        ],
    ),
    "eggplant": (
        {"A": "#1d0d24", "B": "#3e1a52", "C": "#5e2a7a", "D": "#7f45a0", "E": "#a878c4", "F": "#e6d8f0"},
        [
            "....kk...kk...",
            "...k54k.k45k..",
            "..k543kk4k3k..",
            "...kk3k2k3kk..",
            ".kk..kk2kk..k.",
            "k54k.k2k2k.k4k",
            "k4k3kk2k3k.k3k",
            ".k1k2k1k2kk2k.",
            "..k1kk1kk1k1k.",
            "..AkkA1kAkkA..",
            ".ADAAC1ACAADA.",
            ".ACFDC1ACFDCA.",
            ".ACEDCkACEDCA.",
            ".ACDCBkACDCBA.",
            ".ACCCBkACCCBA.",
            ".ABCBBkABCBBA.",
            "..ABBAk.ABBA..",
            "...AA.k..AA...",
        ],
    ),
    "pepper": (
        {"A": "#3a0d10", "B": "#9a1c1c", "C": "#cc2a22", "D": "#e5503a", "E": "#f28a60", "F": "#fbe3d0"},
        [
            ".....k..kk....",
            "..kkk5kk54k...",
            ".k543k4kk3kkk.",
            "..kk3k3k3k45k.",
            ".k5kk2k2kk3k..",
            "k43k1k2k1kk...",
            ".kkAkk1kkAkk..",
            "..ACAk1kACAk..",
            ".ACFDA1ACEDAk.",
            ".ACEDAkACDCA..",
            ".ACDCAkACDCA..",
            ".ABCCAkABCBA..",
            "..ABCA1.ACBA..",
            "..ABBAk.ABA...",
            "...ABA1..AA...",
            "...AA.k.......",
            "......k.......",
        ],
    ),
    "bell_pepper": (
        {"A": "#3a0d10", "B": "#9e1c1a", "C": "#d33022", "D": "#ea5a3a", "E": "#f59a78", "F": "#fde6da"},
        [
            "...kk....kk...",
            "..k54k..k45k..",
            ".k543kkkk3kk..",
            "..kk3k22k3k5k.",
            ".k5kk2kk2k43k.",
            "k43kk1kk1kk3k.",
            ".kkAAk1kkAAk..",
            ".ACDDA1AACDDA.",
            "ACFEDCACAFEDCA",
            "ACEDDCBACEDDCA",
            "ACDDCCBACDDCBA",
            "ABCCCBBABCCCBA",
            "ABCBACBABCBCBA",
            ".ABA.AA.ABAAA.",
        ],
    ),
    "corn": (
        {"A": "#3b2a0a", "B": "#c08a12", "C": "#e4b22a", "D": "#f3d24c", "E": "#fbeb94", "F": "#7e3611"},
        [
            "......kFFk....",
            ".....kF..Fk...",
            ".....kAAAAk...",
            "..k..ADEDCAk..",
            ".k5k.AEDECAk4k",
            ".k4k.ADEDCBk3k",
            "..k3kAEDECBk3k",
            "...k4ADEDCB2k.",
            "..k43AEDECBk..",
            ".k43kADEDCBk..",
            ".k3k4AEDECB3k.",
            "..kk43ADCBA43k",
            ".....k4AAk2k3k",
            "......k43k.kk.",
            "......k3k.....",
            "......k2k.....",
            "......k1k.....",
            "......k1k.....",
        ],
    ),
    "onion": (
        {"A": "#3a1a12", "B": "#a8634a", "C": "#d99a6a", "D": "#eec08e", "E": "#f8e2c4", "F": "#fff6e8"},
        [
            "..k....k..k...",
            ".k5k..k5kk5k..",
            ".k4k..k4kk4k..",
            "..k3k.k3k4k...",
            "..k3k.k3k3k...",
            "...k2kk2k2k...",
            "...k2k2k2k....",
            "....k1k1k.....",
            "....AA1AA.....",
            "..AACDDCAA....",
            ".ACDEFEDCBA...",
            "ACDEFEEDCBBA..",
            "ACDEEEDDCBBA..",
            "ABCDDDDCCBBA..",
            ".ABCCCCCBBA...",
            "..AABBBBAA....",
            "....AAAA......",
        ],
    ),
    "green_bean": (
        {"A": "#1a3a10", "B": "#6aa62c", "C": "#a4d64c", "D": "#c8ea7c", "E": "#e8f7b4", "F": "#f8fde8"},
        [
            ".....kk..kk...",
            "....k43kk34k..",
            "...k432k32k...",
            "..kkk2k1k2kk..",
            ".k43kk1k1kk3k.",
            ".k2kAk1k1kAk2k",
            "..kAEAk1kAEAk.",
            "..AEDCAkADCBA.",
            ".kADCAk1kADCA.",
            "k32ADCAk1ADCA.",
            "k2kACBA1kACBA.",
            ".kkADCAk1ADCA.",
            "..kACBAk1ACBA.",
            "..kADCA1kABBA.",
            "...ACBAk1.AA..",
            "...ABA.k1k....",
            "....A..k1k....",
        ],
    ),
    "lettuce": (
        {"A": "#1d4a1a", "B": "#4a8f25", "C": "#7cbd3a", "D": "#a6d65a", "E": "#cce88a", "F": "#eef8c8"},
        [
            "....AA..AA....",
            "..AADCAACDAA..",
            ".ACEDCBCDEDCA.",
            "ACDEFEDCEFEDCA",
            "ABCDEEDDEEDCBA",
            "ACBCDEFEEDCBCA",
            "ADCBCDEEDCBCDA",
            "ACDCBCDDCBCDCA",
            "ABCDCBCCBCDCBA",
            ".ABCCBBBBCCBA.",
            "..AABBBBBBAA..",
            "....AAAAAA....",
        ],
    ),
    "cabbage": (
        {"A": "#173a2a", "B": "#3f7a55", "C": "#6da878", "D": "#98c996", "E": "#c4e2b4", "F": "#e6f4dc"},
        [
            ".k4k......k4k.",
            "k543kAAAAk345k",
            "k43kACDDCAk34k",
            ".kkACEFFEDCAk.",
            "k4ACDEFFEDCBA4",
            "k3ACDEEEEDCBA3",
            "k3ABCDEEDDCBA3",
            "k2ACBCDDCCBCA2",
            ".kABCBCCBBCBAk",
            "k3kABBBBBBBAk3",
            "k43kAAAAAAAk34",
            ".kk21k1k1k12k.",
            "...kkkkkkkk...",
        ],
    ),
    "broccoli": (
        {"A": "#0d2418", "B": "#1f4d2e", "C": "#2f6b3a", "D": "#4a8a4a", "E": "#6fae5c", "F": "#9ccc7a"},
        [
            "...AA..AAA....",
            "..ADEAADEEA...",
            ".ACEFDACEFDAA.",
            ".ACDEDCDEDCDEA",
            "AADCDCDCDCCDFA",
            "ADEACDCEFDCDEA",
            "ACEFDCCDEDCBBA",
            "ACDECBCCDCBBA.",
            ".ABCBBBBCBBAk.",
            "k4kAAA3k3AAAk4",
            "k43k.k4k4k.k3k",
            ".k3kk3k2k3kk2k",
            "..kk2k6k1k2kk.",
            "....k565k.....",
            "....k454k.....",
            ".....k4k......",
        ],
    ),
    "spinach": (
        {"A": "#0c2a14", "B": "#1f5a2a", "C": "#2f7a34", "D": "#4a9a3e", "E": "#74b84e", "F": "#a2d272"},
        [
            "...AA....AA...",
            "..ADEA..AEDA..",
            ".ACEFDAADFECA.",
            ".ACDEDAADEDCA.",
            "AA.ACDCCDCA.AA",
            "ADAACDBBDCAADA",
            "ACEDACBBCADECA",
            "ACDEDACCADEDCA",
            ".ACDCBABACDCA.",
            "..ABCBBABBCBA.",
            "...AABB1BBAA..",
            ".....AA1AA....",
        ],
    ),
    "celery": (
        {"A": "#1e3a12", "B": "#5a8a2a", "C": "#8cbf4a", "D": "#b4d874", "E": "#d8ecaa", "F": "#f2f9e0"},
        [
            ".kk..k..kk....",
            "k54kk5kk45k...",
            "k43k545k3k....",
            ".kk43k34kk.k..",
            "..kk3k3kk.k5k.",
            "...AkAkAk.k3k.",
            "..ADADADAA2k..",
            "..ACECECECA...",
            "..ACDCDCDBA...",
            "..ACECECEBA...",
            "..ACDCDCDBA...",
            "..ACECECEBA...",
            "..ACDCDCDBA...",
            "..ABCBCBCBA...",
            "...AAAAAAA....",
        ],
    ),
}


def ripe_crop(name):
    """The crop's ripe sprite and its anchor (bottom centre), same shape as extras.crop returns."""
    ramp, rows = RIPE[name]
    colours = {**LEAF, **ramp}
    w, h = max(len(r) for r in rows), len(rows)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, key in enumerate(row):
            if key == ".":
                continue
            hexcode = colours[key]
            img.putpixel((x, y), tuple(int(hexcode[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    return img, (w // 2, h - 1)
