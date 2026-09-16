#!/usr/bin/env python3
"""Contact sheets of every sprite, on grass at 3x, for looking at. Writes areas/sheets/*.png."""
import os
import sys

from PIL import Image

import area
import creatures
import crops
import kit
import people
import props

RIG = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(RIG), "sheets")
SCALE = 3

PROPS = [
    ("brambles", props.brambles), ("rockfall", props.rockfall), ("hedge_overgrown", props.hedge_overgrown),
    ("boardwalk_washed", props.boardwalk_washed), ("fallen_fence", props.fallen_fence),
    ("scarecrow", props.scarecrow), ("shed_old", props.shed_old), ("wild_growth", props.wild_growth),
    ("plough", props.plough), ("canopy", props.canopy), ("hedge", lambda: props.hedge(48)),
    ("cattle_shed", props.cattle_shed), ("hitching_post", props.hitching_post),
    ("stall_fish", lambda: props.stall("R", "fish")), ("stall_fruit", lambda: props.stall("L", "fruit")),
    ("stall_bread", lambda: props.stall("v", "bread")), ("stall_cloth", lambda: props.stall("o", "cloth")),
    ("pier", lambda: props.pier(60)), ("boat", props.boat), ("lamppost", props.lamppost),
    ("lobster_trap", props.lobster_trap), ("buoy", props.buoy), ("driftwood", props.driftwood),
    ("fish_rack", props.fish_rack), ("oak_tree", props.oak_tree), ("mural", props.mural),
    ("beehive", props.beehive), ("mushrooms", props.mushrooms), ("log_bench", props.log_bench),
    ("standing_stone", props.standing_stone), ("cliff", lambda: props.cliff(64)), ("cave_mouth", props.cave_mouth),
    ("rails", lambda: props.rails(36)), ("mine_cart", props.mine_cart), ("lantern_post", props.lantern_post),
    ("tent", props.tent), ("campfire", lambda: props.campfire_lit()[0]), ("ore_rock", props.ore_rock),
    ("warning_sign", props.warning_sign), ("townhouse_store", lambda: props.townhouse("store")),
    ("townhouse_inn", lambda: props.townhouse("inn")), ("townhouse_bakery", lambda: props.townhouse("bakery")),
    ("townhouse_hall", lambda: props.townhouse("hall")), ("fountain", props.fountain),
    ("notice_board", props.notice_board), ("bench", props.bench), ("planter", props.planter),
    ("beacon", props.beacon), ("market_cart", props.market_cart), ("bridge", lambda: props.bridge(32)),
    ("waterfall", lambda: props.waterfall(40)[0]), ("smoke", lambda: props.smoke()[0]), ("puddle", props.puddle),
]
CREATURES = [
    ("sheep", creatures.sheep), ("cattle", creatures.cattle), ("cattle_plain", lambda: creatures.cattle(patches=False)),
    ("coyote", creatures.coyote), ("wolf", creatures.wolf), ("bear", creatures.bear),
    ("squirrel", creatures.squirrel), ("bird", creatures.bird), ("seagull", creatures.seagull), ("fish", creatures.fish),
]
CROPS = [(f"{name}_{stage}", (lambda n=name, s=stage: crops.crop(n, s))) for name in crops.NAMES for stage in (0, 1, 2)]


def to_image(made):
    sprite, anchor = made
    return (sprite.image() if isinstance(sprite, kit.Sprite) else sprite), anchor


def sheet(entries, cols, cell=None, material=None):
    imgs = [(name, *to_image(fn())) for name, fn in entries]
    cw = cell or max(i.width for _, i, _ in imgs) + 12
    ch = cell or max(i.height for _, i, _ in imgs) + 12
    rows = (len(imgs) + cols - 1) // cols
    tw, th = cols * cw // kit.T + 1, rows * ch // kit.T + 1
    verts = {material: {(x, y) for x in range(tw + 1) for y in range(th + 1)}} if material else {}
    out = kit.render_terrain(tw, th, verts).crop((0, 0, cols * cw, rows * ch))
    for i, (name, img, (ax, ay)) in enumerate(imgs):
        x, y = (i % cols) * cw + cw // 2, (i // cols) * ch + ch - 6
        out.alpha_composite(img, (max(0, x - ax), max(0, y - ay)))
    return out.resize((out.width * SCALE, out.height * SCALE), Image.NEAREST), [n for n, _, _ in imgs]


def lineup(names, scale=4, gap=14):
    """Everyone standing on the farm road at phone scale, for judging size and style side by side."""
    imgs = [area.character_frame(n) for n in names]
    width = sum(i.width for i, _ in imgs) + gap * (len(imgs) + 1)
    tiles_w, tiles_h = width // kit.T + 2, 5
    verts = {"path": {(x, y) for x in range(tiles_w + 1) for y in (3, 4, 5)}}
    ground = kit.render_terrain(tiles_w, tiles_h, verts).crop((0, 0, width, tiles_h * kit.T))
    x = gap
    for img, (ax, ay) in imgs:
        kit.cast_shadow(ground, x + ax + 2, 66, 6, 2)
        ground.alpha_composite(img, (x, 66 - ay))
        x += img.width + gap
    return ground.resize((ground.width * scale, ground.height * scale), Image.NEAREST)


def main():
    os.makedirs(OUT, exist_ok=True)
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "lineups"):
        lineup(people.CAST).save(os.path.join(OUT, "cast.png"))
        print("cast.png")
    for name, entries, cols, material in (("props", PROPS, 7, None), ("creatures", CREATURES, 5, None),
                                          ("crops", CROPS, 3, "soil")):
        if which not in ("all", name):
            continue
        img, names = sheet(entries, cols, material=material)
        allowed = set(kit.RGB.values())
        off = {px[:3] for px in img.get_flattened_data() if px[3] and px[:3] not in allowed}
        assert not off, f"{name}: off-palette {sorted(off)[:5]}"
        img.save(os.path.join(OUT, f"{name}.png"))
        print(name, img.size, "cols", cols, "|", " ".join(names))


if __name__ == "__main__":
    main()
