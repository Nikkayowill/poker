"""Writes the barn-paint UI kit and the StackAcres logo into public/.

    BALOO_TTF=/path/to/Baloo2-ExtraBold.ttf python3 export.py

Everything is drawn at 1 art pixel per image pixel; the CSS shows it at 2x
(app/styles/52-stackacres.css), the same grid as the map.
"""
import os
from icons import all_icons
from ui import PARTS
import lockups
from title import title

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../public")
UI = f"{ROOT}/stackacres-td/ui"
BRAND = f"{ROOT}/brand/stackacres"
os.makedirs(f"{UI}/icons", exist_ok=True)
os.makedirs(BRAND, exist_ok=True)

for name, (canvas, _slice) in PARTS.items():
    canvas.img().save(f"{UI}/{name}.png", optimize=True)
for name, canvas in all_icons().items():
    canvas.img().save(f"{UI}/icons/{name}.png", optimize=True)
title().save(f"{UI}/title.png", optimize=True)

lockups.wordmark().save(f"{BRAND}/wordmark.png", optimize=True)
lockups.mark().save(f"{BRAND}/mark.png", optimize=True)
lockups.stacked().save(f"{BRAND}/lockup-stacked.png", optimize=True)
lockups.row().save(f"{BRAND}/lockup-row.png", optimize=True)
lockups.badge().save(f"{BRAND}/badge.png", optimize=True)
print("wrote", UI, BRAND)
