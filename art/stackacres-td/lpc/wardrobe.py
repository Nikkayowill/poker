#!/usr/bin/env python3
"""The wardrobe: the art the game bakes a player's farmer from.

The shipped farmer is one sheet made by build.py: LPC layers composited at 64px (128px for the
overhead swings), shrunk to 31px tall, placed in a 48px frame, then cut to a 48-colour palette.
A look picked at the mirror has to come out exactly the way build.py would have made it, and a
shrink of each layer on its own does not (the seams between layers blend differently), so the game
bakes the sheet the same way: composite at full size, then shrink. `lib/stackacres/wardrobe/bake.ts`
is that bake, in TypeScript, bit-exact with Pillow.

What this writes, all into public/stackacres-td/wardrobe/:

- `catalogue.json`: what the mirror offers (items, colours, prices, today's farmer as the default).
- `bake.json`: what the baker needs. Every source frame build.py shrinks is a "slot" (its size,
  where it lands in the 48px frame, whether the body is bent over for the harvest), the program
  that turns slots into the 192 frames of farmer.json, the colour ramps, and for every layer the
  crop it draws in each slot.
- `layers/*.png`: those crops, one atlas per LPC layer, in LPC's own uncoloured ramps. The baker
  recolours them for the look.

The crops come from build.py itself: `frames_for` is run with every layer but one blanked and
`place` recording what it would have shrunk, so the slots can never drift from the cast's sheet.
It also writes the golden sheets the baker's tests compare against, made the ordinary way.

    python3 wardrobe.py           # catalogue, bake data, layers, credits, test goldens
"""
import hashlib
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageChops

import build
import cast
import hoe_head
import lpc
import wardrobe_items as W

REPO = build.REPO
OUT = os.path.join(REPO, "public", "stackacres-td", "wardrobe")
FIXTURES = os.path.join(REPO, "lib", "stackacres", "wardrobe", "__fixtures__")
NAME = "__wardrobe__"
# The animations (and the last column of each) that build.py's frames read. An item missing any of
# them would be held on its standing pose or drop out, and its crops would then depend on what else
# is worn, which the baker cannot know. So every catalogue item must have all of them.
NEED = {"walk": 8, "idle": 1, "thrust": 5, "slash": 5, "shoot": 7, "hurt": 2}
# Gaps the shipped farmer already has. LPC's blush has no hurt sheet, so the cheeks are held on the
# walk's back view for the harvest bend (lpc.py does that per layer, whatever else is worn).
ALLOWED_GAPS = {("face_blush", "hurt")}
ATLAS_WIDTH = 512


# --- looks as lpc characters -----------------------------------------------------------------------

def ramp_name(colour_id):
    return colour_id.split(":", 1)[1] if colour_id else None


def character_spec(look):
    """A look as a cast.py-style spec: items in stacking order, the body type, the palette."""
    body = W.BODIES[look["body"]]
    picks = look["picks"]
    items = [("body/body", None), (body["head"], None), ("face_blush", "cheeks")]
    for slot in W.STACK:
        item, colour = picks[slot]["item"], picks[slot]["colour"]
        if item is None:
            continue
        how = how_of(item)
        items.append((item, ramp_name(colour) if how == "cloth" else None))
    palette = {"body": ramp_name(picks["skin"]["colour"]), "eye": ramp_name(picks["eyes"]["colour"]),
               "hair": ramp_name(picks["hair"]["colour"])}
    return dict(items=items, body=body["body"], palette=palette)


def how_of(item):
    return next(how for _s, i, _l, how, _p in W.ITEMS if i == item)


# --- capture: build.py's frames, one layer at a time ------------------------------------------------

REAL = dict(sheet=lpc.sheet, place=build.place, bent=build.bent, undipped=build.undipped,
            stepped=build.stepped, shifted=build.shifted, custom=lpc.Character.custom_frames)


def marker(**info):
    m = Image.new("RGBA", (build.SIZE, build.SIZE))
    m.info.update(info)
    return m


