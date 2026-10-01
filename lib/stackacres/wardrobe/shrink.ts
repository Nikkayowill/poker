/**
 * lpc.shrink (art/stackacres-td/lpc/lpc.py), bit-exact: how LPC's 50px-tall people become the
 * game's 31px ones.
 *
 * lpc.shrink premultiplies alpha, hands the image to Pillow's LANCZOS resize (which, for RGBA,
 * premultiplies a second time and undoes it after), then un-premultiplies and drops every pixel
 * under alpha 115. Each step here is Pillow's integer arithmetic from libImaging/Resample.c and
 * Convert.c, so the output matches byte for byte.
 */

import { blankImage, type RgbaImage } from "./bake-pixels";

const PRECISION_BITS = 32 - 8 - 2;
const HALF = 1 << (PRECISION_BITS - 1);
const CLIP_HIGH = 1 << PRECISION_BITS << 8;

interface Kernel {
  readonly start: Int32Array;
  readonly size: Int32Array;
  readonly width: number;
  readonly weights: Int32Array;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = x * Math.PI;
  return Math.sin(px) / px;
}

function lanczos(x: number): number {
  return x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0;
}

const kernels = new Map<string, Kernel>();

/** precompute_coeffs + normalize_coeffs_8bpc for LANCZOS, cached per size pair. */
function kernel(inSize: number, outSize: number): Kernel {
  const cacheKey = `${inSize}>${outSize}`;
  const cached = kernels.get(cacheKey);
  if (cached) return cached;
  const scale = inSize / outSize;
  const filterScale = Math.max(1, scale);
  const support = 3 * filterScale;
  const width = Math.ceil(support) * 2 + 1;
  const start = new Int32Array(outSize);
  const size = new Int32Array(outSize);
  const weights = new Int32Array(outSize * width);
  const pre = new Float64Array(width);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const ss = 1 / filterScale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss);
      pre[x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) {
      const k = ww !== 0 ? pre[x] / ww : pre[x];
      weights[xx * width + x] = k < 0 ? Math.trunc(-0.5 + k * (1 << PRECISION_BITS)) : Math.trunc(0.5 + k * (1 << PRECISION_BITS));
    }
    start[xx] = xmin;
    size[xx] = xmax;
  }
  const out = { start, size, width, weights };
  kernels.set(cacheKey, out);
  return out;
}

function clip8(v: number): number {
  if (v >= CLIP_HIGH) return 255;
  if (v <= 0) return 0;
  return v >> PRECISION_BITS;
}

/** One LPC frame shrunk to `width` x `height`, as lpc.shrink(img, height) does it. */
export function shrinkLpc(img: RgbaImage, width: number, height: number): RgbaImage {
  const w = img.width;
  const h = img.height;
  const src = img.data;
  // lpc.shrink's premultiply, then Pillow's RGBA -> RGBa (MULDIV255).
  const pre = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    const a = src[i + 3];
    for (let c = 0; c < 3; c++) {
      const once = Math.floor((src[i + c] * a) / 255);
      const t = once * a + 128;
      pre[i + c] = ((t >> 8) + t) >> 8;
    }
    pre[i + 3] = a;
  }
  // Horizontal pass, then vertical, 22-bit fixed point.
  const hk = kernel(w, width);
  const tmp = new Uint8Array(width * h * 4);
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < width; xx++) {
      const xmin = hk.start[xx];
      const n = hk.size[xx];
      const k0 = xx * hk.width;
      let s0 = HALF, s1 = HALF, s2 = HALF, s3 = HALF;
      let p = (y * w + xmin) * 4;
      for (let x = 0; x < n; x++, p += 4) {
        const k = hk.weights[k0 + x];
        s0 += pre[p] * k;
        s1 += pre[p + 1] * k;
        s2 += pre[p + 2] * k;
        s3 += pre[p + 3] * k;
      }
      const o = (y * width + xx) * 4;
      tmp[o] = clip8(s0);
      tmp[o + 1] = clip8(s1);
      tmp[o + 2] = clip8(s2);
      tmp[o + 3] = clip8(s3);
    }
  }
  const vk = kernel(h, height);
  const out = blankImage(width, height);
  const od = out.data;
  const px = [0, 0, 0, 0];
  for (let yy = 0; yy < height; yy++) {
    const ymin = vk.start[yy];
    const n = vk.size[yy];
    const k0 = yy * vk.width;
    for (let x = 0; x < width; x++) {
      let s0 = HALF, s1 = HALF, s2 = HALF, s3 = HALF;
      let p = (ymin * width + x) * 4;
      for (let y = 0; y < n; y++, p += width * 4) {
        const k = vk.weights[k0 + y];
        s0 += tmp[p] * k;
        s1 += tmp[p + 1] * k;
        s2 += tmp[p + 2] * k;
        s3 += tmp[p + 3] * k;
      }
      px[0] = clip8(s0);
      px[1] = clip8(s1);
      px[2] = clip8(s2);
      const a = clip8(s3);
      // Pillow's RGBa -> RGBA, then lpc.shrink's own un-premultiply and alpha cut at 115.
      if (a < 115) continue;
      const o = (yy * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const straight = a === 255 ? px[c] : Math.min(255, Math.floor((255 * px[c]) / a));
        od[o + c] = Math.min(255, Math.floor((straight * 255) / a));
      }
      od[o + 3] = 255;
    }
  }
  return out;
}
