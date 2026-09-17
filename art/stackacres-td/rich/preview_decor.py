"""Renders the Homestead with decor.py's detail layer into out/decor-preview, without touching build.py."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build  # noqa: E402
import area as area_mod  # noqa: E402
import buildings as B  # noqa: E402
import decor  # noqa: E402
import homestead  # noqa: E402
import kit  # noqa: E402

build.OUT = os.path.join(HERE, "out", "decor-preview")
build.rich_character_frame = area_mod.character_frame   # characters are someone else's job; use the rig's frame
_build = homestead.build


def decorated(*args, **kwargs):
    area = _build(*args, **kwargs)
    if kit.farmhouse is B.farmhouse:                     # only the rich pass; the DB16 pass asserts its palette
        print("decor:", decor.decorate(area))
    return area


homestead.build = decorated
build.main()
