#!/usr/bin/env python3
"""Composite LPC layered art into frames, without a browser.

The Universal LPC Spritesheet Character Generator is a web app: you pick layers in a page and it
composites them on a canvas. This reads the same source of truth it does (sheet_definitions/*.json
plus the PNGs under spritesheets/) and composites in Python, so a character is a dict in a script
and the whole cast rebuilds from the command line.

Point LPC_ROOT at the checkout (default ~/deps/lpc-generator).

One LPC layer file is <layer path><variant>/<animation>.png, 64x64 frames, four direction rows in
the order up, left, down, right. Layers draw in zPos order, which is why a hand goes over a sleeve
and a hat over hair.
"""
import json
import os
from collections import OrderedDict

from PIL import Image

ROOT = os.environ.get("LPC_ROOT", os.path.expanduser("~/deps/lpc-generator"))
DEFS = os.path.join(ROOT, "sheet_definitions")
SHEETS = os.path.join(ROOT, "spritesheets")
PALETTES = os.path.join(ROOT, "palette_definitions")

FRAME = 64
DIRS = ["up", "left", "down", "right"]

# Animation name -> the folder LPC stores it in. Names on the left are what a character asks for.
# watering reuses the thrust sheet (the generator does the same); the frame cycle is what differs.
FOLDERS = {"walk": "walk", "idle": "idle", "run": "run", "thrust": "thrust", "watering": "thrust",
           "slash": "slash", "shoot": "shoot", "hurt": "hurt", "emote": "emote", "sit": "sit",
           "jump": "jump", "spellcast": "spellcast", "combat": "combat_idle", "climb": "climb"}
# Which columns of a row make the animation, from the generator's ANIMATION_CONFIGS. A sheet holds
# every frame of its row; an animation is a cycle over them.
CYCLES = {"walk": [1, 2, 3, 4, 5, 6, 7, 8], "idle": [0, 1], "run": [0, 1, 2, 3, 4, 5, 6, 7],
          "thrust": [0, 1, 2, 3, 4, 5, 6, 7], "watering": [0, 1, 4, 4, 4, 5],
          "slash": [0, 1, 2, 3, 4, 5], "shoot": list(range(13)), "hurt": [0, 1, 2, 3, 4, 5],
          "emote": [0, 1, 2], "sit": [0, 1, 2], "jump": [0, 1, 2, 3, 4], "spellcast": [0, 1, 2, 3, 4, 5, 6],
          "combat": [0, 1], "climb": [0, 1, 2, 3, 4, 5]}
# Animations LPC draws once, facing the camera, instead of per direction.
SINGLE_ROW = {"hurt", "climb"}

# LPC keeps a few tools on 128x128 sheets because the swing leaves the 64px box: the axe chop and
# the fishing cast among them. Each output frame names a frame of a standard animation, which is
# where the body, the clothes and the hat come from while the tool comes from its own sheet.
# Copied from the generator's sources/custom-animations.ts.
CUSTOM = {
    "tool_axe": {"size": 128, "base": "slash", "from_single_animation": True,
                 "cols": [5, 5, 4, 4, 3, 1, 0, 0, 0, 0]},
    "tool_rod": {"size": 128, "base": "thrust", "from_single_animation": False,
                 "cols": [0, 1, 2, 3, 4, 5, 4, 4, 4, 5, 4, 2, 3]},
}

# Licenses that let a paid app on the App Store and Google Play ship the art: attribution only, no
# share-alike on our own work, no DRM clause. See the generator's README footnote about CC-BY-SA.
SAFE_LICENSES = ("CC0", "OGA-BY", "CC-BY 3.0", "CC-BY 4.0")


def _defs_index():
    """Every sheet definition by name and by path, e.g. "body/bodies" and "torso/aprons/overalls"."""
    out = {}
    for dirpath, _dirs, files in os.walk(DEFS):
        for f in files:
            if not f.endswith(".json") or f.startswith("meta_"):
                continue
            path = os.path.join(dirpath, f)
            rel = os.path.relpath(path, DEFS)[: -len(".json")]
            out[rel] = path
            out[f[: -len(".json")]] = path
    return out


