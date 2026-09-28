#!/usr/bin/env python3
"""Rebuild every area, the shared tileset and the sprite contact sheets."""
import os

import kit
import sheet
from area import AREAS

import homestead

AREA_MODULES = [homestead]


def main():
    for module in AREA_MODULES:
        module.build().save(module.VIEWS, getattr(module, "ANIMATED", ()))
    kit.tileset_image().save(os.path.join(AREAS, "tileset.png"))
    sheet.main()


if __name__ == "__main__":
    main()
