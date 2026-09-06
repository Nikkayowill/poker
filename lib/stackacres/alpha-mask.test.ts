import { describe, expect, it } from "vitest";
import {
  ALPHA_HIT_THRESHOLD,
  ALPHA_MASK_RESOLUTION,
  alphaMaskAt,
  alphaMaskCovers,
  alphaMaskGrid,
  boundsPoint,
  buildAlphaMask,
} from "./alpha-mask";

/** An RGBA buffer whose alpha channel is whatever `alpha` says for that
 *  pixel. Colour is left black throughout: nothing here reads it, and a mask
 *  that ever started depending on colour would be the bug. */
function rgba(width: number, height: number, alpha: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[(y * width + x) * 4 + 3] = alpha(x, y);
    }
  }
  return data;
}

describe("alphaMaskGrid", () => {
  it("gives the longest side the full resolution and keeps the cells square", () => {
    expect(alphaMaskGrid(64, 64)).toEqual({ cols: 32, rows: 32 });
    expect(alphaMaskGrid(64, 32)).toEqual({ cols: 32, rows: 16 });
    expect(alphaMaskGrid(32, 64)).toEqual({ cols: 16, rows: 32 });
  });

  it("never asks for more cells than the source has pixels", () => {
    expect(alphaMaskGrid(4, 4)).toEqual({ cols: 4, rows: 4 });
    expect(alphaMaskGrid(1, 1)).toEqual({ cols: 1, rows: 1 });
  });

  it("has nothing to grid for an empty source", () => {
    expect(alphaMaskGrid(0, 10)).toEqual({ cols: 0, rows: 0 });
    expect(alphaMaskGrid(10, -1)).toEqual({ cols: 0, rows: 0 });
  });
});

describe("buildAlphaMask", () => {
  it("reads a fully opaque texture as covered everywhere", () => {
    const mask = buildAlphaMask(32, 32, rgba(32, 32, () => 255));
    expect(alphaMaskAt(mask, 0, 0)).toBe(1);
    expect(alphaMaskAt(mask, 0.5, 0.5)).toBe(1);
    expect(alphaMaskAt(mask, 0.999, 0.999)).toBe(1);
  });

  it("reads a fully transparent texture as air everywhere", () => {
    const mask = buildAlphaMask(32, 32, rgba(32, 32, () => 0));
    expect(alphaMaskCovers(mask, 0.5, 0.5)).toBe(false);
    expect(alphaMaskCovers(mask, 0.1, 0.9)).toBe(false);
  });

  /**
   * The case the whole module exists for: a plant standing in the bottom half
   * of its own box, with the top half empty air. A thumb in that upper corner
   * must not read as touching the plant.
   */
  it("rejects the transparent upper corner of a bottom-heavy plant", () => {
    const mask = buildAlphaMask(64, 64, rgba(64, 64, (_x, y) => (y >= 32 ? 255 : 0)));
    expect(alphaMaskCovers(mask, 0.5, 0.1)).toBe(false);
    expect(alphaMaskCovers(mask, 0.9, 0.05)).toBe(false);
    expect(alphaMaskCovers(mask, 0.5, 0.8)).toBe(true);
    expect(alphaMaskCovers(mask, 0.1, 0.99)).toBe(true);
  });

  it("keeps the largest alpha under a cell, not the average", () => {
    // One opaque pixel in an otherwise empty 2x2 block. Averaging would give
    // 64/255 and, at a higher threshold, throw away a real leaf edge.
    const mask = buildAlphaMask(2, 2, rgba(2, 2, (x, y) => (x === 0 && y === 0 ? 255 : 0)), 1);
    expect(mask.cols).toBe(1);
    expect(mask.rows).toBe(1);
    expect(alphaMaskAt(mask, 0.5, 0.5)).toBe(1);
  });

  it("treats a resampler's faint fringe as air", () => {
    // 12/255 is inside the band a high-quality canvas resample leaves outside
    // a silhouette -- above zero, and well below the threshold.
    const mask = buildAlphaMask(32, 32, rgba(32, 32, () => 12));
    expect(alphaMaskAt(mask, 0.5, 0.5)).toBeLessThan(ALPHA_HIT_THRESHOLD);
    expect(alphaMaskCovers(mask, 0.5, 0.5)).toBe(false);
  });

  it("survives a buffer shorter than the size it was handed", () => {
    const short = new Uint8ClampedArray(16 * 4);
    expect(() => buildAlphaMask(32, 32, short)).not.toThrow();
    expect(alphaMaskCovers(buildAlphaMask(32, 32, short), 0.9, 0.9)).toBe(false);
  });

  it("stays small enough to keep per texture", () => {
    const mask = buildAlphaMask(256, 256, rgba(256, 256, () => 255));
    expect(mask.cells.length).toBe(ALPHA_MASK_RESOLUTION * ALPHA_MASK_RESOLUTION);
  });
});

describe("alphaMaskAt", () => {
  it("reads outside the texture as air rather than throwing", () => {
    const mask = buildAlphaMask(8, 8, rgba(8, 8, () => 255));
    expect(alphaMaskAt(mask, -0.01, 0.5)).toBe(0);
    expect(alphaMaskAt(mask, 0.5, 1)).toBe(0);
    expect(alphaMaskAt(mask, 1.5, 1.5)).toBe(0);
  });

  it("reads an empty mask as air", () => {
    expect(alphaMaskAt(buildAlphaMask(0, 0, new Uint8ClampedArray(0)), 0.5, 0.5)).toBe(0);
  });
});

describe("boundsPoint", () => {
  const box = { x: 100, y: 200, width: 40, height: 80 };

  it("puts a point at the box's own top-left at the mask's origin", () => {
    expect(boundsPoint(100, 200, box)).toEqual({ u: 0, v: 0 });
  });

  it("runs v top-down, matching an image buffer's row order", () => {
    const near = boundsPoint(120, 210, box);
    const far = boundsPoint(120, 270, box);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(near!.v).toBeLessThan(far!.v);
  });

  it("is null outside the box on every side", () => {
    expect(boundsPoint(99, 240, box)).toBeNull();
    expect(boundsPoint(141, 240, box)).toBeNull();
    expect(boundsPoint(120, 199, box)).toBeNull();
    expect(boundsPoint(120, 281, box)).toBeNull();
  });

  it("is null for a box with no area", () => {
    expect(boundsPoint(0, 0, { x: 0, y: 0, width: 0, height: 10 })).toBeNull();
  });
});
