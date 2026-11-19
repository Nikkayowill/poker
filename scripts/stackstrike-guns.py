"""Draws StackStrike's three guns as smooth top-down art, pointing east (+x), with gloved hands on them.

Run: python3 scripts/stackstrike-guns.py   (writes public/stackstrike/art/gun-*.png and guns.json)
`grip` is the glove back by the trigger and `lead` the one out front. The game pins `grip` to
`hold` (how far in front of the body's centre, in body picture pixels) and stretches the arms to both
gloves. The picture is turned to the aim.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from stackstrike_art import Canvas, both, union

OUT = "public/stackstrike/art"
METAL = ((176, 184, 198), (58, 64, 78))
DARK = ((104, 112, 128), (28, 30, 38))
POLY = ((72, 76, 88), (20, 22, 28))
WOOD = ((196, 130, 72), (96, 56, 28))


def glove(cv, cx, cy, r=12):
    hand = cv.ellipse(cx, cy, r + 2, r)
    cv.paint(hand, (84, 88, 100), (14, 15, 20))
    cv.paint(cv.capsule((cx + 2, cy - r * 0.55), (cx + r + 3, cy - r * 0.45), 5), (110, 114, 128), (30, 32, 40), edge=0.5)  # fingers
    cv.gloss(cx - 3, cy - 4, 6, 3, 0.35, within=hand)


def rings(cv, x0, x1, y0, y1, gap=9):
    for x in range(x0, x1, gap):
        cv.paint(cv.rrect(x, y0 + 1, x + 2, y1 - 1, 1), (150, 158, 172), (40, 44, 54), edge=0)


def finish(cv, name, grip, lead, hold):
    cv.shadow(cv.img.getchannel("A"), 2, 4, 0.35, 2.5)
    cv.outline(2.2)
    cv.save(f"{OUT}/gun-{name}.png")
    return {"w": cv.w, "h": cv.h, "grip": {"x": grip[0], "y": grip[1]}, "lead": {"x": lead[0], "y": lead[1]}, "hold": hold}


def pistol():
    cv = Canvas(112, 48)
    cv.paint(cv.rrect(4, 15, 30, 33, 8), *POLY)  # grip and frame
    cv.paint(cv.rrect(16, 12, 70, 36, 7), *METAL)  # slide
    cv.paint(cv.rrect(18, 14, 68, 19, 2), (226, 232, 242), (150, 158, 172), edge=0)  # lit top edge
    cv.paint(cv.rrect(70, 17, 108, 31, 7), *DARK)  # suppressor
    rings(cv, 74, 106, 17, 31)
    cv.paint(cv.rrect(64, 9, 68, 14, 1), (240, 244, 250), (150, 158, 172), edge=0)  # sight
    glove(cv, 24, 24)
    glove(cv, 42, 25, 10)
    return finish(cv, "pistol", (24, 24), (44, 26), 46)


def smg():
    cv = Canvas(160, 52)
    cv.paint(cv.rrect(2, 16, 28, 38, 7), *POLY)  # stock
    cv.paint(cv.rrect(20, 12, 104, 40, 8), *METAL)  # receiver
    cv.paint(cv.rrect(24, 14, 100, 20, 3), (226, 232, 242), (150, 158, 172), edge=0)
    cv.paint(cv.rrect(48, 7, 90, 13, 3), *DARK)  # sight rail
    cv.paint(cv.rrect(104, 19, 154, 33, 7), *DARK)  # suppressor
    rings(cv, 108, 152, 19, 33)
    cv.paint(cv.rrect(78, 38, 94, 50, 4), *POLY)  # magazine seen past the receiver
    glove(cv, 34, 27)
    glove(cv, 82, 26, 11)
    return finish(cv, "smg", (34, 27), (82, 26), 40)


def shotgun():
    cv = Canvas(208, 48)
    cv.paint(cv.rrect(2, 12, 58, 36, 10), *WOOD)  # stock
    cv.paint(cv.rrect(6, 14, 54, 19, 3), (232, 170, 108), (150, 92, 48), edge=0)
    cv.paint(cv.rrect(56, 10, 100, 38, 6), *METAL)  # action
    cv.paint(cv.rrect(98, 17, 200, 31, 6), *DARK)  # barrel
    cv.paint(cv.rrect(98, 17, 200, 22, 3), (150, 158, 172), (80, 86, 100), edge=0)
    cv.paint(cv.rrect(116, 12, 162, 36, 8), *WOOD)  # pump
    cv.paint(cv.rrect(170, 14, 204, 34, 7), *DARK)  # suppressor sleeve
    rings(cv, 174, 202, 14, 34)
    glove(cv, 44, 24)
    glove(cv, 122, 24, 12)
    return finish(cv, "shotgun", (44, 24), (122, 24), 34)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {"pistol": pistol(), "smg": smg(), "shotgun": shotgun()}
    with open(f"{OUT}/guns.json", "w") as f:
        json.dump(manifest, f, indent=2)


main()
