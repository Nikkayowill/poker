import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = os.path.join(os.path.dirname(HERE), "areas", "rig")
sys.path[:0] = [HERE, RIG]

from PIL import Image  # noqa: E402

import buildings as B  # noqa: E402
import sprites as S  # noqa: E402
import trees as TR  # noqa: E402

groups = {
    "buildings": [B.farmhouse(), B.barn(), B.windmill(), B.well()],
    "nature": [TR.round_tree(0), TR.round_tree(3), TR.spruce(0), TR.spruce(1, big=True), TR.bush(), TR.bush(2, True),
               S.rock(True), S.rock(), S.stump(), S.reeds(), S.lily_pad(True), S.flowers("W"), S.flowers("R"),
               S.flowers("Y")],
    "objects": [S.well(), S.coop(), S.hay_bale(), S.crate(), S.barrel(), S.woodpile(), S.trough(), S.fence(48),
                S.fence(32, vertical=True), S.dock(), S.hen(), S.signpost(), S.mailbox(), S.fallen_log()],
}
BG = (74, 147, 59, 255)
for name, items in groups.items():
    pad = 6
    w = sum(img.width for img, _ in items) + pad * (len(items) + 1)
    h = max(img.height for img, _ in items) + pad * 2
    sheet = Image.new("RGBA", (w, h), BG)
    x = pad
    for img, _ in items:
        sheet.alpha_composite(img, (x, h - pad - img.height))
        x += img.width + pad
    sheet = sheet.resize((w * 4, h * 4), Image.NEAREST)
    sheet.save(os.path.join(HERE, "out", f"sheet-{name}.png"))
    print(name, sheet.size)
