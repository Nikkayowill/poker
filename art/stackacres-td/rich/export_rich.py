#!/usr/bin/env python3
"""Exports the rich art to public/stackacres-td, in exactly the layout the top-down engine already loads
(see areas/rig/export.py, which this replaces for what ships).

Usage: python3 export_rich.py [--out <dir>] [area ...]

Differences from the DB16 export:
- ground-<f>.png carries the rich terrain, ground-level items, projected cast shadows and pond reflections
  of everything that stands still. People move, so they cast nothing baked; the engine draws theirs.
- No light grade is baked in: the engine's day/night layer grades the whole view.
- Decor's flying critters are left out: the engine flies its own (docs/stackacres-premium-life.md).
- Grass tufts over a prop's feet ship as their own small props, one pixel in front of it.
- An area without water ships one ground frame, not four identical ones (area.json `frames`).
- Life the engine runs (docs/stackacres-premium-life.md): `lights` (windows, lamps, lanterns that glow at night),
  `emitters` (chimney smoke), a `sway` part on trees, reeds and grasses that the wind moves, and `ambient`: the
  open meadow and pond tiles critters may use (kept clear of every tap target) and the broadleaf canopies that
  drop leaves.
"""

import json
import os
import shutil
import sys
from types import SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = os.path.join(os.path.dirname(HERE), "areas", "rig")
sys.path[:0] = [HERE, RIG]

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import area_farm  # noqa: E402
import build  # noqa: E402
import build_area  # noqa: E402
import characters  # noqa: E402
import critters  # noqa: E402
import decor  # noqa: E402
import export as rig_export  # noqa: E402
import extras  # noqa: E402
import interiors  # noqa: E402
import fold  # noqa: E402
import homestead  # noqa: E402
import mine  # noqa: E402
import oak  # noqa: E402
import coast  # noqa: E402
import townsquare  # noqa: E402
import kit  # noqa: E402
import lpc_ground  # noqa: E402
import pasture  # noqa: E402
import portraits  # noqa: E402
import props  # noqa: E402
import scene  # noqa: E402
import sprites  # noqa: E402
import terrain  # noqa: E402
import area as area_mod  # noqa: E402
from area import T  # noqa: E402
from pal import Canvas, hash2  # noqa: E402

PLAYABLE = [homestead, fold, pasture, coast, oak, mine, townsquare]
# Rooms walked into through a Homestead door; drawn only by rich/, so they skip the DB16 sprite patching.
INTERIORS = [SimpleNamespace(__name__="barn", build=interiors.barn),
             SimpleNamespace(__name__="workshop", build=interiors.workshop),
             SimpleNamespace(__name__="farmhouse", build=interiors.house)]
TAP_CLEARANCE = 24   # map px of open space critters keep around anything a player taps
# Light points in a tagged prop's own sprite pixels: where its windows and lamps are. The barn and the workshop
# carry theirs on their sprites (buildings.py), since their tags are also on the counter and the bench inside.
LIGHTS = {}


# A straw mat outside each door on the Homestead: (door centre x, mat top y, width). Laid into the ground picture
# after it is drawn, and the same step is what patched the committed ground-*.png.
DOORMATS = {"homestead": [(360, 151, 32), (488, 151, 24)]}


