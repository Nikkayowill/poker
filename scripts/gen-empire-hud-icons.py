"""Placeholder 12x12 HUD icons for the empire district's Wood/Wheat/Workers
counters (StackAcresPixelIcon, public/stackacres-td/ui/icons/). Simple flat
glyphs, same size class as the existing coin/energy icons -- not a real art
pass, just enough for the icon+number HUD slot to be honestly filled rather
than left blank or numbers-only.
"""

from PIL import Image
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "stackacres-td", "ui", "icons")
INK = (26, 18, 10, 255)


def new_icon():
    return Image.new("RGBA", (12, 12), (0, 0, 0, 0))


def save(im, name):
    im.save(os.path.join(OUT, f"{name}.png"))


# Wood: a log's cut end -- a brown disc with a paler ring.
wood = new_icon()
px = wood.load()
for y in range(12):
    for x in range(12):
        dx, dy = x - 5.5, y - 5.5
        d = (dx * dx + dy * dy) ** 0.5
        if d <= 5:
            px[x, y] = (120, 78, 42, 255)
        if 3 <= d <= 4:
            px[x, y] = (168, 116, 66, 255)
        if d > 5 and d <= 5.6:
            px[x, y] = INK
save(wood, "wood")

# Wheat: two angled stalks with a head each, gold on a bare stem.
wheat = new_icon()
px = wheat.load()
gold = (224, 178, 62, 255)
stem = (150, 118, 40, 255)
for y in range(2, 11):
    px[5, y] = stem
    px[6, y] = stem
for y in range(1, 6):
    px[4, y] = gold
    px[7, y] = gold
px[5, 1] = gold
px[6, 1] = gold
save(wheat, "wheat")

# Workers: a simple head-and-shoulders silhouette.
workers = new_icon()
px = workers.load()
for y in range(2, 5):
    for x in range(4, 8):
        if (x - 5.5) ** 2 + (y - 3) ** 2 <= 3.2:
            px[x, y] = INK
for y in range(6, 11):
    for x in range(3, 9):
        px[x, y] = INK
save(workers, "workers")

print("wrote wood.png, wheat.png, workers.png to", OUT)
