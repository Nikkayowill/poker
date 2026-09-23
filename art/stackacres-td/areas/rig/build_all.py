#!/usr/bin/env python3
"""Rebuild every area, the shared tileset and the sprite contact sheets."""
import os

import kit
import sheet
from area import AREAS

import coast
import fold
import homestead
import mine
import oak
import pasture
import townsquare

AREA_MODULES = [homestead, fold, pasture, coast, oak, mine, townsquare]


def main():
    for module in AREA_MODULES:
        module.build().save(module.VIEWS, getattr(module, "ANIMATED", ()))
    kit.tileset_image().save(os.path.join(AREAS, "tileset.png"))
    sheet.main()


if __name__ == "__main__":
    main()
