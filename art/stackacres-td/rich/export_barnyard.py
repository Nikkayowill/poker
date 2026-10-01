#!/usr/bin/env python3
"""Exports the Barnyard (areas/rig/barnyard.py) exactly as export_rich.py exports a playable area.

Usage: python3 export_barnyard.py [--out <dir>]    (default public/stackacres-td)

It is kept out of export_rich's PLAYABLE list because the game doesn't walk it yet: the barn crew sim
(lib/stackacres-td/barnsite.ts) reads its area.json, and its tests run a day on it.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(HERE), "areas", "rig")]

import barnyard  # noqa: E402
import export_rich  # noqa: E402


def main(args):
    out_root = os.path.join(export_rich.rig_export.REPO, "public", "stackacres-td")
    if args[:1] == ["--out"]:
        out_root = args[1]
    # Its props are swapped for their rich drawings along with everyone else's.
    export_rich.PLAYABLE.append(barnyard)
    export_rich.patch()
    export_rich.export_area(barnyard, out_root)


if __name__ == "__main__":
    main(sys.argv[1:])