def capture(spec, keep, hoe_target=None):
    """Run build.frames_for for `spec` with only the sheets `keep(path)` accepts drawn, uncoloured.

    Returns (records, blocks): one record per frame build.py would shrink (the full-size frame, its
    height and ground, the harvest bend), and the sheet's blocks with markers naming those records.
    `hoe_target` ("bg" or "fg") captures that pickaxe layer through the hoe edit, which needs both
    pickaxe layers at once."""
    records = []
    state = {"hoe": False}

    def sheet(path, mapping, only=None):
        img = REAL["sheet"](path, {}, only)
        if keep(path) or (state["hoe"] and hoe_target and "/tools/pickaxe/" in path):
            return img
        return Image.new("RGBA", img.size)

    def place(frame, height, ground=build.GROUND):
        records.append(dict(frame=frame.copy(), height=height, ground=tuple(ground),
                            bent=frame.info.get("bent")))
        return marker(slot=len(records) - 1)

    def bent(frame, drop, lean, facing):
        out = frame.copy()
        if drop or lean:
            out.info["bent"] = (drop, -lean if facing == "left" else lean)
        return out

    def stepped(walk, stand):
        return [marker(slot=f.info["slot"], stand=stand.info["slot"]) for f in walk]

    def shifted(img, dy):
        return marker(**img.info, hop=dy)

    def custom(self, name, direction, tool_edit=None):
        if tool_edit is None:
            return REAL["custom"](self, name, direction)

        def edit(bg, fg, d):
            bg2, fg2 = tool_edit(bg, fg, d)
            blank = Image.new("RGBA", bg2.size)
            return (bg2 if hoe_target == "bg" else blank), (fg2 if hoe_target == "fg" else blank)
        state["hoe"] = True
        try:
            return REAL["custom"](self, name, direction, edit if hoe_target else tool_edit)
        finally:
            state["hoe"] = False

    cast.CAST[NAME] = spec
    build.STRIDES.add(NAME)
    build.SWINGERS.add(NAME)
    lpc.sheet, build.place, build.bent = sheet, place, bent
    build.undipped, build.stepped, build.shifted = (lambda walk: walk), stepped, shifted
    lpc.Character.custom_frames = custom
    try:
        blocks = build.frames_for(NAME, cast.TARGET_HEIGHT)
    finally:
        lpc.sheet, build.place, build.bent = REAL["sheet"], REAL["place"], REAL["bent"]
        build.undipped, build.stepped, build.shifted = REAL["undipped"], REAL["stepped"], REAL["shifted"]
        lpc.Character.custom_frames = REAL["custom"]
        del cast.CAST[NAME]
    return records, blocks


def under(rel):
    base = os.path.join(lpc.SHEETS, rel)
    return lambda path: path == base + ".png" or path.startswith(base + "/")


# --- checks ------------------------------------------------------------------------------------------

def check_item(item, body_type, head, variant):
    """Every layer of the item has every animation build.py reads, wide enough, and a safe licence."""
    problems = []
    rels = set()
    for _z, rel, custom in lpc.layers(item, variant, body_type, lpc.definition(head)["name"].replace(" ", "_")):
        rels.add(rel)
        if custom:
            continue
        for folder, col in NEED.items():
            path = lpc.sheet_path(rel, variant, folder)
            if not os.path.exists(path):
                if (item, folder) in ALLOWED_GAPS:
                    continue
                problems.append(f"{item} ({body_type}) has no {folder}: {os.path.relpath(path, lpc.SHEETS)}")
            elif Image.open(path).width < (col + 1) * lpc.FRAME:
                problems.append(f"{item} ({body_type}) {folder} is too short")
    for row in lpc.credits_for(item, rels):
        if not any(any(g.startswith(s) for s in lpc.SAFE_LICENSES) for g in row.get("licenses", [])):
            problems.append(f"{item}: {row.get('file')} is share-alike only {row.get('licenses')}")
    return problems


def ramp_table(material):
    with open(os.path.join(lpc.PALETTES, material, f"{material}_ulpc.json")) as fh:
        table = json.load(fh)
    with open(os.path.join(lpc.PALETTES, material, f"meta_{material}.json")) as fh:
        base = json.load(fh)["base"]
    return base, {k: [lpc._hex(c) for c in v] for k, v in table.items()}


# --- atlases -----------------------------------------------------------------------------------------

def normalized(img):
    """Transparent pixels as 0,0,0,0: nothing downstream reads their colour, and it packs smaller."""
    a = np.asarray(img).copy()
    a[a[..., 3] == 0] = 0
    return Image.fromarray(a, "RGBA")


