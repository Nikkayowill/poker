#!/usr/bin/env python3
"""Pictures for the scale decision: the same Homestead corner, drawn with today's people and with
LPC people at three heights, plus close-ups and walking GIFs. Usage: python3 review.py <out dir>"""
import io
import json
import os
import subprocess
import sys

from PIL import Image

import cast
import lpc
import mockup

# What the game draws today. The branch overwrites those files, so the comparison reads them from
# git instead of from disk; STACKACRES_TODAY_DIR points it at another checkout when there is one
# with work that has not been committed yet.
TODAY = os.environ.get("STACKACRES_TODAY_DIR")
CHARACTERS = os.path.join("public", "stackacres-td", "characters")
PEOPLE = ["farmer", "ray", "bea", "pilgrim"]
BOX = (80, 80, 320, 200)


def _today(name, ext):
    if TODAY:
        with open(os.path.join(TODAY, f"{name}.{ext}"), "rb") as fh:
            return fh.read()
    return subprocess.check_output(["git", "-C", mockup.REPO, "show",
                                    f"HEAD:{CHARACTERS}/{name}.{ext}"])


def shipped(name, tag="idle_down"):
    """A frame of what the game draws today."""
    im = Image.open(io.BytesIO(_today(name, "png"))).convert("RGBA")
    meta = json.loads(_today(name, "json"))
    i = [t for t in meta["meta"]["frameTags"] if t["name"] == tag][0]["from"]
    col, row = i % 4, i // 4
    return lpc.cutout(im.crop((col * 48, row * 48, col * 48 + 48, row * 48 + 48)))


def shipped_anim(name, tag):
    im = Image.open(io.BytesIO(_today(name, "png"))).convert("RGBA")
    meta = json.loads(_today(name, "json"))
    t = [t for t in meta["meta"]["frameTags"] if t["name"] == tag][0]
    return [im.crop(((i % 4) * 48, (i // 4) * 48, (i % 4) * 48 + 48, (i // 4) * 48 + 48))
            for i in range(t["from"], t["to"] + 1)]


def contact(panels, scale=7, pad=20, bg=(26, 26, 30, 255)):
    w = sum(p.width * scale + pad for _l, p in panels) + pad
    h = max(p.height for _l, p in panels) * scale + pad * 2
    sheet = Image.new("RGBA", (w, h), bg)
    x = pad
    for _label, im in panels:
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        sheet.alpha_composite(big, (x, h - pad - big.height))
        x += big.width + pad
    return sheet


def main(out):
    os.makedirs(out, exist_ok=True)
    area = mockup.Area()
    built = {n: cast.build(n) for n in PEOPLE}
    idle = {n: lpc.cutout(c.frames("idle", "down")[0]) for n, c in built.items()}

    def row(images):
        return [(im, 130 + i * 50, 250) for i, im in enumerate(images)]

    mockup.zoom(area.render(BOX, row([shipped(n) for n in PEOPLE])), 3).save(f"{out}/world-today.png")
    for h in (31, 38, 44):
        sprites = row([lpc.shrink(idle[n], h) for n in PEOPLE])
        mockup.zoom(area.render(BOX, sprites), 3).save(f"{out}/world-{h}.png")
    mockup.zoom(area.render(BOX, row([idle[n] for n in PEOPLE])), 3).save(f"{out}/world-native.png")

    contact([("today", shipped("farmer")), ("lpc31", lpc.shrink(idle["farmer"], 31)),
             ("lpc38", lpc.shrink(idle["farmer"], 38)), ("lpc50", idle["farmer"])]
            ).save(f"{out}/closeup-farmer.png")
    contact([(n, idle[n]) for n in PEOPLE]).save(f"{out}/cast-native.png")
    contact([(n, lpc.shrink(idle[n], 31)) for n in PEOPLE]).save(f"{out}/cast-31.png")

    # Walking and working, which is the part today's cast cannot do.
    spec = cast.CAST["farmer"]
    with_tool = {t: lpc.Character(spec["items"] + [(t, None)], palette=spec.get("palette"))
                 for t in ("tool_watering_can", "tool_hoe")}
    for tag, anim, ms, who in (("walk", "walk", 90, built["farmer"]),
                               ("water", "watering", 140, with_tool["tool_watering_can"]),
                               ("hoe", "thrust", 120, with_tool["tool_hoe"]),
                               ("run", "run", 80, built["farmer"])):
        for h, suffix in ((50, "native"), (31, "31")):
            frames = [lpc.cutout(f) for f in who.frames(anim, "down")]
            top = max(f.height for f in frames)
            pad = []
            for f in frames:
                canvas = Image.new("RGBA", (max(f.width for f in frames) + 4, top + 2))
                canvas.alpha_composite(f, ((canvas.width - f.width) // 2, canvas.height - f.height))
                pad.append(lpc.shrink(canvas, round(canvas.height * h / 50)))
            gif(pad, f"{out}/{tag}-{suffix}.gif", ms)
    old = [lpc.cutout(f) for f in shipped_anim("farmer", "walk_down")]
    gif(old, f"{out}/walk-today.gif", 150)
    print("wrote", out)


def gif(frames, path, ms, scale=6):
    w = max(f.width for f in frames)
    h = max(f.height for f in frames)
    flat = []
    for f in frames:
        canvas = Image.new("RGBA", (w, h), (255, 255, 255, 255))
        canvas.alpha_composite(f, ((w - f.width) // 2, h - f.height))
        flat.append(canvas.resize((w * scale, h * scale), Image.NEAREST).convert("P", palette=Image.ADAPTIVE))
    flat[0].save(path, save_all=True, append_images=flat[1:], duration=ms, loop=0, disposal=2)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
