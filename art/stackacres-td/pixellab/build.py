#!/usr/bin/env python3
"""Character sheets from PixelLab art, in the layout the game already reads.

The people are drawn in PixelLab now (Kayo, 2026-09-19): the farmer with walk, idle and tool animations, everyone
else as standing views. `source/<name>/` keeps what PixelLab made, exactly as downloaded, so a sheet can be
rebuilt without generating again. This writes public/stackacres-td/characters/<name>.png + .json.

Layout, same as the rig's sheets so every frame index the game uses still means the same thing
(scene.ts STANDING, lib/stackacres-td/fishing-cast.ts): 48x48 frames in rows of 4, feet on row 44, tags
walk/harvest/water/chop/fish/shoot x down/up/left/right (4 frames each), then idle x 4. Left is a mirror of
right. A character with an 8-frame walk gets it appended and its walk tags pointed there; the first four walk
slots stay as two contacts and the standing pose (frame 1 of each walk tag is the standing frame).

Tightening (the raw frames "moved everywhere", Kayo): PixelLab redraws the whole body on every frame, so the
shading boils, the face drifts and the walk sits a few pixels off the standing pose. Walk and idle frames are
lined up with the standing pose, get its head (and, front and back, its chest) back at a 0/1px bob, and are
snapped to its colours. Tool actions are only lined up: their tools aren't in the standing palette.
"""
import colorsys
import glob
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "source")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "public", "stackacres-td", "characters")

SIZE, FEET_X, FEET_Y, COLS = 48, 24, 44, 4
DIRS = {"down": "south", "up": "north", "right": "east"}  # left is right, mirrored
ACTIONS = ["walk", "harvest", "water", "chop", "fish", "shoot"]
# Frame holds per action, from the rig (characters/rig/rig.py), so actions keep their timing.
DURATIONS = {"harvest": [120, 160, 120, 350], "water": [160, 160, 160, 160], "chop": [180, 120, 60, 260],
             "fish": [220, 90, 150, 500], "shoot": [150, 250, 200, 250]}
IDLE_MS = [700, 500, 700, 500]
STRIDE_MS = 100
# The last row of the head in each standing view, and the chest between the arms (front and back only; from the
# side the arm swings across it). Measured on the farmer; standing NPCs don't use them.
HEAD_ROWS = {"south": 12, "east": 13, "north": 11}
TORSO = {"south": (13, 24, 11, 20), "north": (12, 24, 11, 20)}
# How far down the body an NPC's idle breath reaches: rows above this dip a pixel on the out-breath.
BREATH_ROWS = 20


# PixelLab often draws light skin whatever the prompt says. These people have brown skin in their design (Ray
# above all: he is Kayo's great-grandfather), so their skin tones are swapped for a brown ramp. The farmer keeps
# PixelLab's light skin and blue eyes (Kayo's pick; he'll be customizable).
def ramp(*hexes):
    return [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in hexes]


WARM_BROWN = ramp("5a2a26", "7a3d2c", "8f5233", "a0603c", "b07046", "c08352", "d29a66")
DEEP_BROWN = ramp("441c21", "5a2522", "682d25", "7d4429", "8a4d30", "9a5a37", "b37749")  # the rig's skin_deep
# Bea came out brown already, so she isn't here.
BROWN_SKIN = {"ray": DEEP_BROWN, "brayden": WARM_BROWN, "pilgrim": WARM_BROWN}


def is_skin(r, g, b):
    """Warm red-orange, saturated and not dark: skin. Straw hats sit at hue 25 and up, red cloth past 340, leather
    and hair below 0.38 lightness, and brown caps and white beards under 0.40 saturation."""
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return 4 <= h * 360 <= 24 and 0.38 <= l <= 0.9 and s >= 0.40


def skin_top(name):
    """This character's lightest skin tone, which becomes the top of the brown ramp."""
    return max(colorsys.rgb_to_hls(r / 255, g / 255, b / 255)[1]
               for p in glob.glob(os.path.join(SOURCE, name, "rotations", "*.png"))
               for r, g, b, a in Image.open(p).convert("RGBA").get_flattened_data() if a and is_skin(r, g, b))


# How much darker than the lightest skin tone the deepest shadow sits, in lightness.
SKIN_SPAN = 0.40


def brown(img, skin, top):
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a and is_skin(r, g, b):
                _, l, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
                t = max(0.0, min(1.0, 1 - (top - l) / SKIN_SPAN))
                px[x, y] = skin[round(t * (len(skin) - 1))] + (a,)
    return out


CURRENT = None  # (name, ramp, top) for the character being built, so load() can brown its skin


def load(path):
    img = Image.open(path).convert("RGBA")
    return brown(img, *CURRENT[1:]) if CURRENT else img