def atlas_from(records):
    """The crops one layer draws: unique trimmed crops, and per slot [crop, x, y] or null."""
    crops, index, slots = [], {}, []
    for rec in records:
        img = normalized(rec["frame"])
        box = img.getbbox()
        if not box:
            slots.append(None)
            continue
        crop = img.crop(box)
        key = hashlib.sha1(crop.tobytes() + repr(crop.size).encode()).hexdigest()
        if key not in index:
            index[key] = len(crops)
            crops.append(crop)
        slots.append([index[key], box[0], box[1]])
    return crops, slots


def pack(crops):
    """Shelf-pack crops into one image. Returns the image and each crop's [x, y, w, h]."""
    order = sorted(range(len(crops)), key=lambda i: (-crops[i].height, -crops[i].width, i))
    x = y = row_h = 0
    at = [None] * len(crops)
    for i in order:
        w, h = crops[i].size
        if x + w > ATLAS_WIDTH:
            x, y, row_h = 0, y + row_h, 0
        at[i] = [x, y, w, h]
        x += w
        row_h = max(row_h, h)
    sheet = Image.new("RGBA", (ATLAS_WIDTH, max(1, y + row_h)))
    for i, crop in enumerate(crops):
        sheet.paste(crop, tuple(at[i][:2]))
    return sheet, at


def save_png(img, path):
    """RGBA art saved as a palette PNG when it has 256 colours or fewer (every LPC layer does), with
    per-index alpha, else as RGBA. Lossless either way."""
    a = np.asarray(img)
    flat = a.reshape(-1, 4)
    colours, inverse = np.unique(flat.view(np.uint32).reshape(-1), return_inverse=True)
    if len(colours) <= 256:
        rgba = colours.view(np.uint8).reshape(-1, 4)
        p = Image.fromarray(inverse.reshape(a.shape[:2]).astype(np.uint8), "P")
        p.putpalette(rgba[:, :3].reshape(-1).tolist())
        p.save(path, transparency=bytes(rgba[:, 3].tolist()), optimize=True)
        back = np.asarray(Image.open(path).convert("RGBA"))
        assert np.array_equal(back, a), path
    else:
        img.save(path, optimize=True)


# --- the whole thing ---------------------------------------------------------------------------------

