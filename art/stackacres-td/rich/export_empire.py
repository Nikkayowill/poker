#!/usr/bin/env python3
"""Exports the Far Field (areas/rig/empire.py) exactly as export_rich.py exports a playable area.

Usage: python3 export_empire.py [--out <dir>]    (default public/stackacres-td)

Kept out of export_rich's PLAYABLE list for the same reason export_city.py is: it never re-runs the character and
portrait builds, and it doesn't collide with other work on that list.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(HERE), "areas", "rig")]

import empire  # noqa: E402
import export_rich  # noqa: E402


def main(args):
    out_root = os.path.join(export_rich.rig_export.REPO, "public", "stackacres-td")
    if args[:1] == ["--out"]:
        out_root = args[1]
    export_rich.PLAYABLE.append(empire)
    export_rich.patch()
    export_rich.export_area(empire, out_root)


if __name__ == "__main__":
    main(sys.argv[1:])
