"""The grocery's floor plan as data, 28 x 18 tiles of 16px: what stands where, and the zone on every square
someone works or shops from. It was tested in the store simulation before the room was drawn, and
lpc_rooms.grocery() builds the same plan from the LPC art (the exported room must block exactly these squares).
Writes area-v3.json and solids-v3.json for gen.py and prints the plan as text."""
import json
W, H = 28, 18
solid = {}  # (x,y) -> kind
def fill(kind, xs, ys):
    for y in ys:
        for x in xs: solid[(x, y)] = kind
R = lambda a, b: range(a, b + 1)
# shell
fill("wall", R(0, W - 1), R(0, 2)); fill("wall", [0, W - 1], R(0, H - 1)); fill("wall", R(0, W - 1), [H - 1])
# back wall fixtures (y3)
fill("fridge", R(1, 4), [3]); fill("wallshelf", R(5, 11), [3]); fill("mop", [12], [3])
fill("bay", R(13, 18), R(3, 4)); fill("crates", [19], R(3, 4)); fill("pantry", R(20, 25), [3])
# gondolas and endcaps
fill("gondola", R(2, 9), [7]); fill("endcap", [10], [7]); fill("gondola", R(2, 9), [10]); fill("endcap", [10], [10])
# produce island x14-21 y7-10: tiers north, rim and counter south, a two-row staff floor between, gates at both ends
fill("tier", R(15, 20), [7]); fill("rim", [15, 19, 20], [10]); fill("counter", [16, 17, 18], [10])
# right wall bulk bins, plant
fill("bulk", [26], R(6, 10)); fill("plant", [26], [12])
# front: four checkout lanes (lane, belt, cashier), bakery, carts, manager's booth
for k in range(4):
    L, B, C = 1 + 3 * k, 2 + 3 * k, 3 + 3 * k
    fill("belt", [B], R(12, 14)); fill("rack", [C], R(12, 13))
fill("bakery", R(22, 25), [14])
fill("carts", [17, 18], [16]); fill("booth", R(22, 26), R(15, 16))

zones = []
def z(tag, tiles):
    for x, y in tiles:
        assert (x, y) not in solid, (tag, x, y, solid[(x, y)])
        zones.append({"tag": tag, "x": x * 16, "y": y * 16, "w": 16, "h": 16})
row = lambda xs, y: [(x, y) for x in xs]
z("shelf:dairy", row(R(1, 4), 4)); z("shelf:wall", row(R(5, 11), 4)); z("shelf:pantry", row(R(20, 25), 4))
z("shelf:aisle-a", row(R(2, 9), 6)); z("shelf:aisle-b", row(R(2, 9), 8)); z("shelf:aisle-a", [(11, 7)])
z("shelf:aisle-c", row(R(2, 9), 9)); z("shelf:aisle-c", [(11, 10)])
z("shelf:bulk", [(25, y) for y in R(6, 10)]); z("shelf:bakery", row(R(22, 25), 13))
z("produce:table-0", row(R(15, 17), 8)); z("produce:table-1", row(R(18, 20), 8))
z("produce:table-2", [(15, 9)]); z("produce:table-3", [(19, 9), (20, 9)])
z("produce:2:clerk", [(16, 9)]); z("produce:2:order", [(16, 11)])
z("produce:0:clerk", [(17, 9)]); z("produce:0:order", [(17, 11)])
z("produce:1:clerk", [(18, 9)]); z("produce:1:order", [(18, 11)])
z("produce:line", row(R(19, 23), 11))
for k in range(4):
    L, C = 1 + 3 * k, 3 + 3 * k
    z(f"till:{k}:clerk", [(C, 14)]); z(f"till:{k}:pay", [(L, 14)]); z(f"till:{k}:line", [(L, 13), (L, 12)])
z("stockroom", [(15, 5), (16, 5)]); z("break", [(18, 5)]); z("door:out", [(12, 16), (13, 16)]); z("door:in", [(14, 16), (15, 16)])
inner = row(R(15, 20), 8) + row(R(15, 20), 9) + [(14, 8), (14, 9), (21, 8), (21, 9)]
z("staff", inner + [(14, 5), (15, 5), (16, 5), (17, 5), (18, 5)])
area = {"name": "grocery-v3", "width": W, "height": H, "tile": 16, "blocked": sorted([list(k) for k in solid]), "props": [], "zones": zones}
json.dump(area, open("area-v3.json", "w"))
json.dump({f"{x},{y}": k for (x, y), k in solid.items()}, open("solids-v3.json", "w"))
tagat = {}
for q in zones: tagat.setdefault((q["x"] // 16, q["y"] // 16), q["tag"])
CH = {"belt": "T", "rack": "r", "wall": "#", "fridge": "F", "wallshelf": "S", "pantry": "S", "mop": "m", "bay": "X", "crates": "Z", "gondola": "G", "endcap": "E",
      "tier": "P", "crate": "P", "pyramid": "P", "rim": "P", "counter": "C", "bulk": "B", "plant": "*", "till": "T", "bakery": "K", "carts": "R", "booth": "O"}
ZC = {"shelf": "s", "produce": "p", "till": "t", "stockroom": "r", "break": "h", "door": "D", "staff": "~"}
for y in range(H):
    line = ""
    for x in range(W):
        if (x, y) in solid: line += CH[solid[(x, y)]]
        elif (x, y) in tagat:
            t = tagat[(x, y)]
            line += "c" if t.startswith("produce:") and t.endswith(":clerk") else "o" if t.endswith(":order") else "l" if t.endswith(":line") else "$" if t.endswith(":pay") else "k" if t.endswith(":clerk") else ZC[t.split(":")[0]]
        else: line += "."
    print(f"{y:2d} {line}")
