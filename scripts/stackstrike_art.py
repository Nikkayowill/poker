"""Shared drawing helpers for StackStrike's smooth top-down art.

Everything is drawn at 4x and shrunk, so edges are anti-aliased. A shape is a mask; `paint` fills
it with a gradient lit from the top left and gives it a dark edge, so parts read as separate pieces.
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SS = 4


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))

    def mask(self):
        return Image.new("L", self.img.size, 0)

    def ellipse(self, cx, cy, rx, ry):
        m = self.mask()
        ImageDraw.Draw(m).ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=255)
        return m

    def rrect(self, x0, y0, x1, y1, r):
        m = self.mask()
        ImageDraw.Draw(m).rounded_rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], radius=r * SS, fill=255)
        return m

    def capsule(self, p0, p1, width):
        m = self.mask()
        d = ImageDraw.Draw(m)
        d.line([p0[0] * SS, p0[1] * SS, p1[0] * SS, p1[1] * SS], fill=255, width=int(width * SS))
        r = width * SS / 2
        for p in (p0, p1):
            d.ellipse([p[0] * SS - r, p[1] * SS - r, p[0] * SS + r, p[1] * SS + r], fill=255)
        return m

    def poly(self, points):
        m = self.mask()
        ImageDraw.Draw(m).polygon([(x * SS, y * SS) for x, y in points], fill=255)
        return m

    def paint(self, mask, light, dark, edge=0.5, edge_px=1.1, bounds=None):
        """Gradient from `light` (top left) to `dark` (bottom right) inside the mask, edged in a shade of `dark`."""
        bbox = mask.getbbox()
        if not bbox:
            return
        x0, y0, x1, y1 = bbox if bounds is None else [v * SS for v in bounds]
        ys, xs = np.mgrid[0 : self.img.size[1], 0 : self.img.size[0]]
        t = ((xs - x0) / max(1, x1 - x0) * 0.45 + (ys - y0) / max(1, y1 - y0) * 0.55).clip(0, 1)
        light, dark = np.array(light, dtype=float), np.array(dark, dtype=float)
        rgb = (light[None, None, :] * (1 - t[..., None]) + dark[None, None, :] * t[..., None]).astype(np.uint8)
        fill = Image.fromarray(rgb, "RGB").convert("RGBA")
        if edge:
            grown = mask.filter(ImageFilter.MaxFilter(int(edge_px * 2 * SS) | 1))
            edge_col = tuple(int(c * edge) for c in dark) + (255,)
            self.img.alpha_composite(Image.composite(Image.new("RGBA", self.img.size, edge_col), Image.new("RGBA", self.img.size, (0, 0, 0, 0)), grown))
        self.img.alpha_composite(Image.composite(fill, Image.new("RGBA", self.img.size, (0, 0, 0, 0)), mask))

    def gloss(self, cx, cy, rx, ry, alpha=0.4, within=None):
        m = self.ellipse(cx, cy, rx, ry).filter(ImageFilter.GaussianBlur(SS * 1.6))
        m = m.point(lambda v: int(v * alpha))
        if within is not None:
            m = Image.composite(m, Image.new("L", m.size, 0), within)
        self.img.alpha_composite(Image.composite(Image.new("RGBA", self.img.size, (255, 255, 255, 255)), Image.new("RGBA", self.img.size, (0, 0, 0, 0)), m))

    def shadow(self, mask, dx=3, dy=5, alpha=0.38, blur=3.5):
        m = Image.new("L", mask.size, 0)
        m.paste(mask, (int(dx * SS), int(dy * SS)))
        m = m.filter(ImageFilter.GaussianBlur(SS * blur)).point(lambda v: int(v * alpha))
        under = Image.composite(Image.new("RGBA", self.img.size, (0, 0, 0, 255)), Image.new("RGBA", self.img.size, (0, 0, 0, 0)), m)
        under.alpha_composite(self.img)
        self.img = under

    def outline(self, px=2.4, color=(10, 11, 14)):
        alpha = self.img.getchannel("A").point(lambda v: 255 if v > 8 else 0)
        grown = alpha.filter(ImageFilter.MaxFilter(int(px * 2 * SS) | 1))
        base = Image.composite(Image.new("RGBA", self.img.size, color + (255,)), Image.new("RGBA", self.img.size, (0, 0, 0, 0)), grown)
        base.alpha_composite(self.img)
        self.img = base

    def save(self, path):
        self.img.resize((self.w, self.h), Image.LANCZOS).save(path)


def both(a, b):
    from PIL import ImageChops
    return ImageChops.multiply(a, b)


def union(*masks):
    from PIL import ImageChops
    out = masks[0]
    for m in masks[1:]:
        out = ImageChops.lighter(out, m)
    return out
