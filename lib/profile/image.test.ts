import { describe, expect, it } from "vitest";
import { MAX_AVATAR_DIMENSION, MAX_AVATAR_PIXELS, readImageDimensions } from "./image";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  bytes.set([0, 0, 0, 13], 8); // chunk length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(10);
  bytes.set(new TextEncoder().encode("GIF89a"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(29);
  bytes.set([0xff, 0xd8], 0); // SOI
  bytes.set([0xff, 0xe0, 0x00, 0x10], 2); // APP0 marker, length 16
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20); // SOF0 marker, length 17, precision 8
  const view = new DataView(bytes.buffer);
  view.setUint16(25, height);
  view.setUint16(27, width);
  return bytes;
}

function webpExtended(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode("VP8X"), 12);
  bytes[24] = (width - 1) & 0xff;
  bytes[25] = ((width - 1) >> 8) & 0xff;
  bytes[26] = ((width - 1) >> 16) & 0xff;
  bytes[27] = (height - 1) & 0xff;
  bytes[28] = ((height - 1) >> 8) & 0xff;
  bytes[29] = ((height - 1) >> 16) & 0xff;
  return bytes;
}

describe("readImageDimensions", () => {
  it("reads PNG width/height from the IHDR chunk", () => {
    expect(readImageDimensions(png(800, 600), "image/png")).toEqual({ width: 800, height: 600 });
  });

  it("reads GIF width/height from the logical screen descriptor", () => {
    expect(readImageDimensions(gif(320, 240), "image/gif")).toEqual({ width: 320, height: 240 });
  });

  it("reads JPEG width/height from the SOF0 marker", () => {
    expect(readImageDimensions(jpeg(200, 100), "image/jpeg")).toEqual({ width: 200, height: 100 });
  });

  it("reads extended WebP (VP8X) width/height", () => {
    expect(readImageDimensions(webpExtended(99, 49), "image/webp")).toEqual({ width: 99, height: 49 });
  });

  it("flags a pixel-bomb PNG (tiny file, enormous declared canvas) as over the cap", () => {
    const dimensions = readImageDimensions(png(60000, 60000), "image/png")!;
    expect(dimensions.width > MAX_AVATAR_DIMENSION || dimensions.width * dimensions.height > MAX_AVATAR_PIXELS).toBe(true);
  });

  it("returns null for a truncated or malformed header", () => {
    expect(readImageDimensions(new Uint8Array(4), "image/png")).toBeNull();
  });
});
