"""The four early-game crops at three growth stages: sprout, growing, ready to harvest.

Kayo's call (2026-09-16): only carrot, potato, radish and wheat for now (wheat added with
the early crop economy brief, docs/stackacres-early-crop-economy.md); the rest of the
catalogue gets drawn once the game is playable. The ready stage is the one that has to
look good: the produce shows, in its own colour, and the plant is at its fullest.
Outlined in P like the generic crop so they sit in the dark soil.
"""
from kit import Sprite

SPROUT = ["v.v", ".G."]

CROPS = {
    "carrot": {
        1: [".v.v.v.", "vGvGvGv", ".vGvGv.", "..vGv..", "..GvG..", "...G..."],
        2: ["v.v.v.v.v.v", ".vGvGvGvGv.", "v.vGvGvGv.v", ".vGvGvGvGv.", "..vGvGvGv..", "...GvGvG...", "....GGG....",
            "...ToooT...", "..ToooooN..", "..oooooNN..", "...oooNN...", "....oN....."],
    },
    "potato": {
        1: [".vG.Gv.", "vGvGvGv", ".GvGvG.", "..vGv..", "...G..."],
        2: ["..W...W.W...", ".WYW.WYWYW..", "..W.vGvW.W..", ".vGvGvGvGvG.", "vGvGvGvGvGvG", ".GvGvGvGvGv.",
            "..GvGvGvGv..", "...GvGvGv...", "....GvGv....", ".TTT....TTT.", ".ToN....ToN.", "..TT.TTT.TT."],
    },
    "wheat": {  # straw-gold stalks when ready, grain heads on top: it has to read as two things, grain and straw
        1: ["v..v..v", "Gv.Gv.G", "vG.vG.v", "Gv.Gv.G", ".G..G..", ".G..G.."],
        2: ["Y...W...Y", "oY.YoY.Yo", "Yo.oYo.oY", "oY.YoY.Yo", ".Y..o..Y.", ".o..Y..o.", "..o.o.o..",
            "..T.T.T..", "v.T.T.T.v", ".vT.T.Tv.", "..vTTTv..", "...TTT...", "....o...."],
    },
    "radish": {
        1: [".vv.vv.", "vGvvGvv", ".vGvGv.", "..GvG..", "...G..."],
        2: [".vv..v..vv.", "vGvv.G.vvGv", ".vGvvGvvGv.", "..vGvGvGv..", "...GvGvG...", "....GvG....", "...RRRRR...",
            "..RWWRRRR..", "..RWRRRRP..", "..RRRRRPP..", "...RRRPP...", "....WPP...."],
    },
}
NAMES = list(CROPS)


def crop(name, stage):
    rows = SPROUT if stage == 0 else CROPS[name][stage]
    s = Sprite(len(rows[0]) + 2, len(rows) + 2)
    s.stamp(rows, 1, 1)
    return s.outline("P"), (s.w // 2, s.h - 1)
