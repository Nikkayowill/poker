"""The film of light the engine lays over the lake (components/arcade/stackacres-td/water-film.ts).

This is Stardew Valley's water overlay, measured (2026-09-23) and redrawn at this game's scale. Stardew
draws a full square of moving light over every water tile: no transparent pixels, blobby patches a few
pixels wide in five blues from mid-blue up to near-white, ten frames at 200 ms, tinted by the season and
laid on at about 42% opacity while it drifts slowly up. That film is what makes its water look glossy:
the flat water shows through it, and so does anything darker underneath, which is how the deep water
reads as deep.

The pattern is noise that tiles in both directions AND loops in time, cut into five colours by share, so
each frame is a sheet of patches and the ten frames flow into each other and back to the first. The
patch size is set for a 32 px map square (the ground picture's own resolution): a few pixels across,
like Stardew's 1-3 px patches on its 16 px squares.

The colours are Stardew's overlay colours already multiplied by its spring tint, so the engine only has
to lay the film on at one opacity. The timing (frame length, drift, opacity) is the engine's, in
lib/stackacres-td/water.ts; the sheet's layout below has to match it, which water.test.ts checks.
"""
import numpy as np
from PIL import Image

SIZE = 128         # px square, tiling: four map squares of the ground picture, so the repeat is hard to spot
FRAMES = 10
COLUMNS = 5        # frames laid out 5 x 2 in the sheet

# Shade, share of the film. Darkest first; each takes the next slice of the noise's range.
SHADES = [
    ((32, 118, 205), 0.44),     # mid-blue: the film's own ground
    ((40, 147, 255), 0.27),     # cyan
    ((59, 150, 253), 0.11),     # periwinkle, round the edge of the pale patches
    ((60, 184, 253), 0.14),     # pale aqua
    ((102, 191, 248), 0.04),    # near-white: the brightest glints of the patch
]
CELL = 6.4         # noise lattice spacing in px: sets how big a patch is (SIZE / CELL must be whole)
LOOP = 5           # noise lattice steps in one pass of the ten frames


def _hash3(i, j, k, salt):
    h = (i * 374761393 + j * 668265263 + k * 2147483647 + salt * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF


def _periodic_noise(xs, ys, t, cell, period_xy, period_t, salt):
    """Smooth value noise on a lattice that wraps every `period_xy` cells in x and y and `period_t` in t."""
    u, v = xs / cell, ys / cell
    i0, j0, k0 = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64), int(np.floor(t))
    fu, fv, fw = u - i0, v - j0, t - np.floor(t)
    fu, fv, fw = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv), fw * fw * (3 - 2 * fw)
    h = np.vectorize(_hash3)
    out = 0.0
    for dk, wk in ((0, 1 - fw), (1, fw)):
        k = (k0 + dk) % period_t
        a = h(i0 % period_xy, j0 % period_xy, k, salt)
        b = h((i0 + 1) % period_xy, j0 % period_xy, k, salt)
        c = h(i0 % period_xy, (j0 + 1) % period_xy, k, salt)
        d = h((i0 + 1) % period_xy, (j0 + 1) % period_xy, k, salt)
        out = out + ((a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv) * wk
    return out


def _field(f):
    """The noise for frame `f`: two octaves, both wrapping at SIZE px and at the end of the loop."""
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    t = f * LOOP / FRAMES
    cells = round(SIZE / CELL)
    n = _periodic_noise(xs, ys, t, CELL, cells, LOOP, 1) * 0.72
    n = n + _periodic_noise(xs, ys, t * 2, CELL / 2, cells * 2, LOOP * 2, 2) * 0.28
    return n


def frames():
    """The ten frames, each SIZE x SIZE RGB."""
    fields = [_field(f) for f in range(FRAMES)]
    everything = np.concatenate([f.ravel() for f in fields])
    cuts = np.quantile(everything, np.cumsum([share for _, share in SHADES])[:-1])
    palette = np.array([rgb for rgb, _ in SHADES], np.uint8)
    return [palette[np.digitize(f, cuts)] for f in fields]


def sheet():
    """The frames laid out COLUMNS across, as the engine reads them."""
    rows = -(-FRAMES // COLUMNS)
    out = np.zeros((rows * SIZE, COLUMNS * SIZE, 4), np.uint8)
    out[..., 3] = 255
    for i, rgb in enumerate(frames()):
        r, c = divmod(i, COLUMNS)
        out[r * SIZE:(r + 1) * SIZE, c * SIZE:(c + 1) * SIZE, :3] = rgb
    return Image.fromarray(out, "RGBA")
