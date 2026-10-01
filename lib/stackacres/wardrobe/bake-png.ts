/**
 * A small PNG decoder for the wardrobe's layer atlases, so the baker never goes through a canvas.
 *
 * A canvas stores pixels premultiplied, which changes the colour of every half-transparent pixel on
 * the way back out (LPC hair has thousands), and some browsers add noise to canvas reads to stop
 * fingerprinting. Either would make the baked farmer differ from build.py's. Decoding the PNG
 * here gives the exact bytes. Inflate is the platform's DecompressionStream (browsers and Node 18+).
 *
 * Handles what the art pipeline writes: non-interlaced 8-bit greyscale, RGB, grey+alpha and RGBA,
 * and palette images (with tRNS) at 1, 2, 4 or 8 bits, which Pillow picks for small palettes.
 */

import type { RgbaImage } from "./bake-pixels";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let colourType = 0;
  let depth = 8;
  let palette: Uint8Array | null = null;
  let alphas: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = body[8];
      colourType = body[9];
      if (body[12] !== 0) throw new Error("interlaced PNGs are not handled");
      if (depth !== 8 && !(colourType === 3 && (depth === 1 || depth === 2 || depth === 4))) {
        throw new Error(`PNG bit depth ${depth} not handled`);
      }
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "tRNS") {
      alphas = body;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`PNG colour type ${colourType} not handled`);
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const chunk of idat) {
    joined.set(chunk, o);
    o += chunk.length;
  }
  const raw = await inflate(joined);
  const stride = Math.ceil((width * channels * depth) / 8);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      else if (filter !== 0) throw new Error("bad PNG filter");
      out[x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  if (depth < 8) {
    // Unpack sub-byte palette indices to one byte each, so the loop below reads them like 8-bit.
    const perByte = 8 / depth;
    const mask = (1 << depth) - 1;
    const unpacked = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = rows[y * stride + Math.floor(x / perByte)];
        unpacked[y * width + x] = (byte >> (8 - depth * ((x % perByte) + 1))) & mask;
      }
    }
    return expand(unpacked, 1, width, height, colourType, palette, alphas, data);
  }
  return expand(rows, channels, width, height, colourType, palette, alphas, data);
}

function expand(
  rows: Uint8Array,
  channels: number,
  width: number,
  height: number,
  colourType: number,
  palette: Uint8Array | null,
  alphas: Uint8Array | null,
  data: Uint8ClampedArray,
): RgbaImage {
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const d = i * 4;
    if (colourType === 6) {
      data[d] = rows[s];
      data[d + 1] = rows[s + 1];
      data[d + 2] = rows[s + 2];
      data[d + 3] = rows[s + 3];
    } else if (colourType === 2) {
      data[d] = rows[s];
      data[d + 1] = rows[s + 1];
      data[d + 2] = rows[s + 2];
      data[d + 3] = 255;
    } else if (colourType === 3) {
      if (!palette) throw new Error("palette PNG without PLTE");
      const p = rows[s];
      data[d] = palette[p * 3];
      data[d + 1] = palette[p * 3 + 1];
      data[d + 2] = palette[p * 3 + 2];
      data[d + 3] = alphas && p < alphas.length ? alphas[p] : 255;
    } else {
      data[d] = data[d + 1] = data[d + 2] = rows[s];
      data[d + 3] = colourType === 4 ? rows[s + 1] : 255;
    }
  }
  return { width, height, data };
}