INDEX = _defs_index()


def definition(item):
    """Load a sheet definition by the id a character uses: a bare name (tool_hoe) or a path."""
    if item not in INDEX:
        raise KeyError(f"no LPC sheet definition for {item!r}")
    with open(INDEX[item]) as fh:
        return json.load(fh)


def layers(item, variant, body="male", head=None):
    """The (zPos, sheet directory, custom animation) rows an item contributes for this body type.

    A face is drawn per head shape, so its path names the head (`head/faces/${head}/happy/`), and
    the definition's `replace_in_path` says which folder each head uses."""
    out = []
    d = definition(item)
    subs = {k: table.get(head) for k, table in d.get("replace_in_path", {}).items()}
    for key in sorted(k for k in d if k.startswith("layer_")):
        layer = d[key]
        base = layer.get(body) or layer.get("male")
        if not base:
            continue
        for k, v in subs.items():
            if "${" + k + "}" in base:
                if v is None:
                    raise KeyError(f"{item} has no {k} folder for head {head!r}")
                base = base.replace("${" + k + "}", v)
        out.append((layer["zPos"], base.rstrip("/"), layer.get("custom_animation")))
    return out


def has_variants(item):
    """True when LPC ships this item's colours as files. The rest are recoloured from a palette."""
    return bool(definition(item).get("variants"))


def sheet_path(rel, variant, folder):
    """Where LPC keeps one layer's sheet. An item with colour variants files them under the
    animation (walk/green.png); an item recoloured by palette has the animation alone (walk.png)."""
    if variant:
        return os.path.join(SHEETS, rel, folder, variant + ".png")
    return os.path.join(SHEETS, rel, folder + ".png")


def credits_for(item, used):
    """The credit rows of this item that cover the sheet directories actually drawn."""
    rows = []
    for row in definition(item).get("credits", []):
        f = row.get("file", "").rstrip("/")
        if any(rel == f or rel.startswith(f + "/") or f.startswith(rel) for rel in used):
            rows.append(row)
    return rows or definition(item).get("credits", [])


def ramp(material, name, base=None):
    """One colour ramp from LPC's palette files, paired with the ramp the art is actually drawn in
    (meta_<material>.json names it: white for cloth, light for skin, orange for hair)."""
    with open(os.path.join(PALETTES, material, f"{material}_ulpc.json")) as fh:
        table = json.load(fh)
    if base is None:
        with open(os.path.join(PALETTES, material, f"meta_{material}.json")) as fh:
            base = json.load(fh).get("base") or next(iter(table))
    if name not in table:
        raise KeyError(f"{material} has no {name!r} palette; try {sorted(table)}")
    return [_hex(c) for c in table[base]], [_hex(c) for c in table[name]]