def main():
    shutil.rmtree(os.path.join(OUT, "layers"), ignore_errors=True)
    os.makedirs(os.path.join(OUT, "layers"), exist_ok=True)
    ramps = {m: ramp_table(m) for m in ("body", "eye", "hair", "cloth")}
    problems = []

    # Colours, by palette.
    colours = {}
    for material, offered in (("body", W.SKIN), ("eye", W.EYES), ("hair", W.HAIR), ("cloth", W.CLOTH)):
        _base, table = ramps[material]
        pick = {"eye": 1, "body": 3}.get(material, 4)
        for name, label in offered:
            r, g, b = table[name][pick]
            colours[f"{W.PREFIX[material]}:{name}"] = {"id": f"{W.PREFIX[material]}:{name}", "label": label,
                                                       "swatch": f"#{r:02x}{g:02x}{b:02x}"}

    # Layers per item per body, and which colours each item really comes in.
    layer_jobs = {}    # atlas key -> (spec items, body type, keep path, hoe target)
    items_out, bake_items = [], {}
    for slot, item, label, how, price in W.ITEMS:
        bodies = W.ONLY_ON.get(item, W.BOTH)
        entry = {"bodies": {}}
        if how in ("skin", "eyes"):
            ids = [f"{'skin' if how == 'skin' else 'eye'}:{n}" for n, _l in (W.SKIN if how == "skin" else W.EYES)]
            items_out.append(dict(id=item, slot=slot, label=label, bodies=list(bodies), colours=ids, price=price))
            continue
        d = lpc.definition(item)
        variants = d.get("variants") or []
        if how == "cloth":
            offered = [n for n, _l in W.CLOTH if not variants or n in variants]
            first = W.FIRST.get(item, offered[0])
            offered = [first] + [c for c in offered if c != first]
            ids = [f"cloth:{c}" for c in offered]
        elif how == "hair":
            first = W.DEFAULT_LOOK["picks"]["hair"][1]
            ids = [first] + [f"hair:{n}" for n, _l in W.HAIR if f"hair:{n}" != first]
            offered = []
        else:
            ids, offered = [], []
        mats = sorted(lpc.materials(item))
        # The same colour swap lpc.Character._mapping makes: skin, eyes and hair from the look, then
        # the item's own colour. An item LPC ships as colour files is one atlas per colour instead.
        recolour = []
        for m in mats:
            if m in ("body", "eye", "hair"):
                recolour.append({"material": m, "from": ramps[m][0], "to": {"body": "skin", "eye": "eyes", "hair": "hair"}[m]})
        if how == "cloth" and not variants:
            for m in mats:
                if m not in ("body", "eye"):
                    recolour.append({"material": m, "from": ramps[m][0], "to": "item"})
        sources = [ramps[r["material"]][1][r["from"]] for r in recolour]
        flat = [c for src in sources for c in src]
        if len(flat) != len(set(flat)):
            problems.append(f"{item}: ramps overlap, recolour order would matter")
        for body_name in bodies:
            body_type = W.BODIES[body_name]["body"]
            head = W.BODIES[body_name]["head"]
            for colour in (offered if variants else [None]):
                problems += check_item(item, body_type, head, colour)
            layers = []
            for z, rel, _custom in lpc.layers(item, None, body_type, None):
                base = rel.replace("/", "_")
                if variants:
                    by = {}
                    for colour in offered:
                        layer_jobs.setdefault(f"{base}__{colour}", (item, colour, body_name, rel))
                        by[f"cloth:{colour}"] = f"{base}__{colour}"
                    layers.append({"z": z, "byColour": by})
                else:
                    layer_jobs.setdefault(base, (item, None, body_name, rel))
                    layers.append({"z": z, "atlas": base})
            entry["bodies"][body_name] = layers
        entry["recolour"] = recolour
        bake_items[item] = entry
        items_out.append(dict(id=item, slot=slot, label=label, bodies=list(bodies), colours=ids, price=price))

    # The bodies: body, head and cheeks, and the tools every body carries.
    bake_bodies = {}
    for body_name, b in W.BODIES.items():
        head_name = lpc.definition(b["head"])["name"].replace(" ", "_")
        fixed = []
        for item, colour in (("body/body", None), (b["head"], None), ("face_blush", "cheeks")):
            problems += check_item(item, b["body"], b["head"], None)
            recolour = [{"material": m, "from": ramps[m][0], "to": {"body": "skin", "eye": "eyes"}[m]}
                        for m in sorted(lpc.materials(item))]
            for z, rel, _c in lpc.layers(item, None, b["body"], head_name):
                key = rel.replace("/", "_")
                fixed.append({"z": z, "atlas": key, "recolour": recolour})
                layer_jobs.setdefault(key, (item, colour, body_name, rel))
        tools = []
        for tool in W.TOOLS:
            for z, rel, _c in lpc.layers(tool, None, b["body"], head_name):
                key = rel.replace("/", "_")
                tools.append({"z": z, "atlas": key})
                layer_jobs.setdefault(key, (tool, None, body_name, rel))
        bake_bodies[body_name] = {"fixed": fixed, "tools": tools}

    if problems:
        print("\n".join(problems))
        sys.exit(1)

    # Capture every layer.
    default_spec = character_spec(_look(W.DEFAULT_LOOK))
    atlases, program, slots = {}, None, None
    for key, (item, colour, body_name, rel) in sorted(layer_jobs.items()):
        body_type = W.BODIES[body_name]["body"]
        spec = dict(items=[("body/body", None), (W.BODIES[body_name]["head"], None), ("face_blush", "cheeks")],
                    body=body_type, palette={})
        if item not in W.TOOLS and item not in [i for i, _c in spec["items"]]:
            spec["items"].append((item, colour))
        hoe = None
        if item == "tool_pickaxe" and rel.endswith(("/bg", "/fg")):
            hoe = rel.rsplit("/", 1)[1]
        records, blocks = capture(spec, under(rel), hoe)
        if slots is None:
            slots = [slot_of(r) for r in records]
            program = program_of(blocks)
        assert [slot_of(r) for r in records] == slots, key
        crops, per_slot = atlas_from(records)
        if not crops:
            atlases[key] = None
            continue
        sheet, at = pack(crops)
        path = os.path.join(OUT, "layers", key + ".png")
        save_png(sheet, path)
        atlases[key] = {"file": f"layers/{key}.png", "size": list(sheet.size), "crops": at, "slots": per_slot}
        print(f"  {key:60s} {len(crops):3d} crops {os.path.getsize(path):6d} B")

    # Drop layers that never draw (the pickaxe as carried, the bow's 128px walk).
    lists = [layers for entry in bake_items.values() for layers in entry["bodies"].values()]
    lists += [b[part] for b in bake_bodies.values() for part in ("fixed", "tools")]
    for layers in lists:
        for l in layers:
            if "byColour" in l:
                l["byColour"] = {c: k for c, k in l["byColour"].items() if atlases.get(k)}
        layers[:] = [l for l in layers if atlases.get(l.get("atlas")) or l.get("byColour")]
    for k in [k for k, v in atlases.items() if v is None]:
        del atlases[k]

    # Slots every layer draws the same in are one slot.
    canon, remap = {}, []
    for s, recipe in enumerate(slots):
        sig = json.dumps([recipe] + [a["slots"][s] for _k, a in sorted(atlases.items())])
        remap.append(canon.setdefault(sig, len(canon)))
    keep_slots = sorted(set(remap), key=remap.index)
    first_of = {c: remap.index(c) for c in keep_slots}
    slots = [slots[first_of[c]] for c in range(len(canon))]
    for a in atlases.values():
        a["slots"] = [a["slots"][first_of[c]] for c in range(len(canon))]
    for block in program:
        block["frames"] = [remap[f] for f in block["frames"]]
        if block.get("stand") is not None:
            block["stand"] = remap[block["stand"]]

    # Colours of one LPC item share their crops' geometry: store it once as a layout.
    layouts = {}
    for a in atlases.values():
        geometry = {"size": a.pop("size"), "crops": a.pop("crops"), "slots": a.pop("slots")}
        lid = hashlib.sha1(json.dumps(geometry).encode()).hexdigest()[:10]
        layouts[lid] = geometry
        a["layout"] = lid

    look = _look(W.DEFAULT_LOOK)
    catalogue = {"version": 1, "items": items_out, "colours": colours, "defaultLook": look}
    bake = {
        "version": 1,
        "frame": build.SIZE, "columns": build.COLS, "colours": build.COLOURS, "key": list(build.KEY),
        "waist": build.WAIST, "feet": [build.FEET_X, build.FEET_Y], "hop": build.HOP, "lift": list(build.LIFT),
        "stack": W.STACK,
        "ramps": used_ramps(ramps, colours, bake_items, bake_bodies),
        "colourRamps": {cid: {"material": {"skin": "body", "eye": "eye", "hair": "hair", "cloth": "cloth"}[cid.split(":")[0]],
                              "ramp": ramp_name(cid)} for cid in colours},
        "slots": slots, "program": program, "bodies": bake_bodies, "items": bake_items, "atlases": atlases,
        "layouts": layouts,
    }
    with open(os.path.join(OUT, "catalogue.json"), "w") as fh:
        json.dump(catalogue, fh, indent=1)
        fh.write("\n")
    with open(os.path.join(OUT, "bake.json"), "w") as fh:
        json.dump(bake, fh, separators=(",", ":"))
    print(f"{len(slots)} slots, {len(atlases)} layer atlases, {len(layouts)} layouts, {len(items_out)} items")

    authors, licences = build.credits([n for n in cast.CAST if n not in cast.ODD_ONES])
    print(f"credits: {len(authors)} artists")
    goldens(default_spec)


