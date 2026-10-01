#!/usr/bin/env python3
"""The barnyard's animals, from LPC art, for the barn crew's farm (lib/stackacres-td/work-barn.ts).

Hens, sheep, cows and pigs are Daniel Eddeland's "LPC style farm animals", piglets are from the "Pigs
Rework" of his pig, and the horses are "LPC Horse Extended". The source sheets are in animals/ with
the pack's own notes; animals/SOURCES.md says where each came from.

Each animal is shrunk by the factor that takes an LPC person (50px) to the cast's height, so a cow stands
beside a farmhand at true size. Hens come out a little smaller, since LPC draws them plump, and piglets
smaller again than the sows. Written to public/stackacres-td/animals/<name>.png|json, one sheet per
animal (a horse per coat): frames trimmed and packed, tags `<act>_<dir>` for walk, eat and idle (and
gallop, for a horse), and `meta.anchor`, the point in each frame's box that stands on the animal's square.

    python3 animals.py
"""
import json
import os

from PIL import Image, ImageChops

import cast
import lpc

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "animals")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "public", "stackacres-td", "animals")

# The crew's own shrink: an LPC person is 50px and the cast is TARGET_HEIGHT.
TRUE_SIZE = cast.TARGET_HEIGHT / 50
# LPC's farm animal sheets and its horse run up, left, down, right; the Pigs Rework runs north, east,
# south, west.
LPC_ROWS = ["up", "left", "down", "right"]
REWORK_ROWS = ["up", "right", "down", "left"]
COLOURS, KEY = 40, (255, 0, 255)
SHEET_W = 512


