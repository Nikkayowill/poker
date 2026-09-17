"""Renders the Homestead twice from the same layout: the DB16 rig for comparison, and the rich version."""
import itertools
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = os.path.join(os.path.dirname(HERE), "areas", "rig")
sys.path[:0] = [HERE, RIG]

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import area as area_mod  # noqa: E402
import buildings as B  # noqa: E402
import characters  # noqa: E402
import crops  # noqa: E402
import decor  # noqa: E402
import extras as X  # noqa: E402
import homestead  # noqa: E402
import kit  # noqa: E402
import props  # noqa: E402
import scene  # noqa: E402
import trees as TR  # noqa: E402
import sprites as S  # noqa: E402
import terrain  # noqa: E402

OUT = os.path.join(HERE, "out")
VIEW_W, VIEW_H, T = 13, 8, 16

DB16_SET = {kit.RGB[k] for k in kit.RGB}


def assert_redrawn(area):
    """Every sprite must come from the rich modules; a DB16-only image means a kit function wasn't replaced."""
    for i, (imgs, *_rest) in enumerate(area.items):
        for img in imgs:
            a = np.array(img.convert("RGBA"))
            colors = {tuple(c) for c in a[a[..., 3] > 0][:, :3]}
            assert not colors or not colors <= DB16_SET, f"item {i} ({area.tags.get(i) or _rest[-1]}) is still DB16"


def patch_kit():
    seeds = itertools.count(1)
    kit.farmhouse, kit.barn, kit.windmill, kit.well = B.farmhouse, B.barn, B.windmill, B.well
    kit.workshop = B.workshop
    kit.coop = S.coop
    kit.round_tree, kit.spruce = TR.round_tree, TR.spruce
    kit.bush = lambda seed=0, berries=False: TR.bush(next(seeds), berries)
    kit.broken_cart, kit.greenhouse_ruin, kit.loose_board = X.broken_cart, X.greenhouse_ruin, X.loose_board
    props.bridge, props.brambles, props.rockfall = X.bridge, X.brambles, X.rockfall
    props.hedge_overgrown, props.boardwalk_washed, props.smoke = X.hedge_overgrown, X.boardwalk_washed, X.smoke
    crops.crop = X.crop
    kit.rock = lambda big=False: S.rock(big, next(seeds))
    kit.stump, kit.flowers, kit.reeds, kit.lily_pad = S.stump, S.flowers, S.reeds, S.lily_pad
    kit.hay_bale, kit.crate, kit.barrel, kit.woodpile, kit.trough = S.hay_bale, S.crate, S.barrel, S.woodpile, S.trough
    kit.fence, kit.dock, kit.hen, kit.signpost, kit.mailbox = S.fence, S.dock, S.hen, S.signpost, S.mailbox
    kit.fallen_log = S.fallen_log
    area_mod.character_frame = rich_character_frame


def rich_character_frame(name):
    """The rich sheet's standing frame (walk_down, frame 1), built by characters.py."""
    path = os.path.join(OUT, "characters", f"{name}-sheet.png")
    if not os.path.exists(path):
        characters.main([name])
    sheet = Image.open(path).convert("RGBA")
    return sheet.crop((48, 0, 96, 48)), (24, 44)


def view(full, x, y):
    v = full.crop((x, y, x + VIEW_W * T, y + VIEW_H * T))
    return v.resize((v.width * 4, v.height * 4), Image.NEAREST)


def main():
    t0 = time.time()
    db_dir, rich_dir = os.path.join(OUT, "db16"), os.path.join(OUT, "rich")
    os.makedirs(os.path.join(rich_dir, "views"), exist_ok=True)
    homestead.build().save(homestead.VIEWS, homestead.ANIMATED, out_dir=db_dir)

    patch_kit()
    area = homestead.build()
    decor.decorate(area)
    assert_redrawn(area)
    ground = terrain.Ground(area)
    sc = scene.Scene(area, ground)
    frames = [sc.render(f) for f in range(kit.FRAMES)]
    frames[0].save(os.path.join(rich_dir, "homestead.png"))
    frames[0].resize((frames[0].width * 2, frames[0].height * 2), Image.NEAREST).save(
        os.path.join(rich_dir, "homestead-2x.png"))
    for name, (x, y) in homestead.VIEWS.items():
        view(frames[0], x, y).save(os.path.join(rich_dir, "views", f"{name}.png"))
    for name in homestead.ANIMATED:
        x, y = homestead.VIEWS[name]
        seq = [view(fr, x, y).convert("P", palette=Image.ADAPTIVE, colors=255) for fr in frames]
        seq[0].save(os.path.join(rich_dir, "views", f"{name}.gif"), save_all=True, append_images=seq[1:],
                    duration=170, loop=0)
    colors = len(set(frames[0].get_flattened_data()))
    print(f"rich homestead done in {time.time() - t0:.1f}s, {colors} colours in the frame")


if __name__ == "__main__":
    main()
