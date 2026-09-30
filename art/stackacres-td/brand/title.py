"""The title screen's backdrop: the Homestead from the lake, at golden hour.

Composited from the exported area (ground frame 0 plus every prop), so it
always matches the live map. 1 art pixel = 1 output pixel.
"""
import json, os
import numpy as np
from PIL import Image

AREA = os.path.join(os.path.dirname(__file__), "../../../public/stackacres-td/areas/homestead")


def homestead():
    a = json.load(open(f"{AREA}/area.json"))
    frames = json.load(open(f"{AREA}/props.json"))["frames"]
    atlas = Image.open(f"{AREA}/props.png").convert("RGBA")
    g = Image.open(f"{AREA}/ground-0.png").convert("RGBA")
    S = g.width / (a["width"] * a["tile"])
    for p in sorted(a["props"], key=lambda p: p["y"]):
        f = frames[p["frame"]]["frame"]
        im = atlas.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
        sc = p["scale"] * S
        if sc != 1:
            im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.NEAREST)
        g.alpha_composite(im, (round((p["x"] - p["ax"]) * S), round((p["y"] - p["ay"]) * S)))
    return g


def title(w=844, h=390, x0=578, y0=40):
    t = homestead().convert("RGB").crop((x0, y0, x0 + w, y0 + h))
    a = np.asarray(t).astype(float) / 255
    yy, xx = np.mgrid[0:h, 0:w]
    a = a * np.array([1.04, 0.99, 0.90])
    light = np.clip(1 - np.hypot((xx - w * 0.2) / w, (yy + h * 0.2) / h), 0, 1)[..., None]
    a = 1 - (1 - a) * (1 - np.array([1.0, 0.82, 0.5]) * light * 0.32)
    vig = np.clip(1 - (np.hypot((xx - w / 2) / (w * 0.6), (yy - h / 2) / (h * 0.72)) ** 2) * 0.4, 0, 1)[..., None]
    return Image.fromarray((np.clip(a * vig, 0, 1) * 255).astype("uint8"))
