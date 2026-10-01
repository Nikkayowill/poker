#!/usr/bin/env python3
"""Hand retouch of the farmer idle, over the pristine dev render.

The dev+LoRA render is the best-composed source of the day -- correct chibi
proportion, symmetric idle, square to camera -- and it still lost to the crude
schnell sprite at 48px, because it renders soft, desaturated and outline-less
and that is what dies at this size. Generation got the silhouette; this gets
the rest, the same way the cast faces were fixed: named decisions over source
that is never written.

Size is the cast's, not the earlier 41px guess. Every shipped character in
public/stackacres-td/characters/ is 31px tall on y=14..45, 14-16 wide
(Stardew's 16x32-on-a-16-tile, ~1.9 tiles). The outline is drawn OUTWARD around a 29px body, so the total lands on 31 like
Arthur (whose edge runs near-black, mean luminance 40 against 91 inside)
without eating the figure. Drawing it inward was the first attempt and on a
15px-wide body it consumed both arms: at this width the outermost ring IS the
arm.

Six fixes, each one a decision rather than a filter:
  1. Despeckle the keying fringe. Near-white crumbs sit off the body where the
     plate flood met an anti-aliased edge; they survive any recolour as bright
     specks. Removed by neighbour count, before anything reads colour.
  2. Regions by row, colour by luminance into a three-tone ramp, split at the
     material's own terciles. The render already put the form in the right
     places; what it lacked was saturation and separation, so each material
     keeps its own light/mid/dark and nothing blends between materials. Fixed
     fractions of the range were the first attempt and the whole overalls came
     out one flat dark slab -- a few specular pixels stretched the range and
     pushed every ordinary pixel below the cut. Terciles of the actual
     distribution cannot do that. Three tones chosen per pixel is a ramp, not
     a gradient.
  3. Within the shirt and overall rows, column position splits bib from sleeve
     and blue-vs-warm splits hand from denim, because those share a row and a
     row alone cannot tell them apart. Blue-vs-warm alone was the first try and
     it turned the whole shirt into bib -- the render draws the sleeves in a
     shadowed blue-grey, so hue could not see them; where they sit could.
  4. Eyes as a light/dark pair. This face is brown-skinned, so a pupil alone
     lands near the skin value and reads as a smear -- the same failure as
     Ray's and Brayden's. Pupil plus one sclera pixel outward each side.
  5. A hair band under the brim, so the head is not a bare skin oval.
  6. Named pixels last: a seam down the overalls and between the boots, which
     the render drew as one slab and which is what makes legs read as legs; and
     two stray pixels the reduction left in the wrong material.
  7. No mouth. At 31px a drawn mouth is a smudge, and Stardew leaves it off.
"""
import os
import sys

from PIL import Image

from post_farmer import key_plate, strip_pad

SIZE, BODY_H, FEET_Y = 48, 29, 45   # 29 of body + a 1px outline all round = 31

# Saturated enough to survive the size, and a ramp per material so nothing
# blends into its neighbour. Not DB16; the top-down art left that behind.
OUTLINE    = (36, 26, 23, 255)
STRAW_LIT  = (247, 222, 132, 255)
STRAW      = (226, 186, 88, 255)
STRAW_DARK = (172, 129, 52, 255)
SKIN_LIT   = (216, 152, 107, 255)
SKIN       = (186, 122, 82, 255)
SKIN_DARK  = (138, 84, 55, 255)
HAIR       = (59, 40, 28, 255)
PUPIL      = (38, 25, 21, 255)
SCLERA     = (228, 216, 200, 255)
SHIRT_LIT  = (112, 164, 76, 255)
SHIRT      = (78, 122, 58, 255)
SHIRT_DARK = (50, 82, 41, 255)
DENIM_LIT  = (98, 140, 196, 255)
DENIM      = (66, 104, 160, 255)
DENIM_DARK = (42, 70, 116, 255)
BOOT_LIT   = (140, 94, 55, 255)
BOOT       = (102, 66, 38, 255)
BOOT_DARK  = (66, 42, 24, 255)

