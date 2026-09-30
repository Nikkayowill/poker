#!/usr/bin/env python3
"""Render a piece of a real area with sprites standing in it, the way the game draws it.

Kayo judges character art by looking at it in the world, not on a contact sheet, so a scale
question needs a picture of the Homestead with the candidate standing next to a building and next
to a character already in the game. This reads what the game reads (public/stackacres-td/areas/
<area>/) and composites ground, props by base point, then whatever sprites are handed to it.
"""
import json
import os

from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
AREAS = os.path.join(REPO, "public", "stackacres-td", "areas")


class Area:
    def __init__(self, name="homestead", frame=0):
        self.dir = os.path.join(AREAS, name)
        with open(os.path.join(self.dir, "area.json")) as fh:
            self.data = json.load(fh)
        self.ground = Image.open(os.path.join(self.dir, f"ground-{frame}.png")).convert("RGBA")
        self.atlas = Image.open(os.path.join(self.dir, "props.png")).convert("RGBA")
        with open(os.path.join(self.dir, "props.json")) as fh:
            self.frames = json.load(fh)["frames"]

    def _prop_image(self, name):
        f = self.frames[name]["frame"]
        return self.atlas.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))

    def render(self, box, sprites=()):
        """box is (x, y, w, h) in world pixels. sprites are (image, world x, world y of the feet)."""
        x, y, w, h = box
        out = Image.new("RGBA", (w, h), (0, 0, 0, 255))
        out.alpha_composite(self.ground.crop((x, y, x + w, y + h)))
        drawn = [(p["y"], "prop", p) for p in self.data["props"]]
        drawn += [(fy, "sprite", (im, fx, fy)) for im, fx, fy in sprites]
        for _key, kind, item in sorted(drawn, key=lambda t: t[0]):
            if kind == "prop":
                im = self._prop_image(item["frame"])
                px, py = item["x"] - item["ax"] - x, item["y"] - item["ay"] - y
            else:
                im, fx, fy = item
                px, py = fx - im.width // 2 - x, fy - im.height - y
            if px > w or py > h or px + im.width < 0 or py + im.height < 0:
                continue
            out.alpha_composite(im, (int(px), int(py)))
        return out


def zoom(img, k=4):
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def trim_to_feet(frame, feet_row=None):
    """A 64x64 LPC frame or a 48x48 rig frame cut down to the drawn body, so a sprite can be placed
    by its feet whatever sheet it came from."""
    bb = frame.getbbox()
    return frame.crop((bb[0], bb[1], bb[2], bb[3] if feet_row is None else feet_row))
