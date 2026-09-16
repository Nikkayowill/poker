"""Animals: stock, wildlife and predators. Side views facing right; `facing_left` mirrors.

Grids use DawnBringer 16 keys. Each returns (Sprite, anchor) like kit.py's sprites.
"""
from kit import Sprite


def _grid(rows, facing_left=False, outline="K", pad=1):
    if facing_left:
        rows = [r[::-1] for r in rows]
    s = Sprite(len(rows[0]) + pad * 2, len(rows) + pad * 2)
    s.stamp(rows, pad, pad)
    if outline:
        s.outline(outline)
    return s


def sheep(facing_left=False):
    rows = [
        "...WWWWWWW....",
        "..WWWWWWWWWW..",
        ".WWWWWWWWWWKK.",
        ".WWWWWWWWWWKKK",
        ".WWWWWWWWWsKK.",
        "..WWWWWWsss...",
        "...gg..gg.....",
        "...gg..gg.....",
    ]
    s = _grid(rows, facing_left)
    return s, (s.w // 2, s.h - 1)


def cattle(facing_left=False, patches=True):
    rows = [
        "......................T.TT",
        ".....NNNNNNNNNNNNNN...TNNT",
        "....NNNNNNNNNNNNNNNNN.NNNN",
        "...NNNNNWWWNNNNNNNNNNNNNNN",
        "..NNNNNWWWWWNNNNNNNNNNKNNN",
        "..NNNNNNWWWNNNNNWWNNNNNTTT",
        "..NNNNNNNNNNNNNWWWNNNNNTTT",
        "..PNNNNNNNNNNNNNNNNNNN.TT.",
        "..P.NNNNNNNNNNNNNNNNN.....",
        "..P..NNN.....NNN..........",
        ".....NNN.....NNN..........",
        ".....PPP.....PPP..........",
    ]
    if not patches:
        rows = [r.replace("W", "N") for r in rows]
    s = _grid(rows, facing_left)
    return s, (s.w // 2, s.h - 1)


def coyote(facing_left=False):
    rows = [
        "..............o.o.",
        "oo............ooo.",
        ".ooo.oooooooooooK.",
        "..oooooooooooooTT.",
        "...ooooooooooTT...",
        "...oTTTTTTTTT.....",
        "...oo.....oo......",
        "...oo.....oo......",
    ]
    s = _grid(rows, facing_left)
    return s, (s.w // 2, s.h - 1)


def wolf(facing_left=False):
    rows = [
        "...............g.g..",
        "gg.............ggg..",
        ".ggg.ggggggggggggK..",
        "..gggggggggggggggss.",
        "...gggggggggggssss..",
        "...gsssssssssss.....",
        "...gg.....gg........",
        "...gg.....gg........",
        "...KK.....KK........",
    ]
    s = _grid(rows, facing_left)
    return s, (s.w // 2, s.h - 1)


def bear(facing_left=False):
    rows = [
        "...........................",
        ".......PPPPPPPPPPP..P.P....",
        "....PPPPPPPPPPPPPPPPPPPP...",
        "...PPPPPPPPPPPPPPPPPPPPPP..",
        "..PPPPPPPPPPPPPPPPPPPKPPNN.",
        "..PPPPPPPPPPPPPPPPPPPPPNNK.",
        "..PPPPPPPPPPPPPPPPPPPPPNNN.",
        "..PPPPPPPPPPPPPPPPPPPPP....",
        "..PPPPPPPPPPPPPPPPPPPP.....",
        "..PPPPPPPPPPPPPPPPPPP......",
        "...PPPPPP.......PPPPPP.....",
        "...PPPPPP.......PPPPPP.....",
        "...NNNNNN.......NNNNNN.....",
    ]
    s = _grid(rows, facing_left)
    return s, (s.w // 2, s.h - 1)


def squirrel(facing_left=False):
    rows = [
        ".....oo.",
        "....oooo",
        "..K.oooo",
        ".ooo.oo.",
        ".oooooo.",
        ".oTToo..",
        "..oo.o..",
    ]
    s = _grid(rows, facing_left)
    return s, (s.w // 2, s.h - 1)


def bird(facing_left=False):
    rows = [
        "..LL...",
        ".LKLL..",
        "YLLLLL.",
        ".WWLL..",
        "..WW...",
        "..K.K..",
    ]
    s = _grid(rows, facing_left)
    return s, (s.w // 2, s.h - 1)


def seagull(facing_left=False):
    rows = [
        "........W..",
        ".......WWW.",
        ".sssWWWWKY.",
        "..sWWWWWW..",
        "...WWWWW...",
        ".....Y.Y...",
    ]
    s = _grid(rows, facing_left)
    return s, (s.w // 2, s.h - 1)


def fish(kind="s"):
    """A fish out of water, for racks and counters."""
    rows = [".%s%s%s." % (kind, kind, kind), "C%s%sC%s" % (kind, kind, kind), ".%s%s%s." % (kind, kind, kind)]
    s = _grid(rows, outline="B")
    return s, (s.w // 2, s.h - 1)