def used_ramps(ramps, colours, bake_items, bake_bodies):
    """The ramps the baker can reach: every offered colour and every ramp a layer is drawn in."""
    want = {(c.split(":")[0], c.split(":", 1)[1]) for c in colours}
    want = {({"skin": "body"}.get(m, m), r) for m, r in want}
    recolours = [r for e in bake_items.values() for r in e["recolour"]]
    recolours += [r for b in bake_bodies.values() for l in b["fixed"] for r in l["recolour"]]
    want |= {(r["material"], r["from"]) for r in recolours}
    out = {}
    for m, name in sorted(want):
        out.setdefault(m, {})[name] = [list(c) for c in ramps[m][1][name]]
    return out


def _look(raw):
    return {"body": raw["body"], "picks": {s: {"item": i, "colour": c} for s, (i, c) in raw["picks"].items()}}


def slot_of(rec):
    """Where a captured frame goes: its size, the bend, the shrink and the paste into 48x48."""
    frame, height, ground = rec["frame"], rec["height"], rec["ground"]
    k = height / build.LPC_HEIGHT
    h = max(1, round(frame.height * k))
    w = max(1, round(frame.width * (h / frame.height)))
    x = build.FEET_X - round(ground[0] * k)
    y = build.FEET_Y + 1 - round(ground[1] * k)
    return {"size": frame.width, "bent": list(rec["bent"]) if rec["bent"] else None,
            "shrink": [w, h], "at": [x, y]}