RAMPS = {
    "straw": (STRAW_LIT, STRAW, STRAW_DARK),
    "skin":  (SKIN_LIT, SKIN, SKIN_DARK),
    "shirt": (SHIRT_LIT, SHIRT, SHIRT_DARK),
    "denim": (DENIM_LIT, DENIM, DENIM_DARK),
    "boot":  (BOOT_LIT, BOOT, BOOT_DARK),
    "brim":  (STRAW, STRAW_DARK, STRAW_DARK),
    "hair":  (HAIR, HAIR, HAIR),
}

# Row bands on the placed 48x48 canvas, read off the base sprite. Hardcoded
# because this retouches one sprite, the way retouch.py names one character's
# pixels rather than inferring them.
BANDS = [
    (16, 19, "straw"),   # hat crown
    (20, 21, "brim"),    # hat brim
    (22, 28, "skin"),    # head; hair and eyes are named below
    (29, 32, "shirt"),   # shirt rows, shared with the bib
    (33, 41, "denim"),   # overalls, shared with the hands
    (42, 44, "boot"),    # boots
]

FACE_X = 23          # the figure's centre column
SLEEVE_X = 3         # columns this far out in a shirt row are sleeve, not bib

# Hair: the whole row under the brim, plus the two columns either side of the
# face on the row below, which is where the render put the sideburns.
HAIR_ROW = 22
HAIR_SIDES = {(17, 23), (18, 23), (28, 23), (29, 23)}

# Eyes on row 23, where the render already darkened x21 and x25. Face centre is
# x23, so the sclera goes outward and the pair stays symmetric.
EYES = [((20, 24), SCLERA), ((21, 24), PUPIL),
        ((25, 24), PUPIL), ((26, 24), SCLERA)]

# The legs and the two boots came out of the reduction as one block. A single
# dark column is what separates them; the body is 6px across here so the seam
# cannot sit dead centre, and 1px off reads as one leg turned slightly, which
# is what a standing figure does anyway.
SEAM_X = 23
LEG_SEAM_ROWS = range(37, 42)
BOOT_SEAM_ROWS = range(42, 44)

# Two pixels the reduction put in the wrong material: a dark smudge between the
# eyes that reads as a scowl, and a skin-toned speck at ankle height where the
# hand above it bled down a row.
STRAYS = [((22, 24), "skin"), ((27, 41), "denim")]


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def despeckle(im, keep=3):
    """Drop pixels with too few opaque neighbours: keying crumbs, not artwork."""
    px = im.load()
    w, h = im.size
    doomed = []
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                continue
            n = sum(1 for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                    if (dx, dy) != (0, 0) and 0 <= x+dx < w and 0 <= y+dy < h
                    and px[x+dx, y+dy][3] > 0)
            if n < keep:
                doomed.append((x, y))
    for p in doomed:
        px[p] = (0, 0, 0, 0)
    return len(doomed)


def band_of(y):
    for lo, hi, name in BANDS:
        if lo <= y <= hi:
            return name
    return "denim"


def material(x, y, c):
    """Which ramp this pixel belongs to, resolving the rows that share two."""
    if y == HAIR_ROW or (x, y) in HAIR_SIDES:
        return "hair"
    b = band_of(y)
    # A shirt row also carries the bib straps, and an overall row also carries
    # the hands. Blue-vs-warm is what separates them; the row cannot.
    if b == "shirt":
        # Sleeves sit outboard of the bib. The render shades them blue-grey, so
        # hue reads them as denim; their column does not.
        return "shirt" if abs(x - FACE_X) >= SLEEVE_X else "denim"
    if b == "denim" and c[0] > c[2]:
        return "skin"
    return b


def tone(c, ramp, cuts):
    """Pick lit/mid/dark by this pixel's rank inside its material."""
    l = lum(c)
    return ramp[2] if l < cuts[0] else (ramp[1] if l < cuts[1] else ramp[0])


