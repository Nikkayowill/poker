"""The Homestead terrace's stair: eight wooden steps between two railed edges, drawn pixel by pixel.

It stands in the wall as a block six tiles wide at 32px a tile (192px):

    0-15     rock of the wall, left cheek
    16-31    left rail, with its posts
    32-159   the four tiles the farmer walks: a landing and eight steps
    160-175  right rail
    176-191  rock of the wall, right cheek

The wood is the dock's own (the planks in the Homestead ground): light, mid and dark. The view is the
game's: from the south, a little above. Each step is its tread, lit along the nosing, and under it the
riser, dark under the nosing and lit along its foot. Light comes from the top left, so the rails are lit on
their west side and the left rail throws a short shadow onto the treads. The posts stand a little taller than
the rail and the bottom ones a little below the foot.

Pure: a picture out.
"""
from PIL import Image

W = 192
LANDING_TOP = 22                     # the picture row the wall's top course sits on
FOOT = 150                           # first row below the last riser
STEPS = 8
PITCH = 15                           # a step: 9 rows of tread and 6 of riser
OPEN_X0, OPEN_X1 = 32, 160           # the walked opening, [x0, x1)
RAIL_L, RAIL_R = (16, 32), (160, 176)

HI = (238, 196, 132, 255)            # lit edge
LIGHT = (196, 140, 76, 255)          # the dock's light plank
MID = (162, 107, 54, 255)            # the dock's mid plank
SHADE = (128, 82, 42, 255)
DARK = (90, 55, 28, 255)             # the dock's seam colour
DEEP = (56, 34, 20, 255)             # outline

# What each tone becomes in the rail's shadow.
IN_SHADOW = {HI: LIGHT, LIGHT: MID, MID: SHADE, SHADE: DARK}


def _rect(px, x0, y0, x1, y1, colour):
    """Fill x0..x1, y0..y1 inclusive."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px[x, y] = colour


def _steps(px):
    # The landing the farmer steps off the lawn onto: its back edge in the wall's shadow, then plank, then nosing.
    _rect(px, OPEN_X0, LANDING_TOP, OPEN_X1 - 1, LANDING_TOP, SHADE)
    _rect(px, OPEN_X0, LANDING_TOP + 1, OPEN_X1 - 1, LANDING_TOP + 6, LIGHT)
    _rect(px, OPEN_X0, LANDING_TOP + 7, OPEN_X1 - 1, LANDING_TOP + 7, HI)
    for k in range(STEPS):
        y = LANDING_TOP + 8 + PITCH * k
        # The tread: a seam of shadow where it meets the riser above, plank, a lit nosing.
        _rect(px, OPEN_X0, y, OPEN_X1 - 1, y, MID)
        _rect(px, OPEN_X0, y + 1, OPEN_X1 - 1, y + 7, LIGHT)
        _rect(px, OPEN_X0, y + 8, OPEN_X1 - 1, y + 8, HI)
        # The riser: outlined under the nosing, in shade, a dark foot line.
        _rect(px, OPEN_X0, y + 9, OPEN_X1 - 1, y + 9, DEEP)
        _rect(px, OPEN_X0, y + 10, OPEN_X1 - 1, y + 13, SHADE)
        _rect(px, OPEN_X0, y + 14, OPEN_X1 - 1, y + 14, DARK)
        # Plank ends on the tread, staggered step to step the way boards are laid.
        for seam in (OPEN_X0 + 21 + 17 * (k % 3), OPEN_X0 + 64 + 13 * (k % 4), OPEN_X0 + 107 + 9 * (k % 2)):
            if OPEN_X0 + 2 < seam < OPEN_X1 - 2:
                _rect(px, seam, y + 1, seam, y + 7, MID)
        # Boards on the riser, joined in different places.
        for seam in (OPEN_X0 + 37 + 11 * (k % 3), OPEN_X0 + 85 + 7 * (k % 4)):
            _rect(px, seam, y + 10, seam, y + 13, DARK)
        # A few grain flecks, set by hand: the same dark the dock's planks carry.
        for fx, fy in ((9 + 23 * k % 100, 3), (47 + 31 * k % 90, 5), (86 + 19 * k % 34, 2)):
            if OPEN_X0 + 4 < OPEN_X0 + fx < OPEN_X1 - 4:
                px[OPEN_X0 + fx, y + fy] = MID
    # The rail's shadow on the treads: four columns, one tone down.
    for x0, x1 in ((OPEN_X0, OPEN_X0 + 4), (OPEN_X1 - 2, OPEN_X1)):
        for y in range(LANDING_TOP, FOOT):
            for x in range(x0, min(x1, OPEN_X1)):
                c = px[x, y]
                if c in IN_SHADOW:
                    px[x, y] = IN_SHADOW[c]


def _rail(px, x0, x1):
    """A rail: a beam from the top post to the bottom one, lit on its west side, with a post at each end and
    one between."""
    top, bottom = LANDING_TOP - 10, FOOT + 3
    # Beam.
    _rect(px, x0, top, x1 - 1, bottom, LIGHT)
    _rect(px, x0, top, x0, bottom, DEEP)
    _rect(px, x1 - 1, top, x1 - 1, bottom, DEEP)
    _rect(px, x0 + 1, top, x0 + 3, bottom, HI)
    _rect(px, x1 - 4, top, x1 - 2, bottom, MID)
    # Boards of the beam: short seams across it.
    for y in range(top + 17, bottom - 6, 29):
        _rect(px, x0 + 1, y, x1 - 2, y, MID)
    # Posts: broader than the beam by two pixels each side, a lit cap, a shaded foot.
    for y0, y1 in ((top - 6, top + 14), (LANDING_TOP + 58, LANDING_TOP + 78), (bottom - 14, bottom + 6)):
        px_x0, px_x1 = x0 - 1, x1
        _rect(px, px_x0, y0, px_x1, y1, MID)
        _rect(px, px_x0, y0, px_x0, y1, DEEP)
        _rect(px, px_x1, y0, px_x1, y1, DEEP)
        _rect(px, px_x0, y0, px_x1, y0, DEEP)
        _rect(px, px_x0, y1, px_x1, y1, DEEP)
        _rect(px, px_x0 + 1, y0 + 1, px_x1 - 1, y0 + 4, HI)          # cap, lit
        _rect(px, px_x0 + 1, y0 + 5, px_x0 + 4, y1 - 1, LIGHT)       # west face, lit
        _rect(px, px_x1 - 4, y0 + 5, px_x1 - 1, y1 - 1, SHADE)       # east face, in shade


def stair():
    """The stair block, 192px wide, transparent outside the wood. Rows run from the picture's top, so the
    wall's top course sits at LANDING_TOP."""
    img = Image.new("RGBA", (W, FOOT + 12))
    px = img.load()
    _steps(px)
    _rail(px, *RAIL_L)
    _rail(px, *RAIL_R)
    return img