def _hex(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def materials(item):
    """Which colour families this item can be recoloured in (body, hair, eye, cloth, metal, wood)."""
    rc = definition(item).get("recolors") or {}
    if "material" in rc:
        return {rc["material"]}
    return {v["material"] for v in rc.values() if isinstance(v, dict) and "material" in v}


_SHEETS = {}

# A face layer asked for as ("face_blush", "cheeks") draws only its rosy cheeks. LPC's blush face
# also closes the eyes, and at 31px closed eyes read as no eyes at all. The cheeks are painted a
# deeper rose first, since shrinking to 31px blends LPC's own peach back into the skin.
ONLY = {"cheeks": {(255, 140, 104): (232, 84, 96)}}


def sheet(path, mapping, only=None):
    """One layer sheet, recoloured, kept in memory: the same body walks for every character.
    `only` keeps just the pixels of those source colours, repainted as it says."""
    key = (path, tuple(sorted(mapping.items())), tuple(sorted((only or {}).items())))
    if key not in _SHEETS:
        img = Image.open(path).convert("RGBA")
        if only:
            px = img.load()
            for y in range(img.height):
                for x in range(img.width):
                    if px[x, y][3]:
                        swap = only.get(px[x, y][:3])
                        px[x, y] = (*swap, px[x, y][3]) if swap else (0, 0, 0, 0)
        _SHEETS[key] = recolor(img, mapping)
    return _SHEETS[key]


def recolor(img, mapping):
    if not mapping:
        return img
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a:
                hit = mapping.get((r, g, b))
                if hit:
                    px[x, y] = (*hit, a)
    return out


class Character:
    """A stack of LPC items. `items` is a list of (definition id, variant); order does not matter,
    zPos decides what covers what."""

    def __init__(self, items, body="male", palette=None):
        self.items = [(i[0], i[1]) for i in items]
        self.body = body
        self.palette = palette or {}   # material -> ramp name, e.g. {"body": "brown", "hair": "white"}
        self._maps = {}
        # The head's name as a face's `replace_in_path` spells it, e.g. "Human_Male".
        heads = [i for i, _v in self.items if i.startswith("heads_")]
        self.head = definition(heads[0])["name"].replace(" ", "_") if heads else None

    def _mapping(self, item, colour):
        """The colour swap for this layer: the character's skin, hair and eyes, plus this item's own
        colour when LPC recolours it from a palette instead of shipping a file per colour."""
        key = (item, colour)
        if key not in self._maps:
            table = {}
            mats = materials(item)
            for m in mats & set(self.palette):
                src, dst = ramp(m, self.palette[m])
                table.update(dict(zip(src, dst)))
            if colour and colour not in ONLY and not has_variants(item):
                for m in mats - {"body", "eye"}:
                    src, dst = ramp(m, colour)
                    table.update(dict(zip(src, dst)))
            self._maps[key] = table
        return self._maps[key]

    def _stack(self, animation):
        folder = FOLDERS[animation]
        drawn, missing = [], []
        for item, colour in self.items:
            variant = colour if has_variants(item) else None
            for z, rel, custom in layers(item, colour, self.body, self.head):
                if custom:
                    missing.append((item, rel, "custom animation, not composited"))
                    continue
                path = sheet_path(rel, variant, folder)
                if os.path.exists(path):
                    drawn.append((z, path, item, colour, False))
                    continue
                # Most clothes are drawn for the six original LPC animations only, so an apron has
                # no idle or run sheet. Hold its standing pose (walk, first column) rather than
                # letting the garment blink off the character.
                stand = sheet_path(rel, variant, "walk")
                if os.path.exists(stand):
                    drawn.append((z, stand, item, colour, True))
                else:
                    missing.append((item, os.path.relpath(path, SHEETS)))
        drawn.sort(key=lambda t: t[0])
        return drawn, missing

    def frames(self, animation, direction):
        """One list of 64x64 RGBA frames, composited, in the animation's cycle order."""
        drawn, _ = self._stack(animation)
        if not drawn:
            raise ValueError(f"nothing to draw for {animation}")
        row = 0 if animation in SINGLE_ROW else DIRS.index(direction)
        out = []
        sheets = {p: sheet(p, self._mapping(item, colour), ONLY.get(colour)) for _z, p, item, colour, _s in drawn}
        width = min(im.width for _z, p, _i, _c, stand in drawn if not stand
                    for im in [sheets[p]]) if any(not d[4] for d in drawn) else FRAME
        for col in CYCLES[animation]:
            if (col + 1) * FRAME > width:
                continue
            frame = Image.new("RGBA", (FRAME, FRAME))
            for _z, path, _item, _colour, stand in drawn:
                at = 0 if stand else col
                box = (at * FRAME, row * FRAME, (at + 1) * FRAME, (row + 1) * FRAME)
                if box[3] > sheets[path].height or box[2] > sheets[path].width:
                    continue
                frame.alpha_composite(sheets[path].crop(box))
            out.append(frame)
        return out

    def custom_frames(self, name, direction):
        """Frames of one of LPC's oversize tool animations (CUSTOM): the tool comes from its own
        128px sheet, everyone else from the standard animation the tool was drawn over."""
        spec = CUSTOM[name]
        size, row = spec["size"], DIRS.index(direction)
        drawn = []
        for item, colour in self.items:
            variant = colour if has_variants(item) else None
            for z, rel, custom in layers(item, colour, self.body, self.head):
                if custom and custom != name:
                    continue
                path = (os.path.join(SHEETS, rel + ".png") if custom
                        else sheet_path(rel, variant, FOLDERS[spec["base"]]))
                stand = False
                if not os.path.exists(path) and not custom:
                    path, stand = sheet_path(rel, variant, "walk"), True
                if os.path.exists(path):
                    drawn.append((z, path, item, colour, bool(custom), stand))
        drawn.sort(key=lambda t: t[0])
        out = []
        for j, col in enumerate(spec["cols"]):
            frame = Image.new("RGBA", (size, size))
            for _z, path, item, colour, is_tool, stand in drawn:
                img = sheet(path, self._mapping(item, colour), ONLY.get(colour))
                if is_tool:
                    step = img.height // 4
                    x = (col if spec["from_single_animation"] else j) * step
                else:
                    step, x = FRAME, (0 if stand else col) * FRAME
                box = (x, row * step, x + step, row * step + step)
                if box[2] > img.width or box[3] > img.height:
                    continue
                frame.alpha_composite(img.crop(box), ((size - step) // 2, (size - step) // 2))
            out.append(frame)
        return out

    def report(self, animations):
        """What each animation could draw, so a wardrobe gap shows up as text and not as a hole."""
        for a in animations:
            drawn, missing = self._stack(a)
            held = [d[2] for d in drawn if d[4]]
            print(f"  {a:9s} {len(drawn)} layers"
                  + (f", standing pose held for {held}" if held else "")
                  + (f", skipped {missing}" if missing else ""))

    def credits(self):
        """Attribution rows for everything this character draws, de-duplicated."""
        used = {}
        for item, variant in self.items:
            used.setdefault(item, set()).update(rel for _z, rel, _c in layers(item, variant, self.body, self.head))
        rows = OrderedDict()
        for item, rels in used.items():
            for row in credits_for(item, rels):
                rows[(row.get("file"), tuple(row.get("authors", [])))] = row
        return list(rows.values())

    def license_problems(self):
        """Credit rows with no license that survives an app-store release."""
        bad = []
        for row in self.credits():
            got = row.get("licenses", [])
            if not any(any(g.startswith(s) for s in SAFE_LICENSES) for g in got):
                bad.append((row.get("file"), got))
        return bad


def strip(frames, scale=1, pad=2):
    """Frames laid out left to right, for a look at an animation without a GIF."""
    w = FRAME * scale + pad
    out = Image.new("RGBA", (w * len(frames) - pad, FRAME * scale))
    for i, f in enumerate(frames):
        out.alpha_composite(f.resize((FRAME * scale, FRAME * scale), Image.NEAREST), (i * w, 0))
    return out


def gif(frames, path, scale=4, ms=100):
    big = [f.resize((FRAME * scale, FRAME * scale), Image.NEAREST) for f in frames]
    flat = []
    for f in big:
        bg = Image.new("RGBA", f.size, (255, 255, 255, 255))
        bg.alpha_composite(f)
        flat.append(bg.convert("P", palette=Image.ADAPTIVE))
    flat[0].save(path, save_all=True, append_images=flat[1:], duration=ms, loop=0, disposal=2)


def shrink(img, height, filt=Image.LANCZOS):
    """LPC draws people 50px tall; StackAcres draws them 31px. Resize on premultiplied alpha and
    re-threshold, or straight RGBA bleeds transparent black into the outline."""
    if img.height == height:
        return img
    pre = Image.new("RGBA", img.size)
    src, dst = img.load(), pre.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = src[x, y]
            dst[x, y] = (r * a // 255, g * a // 255, b * a // 255, a)
    k = height / img.height
    small = pre.resize((max(1, round(img.width * k)), height), filt)
    out = Image.new("RGBA", small.size)
    sp, op = small.load(), out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = sp[x, y]
            op[x, y] = (0, 0, 0, 0) if a < 115 else (min(255, r * 255 // a), min(255, g * 255 // a),
                                                     min(255, b * 255 // a), 255)
    return out


def cutout(frame):
    """A frame trimmed to what is drawn, so sprites of different sizes can be placed by the feet."""
    bb = frame.getbbox()
    return frame.crop(bb) if bb else frame
