#!/usr/bin/env python3
"""Renders any area through the rich pipeline for review, next to its DB16 original.

Usage: python3 build_area.py <area> [<area> ...]   (area script names in areas/rig: fold, pasture, coast, oak, mine, townsquare,
homestead, oldfields)

Writes rich/out/areas/<area>/{db16,rich}/: <area>.png, <area>-2x.png and views/*.png at 4x. Every sprite an area script
uses must have a rich version: the rig's props/creatures functions are swapped for the same-named ones in the area_*.py
modules, and build.assert_redrawn fails loudly on anything still DB16.
"""
import importlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = os.path.join(os.path.dirname(HERE), "areas", "rig")
sys.path[:0] = [HERE, RIG]

from PIL import Image  # noqa: E402

import area_coast  # noqa: E402
import area_farm  # noqa: E402
import area_town  # noqa: E402
import area_wild  # noqa: E402
import build  # noqa: E402
import creatures  # noqa: E402
import decor  # noqa: E402
import fields  # noqa: E402
import props  # noqa: E402
import scene  # noqa: E402
import terrain  # noqa: E402

AREA_MODULES = [area_farm, area_coast, area_wild, area_town]
OUT = os.path.join(HERE, "out", "areas")


def patch(script_source):
    build.patch_kit()
    props.shed_old, props.plough, props.scarecrow, props.wild_growth = (
        fields.shed_old, fields.plough, fields.scarecrow, fields.wild_growth)
    wanted = set(re.findall(r"\b(?:props|creatures)\.([a-z_]+)\(", script_source))
    for name in sorted(wanted):
        owners = [m for m in AREA_MODULES if callable(getattr(m, name, None))]
        if not owners:
            continue                                  # already redrawn by the Homestead's modules
        for target in (props, creatures):
            if hasattr(target, name):
                setattr(target, name, getattr(owners[0], name))


def save(img, out, name, views):
    os.makedirs(os.path.join(out, "views"), exist_ok=True)
    img.save(os.path.join(out, f"{name}.png"))
    img.resize((img.width * 2, img.height * 2), Image.NEAREST).save(os.path.join(out, f"{name}-2x.png"))
    for view, (x, y) in views.items():
        v = img.crop((x, y, x + build.VIEW_W * build.T, y + build.VIEW_H * build.T))
        v.resize((v.width * 4, v.height * 4), Image.NEAREST).save(os.path.join(out, "views", f"{view}.png"))


def main(names):
    modules = [importlib.import_module(n) for n in names]
    for module in modules:                             # DB16 first: patching swaps the rig's sprites for good
        module.build().save(getattr(module, "VIEWS", {}), out_dir=os.path.join(OUT, module.__name__, "db16"))
    patch("".join(open(m.__file__).read() for m in modules))
    for module in modules:
        area = module.build()
        decor.decorate(area)
        build.assert_redrawn(area)
        img = scene.Scene(area, terrain.Ground(area)).render(0)
        save(img, os.path.join(OUT, module.__name__, "rich"), module.__name__, getattr(module, "VIEWS", {}))
        print(module.__name__, img.size, len(set(img.get_flattened_data())), "colours")


if __name__ == "__main__":
    main(sys.argv[1:])
