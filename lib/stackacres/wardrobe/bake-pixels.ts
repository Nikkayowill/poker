/**
 * The pixel operations the farmer's sheet is made with, each one integer-exact with the Pillow call
 * art/stackacres-td/lpc/build.py makes, so a baked sheet is byte-identical to one build.py writes.
 */

/** Straight (not premultiplied) RGBA, row-major. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export function blankImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/**
 * Pillow's `Image.alpha_composite(src, dest)` for a region of `src`: the rectangle (sx, sy, sw, sh)
 * of `src` drawn over `dst` with its corner at (dx, dy). Off-canvas pixels are dropped, as Pillow's
 * crop-composite-paste drops them. Integer maths from libImaging/AlphaComposite.c.
 */
export function compositeOver(
  dst: RgbaImage,
  src: RgbaImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
): void {
  const d = dst.data;
  const s = src.data;
  const x0 = Math.max(0, -dx);
  const y0 = Math.max(0, -dy);
  const x1 = Math.min(sw, dst.width - dx);
  const y1 = Math.min(sh, dst.height - dy);
  for (let y = y0; y < y1; y++) {
    let si = ((sy + y) * src.width + sx + x0) * 4;
    let di = ((dy + y) * dst.width + dx + x0) * 4;
    for (let x = x0; x < x1; x++, si += 4, di += 4) {
      const sa = s[si + 3];
      if (sa === 0) continue;
      const da = d[di + 3];
      const blend = da * (255 - sa);
      const outa255 = sa * 255 + blend;
      const coef1 = Math.floor((sa * 255 * 255 * 128) / outa255);
      const coef2 = 255 * 128 - coef1;
      for (let c = 0; c < 3; c++) {
        const tmp = s[si + c] * coef1 + d[di + c] * coef2 + (0x80 << 7);
        d[di + c] = (((tmp >> 8) + tmp) >> 8) >> 7;
      }
      const a = outa255 + 0x80;
      d[di + 3] = ((a >> 8) + a) >> 8;
    }
  }
}

/** Pillow's getbbox() on RGBA (alpha only): [left, top, right, bottom], or null when empty. */
export function alphaBox(img: RgbaImage): [number, number, number, number] | null {
  let left = img.width;
  let top = img.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  return right < 0 ? null : [left, top, right + 1, bottom + 1];
}

/** A new image with `img` drawn over nothing at (dx, dy): build.shifted, and a paste into a frame. */
export function drawnAt(img: RgbaImage, width: number, height: number, dx: number, dy: number): RgbaImage {
  const out = blankImage(width, height);
  compositeOver(out, img, 0, 0, img.width, img.height, dx, dy);
  return out;
}

/** An RGB triple as one number, for colour tables. */
export function rgbKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

/** lpc.recolor: every visible pixel whose colour is in the table takes the new colour. */
export function recolour(img: RgbaImage, table: ReadonlyMap<number, number>): RgbaImage {
  if (table.size === 0) return img;
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const hit = table.get(rgbKey(data[i], data[i + 1], data[i + 2]));
    if (hit === undefined) continue;
    data[i] = hit >> 16;
    data[i + 1] = (hit >> 8) & 255;
    data[i + 2] = hit & 255;
  }
  return { width: img.width, height: img.height, data };
}
