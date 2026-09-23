"""The pieces a player's fence is drawn from: common/fence.png.

The map's fences used to be drawn straight into the Homestead's art. Now the
player builds them a square at a time (lib/stackacres/fences.ts), so the
engine needs one picture per way a piece can join its neighbours rather than
whole runs of fence.

Cut from the farm's own fence (`kit.fence`, the one the map used to draw), so
a built fence looks like the fences that were there. The LPC pack has no farm
fence of its own, only rope railings and dock posts.

Eight frames, a map square wide and two tall, side by side. The frame number
is lib/stackacres/fences.ts's `fenceFrame`: 1 joins north, 2 east, 4 west. A
piece draws its post, a rail out to each side it joins, and a rail up to the
post above; the piece below draws the rail between them, so no join is drawn
twice.
"""

import numpy as np
from PIL import Image

W, H = 16, 32          # one frame: the square, and the one above it for the post's top
FOOT = 16 + 12         # frame row the post stands on: 12 down its own square
NORTH, EAST, WEST = 1, 2, 4


def fence_sheet(kit):
    run = np.array(kit.fence(48)[0].convert("RGBA"))                    # posts every 16 px, rails between
    column = np.array(kit.fence(48, vertical=True)[0].convert("RGBA"))
    post = run[:, 0:5]                                                   # the first post, its outline included
    rail = run[:, 10:11]                                                 # one column of the two rails
    link = column[10:11, :]                                              # one row of the rail between two posts
    top = FOOT - 10                                                      # the run's own base row is 10
    sheet = np.zeros((H, W * 8, 4), np.uint8)
    for frame in range(8):
        tile = np.zeros((H, W, 4), np.uint8)

        def over(piece, x, y):
            h, w = piece.shape[:2]
            region = tile[y:y + h, x:x + w]
            mask = piece[..., 3:4] > 0
            region[:] = np.where(mask, piece, region)

        if frame & NORTH:
            for y in range(top - 4, top + 2):                           # up to the post above, tucked behind this one
                over(link, 5, y)
        if frame & WEST:
            for x in range(0, 7):
                over(rail, x, top)
        if frame & EAST:
            for x in range(11, 16):
                over(rail, x, top)
        over(post, 6, top)
        sheet[:, frame * W:(frame + 1) * W] = tile
    return Image.fromarray(sheet, "RGBA")