def cells(path, size, rows):
    """{direction: [frame, ...]} off a sheet of `size` square cells (or (w, h) cells)."""
    w, h = (size, size) if isinstance(size, int) else size
    img = Image.open(os.path.join(SRC, path)).convert("RGBA")
    return {d: [img.crop((c * w, r * h, c * w + w, r * h + h)) for c in range(img.width // w)]
            for r, d in enumerate(rows)}


def layered(paths, size, rows):
    """Several layers of the same sheet (a horse's coat, its mane and its markings) drawn over each other."""
    stacks = [cells(p, size, rows) for p in paths]
    out = {}
    for d in rows:
        frames = []
        for i, base in enumerate(stacks[0][d]):
            f = base.copy()
            for layer in stacks[1:]:
                f.alpha_composite(layer[d][i])
            frames.append(f)
        out[d] = frames
    return out


def side_ground(sheet):
    """The row an animal stands on: one below its feet, side on."""
    return max(f.getbbox()[3] for d in ("left", "right") for f in sheet[d] if f.getbbox())


def hen():
    walk = cells("farm/chicken_walk.png", 32, LPC_ROWS)
    eat = cells("farm/chicken_eat.png", 32, LPC_ROWS)
    return dict(scale=TRUE_SIZE * 0.8, anchor=(16, side_ground(walk)),
                tags={"walk": (walk, None, 110), "eat": (eat, None, [260, 160, 260, 160]), "idle": (walk, [0], 1000)})


def farm_animal(kind, walk_ms, eat_ms=(420, 300, 420, 300)):
    walk = cells(f"farm/{kind}_walk.png", 128, LPC_ROWS)
    eat = cells(f"farm/{kind}_eat.png", 128, LPC_ROWS)
    return dict(scale=TRUE_SIZE, anchor=(64, side_ground(walk)),
                tags={"walk": (walk, None, walk_ms), "eat": (eat, None, list(eat_ms)), "idle": (walk, [0], 1000)})


def piglet():
    """A piglet a few weeks old, a bit over half its mother's length. The Rework's three walk frames step
    left, stand, step right; standing is the middle one."""
    sheet = cells("pigs-rework/piglet.png", (48, 64), REWORK_ROWS)
    return dict(scale=TRUE_SIZE * 0.8, anchor=(24, side_ground(sheet)),
                tags={"walk": (sheet, [0, 1, 2, 1], 120), "idle": (sheet, [1], 1000)})


# The yard's horses: a bay with a blaze and white socks, a black with a star, a grey with a stripe and a
# palomino with a white mane and tail.
HORSES = {
    "horse_bay": ("brown", ["face-blaze", "socks-{a}-brown"]),
    "horse_black": ("black", ["face-star"]),
    "horse_grey": ("gray", ["face-stripe", "socks-{a}-gray"]),
    "horse_palomino": ("gold", ["mane-{a}-white", "face-stripe"]),
}


def horse(coat, marks):
    def sheet(anim):
        paths = [f"horse/horse-{anim}-{coat}.png"]
        for m in marks:
            paths.append(f"horse/{m.format(a=anim)}.png" if "{a}" in m else f"horse/{m}-{anim}.png")
        return layered(paths, 128, LPC_ROWS)

    walk, idle, gallop = sheet("walk"), sheet("idle"), sheet("gallop")
    # The idle sheet is one row: a standing horse facing each way in turn.
    stand = {d: [idle["up"][i]] for i, d in enumerate(LPC_ROWS)}
    return dict(scale=TRUE_SIZE, anchor=(64, side_ground(walk)),
                tags={"walk": (walk, None, 130), "gallop": (gallop, None, 80), "idle": (stand, [0], 1000)})


def animals():
    made = {"hen": hen(), "sheep": farm_animal("sheep", 150), "cow": farm_animal("cow", 190),
            "pig": farm_animal("pig", 150, (320, 220, 320, 220)), "piglet": piglet()}
    for name, (coat, marks) in HORSES.items():
        made[name] = horse(coat, marks)
    return made


def shrunk(frame, k):
    """A whole cell shrunk by `k`, so every frame of an animal keeps the same box and anchor."""
    return lpc.shrink(frame, max(1, round(frame.height * k)))


def paletted(img, colours=COLOURS):
    alpha = img.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    rgb = img.convert("RGB")
    rgb.paste(KEY, mask=ImageChops.invert(alpha))
    out = rgb.quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette = out.getpalette()
    clear = min(range(colours), key=lambda i: sum((palette[i * 3 + c] - KEY[c]) ** 2 for c in range(3)))
    return out, clear


def write(name, spec, out=OUT):
    k = spec["scale"]
    frames, tags = [], []
    for act, (sheet, pick, holds) in spec["tags"].items():
        for d in ("down", "up", "left", "right"):
            row = sheet[d]
            chosen = [row[i] for i in pick] if pick is not None else row
            first = len(frames)
            for i, f in enumerate(chosen):
                frames.append((shrunk(f, k), holds[i % len(holds)] if isinstance(holds, list) else holds))
            tags.append({"name": f"{act}_{d}", "from": first, "to": len(frames) - 1, "direction": "forward"})
    box = frames[0][0].size
    cell = next(iter(spec["tags"].values()))[0]["down"][0].size
    anchor = (round(spec["anchor"][0] * box[0] / cell[0]), round(spec["anchor"][1] * box[1] / cell[1]))

    # Trim each frame to what is drawn, store a frame drawn twice once, and shelve them in rows.
    rects, placed, seen = [], [], {}
    x = y = row_h = 0
    for img, _ in frames:
        bb = img.getbbox() or (0, 0, 1, 1)
        piece = img.crop(bb)
        key = (piece.size, piece.tobytes())
        if key not in seen:
            if x + piece.width > SHEET_W:
                x, y, row_h = 0, y + row_h + 1, 0
            seen[key] = (x, y, piece.width, piece.height)
            placed.append((piece, x, y))
            x += piece.width + 1
            row_h = max(row_h, piece.height)
        rects.append((seen[key], bb))
    sheet = Image.new("RGBA", (SHEET_W, y + row_h))
    for piece, px, py in placed:
        sheet.alpha_composite(piece, (px, py))
    sheet = sheet.crop((0, 0, max(px + p.width for p, px, _ in placed), sheet.height))

    os.makedirs(out, exist_ok=True)
    small, clear = paletted(sheet)
    small.save(os.path.join(out, f"{name}.png"), transparency=clear, optimize=True)
    data = {
        "frames": {
            str(i): {"frame": {"x": fx, "y": fy, "w": fw, "h": fh}, "rotated": False, "trimmed": True,
                     "spriteSourceSize": {"x": bb[0], "y": bb[1], "w": fw, "h": fh},
                     "sourceSize": {"w": box[0], "h": box[1]}, "duration": hold}
            for i, (((fx, fy, fw, fh), bb), (_, hold)) in enumerate(zip(rects, frames))
        },
        "meta": {"image": f"{name}.png", "format": "RGBA8888", "size": {"w": sheet.width, "h": sheet.height},
                 "scale": "1", "anchor": {"x": anchor[0], "y": anchor[1]}, "frameTags": tags},
    }
    with open(os.path.join(out, f"{name}.json"), "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    return len(frames), sheet.size, box, anchor


CREDITS = """# Animal art credits

The barnyard's animals are Liberated Pixel Cup art from OpenGameArt, shrunk to stand beside the farm crew.
All of it is used under CC-BY 3.0.

- **Hens, sheep, cows and pigs**: "LPC style farm animals" by Daniel Eddeland (daneeklu), CC-BY 3.0 (also
  GPL 2.0). https://opengameart.org/node/11629
- **Piglets**: "Pigs Rework" by Daniel Eddeland (daneeklu) and Jordan Irwin (AntumDeluge), from
  daneeklu's pig, CC-BY 3.0. https://opengameart.org/node/83210
- **Horses**: "LPC Horse Extended" by Benjamin K. Smith (BenCreating), extending "[LPC] Horses" by
  bluecarrot16, CC-BY 3.0 (also OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0 and GPL 3.0). Coats, manes and face and
  leg markings are his. https://opengameart.org/content/lpc-horse-extended and
  https://opengameart.org/content/lpc-horses
"""


def main():
    for name, spec in animals().items():
        count, size, box, anchor = write(name, spec)
        print(f"{name:15s} {count:3d} frames  sheet {size[0]}x{size[1]}  box {box[0]}x{box[1]}  anchor {anchor}")
    with open(os.path.join(OUT, "CREDITS.md"), "w") as fh:
        fh.write(CREDITS)


if __name__ == "__main__":
    main()
