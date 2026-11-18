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
ARM_W = 17

# Palettes: (light, dark) pairs for `paint`.
STEEL = ((232, 238, 248), (118, 128, 148))
STEEL_MID = ((190, 198, 212), (96, 106, 126))
GUNMETAL = ((112, 120, 138), (26, 28, 36))
TEAL = ((130, 244, 240), (24, 128, 142))
TEAL_DEEP = ((60, 190, 196), (12, 84, 100))
BLACK = ((84, 88, 100), (14, 15, 20))


def radial(cv, cx, cy, r_in, r_out, deg, width, light, dark, within=None):
    """A thin spoke from near the centre outwards, for seams."""
    a = math.radians(deg)
    spoke = cv.capsule((cx + math.cos(a) * r_in, cy + math.sin(a) * r_in), (cx + math.cos(a) * r_out, cy + math.sin(a) * r_out), width)
    if within is not None:
        spoke = both(spoke, within)
    cv.paint(spoke, light, dark, edge=0)


def arm_piece(name, base, shade, band=None, glove=False, pad=None, cuff=None):
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
        cv.paint(hand, *BLACK)
        cv.paint(cv.rrect(end[0] - 4, y - 7, end[0] - 1, y + 7, 1.5), (60, 64, 76), (20, 22, 28), edge=0)  # knuckle guard
        cv.gloss(end[0] - 2, y - 3, 5, 2.4, 0.35, within=hand)
    cv.outline(1.5)
    cv.save(f"{OUT}/arm-{name}.png")


def arm_pieces():
    arm_piece("operative-upper", *STEEL, pad=GUNMETAL)
    arm_piece("operative-fore", *STEEL_MID, band=(52, 6, *TEAL), glove=True)
    arm_piece("guard-upper", (140, 146, 164), (52, 54, 64), band=(30, 9, (255, 100, 108), (160, 22, 34)))
    arm_piece("guard-fore", (116, 122, 140), (42, 44, 54), glove=True, cuff=(46, 7, (30, 30, 36), (12, 12, 16)))


def operative():
    cv = Canvas(N, N)

    # Backpack with a rolled mat on top and a status light.
    pack = cv.rrect(11, 34, 46, 94, 11)
    cv.paint(pack, (112, 120, 100), (48, 52, 42))
    cv.paint(cv.rrect(5, 42, 20, 86, 7), (86, 92, 78), (36, 40, 32))  # rolled mat
    for y in (50, 64, 78):
        cv.paint(cv.rrect(5, y - 2, 20, y + 2, 1), (60, 64, 54), (30, 32, 26), edge=0)
    cv.paint(cv.rrect(28, 44, 40, 84, 5), (88, 96, 80), (40, 44, 36), edge=0.55)  # flap
    cv.paint(cv.ellipse(34, 64, 3, 3), *TEAL, edge=0.5)  # light

    torso = cv.rrect(34, 17, 94, 111, 26)
    cv.paint(torso, (240, 245, 252), (134, 144, 162))

    # Plate carrier, shoulder straps, magazine pouches.
    for sign in (-1, 1):
        cv.paint(cv.rrect(46, C + sign * 28 - 5, 82, C + sign * 28 + 5, 4), (74, 80, 94), (30, 33, 42), edge=0.6)  # shoulder strap
    cv.paint(cv.rrect(42, 30, 88, 98, 15), (204, 212, 224), (116, 126, 146), edge=0.6)  # plate
    cv.paint(cv.rrect(48, 36, 82, 92, 11), (168, 178, 194), (100, 110, 130), edge=0.5)  # plate inset
    for sign in (-1, 1):
        for dx in (0, 11):
            cv.paint(cv.rrect(70 + dx, C + sign * 34 - 4, 79 + dx, C + sign * 34 + 4, 2.5), (92, 98, 112), (34, 37, 46), edge=0.6)  # pouches
    cv.paint(cv.rrect(60, 34, 66, 94, 3), (150, 160, 178), (96, 106, 124), edge=0)  # seam

    # Armoured shoulder caps with a teal stripe, where the arms join.
    for sign in (-1, 1):
        y0 = C + sign * 46
        cap = cv.rrect(48, y0 - 11, 86, y0 + 11, 10)
        cv.paint(cap, *STEEL_MID)
        cv.paint(cv.rrect(54, y0 - 3, 82, y0 + 3, 3), *TEAL, edge=0.5)
        for rx in (55, 80):
            cv.paint(cv.ellipse(rx, y0 - sign * 7, 2, 2), (70, 76, 90), (24, 27, 34), edge=0)  # rivets

    # Helmet: shell, centre ridge, side rails with lights, ear pods, and the visor wrapped round the front.
    head = cv.ellipse(C + 1, C, 25, 25)
    cv.paint(head, (98, 106, 124), (20, 22, 30))
    cv.paint(both(head, cv.rrect(46, C - 4, 90, C + 4, 3)), (150, 160, 180), (60, 66, 82), edge=0.4)  # ridge
    for sign in (-1, 1):
        cv.paint(both(head, cv.rrect(58, C + sign * 19 - 3, 80, C + sign * 19 + 3, 2)), (70, 76, 92), (24, 26, 34), edge=0.5)  # rail
        cv.paint(cv.ellipse(64, C + sign * 24, 5, 4.5), (60, 66, 80), (18, 20, 26), edge=0.55)  # ear pod
        cv.paint(cv.ellipse(64, C + sign * 24, 1.8, 1.8), *TEAL, edge=0)
    visor = both(head, cv.capsule((81, C - 19), (81, C + 19), 14))
    cv.paint(visor, (30, 34, 42), (8, 9, 12), edge=0.5)
    cv.paint(both(head, cv.capsule((82, C - 17), (82, C + 17), 8)), *TEAL, edge=0.5)
    cv.paint(both(head, cv.capsule((83, C - 14), (83, C + 14), 3)), (230, 255, 255), (130, 230, 235), edge=0)
    cv.gloss(55, 52, 11, 7, 0.45, within=head)

    cv.shadow(cv.img.getchannel("A"), 0, 0, 0.32, 3.2)
    cv.outline()
    cv.save(f"{OUT}/operative.png")


