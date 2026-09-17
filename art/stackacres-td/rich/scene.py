"""Scene passes that give an area depth after its ground and sprites are drawn.

Order per frame: ground, ground-level items, projected cast shadows (from each sprite's own silhouette,
falling bottom-right away from the top-left sun), contact shade at every base, pond reflections, then the
standing sprites in base-y order with grass tufts over their feet, then a gentle warm-to-cool light grade.
"""
import numpy as np
from PIL import Image

from pal import RGB, fbm, hash2
from terrain import CODE

KX, KY = 0.72, 0.14                 # ground offset of a shadow per pixel of height
SHADOW_TINT = np.array([0.50, 0.54, 0.74])
REFLECT_RANGE = 90


def _blit(dst, src, x, y):
    """Alpha-composite RGBA uint8 `src` onto float RGB `dst` at (x, y)."""
    h, w = src.shape[:2]
    H, W = dst.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x0 >= x1 or y0 >= y1:
        return
    s = src[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float64)
    a = s[..., 3:4] / 255
    dst[y0:y1, x0:x1] = dst[y0:y1, x0:x1] * (1 - a) + s[..., :3] * a


class Scene:
    def __init__(self, area, ground, static_only=False):
        """`static_only` is the game export: people move, so they cast no baked shadow or reflection."""
        self.area, self.ground, self.static_only = area, ground, static_only
        self.H, self.W = ground.owner.shape
        self.items = []
        for i, (imgs, (ax, ay), bx, by, shadow, is_ground, name) in enumerate(area.items):
            arrs = [np.array(im.convert("RGBA")) for im in imgs]
            self.items.append(dict(i=i, arrs=arrs, ax=ax, ay=ay, bx=bx, by=by, shadow=shadow, ground=is_ground,
                                   name=name, x=bx - ax, y=by - ay, animated=len(arrs) > 1))
        self._shadows()
        pond = ground.owner == CODE["water"]
        self.pond = pond
        self.grassy = ground.owner == 0

    def _shadows(self):
        H, W = self.H, self.W
        dark = np.zeros((H, W))
        leafy = np.zeros((H, W), bool)
        src = np.full((H, W), -1, np.int32)
        for it in self.items:
            if it["ground"] or it["animated"] or (self.static_only and it["name"]):
                continue
            a = it["arrs"][0]
            ys, xs = np.nonzero(a[..., 3] > 0)
            if not len(xs):
                continue
            height = np.maximum(it["ay"] - ys, 0)
            h, w = a.shape[:2]
            if h > 3 * w and h > 40:
                height = np.minimum(height, 10)                 # a vertical fence runs along the ground; it isn't tall
            gx = np.rint(it["x"] + xs + height * KX).astype(int)
            gy = np.rint(it["by"] + height * KY - np.where(height > 0, 0, it["ay"] - ys)).astype(int)
            rgb = a[ys, xs, :3].astype(int)
            green = (rgb[:, 1] > rgb[:, 0] + 8) & (rgb[:, 1] > rgb[:, 2])
            for dx in (0, 1):
                ok = (gx + dx >= 0) & (gx + dx < W) & (gy >= 0) & (gy < H)
                dark[gy[ok], gx[ok] + dx] = 1
                leafy[gy[ok & green], gx[ok & green] + dx] = True
                src[gy[ok], gx[ok] + dx] = it["i"]
            if it["shadow"]:                                    # contact shade right under the base
                rx, ry = it["shadow"]
                yy, xx = np.mgrid[-ry - 1:ry + 2, -rx - 1:rx + 2]
                d = (xx / (rx + 0.5)) ** 2 + (yy / (ry + 0.5)) ** 2
                cy, cx = it["by"], it["bx"] + 1
                for (oy, ox), v in np.ndenumerate(d):
                    py, px = cy + yy[oy, ox], cx + xx[oy, ox]
                    if 0 <= py < H and 0 <= px < W and v <= 1:
                        dark[py, px] = max(dark[py, px], 1.35 if v < 0.45 else 1.15)
        soft = dark.copy()
        for _ in range(1):
            pad = np.pad(soft, 1, mode="edge")
            soft = np.maximum(soft, 0.45 * np.maximum.reduce([pad[:-2, 1:-1], pad[2:, 1:-1], pad[1:-1, :-2], pad[1:-1, 2:]]))
        ys, xs = np.mgrid[0:H, 0:W]
        fleck = (fbm(xs.astype(float), ys.astype(float), 5, 91, 2) > 0.62) & leafy & (dark <= 1)
        soft = np.where(fleck, soft * 0.35, soft)
        self.dark, self.src = soft, src

    def _reflect(self, img, frame):
        H, W = self.H, self.W
        pond = self.pond
        if not pond.any():
            return
        pys, pxs = np.nonzero(pond)
        top, bottom, left, right = pys.min(), pys.max(), pxs.min(), pxs.max()
        for it in self.items:
            if it["ground"] or (self.static_only and (it["name"] or it["animated"])):
                continue
            if not (left - 60 < it["bx"] < right + 60 and top - REFLECT_RANGE < it["by"] < bottom):
                continue
            a = it["arrs"][frame % len(it["arrs"])]
            ys, xs = np.nonzero(a[..., 3] > 0)
            sy = it["by"] + (it["by"] - (it["y"] + ys)) + 1
            row = sy - it["by"]
            wobble = np.rint(np.sin(row * 0.8 + frame * np.pi / 2) * (row > 6)).astype(int)
            sx = it["x"] + xs + wobble
            ok = (sy >= 0) & (sy < H) & (sx >= 0) & (sx < W)
            ok[ok] &= pond[sy[ok], sx[ok]]
            ok &= (row % 5 != 3)
            fade = np.clip(1 - row / 70, 0.15, 1)
            c = a[ys, xs, :3].astype(np.float64) * np.array([0.72, 0.82, 1.0])
            mix = (0.42 * fade)[:, None]
            img[sy[ok], sx[ok]] = img[sy[ok], sx[ok]] * (1 - mix[ok]) + c[ok] * mix[ok]

    def _tufts(self, it):
        """A few grass blades in front of a grounded object's base, so it sits in the grass, not on it."""
        rx = it["shadow"][0] if it["shadow"] else 4
        blades = []
        n = 2 + int(rx * 0.7)
        greens = RGB["grass"]
        for k in range(n):
            bx = it["bx"] - rx + int(hash2(it["bx"], k, 7) * (2 * rx + 1))
            by = it["by"] + int(hash2(it["by"], k, 8) * 2)
            if not (0 <= by < self.H and 0 <= bx < self.W and self.grassy[by, bx]):
                continue
            tall = 2 + int(hash2(bx, by, 9) * 3)
            lean = -1 if hash2(bx, by, 10) < 0.35 else 1 if hash2(bx, by, 10) > 0.7 else 0
            for j in range(tall):
                x = bx + (lean if j == tall - 1 else 0)
                shade = 3 + int(j * 5 / tall) + (1 if lean < 0 else 0)
                blades.append((x, by - j, greens[min(shade, 9)]))
        return blades

    def ground_image(self, frame=0):
        """Terrain, ground-level items, cast shadows and reflections: everything under what stands."""
        img = np.array(self.ground.frame(frame))[..., :3].astype(np.float64)
        for it in self.items:
            if it["ground"]:
                _blit(img, it["arrs"][frame % len(it["arrs"])], it["x"], it["y"])
        d = np.clip(self.dark, 0, 1.4)[..., None]
        strength = np.where(d > 1, 0.82 + (d - 1) * 0.4, d * 0.82)
        img = img * (1 - strength) + img * SHADOW_TINT * strength
        self._reflect(img, frame)
        return img

    def standing(self):
        return sorted((i for i in self.items if not i["ground"]), key=lambda i: i["by"])

    def prop_frame(self, it, frame=0):
        """A standing item's picture, cooled and dimmed when its base sits in something else's shadow."""
        arr = it["arrs"][frame % len(it["arrs"])]
        by, bx = min(it["by"] - 2, self.H - 1), min(max(it["bx"], 0), self.W - 1)
        if not it["animated"] and self.src[by, bx] not in (-1, it["i"]) and self.dark[by, bx] > 0.5:
            arr = arr.copy()
            arr[..., :3] = (arr[..., :3] * np.array([0.74, 0.76, 0.88])).astype(np.uint8)
        return arr

    def tuft_image(self, it):
        """The grass blades over a grounded item's feet, as (RGBA array, left, top), or None."""
        if not it["shadow"] or it["name"] or it["animated"]:
            return None
        blades = [(x, y, c) for x, y, c in self._tufts(it) if 0 <= x < self.W and 0 <= y < self.H]
        if not blades:
            return None
        x0, y0 = min(b[0] for b in blades), min(b[1] for b in blades)
        x1, y1 = max(b[0] for b in blades), max(b[1] for b in blades)
        arr = np.zeros((y1 - y0 + 1, x1 - x0 + 1, 4), np.uint8)
        for x, y, c in blades:
            arr[y - y0, x - x0] = (*c, 255)
        return arr, x0, y0

    def render(self, frame=0):
        """The review render: everything composed, plus a warm-to-cool light grade the game does itself."""
        img = self.ground_image(frame)
        for it in self.standing():
            _blit(img, self.prop_frame(it, frame), it["x"], it["y"])
            tuft = self.tuft_image(it)
            if tuft:
                _blit(img, *tuft)
        H, W = self.H, self.W
        ys, xs = np.mgrid[0:H, 0:W]
        t = ((xs / W) + (ys / H))[..., None] / 2
        grade = np.array([1.05, 1.03, 0.96]) * (1 - t) + np.array([0.95, 0.97, 1.04]) * t
        img = np.clip(img * grade, 0, 255).astype(np.uint8)
        return Image.fromarray(np.dstack([img, np.full((H, W), 255, np.uint8)]), "RGBA")
