"""Adds the Homestead's one exit onto the empire district (the bridge) and
opens the two wall tiles under it. Run once; the diff is small enough to
review directly in git after. See docs/stackacres-second-map-direction.md
section 6a.

The doorway sits on the Homestead's west wall at tile columns 0-1, rows
28-29 (world pixels 0..32, 448..480) -- picked because that stretch of the
perimeter is a plain solid wall with nothing else nearby (no pond, no prop,
no existing exit), so opening exactly those four tiles cannot disturb
anything else on the map.
"""

import json
import os

HOMESTEAD = os.path.join(
    os.path.dirname(__file__), "..", "public", "stackacres-td", "areas", "homestead", "area.json"
)
EMPIRE = os.path.join(
    os.path.dirname(__file__), "..", "public", "stackacres-td", "areas", "empire", "area.json"
)

OPEN_TILES = {(0, 28), (0, 29), (1, 28), (1, 29)}

with open(HOMESTEAD) as f:
    homestead = json.load(f)

before = len(homestead["blocked"])
homestead["blocked"] = [t for t in homestead["blocked"] if tuple(t) not in OPEN_TILES]
assert before - len(homestead["blocked"]) == len(OPEN_TILES), "expected tiles were not all present"

already = any(e["to"] == "empire" for e in homestead["exits"])
if not already:
    homestead["exits"].append(
        # Spawn lands just inside empire's own west doorway (its return exit
        # below is at the same row, x 0..32, y 224..256) so arriving there
        # reads as stepping off the bridge, not teleporting across the field.
        {"to": "empire", "x": 0, "y": 448, "w": 10, "h": 32, "spawn": {"x": 48, "y": 240}}
    )

with open(HOMESTEAD, "w") as f:
    json.dump(homestead, f)

# The empire district itself: a flat 40x30-tile field (640x480 px), fenced
# by a border wall with one gap back onto the Homestead. Nothing else is
# placed -- no props, no npcs -- per section 6a: the map starts empty.
W, H, TILE = 40, 30, 16
border = set()
for x in range(W):
    border.add((x, 0))
    border.add((x, H - 1))
for y in range(H):
    border.add((0, y))
    border.add((W - 1, y))
# The return gap: two tiles on the west wall, mirroring the Homestead's own
# doorway, at a row that lands the farmer a short walk from the spawn point.
RETURN_TILES = {(0, 14), (0, 15)}
blocked = sorted(border - RETURN_TILES)

empire = {
    "name": "empire",
    "width": W,
    "height": H,
    "tile": TILE,
    "frames": 1,
    "spawn": {"x": 40, "y": 240},
    "props": [],
    "npcs": [],
    "blocked": [list(t) for t in blocked],
    "zones": [],
    "exits": [
        {"to": "homestead", "x": 0, "y": 224, "w": 10, "h": 32, "spawn": {"x": 40, "y": 464}}
    ],
    "indoor": False,
    "lights": [],
    "emitters": [],
    "ambient": {"meadow": [], "pond": [], "canopies": []},
}

with open(EMPIRE, "w") as f:
    json.dump(empire, f)

print("homestead exits:", len(homestead["exits"]), "blocked removed:", before - len(homestead["blocked"]))
print("empire area written:", empire["width"], "x", empire["height"], "tiles")