def lay_doormats(img, area_name, scale=1):
    for cx, top, w in DOORMATS.get(area_name, ()):
        mat = interiors.doormat(w).convert("RGBA")
        if scale != 1:
            mat = mat.resize((mat.width * scale, mat.height * scale), Image.NEAREST)
        img.paste(mat, ((cx - w // 2) * scale, top * scale), mat)
    return img


def lpc_ground_image(area, sc, ground):
    """The ground picture, with the terrain painted from the LPC atlas.

    Everything that is not terrain is unchanged and simply drawn twice the
    size, so it lands back at its own scale on screen once the engine halves
    the picture. The terrain is the only thing that actually gains detail --
    which is the point, and why no coordinate anywhere had to move.

    Pond reflections are the one thing left behind for now: they are computed
    against the procedural water's own pixels. Shadows are not -- they are a
    mask over the whole map and scale up cleanly.
    """
    names = ["grass"] + terrain.ORDER
    tiles = lpc_ground.tile_materials(ground.owner, names, area.w, area.h)
    img = lpc_ground.paint(tiles, area.w, area.h)
    d = np.clip(sc.dark, 0, 1.4)
    strength = np.where(d > 1, 0.82 + (d - 1) * 0.4, d * 0.82)
    strength = strength.repeat(lpc_ground.SCALE, axis=0).repeat(lpc_ground.SCALE, axis=1)[..., None]
    img = img * (1 - strength) + img * scene.SHADOW_TINT * strength
    for it in sc.items:
        if not it["ground"]:
            continue
        arr = it["arrs"][0]
        big = arr.repeat(lpc_ground.SCALE, axis=0).repeat(lpc_ground.SCALE, axis=1)
        scene._blit(img, big, it["x"] * lpc_ground.SCALE, it["y"] * lpc_ground.SCALE)
    return img


def game_character_frame(name):
    """An empty frame where a character stands, for the GAME export only.

    The game never uses the picture. A character reaches it as a name and a
    position (`area.npcs`), the engine loads the art itself from
    public/stackacres-td/characters/, the export skips characters when it
    writes props, and their shadows are not baked because people move. Asking
    characters.py to draw one here would build the whole Aseprite chain to
    produce an image that is then thrown away.

    The review render is the opposite case: it exists to show the people, so it
    keeps `build.rich_character_frame`, which reads the real sheet and fails if
    it is not there.
    """
    return Image.new("RGBA", (48, 48)), (24, 44)


def patch():
    build_area.patch("".join(open(m.__file__).read() for m in PLAYABLE))
    area_mod.character_frame = game_character_frame
    smoke = props.smoke

    def smoke_emitter():
        frames = smoke()
        for img, _ in frames:
            img.info["emitter"] = "smoke"
        return frames

    props.smoke = smoke_emitter


def to_image(arr):
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    if arr.shape[2] == 3:
        arr = np.dstack([arr, np.full(arr.shape[:2], 255, np.uint8)])
    return Image.fromarray(arr, "RGBA")


def export_area(module, out_root):
    area = module.build(for_game=True)
    before_decor = len(area.items)
    if not area.indoor:                                   # no grass, pebbles or butterflies on a floor
        decor.decorate(area)
    build.assert_redrawn(area)
    ground = terrain.Ground(area)
    sc = scene.Scene(area, ground, static_only=True)
    out = os.path.join(out_root, "areas", area.name)
    os.makedirs(out, exist_ok=True)
    # One ground frame, not four. The four were water shimmer, and the LPC
    # picture is twice the size in each direction -- four of them would be the
    # kind of texture budget that crashed a phone before. The pond will get its
    # movement back from the engine rather than from four baked copies.
    lay_doormats(to_image(lpc_ground_image(area, sc, ground)), area.name, lpc_ground.SCALE).save(
        os.path.join(out, "ground-0.png"))
    for f in range(1, kit.FRAMES):
        path = os.path.join(out, f"ground-{f}.png")
        if os.path.exists(path):
            os.remove(path)

    names = ["grass"] + terrain.ORDER
    owner = [[names[c] for c in row] for row in ground.owner.tolist()]
    named, entries, lights, emitters, canopies = [], [], [], [], []
    for it in sc.standing():
        source = area.items[it["i"]][0]
        if source[0].info.get("emitter"):
            emitters.append({"kind": source[0].info["emitter"], "x": it["bx"], "y": it["by"] - 1})
            continue
        if it["name"] or (it["i"] >= before_decor and it["animated"]):
            continue
        sway = source[0].info.get("sway") if len(source) == 1 else None
        shade = lambda img: Image.fromarray(sc.prop_frame({**it, "arrs": [np.array(img.convert("RGBA"))]}, 0))
        if sway:
            imgs = [shade(sway["lower"])]
        else:
            imgs = [Image.fromarray(sc.prop_frame(it, f)) for f in range(len(it["arrs"]))]
        frame_names = []
        for f, img in enumerate(imgs):
            frame_names.append(f"p{it['i']}_{f}")
            named.append((frame_names[-1], img))
        entry = {"frame": frame_names[0], "frames": frame_names, "x": it["bx"], "y": it["by"], "ax": it["ax"],
                 "ay": it["ay"], "w": imgs[0].width, "h": imgs[0].height,
                 "blocks": [b for b in rig_export.prop_blocks(imgs, (it["ax"], it["ay"]), it["bx"], it["by"], area)
                            if tuple(b) not in area.doorways]}
        if source[0].info.get("passable"):
            entry["passable"] = True
            entry["blocks"] = []
        if sway and sway.get("kind") == "broadleaf":
            canopies.append({"x": it["bx"], "y": it["by"] - 26})
        if sway:
            named.append((f"s{it['i']}", shade(sway["upper"])))
            entry["sway"] = {"frame": f"s{it['i']}", "amp": sway["amp"], "rustle": sway["rustle"]}
        for lx, ly, kind in source[0].info.get("lights", ()):
            lights.append({"kind": kind, "x": it["x"] + lx, "y": it["y"] + ly})
        if it["i"] in area.tags:
            entry["tag"] = area.tags[it["i"]]
            for lx, ly, kind in LIGHTS.get(entry["tag"], ()):
                lights.append({"kind": kind, "x": it["x"] + lx, "y": it["y"] + ly})
        entries.append(entry)
        tuft = sc.tuft_image(it)
        if tuft:
            arr, x0, y0 = tuft
            name = f"t{it['i']}"
            named.append((name, Image.fromarray(arr, "RGBA")))
            entries.append({"frame": name, "frames": [name], "x": it["bx"], "y": it["by"] + 1, "ax": it["bx"] - x0,
                            "ay": it["by"] + 1 - y0, "w": arr.shape[1], "h": arr.shape[0], "blocks": []})
    for imgs, (ax, ay), bx, by, _, is_ground, _ in area.items:  # lamps painted into a ground picture (a room's walls)
        if is_ground:
            for lx, ly, kind in imgs[0].info.get("lights", ()):
                lights.append({"kind": kind, "x": bx - ax + lx, "y": by - ay + ly})
    sheet, atlas_json = rig_export.atlas(named, "props.png")
    sheet.save(os.path.join(out, "props.png"))
    with open(os.path.join(out, "props.json"), "w") as fh:
        json.dump(atlas_json, fh, separators=(",", ":"))

    spawn = area.spawn or (area.w * T // 2, area.h * T // 2)
    data = {
        "name": area.name, "width": area.w, "height": area.h, "tile": T, "frames": 1,
        "spawn": {"x": spawn[0], "y": spawn[1]},
        "props": entries,
        "npcs": [{"name": n, "x": x, "y": y} for n, x, y in area.npcs if n != "farmer"],
        "blocked": sorted({tuple(b) for b in rig_export.ground_blocked(area, owner)} | area.solid),
        "indoor": area.indoor,
        "zones": [{"tag": t, "x": x, "y": y, "w": w, "h": h} for t, x, y, w, h in area.zones],
        "exits": [{"to": to, "x": x, "y": y, "w": w, "h": h, "spawn": {"x": sx, "y": sy}}
                  for to, x, y, w, h, sx, sy in area.exits],
        "lights": lights,
        "emitters": emitters,
        "ambient": {**ambient_tiles(area, ground, entries), "canopies": canopies},
    }
    with open(os.path.join(out, "area.json"), "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(area.name, "->", out, "|", len(entries), "props,", len(data["npcs"]), "npcs,", len(data["blocked"]), "blocked tiles,",
          len(lights), "lights,", len(emitters), "emitters,", len(data["ambient"]["meadow"]), "meadow and",
          len(data["ambient"]["pond"]), "pond tiles,", len(canopies), "canopies,", sum(1 for e in entries if "sway" in e), "swaying,", 1, "ground frame")


def ambient_tiles(area, ground, entries):
    """Tiles critters may fly over: mostly grass (the meadow) or mostly pond, each at least TAP_CLEARANCE from any
    tagged prop, person, zone or exit, and not under a standing prop's footprint."""
    keep_out = []
    for e in entries:
        if "tag" in e:
            keep_out.append((e["x"] - e["ax"], e["y"] - e["ay"], e["w"], e["h"]))
    for _, x, y in area.npcs:
        keep_out.append((x - 9, y - 30, 18, 32))
    for _, x, y, w, h in area.zones:
        keep_out.append((x, y, w, h))
    for _, x, y, w, h, _, _ in area.exits:
        keep_out.append((x, y, w, h))
    blocked = {(tx, ty) for e in entries for tx, ty in e["blocks"]}
    grass = ground.owner == 0
    pond = ground.owner == terrain.CODE["water"]
    meadow, water = [], []
    for ty in range(area.h):
        for tx in range(area.w):
            x0, y0 = tx * T, ty * T
            if (tx, ty) in blocked:
                continue
            if any(x0 + T > kx - TAP_CLEARANCE and x0 < kx + kw + TAP_CLEARANCE and
                   y0 + T > ky - TAP_CLEARANCE and y0 < ky + kh + TAP_CLEARANCE for kx, ky, kw, kh in keep_out):
                continue
            if grass[y0:y0 + T, x0:x0 + T].mean() >= 0.9:
                meadow.append([tx, ty])
            elif pond[y0:y0 + T, x0:x0 + T].mean() >= 0.8:
                water.append([tx, ty])
    return {"meadow": meadow, "pond": water}


# ------------------------------------------------------------------ shared sprites

def soil_tile(tier, mask):
    """One bed tile, matching the rich terrain's tilled soil. mask bits: 1 N, 2 E, 4 S, 8 W neighbour is soil."""
    c = Canvas(T, T)
    for y in range(T):
        for x in range(T):
            furrow = y % 4 == 2 and 1 <= x <= 14
            ridge = y % 4 == 1 and 1 <= x <= 14
            if tier == "dirt":
                level = 1.0 if furrow else 3.6 if ridge else 2.5 + (hash2(x, y, 1) - 0.5) * 0.8
                c.put(x, y, "soil", level)
            elif tier == "enriched":
                level = 0.3 if furrow else 2.6 if ridge else 1.6 + (hash2(x, y, 2) - 0.5) * 0.8
                c.put(x, y, "soil", level)
                if not furrow and hash2(x, y, 3) < 0.07:
                    c.put(x, y, "straw", 2.6)
                elif not furrow and hash2(x, y, 4) < 0.05:
                    c.put(x, y, "moss", 2.2)
            else:
                if furrow:
                    c.put(x, y, "water", 3.2 if x % 5 != 1 else 6.2)
                else:
                    c.put(x, y, "soil", 3.8 if ridge else 2.2 + (hash2(x, y, 5) - 0.5) * 0.6)
    if not mask & 1:
        for x in range(T):
            c.put(x, 0, "grass", 1.4)
            c.put(x, 1, "soil", 0.5)
    if not mask & 8:
        for y in range(T):
            c.put(0, y, "grass", 1.4)
            if y:
                c.put(1, y, "soil", 0.7)
    if not mask & 4:
        for x in range(T):
            c.put(x, T - 1, "soil", 4.3)
    if not mask & 2:
        for y in range(T):
            c.put(T - 1, y, "soil", 3.9)
    return c.image()


def generic_crop(stage):
    """Any crop without its own drawing: a sprout, a leafy plant, a full plant with a golden seed head."""
    sizes = {0: (7, 6), 1: (9, 8), 2: (11, 10)}
    w, h = sizes[stage]
    c = Canvas(w, h)
    cx, base = w // 2, h - 2
    leaves = {0: [(-1, -2), (1, -2)], 1: [(-2, -3), (2, -3), (-1, -5), (1, -5)],
              2: [(-3, -3), (3, -3), (-2, -5), (2, -5), (-1, -7), (1, -7)]}[stage]
    for y in range(base - (2 + stage * 2), base + 1):
        c.put(cx, y, "leaf", 2.4)
    for dx, dy in leaves:
        side = -1 if dx < 0 else 1
        for k in range(2):
            c.put(cx + dx + side * k, base + dy + k // 2, "leaf2" if dx < 0 else "leaf", 4.8 - k * 1.2)
    if stage == 2:
        for x, y, lv in ((cx, 0, 5.2), (cx - 1, 1, 4.4), (cx, 1, 3.8), (cx + 1, 1, 3.0)):
            c.put(x, y, "gold", lv)
    return c.outline(ramp="soil", idx=0.8, rim=False).image()


def withered():
    c = Canvas(9, 8)
    for x, y, ramp, lv in ((2, 1, "dry", 2.4), (6, 1, "dry", 2.0), (3, 2, "dry", 2.8), (5, 2, "dirt", 2.6),
                           (4, 3, "dirt", 3.0), (5, 3, "dirt", 2.2), (3, 4, "dirt", 2.4), (4, 4, "dry", 2.8),
                           (4, 5, "dirt", 2.0), (1, 2, "dry", 1.8), (7, 2, "dry", 1.6)):
        c.put(x, y, ramp, lv)
    return c.outline(ramp="soil", idx=0.6, rim=False).image()


# Emotes over a person's head (Stardew's emote set is the reference). 7x5 icons inside the cue bubble.
EMOTES = {
    "heart": ["..R.R..", ".RRRRR.", ".RRRRR.", "..RRR..", "...R..."],
    "exclaim": ["...R...", "...R...", "...R...", ".......", "...R..."],
    "question": ["..LLL..", ".L...L.", "....L..", ".......", "...L..."],
    "note": ["....NN.", "....N.N", "....N..", "..NNN..", "..NN..."],
    "sleep": ["LLLL...", "...L...", "..L....", ".L.....", "LLLL..."],
    "sweat": ["....C..", "...CC..", "..CCLC.", "..CLLC.", "...CC.."],
    "sparkle": ["...Y...", ".Y.Y.Y.", "..YoY..", ".Y.Y.Y.", "...Y..."],
}

CUE_KEYS = {"L": ("water", 3.0), "C": ("water", 5.8), "Y": ("gold", 4.6), "o": ("gold", 3.0), "N": ("wood", 2.4),
            "R": ("red", 4.0), "W": ("linen", 6.4)}


def bubble(grid):
    """A speech bubble with a cue icon, lit from the top-left, outlined dark so it reads over any ground."""
    c = Canvas(11, 12)
    body = {(x, y) for y in range(0, 9) for x in range(1, 10)} | {(x, y) for y in range(1, 8) for x in range(0, 11)}
    body |= {(5, 9), (6, 10)}
    for x, y in body:
        level = 6.3 - (x + y) * 0.1
        c.put(x, y, "linen", level)
    for j, row in enumerate(grid):
        for i, k in enumerate(row):
            if k != ".":
                ramp, level = CUE_KEYS[k]
                c.put(2 + i, 1 + j, ramp, level)
    return c.outline(ramp="coal", idx=0.8, rim=False).image()


WARM = (255, 196, 112)


def glow(w, h, rings, core=WARM):
    """A pixel-art light: hard-edged rings of falling alpha, the outermost dithered. `rings` is
    [(radius_x, radius_y, alpha)], innermost first. Drawn in ADD, so the colour is what it adds."""
    img = Image.new("RGBA", (w, h))
    cx, cy = (w - 1) / 2, (h - 1) / 2
    for y in range(h):
        for x in range(w):
            for i, (rx, ry, alpha) in enumerate(rings):
                d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
                if d <= 1:
                    if i == len(rings) - 1 and (x + y) % 2:
                        break
                    img.putpixel((x, y), core + (round(alpha * 255),))
                    break
    return img


def smoke_puff(size):
    w, h = {0: (3, 3), 1: (5, 4), 2: (7, 6)}[size]
    c = Canvas(w, h)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    for y in range(h):
        for x in range(w):
            d = ((x - cx) / (w / 2)) ** 2 + ((y - cy) / (h / 2)) ** 2
            if d <= 1:
                c.put(x, y, "linen", 6.0 - (x + y) * 0.35 - d * 0.8)
    return c.image()


def export_common(out_root):
    out = os.path.join(out_root, "common")
    os.makedirs(out, exist_ok=True)
    named = []
    for tier in rig_export.SOIL_TIERS:
        for mask in range(16):
            named.append((f"soil_{tier}_{mask}", soil_tile(tier, mask)))
    for stock, art in {"carrot": "carrot", "potato": "potato", "radish": "radish", "wheatsheaf": "wheat"}.items():
        for stage in (0, 1, 2):
            named.append((f"crop_{stock}_{stage}", extras.crop(art, stage)[0]))
    for stage in (0, 1, 2):
        named.append((f"crop_generic_{stage}", generic_crop(stage)))
    named.append(("crop_withered", withered()))
    for side, left in (("left", True), ("right", False)):
        named.append((f"sheep_{side}", area_farm.sheep(left)[0]))
        named.append((f"cattle_{side}", area_farm.cattle(left, patches=True)[0]))
        named.append((f"cattle_{side}_plain", area_farm.cattle(left, patches=False)[0]))
        named.append((f"hen_{side}", sprites.hen(left)[0]))
        named.append((f"hen_{side}_peck", sprites.hen(left, peck=True)[0]))
    for kind, grid in EMOTES.items():
        named.append((f"emote_{kind}", bubble(grid)))
    for name, grid in rig_export.CUES.items():
        named.append((name, bubble(grid)))
    named.append(("glow_window", glow(22, 20, [(4.5, 5, 0.5), (7, 7.5, 0.28), (10.5, 9.5, 0.14)])))
    named.append(("glow_lamp", glow(25, 25, [(2, 2, 0.55), (5, 5, 0.34), (8.5, 8.5, 0.18), (12, 12, 0.09)], (255, 190, 104))))
    for size in (0, 1, 2):
        named.append((f"smoke_{size}", smoke_puff(size)))
    for kind in ("white", "yellow", "blue"):
        for i, img in enumerate(critters.butterfly_frames(kind)):
            named.append((f"butterfly_{kind}_{i}", img))
    for prefix, frames in (("dragonfly", critters.dragonfly_frames()), ("bird", critters.bird_frames()),
                           ("leaf", critters.leaf_frames()), ("fish", critters.fish_jump_frames())):
        for i, img in enumerate(frames):
            named.append((f"{prefix}_{i}", img))
    named.append(("bird_shadow", critters.bird_shadow()))
    named.append(("firefly", critters.firefly_glow()))
    for seed in (0, 1):
        named.append((f"cloud_{seed}", critters.cloud_shadow(seed)))
    sheet, atlas_json = rig_export.atlas(named, "sprites.png")
    sheet.save(os.path.join(out, "sprites.png"))
    with open(os.path.join(out, "sprites.json"), "w") as fh:
        json.dump(atlas_json, fh, separators=(",", ":"))
    print("common ->", out, "|", len(named), "frames")


def export_characters(out_root):
    # The people are PixelLab art now (art/stackacres-td/pixellab/build.py), not the rig's. Loaded by path:
    # rich/ has its own `build` module.
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "pixellab_build", os.path.join(os.path.dirname(HERE), "pixellab", "build.py"))
    pixellab_build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pixellab_build)
    pixellab_build.OUT = os.path.join(out_root, "characters")
    pixellab_build.main()
    print("characters ->", pixellab_build.OUT)


def export_portraits(out_root):
    out = os.path.join(out_root, "portraits")
    os.makedirs(out, exist_ok=True)
    for name in characters.rig.CHARACTERS:
        for expression in portraits.EXPRESSIONS:
            portraits.portrait(name, expression).save(os.path.join(out, f"{name}-{expression}.png"))
    print("portraits ->", out)


def main():
    args = sys.argv[1:]
    out_root = os.path.join(rig_export.REPO, "public", "stackacres-td")
    if args[:1] == ["--out"]:
        out_root, args = args[1], args[2:]
    patch()
    for module in PLAYABLE + INTERIORS:
        if not args or module.__name__ in args:
            export_area(module, out_root)
    export_common(out_root)
    export_characters(out_root)
    export_portraits(out_root)


if __name__ == "__main__":
    main()
