#!/usr/bin/env python3
"""Exports the City (areas/rig/city.py) exactly as export_rich.py exports a playable area.

Usage: python3 export_city.py [--out <dir>]    (default public/stackacres-td)

Kept out of export_rich's PLAYABLE list so a City export never re-runs the character and portrait builds that
export_rich's main() does, and so it doesn't collide with other work on that list.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(HERE), "areas", "rig")]

import city  # noqa: E402
import export_rich  # noqa: E402


def main(args):
    out_root = os.path.join(export_rich.rig_export.REPO, "public", "stackacres-td")
    if args[:1] == ["--out"]:
        out_root = args[1]
    # Its props are swapped for their rich drawings along with everyone else's.
    export_rich.PLAYABLE.append(city)
    export_rich.patch()
    export_rich.export_area(city, out_root)


if __name__ == "__main__":
    main(sys.argv[1:])
