"""Inside the barn and the workshop, walked into through their doors on the Homestead.

Each room is one ground-level picture (floorboards, the back wall with its windows and lanterns, the side walls seen
from above, the front wall and its doorway) plus the furniture standing in it. The thing that opens a menu (Ray's
counter, the workbench) stands on a rug, so a young player can see where to go. Same top-left light as outside,
with daylight falling through the back windows; the engine lights the lanterns (their points ride on the room
picture's `lights`)."""
import math

import sprites as S
from area import Area
from pal import Canvas, hash2, noise1

T = 16
class Room:
    """A room's footprint: its size in tiles and where its doorway sits in the front wall (px)."""

    def __init__(self, w, h, door):
        self.w, self.h = w, h
        self.door0, self.door1 = door
        self.front = h * T - 10                                   # the front wall's top edge (px)
        self.arrive = ((door[0] + door[1]) // 2, self.front - 16)  # just inside the door, where a player walking in lands


WALL_TOP, WALL_FACE = 6, 50        # the ceiling beam's foot and the back wall's foot (px)
BARN = Room(24, 11, (176, 208))    # long but no taller than the screen, with the doorway in the middle of the front wall
WORKSHOP = Room(15, 10, (32, 64))  # small and square, with the doorway in the corner


class _Shifted:
    """A canvas drawn on with every x moved over: a decoration drawn at fixed pixels, hung somewhere else on the wall."""

    def __init__(self, c, dx):
        self.c, self.dx = c, dx

    def put(self, x, y, ramp, level):
        self.c.put(x + self.dx, y, ramp, level)


def _planks(c, x0, y0, x1, y1, seed, base):
    """Floorboards running across the room, 6px deep, seams staggered row to row."""
    for y in range(y0, y1):
        row, ry = (y - y0) // 6, (y - y0) % 6
        length = 30 + int(hash2(row, 0, seed) * 22)
        off = int(hash2(row, 1, seed) * length)
        for x in range(x0, x1):
            board = (x + off) // length
            bx = (x + off) % length
            b = base + (hash2(board, row, seed + 2) - 0.5) * 0.55 + (noise1(x, y * 3, 13, seed + 3) - 0.5) * 0.35
            if ry == 5:
                level = b - 1.5                                # the gap between boards
            elif ry == 0:
                level = b + 0.35
            elif bx == 0:
                level = b - 1.1                                # butt joint
            else:
                level = b
            if bx in (3, length - 4) and ry == 2 and hash2(board, row, seed + 4) < 0.3:
                level = b - 0.9                                # a nail head here and there
            c.put(x, y, "wood", level)


def _rug(c, x0, y0, x1, y1, field, border):
    """A woven rug: a patterned border and a field with a centre diamond, frayed at the short ends."""
    cx, cy = (x0 + x1 - 1) / 2, (y0 + y1 - 1) / 2
    for y in range(y0, y1):
        for x in range(x0, x1):
            edge = min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y)
            if edge < 3:
                level = 4.2 if (x + y) % 4 < 2 else 3.2
                if edge == 0:
                    level = 2.2
                c.put(x, y, border, level)
                continue
            d = abs(x - cx) / ((x1 - x0) / 2 - 4) + abs(y - cy) / ((y1 - y0) / 2 - 4)
            level = 3.4 + (0.6 if (x // 2 + y // 2) % 2 else 0)
            if 0.45 < d < 0.62:
                c.put(x, y, border, 4.6)
                continue
            if d <= 0.2:
                c.put(x, y, "linen", 5.0)
                continue
            c.put(x, y, field, level - (y - y0) * 0.02)
    for x in range(x0, x1, 2):                                  # fringe
        c.put(x, y0 - 1, "linen", 4.4)
        c.put(x, y1, "linen", 3.6)


def doormat(w):
    """The straw mat laid outside a door, woven like the one just inside it."""
    c = Canvas(w, 10)
    for y in range(10):
        for x in range(w):
            weave = (x + y) % 3
            rim = y in (0, 9) or x in (0, w - 1)
            c.put(x, y, "straw", (2.4 if rim else 3.8) + (0.7 if weave == 0 else -0.5 if weave == 2 else 0))
    return c.image()


def _lantern(c, lx, ly):
    """A lantern hanging on the back wall at (lx, ly): hook, iron cap, warm glass. Returns its light point."""
    c.put(lx, ly - 3, "stone", 3.4)
    c.put(lx, ly - 2, "stone", 2.4)
    for x in range(lx - 3, lx + 3):
        c.put(x, ly - 1, "coal", 2.6 if x < lx else 1.8)
    for y in range(ly, ly + 7):
        for x in range(lx - 3, lx + 3):
            edge = x in (lx - 3, lx + 2)
            c.put(x, y, "coal" if edge else "lamp", 1.6 if edge else 5.0 - abs(x - lx + 0.5) * 0.7 - (y - ly) * 0.2)
    for x in range(lx - 3, lx + 3):
        c.put(x, ly + 7, "coal", 2.2)
    for y in range(ly - 3, ly + 12):                              # its warm light on the boards around it
        for x in range(lx - 9, lx + 9):
            p = c.get(x, y)
            d = math.hypot(x - lx, (y - ly - 3) * 1.1)
            if p and p[0] not in ("coal", "lamp", "stone") and 4 < d < 9:
                c.put(x, y, p[0], p[1] + (9 - d) * 0.14)
    return (lx, ly + 3, "lantern")


def shell(room, face, windows, lanterns, rug, seed, floor=4.0):
    """The room's picture. `face(c)` paints the back wall; `windows` are the x of 14px windows in it; `lanterns` the x
    of lanterns hung on it; `rug` is (x0, y0, x1, y1, field ramp, border ramp)."""
    w, h = room.w * T, room.h * T
    c = Canvas(w, h)
    _planks(c, T, WALL_FACE, w - T, room.front, seed, floor)
    face(c)
    for wx in windows:
        for y in range(15, 36):
            for x in range(wx - 1, wx + 15):
                c.put(x, y, "wood", 4.8 if (x == wx - 1 or y == 15) else 1.8)
        for y in range(16, 34):
            for x in range(wx, wx + 14):
                if y > 27:
                    c.put(x, y, "leaf", 3.4 + (hash2(x, y, seed) - 0.5) * 1.2)   # the yard's greenery beyond
                    continue
                c.put(x, y, "glass", 5.2 - (y - 16) * 0.12 if x not in (wx, wx + 13) else 1.2)
        for y in range(16, 34):
            c.put(wx + 6, y, "wood", 3.8)
            c.put(wx + 7, y, "wood", 2.4)
        for x in range(wx, wx + 14):
            c.put(x, 24, "wood", 3.8)
            c.put(x, 25, "wood", 2.4)
        for x in range(wx - 2, wx + 16):
            c.put(x, 34, "wood", 5.4)
            c.put(x, 35, "wood", 2.6)
        for y in range(WALL_FACE, WALL_FACE + 46):                 # daylight falling across the floor
            fade = 1 - (y - WALL_FACE) / 46
            spread = (y - WALL_FACE) * 0.5
            for x in range(round(wx - 1 + spread), round(wx + 15 + spread)):
                p = c.get(x, y)
                if p and p[0] == "wood" and (fade > 0.35 or (x + y) % 2 == 0):
                    c.put(x, y, "wood", p[1] + 0.8 * fade + 0.25)
    if rug:
        _rug(c, *rug)
    for x in range(T, w - T):                                    # the back wall's shade on the floor at its foot
        for k in range(6):
            p = c.get(x, WALL_FACE + k)
            if p:
                c.put(x, WALL_FACE + k, p[0], p[1] - (6 - k) * 0.4)
    lights = [_lantern(c, lx, 13) for lx in lanterns]
    for y in range(0, WALL_TOP):                                 # the ceiling beam
        for x in range(0, w):
            c.put(x, y, "wood", 1.0 + (1.8 if y == WALL_TOP - 1 else 0) + (hash2(x // 9, y, seed) - 0.5) * 0.4)
    for side in (0, w - T):                                      # side walls, seen from above
        for y in range(0, h):
            for x in range(side, side + T):
                inner = x == side + T - 1 if side == 0 else x == side
                level = 1.8 + (noise1(x, y // 3, 5, seed + 9) - 0.5) * 0.5
                if inner:
                    level = 4.4 if side == 0 else 3.0
                c.put(x, y, "wood", level)
        for y in range(8, h, 16):
            for x in range(side + 2, side + T - 2):
                c.put(x, y, "wood", 1.0)
    for y in range(room.front, h):                                    # the front wall's top, broken by the doorway
        for x in range(0, w):
            if room.door0 <= x < room.door1:
                continue
            level = 4.6 if y == room.front else 1.8 + (hash2(x // 6, y, seed) - 0.5) * 0.4
            c.put(x, y, "wood", level)
    for y in range(room.front, h):                                    # door posts and the threshold
        for x in range(room.door0 - 3, room.door0):
            c.put(x, y, "wood", (5.0, 3.8, 2.4)[x - room.door0 + 3])
        for x in range(room.door1, room.door1 + 3):
            c.put(x, y, "wood", (1.4, 2.8, 2.0)[x - room.door1])
        for x in range(room.door0, room.door1):
            c.put(x, y, "wood", 2.8 - (y - room.front) * 0.08)
    for y in range(room.front - 16, room.front + 2):                       # the doormat
        for x in range(room.door0 + 3, room.door1 - 3):
            weave = (x + y) % 3
            rim = y in (room.front - 16, room.front + 1) or x in (room.door0 + 3, room.door1 - 4)
            c.put(x, y, "straw", (2.4 if rim else 3.8) + (0.7 if weave == 0 else -0.5 if weave == 2 else 0))
    img = c.image()
    img.info["lights"] = lights
    return img, (0, 0)


def _enclose(a, room):
    """The room's walls: the back wall's three rows, both sides, and the front wall either side of the doorway."""
    a.wall(0, 0, room.w - 1, 2)
    a.wall(0, 0, 0, room.h - 1)
    a.wall(room.w - 1, 0, room.w - 1, room.h - 1)
    a.wall(0, room.h - 1, room.door0 // T - 1, room.h - 1)
    a.wall(room.door1 // T, room.h - 1, room.w - 1, room.h - 1)


# ------------------------------------------------------------------ the barn

def _barn_face(c, room, sign_x):
    for y in range(WALL_TOP, WALL_FACE):
        for x in range(T, room.w * T - T):
            board = (x - T) // 7
            bx = (x - T) % 7
            level = 2.6 + (hash2(board, 0, 41) - 0.5) * 0.6 + (noise1(x * 3, y, 9, 42 + board) - 0.5) * 0.7
            level = 0.9 if bx == 0 else level + 0.7 if bx == 1 else level
            c.put(x, y, "barnred", level)
    for x in range(T, room.w * T - T):                                # a beam along the wall and the skirting
        for y, lv in ((38, 4.6), (39, 3.4), (40, 1.6), (46, 3.8), (47, 3.0), (48, 2.4), (49, 1.4)):
            c.put(x, y, "wood", lv - (x / (room.w * T)) * 0.6)
    sign = _Shifted(c, sign_x - 144)
    bx0, bx1 = 118, 170                                           # the shop sign: a carrot and a coin
    for y in range(9, 30):
        for x in range(bx0, bx1):
            edge = x in (bx0, bx1 - 1) or y in (9, 29)
            sign.put(x, y, "tan", 2.0 if edge else 4.8 - (y - 9) * 0.05 - (x - bx0) * 0.012)
    for k in range(11):                                            # carrot
        for j in range(max(1, 4 - k // 3)):
            sign.put(128 + k, 17 + j + k // 4, "orange", 4.8 - j * 0.9)
    for x, y in ((126, 15), (127, 14), (128, 15), (125, 14), (128, 13), (126, 16)):
        sign.put(x, y, "leaf", 4.2)
    for y in range(12, 27):                                        # coin
        for x in range(146, 162):
            d = math.hypot(x - 153.5, y - 19)
            if d <= 6.6:
                sign.put(x, y, "gold", 4.6 - (x - 153.5 + y - 19) * 0.18 if d < 5.2 else 2.4)
    for y in range(16, 23):
        sign.put(153, y, "gold", 2.2)
    for y in range(12, 37):                                        # a pitchfork and a rake on pegs
        c.put(24, y, "wood", 4.4)
        c.put(25, y, "wood", 2.6)
    for x, y in ((21, 12), (24, 11), (27, 12), (21, 13), (27, 13), (21, 14), (27, 14), (22, 15), (26, 15), (23, 15), (25, 15)):
        c.put(x, y, "stone", 5.0)
    for y in range(14, 37):
        c.put(room.w * T - 26, y, "wood", 4.4)
        c.put(room.w * T - 25, y, "wood", 2.6)
    for x in range(room.w * T - 32, room.w * T - 18):
        c.put(x, 14, "stone", 4.4)
        if x % 2 == 0:
            c.put(x, 15, "stone", 3.0)
            c.put(x, 16, "stone", 2.0)


def _straw_scatter(c, room, seed):
    """Loose straw on the barn floor, thickest by the bales."""
    for k in range(260):
        x = T + int(hash2(k, 0, seed) * (room.w * T - 2 * T))
        y = WALL_FACE + 4 + int(hash2(k, 1, seed) * (room.front - WALL_FACE - 22))
        near_bales = x > room.w * T - 88
        if not near_bales and hash2(k, 2, seed) < 0.55:
            continue
        dx = 1 if hash2(k, 3, seed) < 0.5 else -1
        for t in range(3 + int(hash2(k, 4, seed) * 3)):
            c.put(x + t, y + (t * dx) // 3, "straw", 4.6 - t * 0.3)


def counter():
    """Ray's shop counter: a worn top with a brass bell, the open ledger and a jar of coins, and a planked front."""
    w, h = 78, 31
    c = Canvas(w, h)
    for y in range(9, 15):                                        # the top
        for x in range(1, w - 1):
            level = 5.0 - (y - 9) * 0.25 - x / w * 0.9 + (noise1(x * 2, y, 8, 51) - 0.5) * 0.5
            if y == 9:
                level += 0.7
            if 26 < x < 52 and y in (11, 12):
                level += 0.5                                     # rubbed pale where coins slide across
            c.put(x, y, "wood", level)
    for x in range(1, w - 1):
        c.put(x, 15, "wood", 1.4)
    for y in range(16, 29):                                       # the planked front, with a darker kick rail
        for x in range(2, w - 2):
            bx = (x - 2) % 6
            level = 3.0 + (hash2((x - 2) // 6, 0, 52) - 0.5) * 0.6 - (y - 16) * 0.04
            if y >= 25:
                level -= 0.9
            c.put(x, y, "wood", 1.1 if bx == 0 else level + 0.7 if bx == 1 else level)
    for x in range(2, w - 2):
        c.put(x, 24, "wood", 4.2)
        c.put(x, 28, "wood", 0.9)
    for y in range(3, 12):                                        # the ledger, open
        for x in range(8, 25):
            level = 6.0 - (x - 8) * 0.05 - (0.9 if x in (16, 17) else 0)
            if y % 2 == 0 and x not in (16, 17) and 9 < x < 24 and 3 < y < 11:
                level = 3.2                                      # lines of Ray's handwriting
            c.put(x, y, "linen", level)
    for x in range(8, 25):
        c.put(x, 12, "leather", 2.4)
    for y in range(0, 11):                                        # a glass jar of gold coins
        for x in range(54, 64):
            if y == 0 and x in (54, 63):
                continue
            if 55 <= x <= 62 and y >= 4:
                c.put(x, y, "gold", 4.6 - (x - 55) * 0.25 + (hash2(x, y, 53) - 0.5))
            else:
                c.put(x, y, "glass", 4.4 if x < 57 else 2.6)
    c.put(56, 6, "linen", 6.0)
    for y in range(4, 12):                                        # the brass bell
        for x in range(35, 45):
            if abs(x - 39.5) <= 1 + (y - 4) * 0.62:
                c.put(x, y, "gold", 4.8 - (x - 35) * 0.35 + (0.8 if y == 5 else 0))
    c.put(39, 3, "gold", 3.0)
    c.put(40, 3, "gold", 2.2)
    for x in range(34, 46):
        c.put(x, 12, "wood", 2.0)
    return c.outline().image(), (w // 2, h - 1)


def sack(ramp="khaki"):
    """A tied burlap sack of seed or feed, a little spilled at its foot."""
    c = Canvas(16, 18)
    for y in range(3, 16):
        for x in range(2, 14):
            wid = 4.2 + 1.8 * math.sin(math.pi * (y - 3) / 13)
            if abs(x - 7.5) > wid:
                continue
            nx = (x - 7.5) / wid
            level = 4.4 - nx * 1.6 - (y - 3) * 0.08 - (0.5 if (x + y * 2) % 3 == 0 else 0)
            c.put(x, y, ramp, level)
    for x in range(5, 11):
        c.put(x, 3, ramp, 5.2)
        c.put(x, 2, ramp, 4.2 if x % 2 else 3.6)
    for x in range(6, 10):
        c.put(x, 4, "leather", 2.6)
    for k in range(4):
        c.put(12 + k % 2, 16 - k // 2, "straw", 5.0 - k * 0.5)
    return c.outline().image(), (8, 16)


def barn(for_game=False):
    """Long and low: Ray's counter at the right end, a feed bay down the left, stock stacked at both ends."""
    room = BARN
    a = Area("barn", room.w, room.h)
    a.indoor = True
    a.rect("cobble", 0, 0, room.w, room.h)                       # under the room picture: not grass, so nothing grows
    counter_x = 280

    def face(c):
        _barn_face(c, room, counter_x)
        _straw_scatter(c, room, 61)

    a.add(shell(room, face, (40, 110, 322), (76, 226, 340), (counter_x - 40, 96, counter_x + 40, 124, "red", "gold"), 60), 0, 0, ground=True)
    _enclose(a, room)
    a.add(counter(), counter_x, 90, (30, 3), tag="barn")
    for x, y, ramp in ((28, 66, "khaki"), (44, 70, "tan"), (32, 82, "khaki"), (58, 64, "tan")):   # the seed stock
        a.add(sack(ramp), x, y, (5, 2))
    a.add(S.barrel(), 80, 66, (5, 2))
    a.add(S.crate(), 222, 66, (6, 2))
    for x, y in ((330, 64), (350, 64), (340, 78), (330, 92), (350, 92)):                          # bales stacked at the far end
        a.add(S.hay_bale(), x, y, (9, 2))
    for x, y in ((40, 116), (60, 116), (50, 130)):                                                # the feed bay
        a.add(S.hay_bale(), x, y, (9, 2))
    a.add(S.trough(), 104, 128, (11, 2))
    a.add(S.trough(), 152, 128, (11, 2))
    a.add(S.hay_bale(), 108, 110, (9, 2))
    a.add(S.hay_bale(), 128, 110, (9, 2))
    a.add(S.barrel(), 30, 152, (5, 2))
    a.add(S.crate(), 54, 158, (6, 2))
    a.add(sack("khaki"), 80, 160, (5, 2))
    a.add(S.barrel(), 246, 150, (5, 2))
    a.add(S.crate(), 268, 158, (6, 2))
    a.add(S.trough(), 322, 152, (11, 2))
    a.add(sack("tan"), 352, 142, (5, 2))
    a.door("homestead", room.door0, room.h * T - 8, room.door1 - room.door0, 8, (360, 174))
    a.spawn = room.arrive
    return a

# ------------------------------------------------------------------ the workshop

def _workshop_face(c, room, board_x, stove_x):
    for y in range(WALL_TOP, WALL_FACE):
        for x in range(T, room.w * T - T):
            row, ry = (y - WALL_TOP) // 5, (y - WALL_TOP) % 5
            level = 3.8 + (hash2(row, (x + row * 13) // 34, 61) - 0.5) * 0.8 + (noise1(x, y * 4, 13, 62) - 0.5) * 0.5
            level = 1.6 if ry == 4 else level + 0.6 if ry == 0 else level
            c.put(x, y, "tan", level - x / (room.w * T) * 0.7)
    for x in range(T, room.w * T - T):
        for y, lv in ((46, 3.6), (47, 2.8), (48, 2.2), (49, 1.2)):
            c.put(x, y, "wood", lv)
    board = _Shifted(c, board_x - 144)
    px0, px1, py0, py1 = 108, 180, 10, 38                          # the pegboard and its tools
    for y in range(py0, py1):
        for x in range(px0, px1):
            edge = x in (px0, px1 - 1) or y in (py0, py1 - 1)
            level = 2.2 if edge else 3.6 - (y - py0) * 0.03
            if not edge and (x - px0) % 4 == 2 and (y - py0) % 4 == 2:
                level = 1.8                                      # peg holes
            board.put(x, y, "wood", level)
    for y in range(13, 33):                                        # a hand saw
        for x in range(114, 120 - (y - 13) // 7):
            board.put(x, y, "stone", 5.8 - (x - 114) * 0.4)
    for y in range(13, 17):
        board.put(120, y, "tan", 5.0)
        board.put(121, y, "tan", 3.6)
    for y in range(15, 34):                                        # a hammer
        board.put(132, y, "tan", 5.0)
        board.put(133, y, "tan", 3.4)
    for x in range(127, 139):
        board.put(x, 14, "stone", 5.2)
        board.put(x, 15, "stone", 3.4)
    for t in range(18):                                            # a wrench
        board.put(146 + t * 0.5, 14 + t, "stone", 5.2)
        board.put(147 + t * 0.5, 14 + t, "stone", 3.2)
    for x, y in ((144, 13), (148, 13), (144, 14), (148, 14)):
        board.put(x, y, "stone", 4.4)
    for y in range(14, 34):                                        # a chisel and a square
        board.put(160, y, "tan" if y > 26 else "stone", 5.0 if y > 26 else 5.4)
    for y in range(14, 30):
        board.put(170, y, "stone", 5.0)
    for x in range(170, 177):
        board.put(x, 29, "stone", 5.0)
    for x in range(44, 90):                                        # a shelf of paint tins
        c.put(x, 30, "wood", 5.0)
        c.put(x, 31, "wood", 2.4)
    for i, ramp in enumerate(("blue", "red", "gold", "teal", "orange")):
        x0 = 47 + i * 9
        for y in range(22, 30):
            for x in range(x0, x0 + 6):
                c.put(x, y, ramp if y > 23 else "stone", (4.2 if y > 23 else 4.6) - (x - x0) * 0.35)
    for y in range(0, WALL_FACE + 4):                              # the stovepipe, up through the ceiling
        for k, lv in enumerate((3.2, 2.4, 1.6, 1.0)):
            c.put(stove_x - 2 + k, y, "coal", lv)
        if y % 12 == 5:
            c.put(stove_x - 3, y, "coal", 2.4)
            c.put(stove_x + 2, y, "coal", 1.4)


def _sawdust(c, room, bench_x, seed):
    """Shavings and sawdust around where the work gets done."""
    for k in range(110):
        x = bench_x - 48 + int(hash2(k, 0, seed) * 150)
        y = 100 + int(hash2(k, 1, seed) * (room.front - 104))
        if hash2(k, 2, seed) < 0.75:
            c.put(x, y, "straw", 3.6 + hash2(k, 3, seed) * 1.2)
        else:
            for t in range(3):
                c.put(x + t, y - (1 if t == 1 else 0), "tan", 4.6 - t * 0.4)


def workbench():
    """The bench the recipes are worked at: a thick top with a vise, a plane curling shavings, a gear half made,
    and planks on the shelf underneath."""
    w, h = 78, 34
    c = Canvas(w, h)
    for y in range(8, 16):
        for x in range(1, w - 1):
            level = 4.6 - (y - 8) * 0.18 - x / w * 0.9 + (noise1(x * 3, y, 7, 71) - 0.5) * 0.7
            if (x * 7 + y * 3) % 23 == 0:
                level -= 1.2                                     # knife nicks and dents
            c.put(x, y, "wood", level + (0.7 if y == 8 else 0))
    for x in range(1, w - 1):
        c.put(x, 16, "wood", 2.8)
        c.put(x, 17, "wood", 1.3)
    for lx in (4, w - 8):                                          # legs
        for y in range(18, 33):
            c.put(lx, y, "wood", 4.0)
            c.put(lx + 1, y, "wood", 3.0)
            c.put(lx + 2, y, "wood", 1.6)
    for x in range(4, w - 5):                                      # the lower shelf, planks on it
        c.put(x, 27, "wood", 4.4)
        c.put(x, 28, "wood", 2.2)
    for row, y in enumerate((24, 25, 26)):
        for x in range(10, w - 12):
            c.put(x, y, "tan", 4.6 - row * 0.9 - (1.4 if x % 17 == 0 else 0))
    for y in range(1, 12):                                          # the vise on the left end
        for x in range(2, 13):
            if y < 4:
                c.put(x, y, "coal", 3.2 - (x - 2) * 0.1)
            elif x in (2, 3, 11, 12):
                c.put(x, y, "coal", 2.6 if x < 6 else 1.8)
    for x in range(0, 15):
        c.put(x, 6, "stone", 5.0 if x % 3 else 3.2)
    for y in range(4, 10):                                          # a plane and its curls
        for x in range(24, 38):
            if y == 4 and x in (24, 37):
                continue
            c.put(x, y, "tan" if y > 5 else "stone", 4.8 - (x - 24) * 0.12 if y > 5 else 5.0)
    for k, (x, y) in enumerate(((40, 8), (41, 7), (42, 8), (44, 9), (45, 8), (46, 9), (21, 9), (20, 8))):
        c.put(x, y, "straw", 5.6 - k * 0.2)
    gx, gy = 60, 6                                                  # a wooden gear, half cut
    for a in range(12):
        ang = a * math.pi / 6
        if a < 9:
            for r in (4.4, 5.4):
                c.put(gx + math.cos(ang) * r, gy + math.sin(ang) * r * 0.6, "tan", 5.0 - math.sin(ang) * 1.2)
    for y in range(gy - 2, gy + 3):
        for x in range(gx - 4, gx + 5):
            if ((x - gx) / 4) ** 2 + ((y - gy) / 2.4) ** 2 <= 1:
                c.put(x, y, "tan", 4.6 - (x - gx) * 0.2)
    c.put(gx, gy, "wood", 1.4)
    return c.outline().image(), (w // 2, h - 1)


def stove():
    """A cast-iron stove with the fire showing through its door (its pipe is on the wall behind)."""
    w, h = 24, 26
    c = Canvas(w, h)
    for y in range(0, 4):
        for x in (10, 11, 12, 13):
            c.put(x, y, "coal", 3.2 - (x - 10) * 0.6)
    for y in range(4, 24):
        for x in range(2, 22):
            level = 3.0 - (x - 2) * 0.1 - (0.6 if y > 20 else 0)
            if y in (4, 5):
                level = 4.4 if y == 4 else 2.2
            c.put(x, y, "coal", level)
    for y in range(9, 19):                                          # the door and the fire behind its bars
        for x in range(6, 18):
            if x in (6, 17) or y in (9, 18):
                c.put(x, y, "coal", 1.0)
            elif x % 3 == 0:
                c.put(x, y, "coal", 1.4)
            elif y > 12:
                c.put(x, y, "lamp", 4.8 - (y - 13) * 0.2 + (hash2(x, y, 81) - 0.5))
            else:
                c.put(x, y, "orange", 3.6)
    for x in (4, 19):
        c.put(x, 24, "coal", 2.0)
        c.put(x, 25, "coal", 1.2)
    img = c.outline().image()
    img.info["lights"] = [(12, 14, "lamp")]
    return img, (12, 24)


def spinning_wheel():
    """For the Loom's wool: a wheel on a slanted bench, spun yarn on its spindle."""
    c = Canvas(26, 28)
    cx, cy, r = 11, 11, 9
    for a in range(48):
        ang = a * math.pi / 24
        c.put(cx + math.cos(ang) * r, cy + math.sin(ang) * r, "wood", 4.6 - math.sin(ang + 0.8) * 1.4)
    for a in range(6):
        ang = a * math.pi / 3
        for t in range(1, r):
            c.put(cx + math.cos(ang) * t, cy + math.sin(ang) * t, "wood", 3.2)
    c.put(cx, cy, "stone", 4.2)
    for t in range(22):
        c.put(2 + t, 22 - t // 5, "wood", 4.4)
        c.put(2 + t, 23 - t // 5, "wood", 2.2)
    for lx in (4, 20):
        for y in range(22, 27):
            c.put(lx, y, "wood", 3.4)
    for y in range(8, 14):
        for x in range(20, 24):
            c.put(x, y, "pink", 4.6 - (x - 20) * 0.6)
    return c.outline().image(), (12, 26)


def churn():
    """For the Dairy: a tall butter churn with its dasher."""
    c = Canvas(14, 24)
    for y in range(0, 7):
        c.put(7, y, "wood", 4.6)
    for y in range(6, 22):
        wid = 4 + (y - 6) * 0.12
        for x in range(round(7 - wid), round(7 + wid) + 1):
            if y in (9, 18):
                c.put(x, y, "stone", 3.4)
            else:
                c.put(x, y, "wood", 4.4 - (x - 7 + wid) * 0.35)
    for x in range(3, 12):
        c.put(x, 6, "linen", 5.0)
    return c.outline().image(), (7, 22)


def sawhorse():
    """A sawhorse holding a plank sawn part way, sawdust below."""
    c = Canvas(36, 18)
    for lx in (6, 28):
        for t in range(10):
            c.put(lx - 3 + t * 0.6, 7 + t, "wood", 3.8)
            c.put(lx + 3 - t * 0.6, 7 + t, "wood", 2.6)
    for x in range(1, 35):
        for y, lv in ((4, 4.8), (5, 4.0), (6, 3.0), (7, 1.6)):
            c.put(x, y, "tan", lv - x * 0.02)
    for y in range(4, 8):
        c.put(20, y, "wood", 0.6)
    for k in range(9):
        c.put(17 + k, 16 + (k % 2), "straw", 4.8)
    return c.outline().image(), (18, 16)


def workshop(for_game=False):
    """Small and square: everything within reach of the bench, the stove in the corner, the door low on the left."""
    room = WORKSHOP
    a = Area("workshop", room.w, room.h)
    a.indoor = True
    a.rect("cobble", 0, 0, room.w, room.h)
    bench_x, stove_x = 132, 200

    def face(c):
        _workshop_face(c, room, bench_x, stove_x)
        _sawdust(c, room, bench_x, 71)

    a.add(shell(room, face, (22,), (60, 176), (bench_x - 40, 104, bench_x + 40, 130, "denim", "linen"), 70, floor=3.6), 0, 0, ground=True)
    _enclose(a, room)
    a.add(workbench(), bench_x, 96, (30, 3), tag="workshop")
    a.add(stove(), stove_x, 76, (9, 2))
    a.add(spinning_wheel(), 34, 80, (9, 2))
    a.add(churn(), 56, 76, (5, 2))
    a.add(S.barrel(), 76, 68, (5, 2))
    a.add(sawhorse(), 190, 130, (14, 2))
    a.add(S.crate(), 214, 108, (6, 2))
    a.add(S.crate(), 214, 124, (6, 2))
    a.add(S.woodpile(), 196, 148, (13, 2))
    a.add(sack("tan"), 88, 140, (5, 2))
    a.add(S.barrel(), 106, 144, (5, 2))
    a.add(sack("khaki"), 26, 106, (5, 2))
    a.door("homestead", room.door0, room.h * T - 8, room.door1 - room.door0, 8, (488, 172))
    a.spawn = room.arrive
    return a