def guard():
    cv = Canvas(N, N)

    torso = cv.rrect(29, 12, 99, 116, 30)
    cv.paint(torso, (136, 142, 160), (44, 46, 56))
    cv.paint(cv.rrect(36, 20, 92, 108, 22), (100, 106, 122), (40, 42, 52), edge=0.5)  # jacket panel
    cv.paint(cv.rrect(36, C - 2, 92, C + 2, 1), (60, 62, 74), (28, 30, 38), edge=0)  # back seam

    # Cross strap over the jacket, with a brass slide.
    strap = both(torso, cv.poly([(36, 18), (50, 14), (96, 108), (82, 112)]))
    cv.paint(strap, (150, 104, 62), (64, 40, 22), edge=0.5)
    cv.paint(cv.rrect(78, 84, 90, 94, 2), (246, 210, 110), (150, 108, 30), edge=0.5)

    # Radio on the leading shoulder, with an antenna and a red light.
    cv.paint(cv.capsule((52, 30), (52, 4), 3), (50, 52, 60), (14, 15, 18), edge=0.5)
    radio = cv.rrect(44, 26, 62, 50, 4)
    cv.paint(radio, (78, 82, 94), (18, 19, 24))
    cv.paint(cv.rrect(48, 32, 58, 38, 1.5), (40, 44, 54), (10, 11, 14), edge=0)  # speaker grille
    cv.paint(cv.ellipse(53, 44, 2.2, 2.2), (255, 120, 120), (190, 24, 30), edge=0.4)

    # Brass shoulder boards with rank bars, where the arms join.
    for sign in (-1, 1):
        y0 = C + sign * 48
        board = cv.rrect(52, y0 - 9, 84, y0 + 9, 6)
        cv.paint(board, (248, 214, 118), (146, 104, 28))
        for dx in (60, 68, 76):
            cv.paint(cv.rrect(dx - 1.5, y0 - 7, dx + 1.5, y0 + 7, 1), (150, 106, 30), (110, 74, 16), edge=0, bounds=None)

    # Collar, the back of the head, ears.
    cv.paint(cv.ellipse(C - 2, C, 28, 26), (88, 92, 108), (32, 34, 42), edge=0.6)
    cv.paint(cv.ellipse(C - 7, C, 23, 23), (128, 90, 60), (48, 30, 20))  # hair
    for sign in (-1, 1):
        cv.paint(cv.ellipse(C + 3, C + sign * 24, 4.5, 6), (240, 188, 154), (176, 120, 88), edge=0.5)  # ears

    # Peaked cap: the glossy peak first, so the crown overlaps it.
    peak = both(cv.ellipse(90, C, 15, 21), cv.rrect(76, 0, 128, N, 1))
    cv.paint(peak, (92, 94, 108), (8, 8, 12))
    cv.gloss(98, C - 8, 7, 4, 0.5, within=peak)
    brim = cv.ellipse(C + 4, C, 21, 22)
    cv.paint(brim, (92, 22, 34), (46, 8, 16), edge=0.5)  # hatband
    cv.paint(cv.ellipse(C + 4, C, 19, 20), (200, 62, 78), (96, 18, 32), edge=0.5)  # crown edge
    crown = cv.ellipse(C + 4, C, 16.5, 17.5)
    cv.paint(crown, (216, 82, 98), (116, 24, 40), edge=0.55)
    for deg in (45, 135, 225, 315):
        radial(cv, C + 4, C, 3, 18, deg, 1.4, (150, 30, 48), (84, 12, 26), within=crown)
    cv.paint(cv.ellipse(C + 4, C, 4, 4), (255, 226, 144), (176, 128, 36), edge=0.5)  # button
    cv.gloss(58, 54, 9, 6, 0.4, within=crown)

    cv.shadow(cv.img.getchannel("A"), 0, 0, 0.32, 3.2)
    cv.outline()
    cv.save(f"{OUT}/guard.png")


operative()
guard()
arm_pieces()
