"""The painting guides for the grocery at canvas size (896 x 576, twice map size): guide-nodes.png, every
blocked square with how tall to paint it and every square someone stands on, and guide-wear.png, where feet
went in a simulated store day (area-v3-heat.json, per-tile traffic from the simulation), to mask worn varnish.

    python3 plan.py && python3 gen.py      # from this folder
"""
import json
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

Z, T = 2, 16
C = T * Z
area = json.load(open("area-v3.json")); solids = {tuple(map(int, k.split(","))): v for k, v in json.load(open("solids-v3.json")).items()}
W, H = area["width"] * C, area["height"] * C
NOTO = "/usr/share/fonts/google-noto/NotoSans-CondensedBlack.ttf"
font = ImageFont.truetype(NOTO, 11) if os.path.exists(NOTO) else ImageFont.load_default()
small = ImageFont.truetype(NOTO, 9) if os.path.exists(NOTO) else ImageFont.load_default()
# kind: (colour, height in map px, label)
K = {
 "wall": ((70, 52, 44), 48, "WALL 48"), "bay": ((120, 84, 60), 48, "STOCKROOM BAY  face 48"), "fridge": ((90, 170, 210), 38, "DAIRY FRIDGES 38"),
 "wallshelf": ((190, 120, 60), 30, "WALL SHELF 30"), "pantry": ((190, 120, 60), 30, "PANTRY 30"), "mop": ((150, 150, 150), 20, "mop"),
 "crates": ((170, 130, 80), 30, "crates"), "gondola": ((210, 150, 70), 26, "GONDOLA 26"), "endcap": ((230, 90, 70), 28, "END"),
 "tier": ((120, 180, 70), 24, "PRODUCE TIERS 24"), "rim": ((120, 180, 70), 14, "rim 14"), "counter": ((230, 200, 80), 16, "COUNTER 16"),
 "bulk": ((160, 110, 70), 20, "BULK 20"), "plant": ((60, 140, 70), 26, "plant"), "till": ((230, 200, 80), 16, "TILL 16"),
 "bakery": ((210, 160, 100), 16, "BAKERY 16"), "belt": ((230, 200, 80), 16, "BELT"), "rack": ((200, 120, 160), 30, "RACK"), "carts": ((150, 160, 170), 18, "carts"), "booth": ((140, 110, 160), 30, "MANAGER 30"),
}
ZK = {"shelf": ((255, 210, 90), "S"), "produce": ((150, 230, 110), "P"), "till": ((255, 140, 90), "t"), "stockroom": ((120, 200, 255), "R"),
      "break": ((200, 160, 255), "Z"), "door": ((255, 255, 255), "D")}

def groups():
    seen, out = set(), []
    for (x, y), k in solids.items():
        if (x, y) in seen or k == "wall": continue
        # grow a horizontal-first rectangle of the same kind
        x2 = x
        while solids.get((x2 + 1, y)) == k and (x2 + 1, y) not in seen: x2 += 1
        y2 = y
        while all(solids.get((i, y2 + 1)) == k for i in range(x, x2 + 1)): y2 += 1
        for i in range(x, x2 + 1):
            for j in range(y, y2 + 1): seen.add((i, j))
        out.append((k, x, y, x2, y2))
    return out

def draw(bg):
    im = Image.new("RGBA", (W, H), bg)
    d = ImageDraw.Draw(im, "RGBA")
    for (x, y), k in solids.items():
        if k == "wall": d.rectangle([x * C, y * C, x * C + C - 1, y * C + C - 1], fill=(40, 30, 28, 150))
    for i in range(0, W, C): d.line([(i, 0), (i, H)], fill=(255, 255, 255, 40))
    for j in range(0, H, C): d.line([(0, j), (W, j)], fill=(255, 255, 255, 40))
    for k, x, y, x2, y2 in groups():
        col, h, label = K[k]
        x0, y0, x1, y1 = x * C, y * C, (x2 + 1) * C - 1, (y2 + 1) * C - 1
        d.rectangle([x0, y0, x1, y1], fill=col + (150,), outline=col + (255,), width=2)
        top = y1 - h * Z  # how high the painted object rises above its foot line
        if top < y0:
            for yy in range(top, y0, 6): d.line([(x0, yy), (x0, yy + 2)], fill=col + (230,)); d.line([(x1, yy), (x1, yy + 2)], fill=col + (230,))
            for xx in range(x0, x1, 6): d.line([(xx, top), (xx + 2, top)], fill=col + (230,))
        d.line([(x0, y1), (x1, y1)], fill=(255, 255, 255, 255), width=1)  # foot line = sort line
        if (x2 - x + 1) * C >= 40: d.text((x0 + 4, y0 + 4), label, font=small, fill=(20, 14, 12, 255))
    staff = set()
    for z in area["zones"]:
        if z["tag"] == "staff": staff.add((z["x"] // T, z["y"] // T))
    for (x, y) in staff:
        x0, y0 = x * C, y * C
        for o in range(-C, C, 6): d.line([(x0 + max(o, 0), y0 + max(-o, 0)), (x0 + min(o + C, C) - 1, y0 + min(C - o, C) - 1)], fill=(200, 160, 255, 110))
    lines = {}
    for z in area["zones"]:
        kind = z["tag"].split(":")[0]
        if kind == "staff": continue
        x, y = z["x"] // T, z["y"] // T
        col, ch = ZK[kind]
        if z["tag"].endswith(":line"):
            lines.setdefault(z["tag"], []).append((x, y)); ch = str(len(lines[z["tag"]]) + (1 if z["tag"] == "produce:line" else 0))
        elif z["tag"].endswith(":pay"): ch = "$" + z["tag"].split(":")[1]
        elif z["tag"].endswith(":order"): ch = "O"
        elif z["tag"].endswith(":clerk"): ch = "C" + (z["tag"].split(":")[1] if z["tag"].startswith("till") else "")
        x0, y0 = x * C + 3, y * C + 3
        d.rectangle([x0, y0, x0 + C - 7, y0 + C - 7], outline=col + (255,), width=2)
        d.text((x0 + 5, y0 + 5), ch, font=font, fill=col + (255,))
    return im

draw((0, 0, 0, 0)).save("guide-nodes.png")
prev = Image.new("RGBA", (W, H), (38, 30, 36, 255)); prev.alpha_composite(draw((0, 0, 0, 0))); prev.save("guide-nodes-preview.png")
# wear map from the simulated day
heat = json.load(open("area-v3-heat.json"))
mx = max(heat)
small_im = Image.new("L", (area["width"], area["height"]))
for i, v in enumerate(heat):
    x, y = i % area["width"], i // area["width"]
    small_im.putpixel((x, y), 0 if (x, y) in solids else int((v / mx) ** 0.5 * 255))
g = small_im.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(14))
wear = Image.new("RGBA", (W, H), (255, 255, 255, 0)); wear.putalpha(g); wear.save("guide-wear.png")
wp = Image.new("RGBA", (W, H), (38, 30, 36, 255)); tint = Image.new("RGBA", (W, H), (255, 190, 110, 0)); tint.putalpha(g); wp.alpha_composite(tint)
wp.alpha_composite(draw((0, 0, 0, 0)).point(lambda v: v // 3)); wp.save("guide-wear-preview.png")
print(W, H, "max heat", round(mx))