def frames_of(name, anim, view):
    return [load(p) for p in sorted(glob.glob(os.path.join(SOURCE, name, "animations", anim, view, "frame_*.png")))]


def feet(img):
    b = img.getbbox()
    return (b[0] + b[2]) // 2, b[3] - 1


def mask(img, rows):
    return {(x, y) for y in range(max(rows[0], 0), min(rows[1], img.height)) for x in range(img.width)
            if img.getpixel((x, y))[3]}


def fit(frame, standing, rows=(14, 27), reach=2):
    """The shift that best lays the frame's body over the standing body."""
    target = mask(standing, rows)
    best = None
    for dy in range(-reach, reach + 1):
        for dx in range(-5, 6):
            moved = {(x - dx, y - dy) for x, y in mask(frame, (rows[0] + dy, rows[1] + dy))}
            score = len(target ^ moved)
            if best is None or score < best[0]:
                best = (score, dx, dy)
    return best[1], best[2]


def shifted(img, dx, dy):
    out = Image.new("RGBA", img.size)
    out.paste(img, (dx, dy), img)
    return out


def snap(img, colours):
    out = img.copy()
    px = out.load()
    cache = {}
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a:
                if (r, g, b) not in cache:
                    cache[(r, g, b)] = min(colours, key=lambda c: (c[0] - r) ** 2 * 3 + (c[1] - g) ** 2 * 4 + (c[2] - b) ** 2 * 2)
                px[x, y] = cache[(r, g, b)] + (255,)
    return out