def outline_outward(im):
    """Lay a 1px selective outline in the transparent pixels touching the body.

    Eight-connected, so diagonal steps in the silhouette are closed too -- a
    four-connected ring leaves gaps at every corner and the figure looks
    nibbled at 31px.

    Selective, not uniform black: each outline pixel is its own neighbours'
    colour driven most of the way toward the outline tone. A flat near-black
    ring was the first attempt and it read heavier and deader than the shipped
    cast, whose edge carries the garment's hue. Straw keeps a brown edge, denim
    a blue one, and the figure stops looking stamped out of tar.
    """
    px = im.load()
    w, h = im.size
    ring = {}
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                continue
            c = px[x, y]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                        ring.setdefault((nx, ny), []).append(c)
    for p, neigh in ring.items():
        n = len(neigh)
        avg = [sum(c[i] for c in neigh) / n for i in range(3)]
        # 72% of the way to the outline tone: dark enough to read as an edge at
        # 31px, light enough to keep the material's hue.
        px[p] = tuple(round(a * 0.28 + o * 0.72) for a, o in zip(avg, OUTLINE[:3])) + (255,)
    return len(ring)


def build(src_path, out_path):
    im = Image.open(src_path)
    keyed, npad = strip_pad(key_plate(im))
    keyed = keyed.crop(keyed.getbbox())

    # Reduce to the cast's height. Premultiplied, two stages, as the rest of
    # this pipeline: a straight RGBA resize bleeds transparent black into the rim.
    p = keyed.copy()
    px = p.load()
    for y in range(p.height):
        for x in range(p.width):
            r, g, b, a = px[x, y]
            f = a / 255
            px[x, y] = (round(r*f), round(g*f), round(b*f), a)
    tw = max(1, round(p.width * BODY_H / p.height))
    p = p.resize((tw*2, BODY_H*2), Image.BOX).resize((tw, BODY_H), Image.LANCZOS)
    px = p.load()
    for y in range(p.height):
        for x in range(p.width):
            r, g, b, a = px[x, y]
            if a < 110:
                px[x, y] = (0, 0, 0, 0)
            else:
                f = 255 / a
                px[x, y] = (min(255, round(r*f)), min(255, round(g*f)),
                            min(255, round(b*f)), 255)

    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(p, (round((SIZE - p.width) / 2), FEET_Y - BODY_H), p)

    crumbs = despeckle(canvas)

    # Each material's own luminance range, so a washed-out region still spreads
    # across its full ramp instead of collapsing onto one tone.
    cpx = canvas.load()
    lums = {}
    for y in range(SIZE):
        for x in range(SIZE):
            c = cpx[x, y]
            if c[3] == 0:
                continue
            lums.setdefault(material(x, y, c), []).append(lum(c))
    cuts = {}
    for m, vals in lums.items():
        vals.sort()
        n = len(vals)
        cuts[m] = (vals[n // 3], vals[2 * n // 3]) if n >= 3 else (vals[0], vals[-1])

    for y in range(SIZE):
        for x in range(SIZE):
            c = cpx[x, y]
            if c[3] == 0:
                continue
            m = material(x, y, c)
            cpx[x, y] = tone(c, RAMPS[m], cuts[m])

    for (x, y), m in STRAYS:
        if cpx[x, y][3] != 0:
            cpx[x, y] = RAMPS[m][1]
    for yy in LEG_SEAM_ROWS:
        if cpx[SEAM_X, yy][3] != 0:
            cpx[SEAM_X, yy] = DENIM_DARK
    for yy in BOOT_SEAM_ROWS:
        if cpx[SEAM_X, yy][3] != 0:
            cpx[SEAM_X, yy] = OUTLINE

    ring = outline_outward(canvas)
    for (x, y), col in EYES:            # after the outline, so nothing eats them
        if cpx[x, y][3] != 0:
            cpx[x, y] = col

    canvas.save(out_path)
    canvas.resize((SIZE*16, SIZE*16), Image.NEAREST).save(
        out_path.replace(".png", "-16x.png"))
    bb = canvas.getbbox()
    print(f"{out_path}: {bb[2]-bb[0]}x{bb[3]-bb[1]} at y{bb[1]}..{bb[3]-1}, "
          f"pad {npad}, crumbs {crumbs}, outline {ring}")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "out_dev2/td-s47-768x1024-g3.5.png",
          sys.argv[2] if len(sys.argv) > 2 else "farmer-retouched.png")
