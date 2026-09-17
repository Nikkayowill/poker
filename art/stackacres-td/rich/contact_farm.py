"""Writes out/sheet-farm.png: the Fold's and Cattle Pasture's rich sprites at 4x, with their DB16 originals above."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = os.path.join(os.path.dirname(HERE), "areas", "rig")
sys.path[:0] = [HERE, RIG]

from PIL import Image  # noqa: E402

import area_farm as F  # noqa: E402
import creatures  # noqa: E402
import props  # noqa: E402

pairs = [
    (props.canopy(), F.canopy()), (props.fallen_fence(), F.fallen_fence()), (props.hedge(60), F.hedge(60)),
    (props.puddle(22, 10), F.puddle(22, 10)), (props.cattle_shed(), F.cattle_shed()),
    (props.hitching_post(), F.hitching_post()), (creatures.sheep(), F.sheep()), (creatures.sheep(True), F.sheep(True)),
    (creatures.cattle(), F.cattle()), (creatures.cattle(True, patches=False), F.cattle(True, patches=False)),
    (creatures.bird(), F.bird()),
]
Z, pad = 4, 6
imgs = [((o.image() if hasattr(o, "image") else o), n) for (o, _), (n, _) in pairs]
w = sum(max(a.width, b.width) for a, b in imgs) + pad * (len(imgs) + 1)
h = max(a.height for a, _ in imgs) + max(b.height for _, b in imgs) + pad * 3
sheet = Image.new("RGBA", (w, h), (74, 147, 59, 255))
x = pad
top = max(a.height for a, _ in imgs)
for a, b in imgs:
    sheet.alpha_composite(a, (x, pad + top - a.height))
    sheet.alpha_composite(b, (x, h - pad - b.height))
    x += max(a.width, b.width) + pad
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
sheet.resize((w * Z, h * Z), Image.NEAREST).save(os.path.join(HERE, "out", "sheet-farm.png"))
print(w * Z, h * Z)
