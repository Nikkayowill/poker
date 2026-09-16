"""One area = terrain vertices + a list of placed sprites. Shared by every area script.

An area script builds an `Area`, paints materials onto its vertex grid, adds sprites at
base points, and calls `save()`, which writes `<name>.png`, `<name>-2x.png`, the phone-scale
`views/*.png`, and asserts that every pixel is DawnBringer 16.
"""
import os

from PIL import Image

import kit

RIG = os.path.dirname(os.path.abspath(__file__))
AREAS = os.path.dirname(RIG)
CHARACTERS = os.path.join(os.path.dirname(AREAS), "characters")
T = kit.T
VIEW_W, VIEW_H = 13, 8   # what a landscape phone shows at 4x


def character_frame(name):
    """A rig character's standing frame (walk_down, frame 1) and its base point."""
    sheet = Image.open(os.path.join(CHARACTERS, name, f"{name}-sheet.png")).convert("RGBA")
    return sheet.crop((48, 0, 96, 48)), (24, 44)


class Area:
    def __init__(self, name, width, height):
        self.name, self.w, self.h = name, width, height
        self.verts = {m: set() for m in kit.MATERIALS}
        self.items = []      # (frame images, anchor, base x, base y, shadow radii, ground?, character name or None)
        self.npcs = []       # (name, x, y) for everyone placed with character()
        self.spawn = None    # where the player appears, in pixels; export.py needs it
        # For the game only (export.py); the review renders ignore all three.
        self.tags = {}       # item index -> what tapping it does, e.g. "barn", "gate:oldfields"
        self.zones = []      # (tag, x, y, w, h) in pixels: tappable ground with no sprite of its own
        self.exits = []      # (to area, x, y, w, h, spawn x, spawn y): walk in here, arrive there

    # ---- terrain, authored on the (w+1) x (h+1) vertex grid

    def rect(self, material, x0, y0, x1, y1):
        self.verts[material].update((x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1))

    def line(self, material, a, b, width=2):
        """A run of vertices from a to b. Kept 4-connected, so a one-wide stream never pinches on a diagonal step."""
        n = max(abs(b[0] - a[0]), abs(b[1] - a[1]), 1)
        prev = None
        for i in range(n + 1):
            x = round(a[0] + (b[0] - a[0]) * i / n)
            y = round(a[1] + (b[1] - a[1]) * i / n)
            if prev and prev[0] != x and prev[1] != y:
                self.rect(material, prev[0], y, prev[0] + width - 1, y + width - 1)
            self.rect(material, x, y, x + width - 1, y + width - 1)
            prev = (x, y)

    def ellipse(self, material, cx, cy, rx, ry):
        self.verts[material].update((x, y) for y in range(self.h + 1) for x in range(self.w + 1)
                                    if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1)

    def clear(self, material, x0, y0, x1, y1):
        self.verts[material].difference_update((x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1))

    # ---- sprites, placed by base point in pixels

    def add(self, made, bx, by, shadow=None, ground=False, tag=None):
        """`made` is (sprite, anchor) or a list of them for an animated thing (one per frame).
        `tag` names what tapping it does in the game (see export.py)."""
        frames = made if isinstance(made, list) else [made]
        imgs = [(s.image() if isinstance(s, kit.Sprite) else s) for s, _ in frames]
        self.items.append((imgs, frames[0][1], bx, by, shadow, ground, None))
        if tag:
            self.tags[len(self.items) - 1] = tag

    def character(self, name, bx, by):
        self.add(character_frame(name), bx, by, (6, 2))
        self.npcs.append((name, bx, by))
        self.items[-1] = self.items[-1][:6] + (name,)

    def zone(self, tag, x, y, w, h):
        self.zones.append((tag, x, y, w, h))

    def exit(self, to, x, y, w, h, spawn):
        self.exits.append((to, x, y, w, h) + tuple(spawn))

    def trees(self, spots, seed=0):
        """spots: (x, y, kind) with kind in spruce, spruce_big, round."""
        for i, (x, y, kind) in enumerate(spots):
            made = {"spruce": lambda: kit.spruce(i + seed), "spruce_big": lambda: kit.spruce(i + seed, big=True),
                    "round": lambda: kit.round_tree(i + seed)}[kind]()
            self.add(made, x, y, (11 if kind != "round" else 14, 4))

    def tree_line(self, side, gaps=(), depth=2, seed=0, step=22, span=None, spruce=False):
        """A forest edge along one side of the map, `depth` trees deep, skipping the pixel gaps given.
        `span` limits the along-the-edge pixel range; `spruce` drops the broadleaf trees (hill country)."""
        spots = []
        px_len = (self.w if side in ("north", "south") else self.h) * T
        lo_span, hi_span = span or (0, px_len)

        def kind(a, b):
            r = kit.hash2(a, b, 5 + seed)
            if spruce:
                return "spruce_big" if r < 0.45 else "spruce"
            return "spruce_big" if r < 0.3 else "spruce" if r < 0.65 else "round"

        def jig(a, b, s):
            return round((kit.hash2(a, b, s + seed) - 0.5) * 10)

        for i, p in enumerate(range(10, px_len, step)):
            if any(lo < p < hi for lo, hi in gaps) or not lo_span <= p <= hi_span:
                continue
            for row in range(depth):
                if row and kit.hash2(p, row, 8 + seed) > 0.7:
                    continue
                along = p + row * 11 + jig(p, row, 6)
                inset = 30 + row * 28 + jig(p, row, 7) // 2
                if side == "north":
                    spots.append((along, inset, kind(p, row)))
                elif side == "south":
                    spots.append((along, self.h * T - inset + 24, kind(p, row)))
                elif side == "west":
                    spots.append((inset - 20, along, kind(p, row)))
                else:
                    spots.append((self.w * T - inset + 20, along, kind(p, row)))
        self.trees(spots, seed)

    # ---- output

    def render_ground(self, frame=0, character_shadows=True):
        """Terrain, ground-level items and cast shadows only: what the game draws under everything that moves.
        The game passes character_shadows=False: people move, so their shadows can't be baked in."""
        img = kit.render_terrain(self.w, self.h, self.verts, frame)
        for imgs, (ax, ay), bx, by, _, ground, _ in self.items:
            if ground:
                img.alpha_composite(imgs[frame % len(imgs)], (max(bx - ax, 0), max(by - ay, 0)),
                                    (max(ax - bx, 0), max(ay - by, 0)))
        for imgs, (ax, ay), bx, by, shadow, ground, name in self.items:
            if shadow and not ground and (character_shadows or not name):
                kit.cast_shadow(img, bx + 2, by, *shadow)
        return img

    def render(self, frame=0):
        img = self.render_ground(frame)
        for imgs, (ax, ay), bx, by, _, ground, _ in sorted((i for i in self.items if not i[5]), key=lambda i: i[3]):
            layer = Image.new("RGBA", img.size)
            layer.alpha_composite(imgs[frame % len(imgs)], (max(bx - ax, 0), max(by - ay, 0)),
                                  (max(ax - bx, 0), max(ay - by, 0)))
            img.alpha_composite(layer)
        return img

    def save(self, views, animated=(), out_dir=None, frames=kit.FRAMES, frame_ms=170):
        """Writes the stills, the phone views, and an animated GIF for each view named in `animated`."""
        out = out_dir or os.path.join(AREAS, self.name)
        os.makedirs(os.path.join(out, "views"), exist_ok=True)
        img = self.render()
        allowed = set(kit.RGB.values())
        off = {px[:3] for px in img.get_flattened_data() if px[3] and px[:3] not in allowed}
        assert not off, f"off-palette colors: {sorted(off)[:5]}"
        img.save(os.path.join(out, f"{self.name}.png"))
        img.resize((img.width * 2, img.height * 2), Image.NEAREST).save(os.path.join(out, f"{self.name}-2x.png"))

        def view_of(full, x, y):
            view = full.crop((x, y, x + VIEW_W * T, y + VIEW_H * T))
            return view.resize((view.width * 4, view.height * 4), Image.NEAREST)

        for name, (x, y) in views.items():
            view_of(img, x, y).save(os.path.join(out, "views", f"{name}.png"))
        if animated:
            renders = [img] + [self.render(f) for f in range(1, frames)]
            for name in animated:
                x, y = views[name]
                seq = [view_of(r, x, y).convert("P", palette=Image.ADAPTIVE, colors=32) for r in renders]
                seq[0].save(os.path.join(out, "views", f"{name}.gif"), save_all=True, append_images=seq[1:],
                            duration=frame_ms, loop=0)
        print(f"{self.name}.png", img.size, "| views:", ", ".join(views), "| gifs:", ", ".join(animated) or "none")
        return img