def program_of(blocks):
    """build.frames_for's blocks as the baker's program: which slot each frame of the sheet is, and
    for the eight-frame walk, the stand its legs are posed from and the hop."""
    out = []
    for action, d, imgs, holds in blocks:
        block = {"tag": action, "dir": d, "frames": [m.info["slot"] for m in imgs], "durations": holds}
        if action == "stride":
            block["stride"] = True
            block["stand"] = imgs[0].info.get("stand")
            assert [m.info["hop"] for m in imgs] == build.HOP
        out.append(block)
    return out


# --- goldens -------------------------------------------------------------------------------------------

# Looks the baker's tests bake and compare with build.py's own output for the same clothes.
GOLDEN_LOOKS = {
    "female-ponytail": {"body": "female", "picks": {
        "skin": ("skin", "skin:brown"), "eyes": ("eyes", "eye:brown"),
        "hair": ("hair_high_ponytail", "hair:black"), "hat": ("hat_bandana", "cloth:red"),
        "top": ("torso_clothes_tshirt", "cloth:yellow"), "over": ("torso_aprons_suspenders", "cloth:walnut"),
        "bottom": ("legs_skirts_plain", "cloth:teal"), "shoes": ("feet_shoes_basic", "cloth:brown"),
        "face": ("facial_glasses", "cloth:blue")}},
    "male-bare": {"body": "male", "picks": {
        "skin": ("skin", "skin:black"), "eyes": ("eyes", "eye:green"),
        "hair": ("hair_afro", "hair:dark_brown"), "hat": (None, None),
        "top": ("torso_clothes_longsleeve2_polo", "cloth:sky"), "over": (None, None),
        "bottom": ("legs_shorts", "cloth:navy"), "shoes": ("feet_sandals", "cloth:tan"),
        "face": ("beards_trimmed", None)}},
    "male-cavalier": {"body": "male", "picks": {
        "skin": ("skin", "skin:olive"), "eyes": ("eyes", "eye:gray"),
        "hair": ("hair_braid", "hair:ginger"), "hat": ("hat_cap_cavalier", "cloth:purple"),
        "top": ("torso_clothes_longsleeve2_cardigan", "cloth:white"), "over": ("torso_aprons_overalls", "cloth:maroon"),
        "bottom": ("legs_cuffed", "cloth:gray"), "shoes": ("feet_boots_revised", "cloth:black"),
        "face": ("facial_glasses_halfmoon", "cloth:gray")}},
}


def goldens(default_spec):
    """build.py's sheet for each golden look, written the way write() writes the cast's, plus the
    looks as JSON. The default look is checked against the shipped farmer.png here too."""
    os.makedirs(FIXTURES, exist_ok=True)
    looks = {}
    real_out = build.OUT
    for name, raw in [("default", W.DEFAULT_LOOK)] + list(GOLDEN_LOOKS.items()):
        look = _look(raw)
        spec = character_spec(look)
        # A variant item's colour is LPC's own file here, not the baker's recoloured base.
        cast.CAST[NAME] = spec
        build.STRIDES.add(NAME)
        build.SWINGERS.add(NAME)
        try:
            build.OUT = FIXTURES
            build.write(NAME, build.frames_for(NAME, cast.TARGET_HEIGHT))
        finally:
            build.OUT = real_out
            del cast.CAST[NAME]
        png, js = os.path.join(FIXTURES, NAME + ".png"), os.path.join(FIXTURES, NAME + ".json")
        os.remove(js)
        if name == "default":
            shipped = Image.open(os.path.join(build.OUT, "farmer.png")).convert("RGBA")
            ours = Image.open(png).convert("RGBA")
            assert ImageChops.difference(shipped, ours).getbbox() is None, "default look != farmer.png"
            os.remove(png)
        else:
            os.replace(png, os.path.join(FIXTURES, f"{name}.png"))
        looks[name] = look
    with open(os.path.join(FIXTURES, "looks.json"), "w") as fh:
        json.dump(looks, fh, indent=1)
        fh.write("\n")
    print("goldens:", ", ".join(looks))


if __name__ == "__main__":
    main()