def tighten(frames, standing, view):
    """Walk and idle: only the arms and legs move."""
    fits = [fit(f, standing) for f in frames]
    dx0 = sorted(dx for dx, _ in fits)[len(fits) // 2]
    colours = sorted({p[:3] for p in standing.get_flattened_data() if p[3]})
    cut = HEAD_ROWS[view]
    out = []
    for f, (_, dy) in zip(frames, fits):
        bob = 1 if dy > 0 else 0
        body = shifted(f, -dx0, 0)
        body.paste(Image.new("RGBA", (body.width, cut + bob + 1)), (0, 0))
        body.alpha_composite(standing.crop((0, 0, standing.width, cut + 1)), (0, bob))
        if view in TORSO:
            top, bottom, x0, x1 = TORSO[view]
            chest = standing.crop((x0, top, x1, bottom))
            body.paste(Image.new("RGBA", chest.size), (x0, top + bob))
            body.alpha_composite(chest, (x0, top + bob))
        out.append(snap(body, colours))
    return out


def aligned(frames, standing):
    """Tool actions: lined up with the standing pose, drawn as PixelLab drew them. PixelLab can draw an action
    several pixels off the standing pose, and a crouch or a lean changes the body's shape too much to match it,
    so the feet decide the height: the animation's usual lowest row (the median, so an axe swung below the boots
    in one frame doesn't count) goes on the standing pose's. Side to side still comes from the body."""
    dx0 = sorted(fit(f, standing)[0] for f in frames)[len(frames) // 2]
    dy0 = standing.getbbox()[3] - sorted(f.getbbox()[3] for f in frames)[len(frames) // 2]
    return [shifted(f, -dx0, dy0) for f in frames]


def without_specks(img, largest=12):
    """Drops small pieces that don't touch the body. PixelLab's cast draws the float in its last frame only, so
    the fight (which rocks between the last two frames) would blink it; the scene draws the float instead, at
    the spot this one sat (lib/stackacres-td/fishing-cast.ts LINE_END_DX/DY)."""
    out = img.copy()
    px = out.load()
    seen = set()
    for y in range(out.height):
        for x in range(out.width):
            if px[x, y][3] and (x, y) not in seen:
                blob, todo = [], [(x, y)]
                seen.add((x, y))
                while todo:
                    cx, cy = todo.pop()
                    blob.append((cx, cy))
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1),
                                   (cx + 1, cy + 1), (cx - 1, cy - 1), (cx + 1, cy - 1), (cx - 1, cy + 1)):
                        if 0 <= nx < out.width and 0 <= ny < out.height and (nx, ny) not in seen and px[nx, ny][3]:
                            seen.add((nx, ny))
                            todo.append((nx, ny))
                if len(blob) <= largest:
                    for bx, by in blob:
                        px[bx, by] = (0, 0, 0, 0)
    return out


def breath(standing):
    """An NPC's idle, from its one standing view: two holds, then the shoulders and head settle a pixel."""
    out_breath = standing.copy()
    top = standing.crop((0, 0, standing.width, BREATH_ROWS))
    out_breath.paste(Image.new("RGBA", (standing.width, 1)), (0, 0))
    out_breath.alpha_composite(top, (0, 1))
    return [standing, standing, out_breath, out_breath]


def place(img, anchor):
    frame = Image.new("RGBA", (SIZE, SIZE))
    frame.alpha_composite(img, (FEET_X - anchor[0], FEET_Y - anchor[1]))
    return frame


def build(name):
    views = {d: load(os.path.join(SOURCE, name, "rotations", f"{v}.png")) for d, v in DIRS.items()}
    anchors = {d: feet(img) for d, img in views.items()}
    has = lambda anim, view: bool(glob.glob(os.path.join(SOURCE, name, "animations", anim, view, "frame_*.png")))

    def seq(anim, d):
        """Frames for one tag and direction, in the 48x48 layout, with their holds."""
        view, standing = DIRS[d], views[d]
        if anim == "walk":
            stand = [(place(standing, anchors[d]), 150)]
            if has("walk", view):
                walk = [place(f, anchors[d]) for f in tighten(frames_of(name, "walk", view), standing, view)]
                return [(walk[0], 150), stand[0], (walk[4], 150), stand[0]]
            return stand * 4
        if anim == "idle":
            if has("idle", view):
                idle = tighten(frames_of(name, "idle", view), standing, view)
            else:
                idle = breath(standing)
            return [(place(f, anchors[d]), ms) for f, ms in zip(idle, IDLE_MS)]
        if anim == "stride":
            return [(place(f, anchors[d]), STRIDE_MS) for f in tighten(frames_of(name, "walk", view), standing, view)]
        if has(anim, view):
            frames = aligned(frames_of(name, anim, view), standing)
            if anim == "fish":
                frames = [without_specks(f) for f in frames]
            return [(place(f, anchors[d]), ms) for f, ms in zip(frames, DURATIONS[anim])]
        return [(place(standing, anchors[d]), ms) for ms in DURATIONS[anim]]

    tags, frames = [], []
    names = ACTIONS + ["idle"] + (["stride"] if has("walk", "east") else [])
    for anim in names:
        right = None
        for d in ("down", "up", "left", "right"):
            if d == "left":
                right = seq(anim, "right")
                s = [(img.transpose(Image.FLIP_LEFT_RIGHT), ms) for img, ms in right]
            elif d == "right":
                s = right
            else:
                s = seq(anim, d)
            tags.append((anim, d, len(frames), len(frames) + len(s) - 1))
            frames.extend(s)
    return tags, frames


def write(name, tags, frames):
    rows = []
    sheet_frames, frame_tags = {}, []
    row = 0
    for anim, d, first, last in tags:
        for col, i in enumerate(range(first, last + 1)):
            sheet_frames[str(i)] = {"frame": {"x": col % COLS * SIZE, "y": (row + col // COLS) * SIZE, "w": SIZE, "h": SIZE},
                                    "rotated": False, "trimmed": False,
                                    "spriteSourceSize": {"x": 0, "y": 0, "w": SIZE, "h": SIZE},
                                    "sourceSize": {"w": SIZE, "h": SIZE}, "duration": frames[i][1]}
            rows.append((i, col % COLS, row + col // COLS))
        row += -(-(last - first + 1) // COLS)
        # The 8-frame walk is appended as "stride" and takes over the walk tags; see the module docstring.
        tag = f"{'walk' if anim == 'stride' else anim}_{d}"
        existing = next((t for t in frame_tags if t["name"] == tag), None)
        if existing:
            existing.update({"from": first, "to": last})
        else:
            frame_tags.append({"name": tag, "from": first, "to": last, "direction": "forward", "color": "#000000ff"})
    sheet = Image.new("RGBA", (COLS * SIZE, row * SIZE))
    for i, c, r in rows:
        sheet.alpha_composite(frames[i][0], (c * SIZE, r * SIZE))
    os.makedirs(OUT, exist_ok=True)
    sheet.save(os.path.join(OUT, f"{name}.png"))
    meta = {"image": f"{name}.png", "format": "RGBA8888", "size": {"w": sheet.width, "h": sheet.height}, "scale": "1",
            "frameTags": frame_tags}
    with open(os.path.join(OUT, f"{name}.json"), "w") as fh:
        json.dump({"frames": sheet_frames, "meta": meta}, fh, separators=(",", ":"))
    return len(frames)


def main(names=None):
    global CURRENT
    for name in sorted(os.listdir(SOURCE)):
        if names and name not in names:
            continue
        CURRENT = (name, BROWN_SKIN[name], skin_top(name)) if name in BROWN_SKIN else None
        tags, frames = build(name)
        print(f"{name}: {write(name, tags, frames)} frames")


if __name__ == "__main__":
    import sys
    main(sys.argv[1:] or None)
