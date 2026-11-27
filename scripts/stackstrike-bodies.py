"""Draws StackStrike's two characters as smooth, arcade-style top-down art, facing east (+x).

Run: python3 scripts/stackstrike-bodies.py   (writes public/stackstrike/art/{operative,guard}.png and the arm pieces)
Seen from straight above. The body is drawn without arms: the game turns it to the facing, stretches
two arm pieces from each shoulder to each hand (arm-*-upper.png, arm-*-fore.png, which end in a glove),
and lays the gun, with the gloves drawn on it, over the hands. The body's centre is the canvas centre
so turning it turns it in place. SHOULDER_PX and ARM_PX are mirrored in lib/stackstrike/sprites.ts.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from stackstrike_art import Canvas, both, union

OUT = "public/stackstrike/art"
N = 128
C = 64

ARM_PX = 62  # joint to joint, at full stretch
ARM_W = 14

# Palettes: (light, dark) pairs for `paint`.
STEEL = ((232, 238, 248), (118, 128, 148))
STEEL_MID = ((190, 198, 212), (96, 106, 126))
GUNMETAL = ((112, 120, 138), (26, 28, 36))
TEAL = ((130, 244, 240), (24, 128, 142))
TEAL_DEEP = ((60, 190, 196), (12, 84, 100))
GLOVE = ((226, 230, 238), (112, 120, 140))  # light enough to read on the dark floor


def radial(cv, cx, cy, r_in, r_out, deg, width, light, dark, within=None):
    """A thin spoke from near the centre outwards, for seams."""
    a = math.radians(deg)
    spoke = cv.capsule((cx + math.cos(a) * r_in, cy + math.sin(a) * r_in), (cx + math.cos(a) * r_out, cy + math.sin(a) * r_out), width)
    if within is not None:
        spoke = both(spoke, within)
    cv.paint(spoke, light, dark, edge=0)


def arm_piece(name, base, shade, band=None, glove=False, pad=None, cuff=None, glove_colors=GLOVE):
    """One arm segment, joint to joint along x. Shaded like a tube so it looks right turned any way."""
    cv = Canvas(ARM_PX + 18, 26)
    y = 13
    start, end = (9, y), (9 + ARM_PX, y)
    tube = cv.capsule(start, end, ARM_W)
    cv.paint(tube, shade, shade, edge=0.45)
    cv.paint(cv.capsule((start[0], y - 0.5), (end[0], y - 0.5), ARM_W - 6), base, shade, edge=0)
    cv.gloss(9 + ARM_PX / 2, y - 3, ARM_PX / 2 - 4, 2.2, 0.35, within=tube)
    if band:
        cv.paint(both(tube, cv.rrect(band[0], 0, band[0] + band[1], 26, 1)), band[2], band[3], edge=0.5)
    if pad:  # an elbow pad on the joint
        p = cv.rrect(ARM_PX - 7, 3, ARM_PX + 9, 23, 6)
        cv.paint(p, *pad)
        cv.paint(cv.rrect(ARM_PX - 3, 8, ARM_PX + 5, 18, 3), pad[1], pad[1], edge=0)
    if cuff:  # a cuff just before the hand
        cv.paint(both(tube, cv.rrect(cuff[0], 0, cuff[0] + cuff[1], 26, 1)), cuff[2], cuff[3], edge=0.5)
    if glove:
        hand = cv.ellipse(end[0] + 1, y, 10, 9.5)
        cv.paint(hand, *glove_colors)
        cv.gloss(end[0] - 2, y - 3, 5, 2.4, 0.35, within=hand)
    cv.outline(1.5)
    cv.save(f"{OUT}/arm-{name}.png")


def arm_pieces():
    arm_piece("operative-upper", *STEEL, pad=GUNMETAL)
    arm_piece("operative-fore", *STEEL_MID, band=(52, 6, *TEAL), glove=True)
    arm_piece("guard-upper", (168, 174, 194), (70, 74, 94), band=(30, 9, (255, 100, 108), (160, 22, 34)))
    arm_piece("guard-fore", (150, 156, 176), (62, 66, 84), glove=True, glove_colors=((214, 160, 104), (120, 76, 40)))


def operative():
    """Bean torso, big helmet, teal shoulder pads. Few shapes, so it still reads at 40 px."""
    cv = Canvas(N, N)

    pack = cv.rrect(18, 36, 46, 92, 12)  # backpack
    cv.paint(pack, (132, 142, 112), (62, 70, 52))
    cv.paint(cv.rrect(24, 44, 40, 84, 7), (104, 114, 88), (50, 56, 42), edge=0.55)

    torso = cv.ellipse(C, C, 29, 47)
    cv.paint(torso, (226, 232, 244), (118, 128, 150))
    cv.paint(cv.ellipse(C + 4, C, 17, 36), (176, 186, 204), (104, 114, 134), edge=0.5)  # chest plate

    for sign in (-1, 1):  # shoulder pads
        pad = cv.ellipse(C + 2, C + sign * 37, 15, 13)
        cv.paint(pad, *TEAL)
        cv.gloss(C - 1, C + sign * 37 - 4, 8, 3.4, 0.3, within=pad)

    head = cv.ellipse(C + 3, C, 27, 27)  # helmet
    cv.paint(head, (246, 249, 255), (136, 148, 172))
    cv.paint(both(head, cv.rrect(36, C - 3, 96, C + 3, 2)), (130, 140, 162), (70, 78, 98), edge=0.4)  # ridge
    visor = both(head, cv.capsule((88, C - 17), (88, C + 17), 14))
    cv.paint(visor, (24, 28, 36), (6, 7, 10), edge=0.5)
    cv.paint(both(head, cv.capsule((89, C - 14), (89, C + 14), 7)), *TEAL, edge=0.5)
    cv.gloss(56, 50, 12, 7, 0.3, within=head)

    cv.shadow(cv.img.getchannel("A"), 0, 0, 0.3, 3.0)
    cv.outline(3.0)
    cv.save(f"{OUT}/operative.png")


def guard():
    """Dark uniform, brass shoulder boards, a red cap with a peak. The red cap is what you pick out in the dark."""
    cv = Canvas(N, N)

    torso = cv.ellipse(C, C, 32, 47)
    cv.paint(torso, (148, 156, 184), (58, 62, 84))
    cv.paint(both(torso, cv.poly([(34, 18), (50, 14), (96, 110), (80, 114)])), (176, 124, 76), (84, 52, 28), edge=0.5)  # cross strap

    for sign in (-1, 1):  # brass shoulder boards
        board = cv.ellipse(C + 2, C + sign * 37, 15, 13)
        cv.paint(board, (255, 224, 128), (176, 124, 34))
        cv.gloss(C - 1, C + sign * 37 - 4, 8, 3.4, 0.3, within=board)
    cv.paint(cv.rrect(44, 20, 62, 40, 4), (96, 102, 118), (28, 30, 38))  # radio on the leading shoulder
    cv.paint(cv.ellipse(53, 34, 2.8, 2.8), (255, 130, 130), (200, 28, 34), edge=0.4)

    cv.paint(cv.ellipse(C - 4, C, 26, 26), (150, 100, 66), (62, 38, 22))  # hair, seen behind the cap
    peak = both(cv.ellipse(92, C, 16, 22), cv.rrect(78, 0, 128, N, 1))
    cv.paint(peak, (176, 44, 62), (84, 12, 26))
    cv.gloss(99, C - 8, 7, 4, 0.3, within=peak)
    crown = cv.ellipse(C + 4, C, 25, 26)
    cv.paint(crown, (244, 96, 112), (150, 28, 46))
    cv.paint(cv.ellipse(C + 4, C, 4.5, 4.5), (255, 232, 150), (190, 140, 40), edge=0.5)  # button
    cv.gloss(56, 51, 11, 7, 0.3, within=crown)

    cv.shadow(cv.img.getchannel("A"), 0, 0, 0.3, 3.0)
    cv.outline(3.0)
    cv.save(f"{OUT}/guard.png")


operative()
guard()
arm_pieces()
