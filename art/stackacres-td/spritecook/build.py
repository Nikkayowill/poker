"""Turn SpriteCook PNGs into StackAcres top-down prop sprites.

SpriteCook returns roughly 90-320px art with soft shading and thousands of
colours. The game draws props at 16px-tile scale, so each sprite is trimmed to
its content, box-downscaled with premultiplied alpha (so the cutout edge does
not bleed dark), given a hard alpha edge, and quantised to a small palette.

Several props come back on one generated sheet, which is cheaper than one
generation each. Sheets are split by connected alpha, or by explicit columns
when two objects on the sheet touch.

Run: python3 art/stackacres-td/spritecook/build.py
Reads source/, writes out/. Source PNGs come from the SpriteCook MCP tools;
assets.json records which asset id each one is.
"""
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "source")
OUT = os.path.join(HERE, "out")


# ---------------------------------------------------------------- downscaling

def trim(im):
    box = im.split()[3].getbbox()
    return im.crop(box) if box else im


def fit(size, max_w, max_h):
    w, h = size
    s = min(max_w / w, max_h / h)
    return max(1, round(w * s)), max(1, round(h * s))


def shrink(im, w, h, colors=32, alpha_cut=0.45):
    a = np.array(im).astype(float)
    al = a[:, :, 3:] / 255.0
    pm = np.concatenate([a[:, :, :3] * al, al * 255], axis=2).astype(np.uint8)
    small = np.array(Image.fromarray(pm, "RGBA").resize((w, h), Image.BOX)).astype(float)
    sa = small[:, :, 3:] / 255.0
    rgb = np.clip(np.divide(small[:, :, :3], np.where(sa == 0, 1, sa)), 0, 255)
    hard = (sa[:, :, 0] > alpha_cut) * 255
    out = np.concatenate([rgb, hard[:, :, None]], axis=2).astype(np.uint8)
    flat = Image.fromarray(out, "RGBA").convert("RGB")
    q = np.array(flat.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB"))
    return Image.fromarray(np.concatenate([q, out[:, :, 3:]], axis=2).astype(np.uint8), "RGBA")


def to_size(im, w, h, colors=32):
    src = trim(im)
    return shrink(src, *fit(src.size, w, h), colors=colors)


# -------------------------------------------------------------- sheet slicing

def islands(im, min_px=40):
    a = np.array(im)[:, :, 3] > 0
    h, w = a.shape
    seen = np.zeros_like(a, bool)
    boxes = []
    for y in range(h):
        for x in range(w):
            if not a[y, x] or seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            x0 = x1 = x
            y0 = y1 = y
            n = 0
            while stack:
                cy, cx = stack.pop()
                n += 1
                x0, x1 = min(x0, cx), max(x1, cx)
                y0, y1 = min(y0, cy), max(y1, cy)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and a[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            if n >= min_px:
                boxes.append((x0, y0, x1 + 1, y1 + 1))
    return sorted(boxes, key=lambda b: b[0])


def merge_close(boxes, gap=2):
    """Join islands that nearly touch, so a berry or a rope stays with its prop."""
    out = []
    for b in boxes:
        if out and b[0] - out[-1][2] <= gap:
            p = out[-1]
            out[-1] = (min(p[0], b[0]), min(p[1], b[1]), max(p[2], b[2]), max(p[3], b[3]))
        else:
            out.append(b)
    return out


def cut(path, names, gap=2):
    im = Image.open(path).convert("RGBA")
    boxes = merge_close(islands(im), gap)
    if len(boxes) != len(names):
        raise SystemExit(f"{os.path.basename(path)}: {len(boxes)} islands for {len(names)} names")
    return {n: im.crop(b) for n, b in zip(names, boxes)}


def cut_columns(path, spans):
    """Split a sheet at explicit x ranges, for objects that touch each other."""
    im = Image.open(path).convert("RGBA")
    return {n: trim(im.crop((x0, 0, x1, im.height))) for n, (x0, x1) in spans.items()}


def split_tree(im, canopy_frac=0.4):
    """Split a tree into a canopy and a trunk, so the engine can sway the canopy.

    The trunk is the bottom run of rows narrower than `canopy_frac` of the
    widest row. Both halves keep the full sprite size so they composite at the
    same origin, which is what area.json's sway frames expect.
    """
    a = np.array(im)[:, :, 3] > 0
    widths = a.sum(axis=1)
    cut_y = len(widths)
    for y in range(len(widths) - 1, -1, -1):
        if widths[y] > widths.max() * canopy_frac:
            cut_y = y + 1
            break
    canopy = im.copy()
    canopy.paste((0, 0, 0, 0), (0, cut_y, im.width, im.height))
    trunk = im.copy()
    trunk.paste((0, 0, 0, 0), (0, 0, im.width, cut_y))
    return canopy, trunk


# ------------------------------------------------------------------- the props

# Sheets are applied in order, so a later one replaces a prop an earlier one
# drew. clutter-flat redraws the three that came back as isometric boxes.
SHEETS = {
    "clutter.png": ["crate", "barrel", "haybale", "woodpile", "trough", "sack"],
    "clutter-flat.png": ["crate", "woodpile", "trough"],
    "structures.png": ["well", "coop", "signpost"],
    "nature.png": ["berrybush", "bush", "rock_big", "rock_small", "stump", "flowers"],
    "trees.png": ["pine", "oak", "sapling"],
}
SINGLES = {"farmhouse.png": "farmhouse", "barn.png": "barn", "workshop.png": "workshop"}

# Target size in game art pixels, taken from the prop's current frame in
# public/stackacres-td/areas/homestead/area.json.
SIZES = {
    "farmhouse": (86, 80), "barn": (96, 84), "workshop": (82, 78),
    "well": (22, 30), "signpost": (20, 24), "coop": (36, 34), "mailbox": (14, 20),
    "crate": (16, 16), "barrel": (14, 18), "haybale": (20, 14),
    "woodpile": (30, 16), "trough": (26, 11), "sack": (14, 16),
    "berrybush": (18, 14), "bush": (18, 14), "rock_big": (12, 10),
    "rock_small": (9, 8), "stump": (14, 12), "flowers": (11, 12),
    "oak": (40, 44), "pine": (26, 44), "sapling": (22, 36),
}
TREES = ("oak", "pine", "sapling")


def main():
    os.makedirs(OUT, exist_ok=True)
    props = {}
    for name, keys in SHEETS.items():
        props.update(cut(os.path.join(SOURCE, name), keys))
    for name, key in SINGLES.items():
        props[key] = Image.open(os.path.join(SOURCE, name)).convert("RGBA")

    made = 0
    for key, im in sorted(props.items()):
        w, h = SIZES[key]
        out = to_size(im, w, h)
        out.save(os.path.join(OUT, f"{key}.png"))
        made += 1
        if key in TREES:
            canopy, trunk = split_tree(out)
            canopy.save(os.path.join(OUT, f"{key}-canopy.png"))
            trunk.save(os.path.join(OUT, f"{key}-trunk.png"))
            made += 2
    print(f"wrote {made} sprites to {OUT}")


if __name__ == "__main__":
    main()
