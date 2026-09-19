#!/usr/bin/env python3
"""Download a PixelLab character (its standing views and animations) into source/<name>/.

    python3 fetch.py <name> <pixellab character id>

Only needed when a character is regenerated; build.py works from source/ alone.
"""
import io
import os
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))


def fetch(name, character_id):
    url = f"https://api.pixellab.ai/mcp/characters/{character_id}/download"
    data = urllib.request.urlopen(url, timeout=60).read()
    dest = os.path.join(HERE, "source", name)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for member in z.namelist():
            parts = member.split("/")
            # <state>/rotations/<view>.png and <state>/animations/<anim>/<view>/frame_NNN.png
            if len(parts) < 3 or not member.endswith(".png"):
                continue
            rel = parts[1:]
            if rel[0] == "rotations" and rel[1][:-4] not in ("south", "east", "north"):
                continue
            path = os.path.join(dest, *rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(z.read(member))
    print(name, "->", dest)


if __name__ == "__main__":
    fetch(sys.argv[1], sys.argv[2])
