import { describe, expect, it } from "vitest";
import { clampCentre, clampZoom, ease, nearestWholeZoom, roomZoom, settled, zoomRange } from "./camera";

// The Old Fields at 44 x 40 tiles of 16px, on a phone-sized canvas at dpr 3.
const OLD_FIELDS = { w: 44 * 16, h: 40 * 16 };
const PHONE = { w: 390 * 3, h: 720 * 3 };

describe("zoomRange", () => {
  it("lets a phone zoom out until the whole field fits", () => {
    const range = zoomRange(PHONE.w, PHONE.h, OLD_FIELDS.w, OLD_FIELDS.h, 5);
    expect(range.min).toBe(1);
    expect(range.max).toBe(7);
    // At the bottom of the range the whole map is on screen.
    expect(OLD_FIELDS.w * range.min).toBeLessThanOrEqual(PHONE.w);
    expect(OLD_FIELDS.h * range.min).toBeLessThanOrEqual(PHONE.h);
  });

  it("never offers a zoom further out than the follow zoom", () => {
    // A tiny area already fits at the follow zoom, so there is nothing to pull back to.
    const range = zoomRange(PHONE.w, PHONE.h, 160, 160, 4);
    expect(range.min).toBe(4);
    expect(range.max).toBeGreaterThan(range.min);
  });

  it("never goes below 1 device pixel per art pixel", () => {
    const range = zoomRange(200, 200, 4000, 4000, 3);
    expect(range.min).toBe(1);
  });
});

describe("nearestWholeZoom", () => {
  const range = { min: 1, max: 7 };

  it("settles a pinch on the nearest whole step", () => {
    expect(nearestWholeZoom(3.4, range)).toBe(3);
    expect(nearestWholeZoom(3.6, range)).toBe(4);
  });

  it("settles inside the range even when the pinch overshot it", () => {
    expect(nearestWholeZoom(0.2, range)).toBe(1);
    expect(nearestWholeZoom(99, range)).toBe(7);
  });

  it("always returns a whole number, which is what keeps the art crisp", () => {
    for (const zoom of [1.1, 2.5, 4.9, 6.75]) {
      expect(Number.isInteger(nearestWholeZoom(zoom, range))).toBe(true);
    }
  });
});

describe("clampZoom", () => {
  it("holds a live pinch inside the range without rounding it", () => {
    expect(clampZoom(3.37, { min: 1, max: 7 })).toBeCloseTo(3.37);
    expect(clampZoom(12, { min: 1, max: 7 })).toBe(7);
    expect(clampZoom(0.1, { min: 1, max: 7 })).toBe(1);
  });
});

describe("clampCentre", () => {
  it("keeps the view inside the area", () => {
    const at = clampCentre({ x: 0, y: 0 }, 200, 100, OLD_FIELDS.w, OLD_FIELDS.h);
    expect(at).toEqual({ x: 100, y: 50 });
    const far = clampCentre({ x: 9999, y: 9999 }, 200, 100, OLD_FIELDS.w, OLD_FIELDS.h);
    expect(far).toEqual({ x: OLD_FIELDS.w - 100, y: OLD_FIELDS.h - 50 });
  });

  it("centres an axis the view is wider than, so it cannot pan", () => {
    const at = clampCentre({ x: 0, y: 300 }, 2000, 100, OLD_FIELDS.w, OLD_FIELDS.h);
    expect(at.x).toBe(OLD_FIELDS.w / 2);
    expect(at.y).toBe(300);
  });

  it("leaves a centre that is already legal alone", () => {
    expect(clampCentre({ x: 300, y: 300 }, 200, 100, OLD_FIELDS.w, OLD_FIELDS.h)).toEqual({ x: 300, y: 300 });
  });
});

describe("ease", () => {
  it("covers the same share of the gap regardless of frame length", () => {
    const oneLongFrame = ease(0, 100, 0.25, 32);
    let twoShortFrames = ease(0, 100, 0.25, 16);
    twoShortFrames = ease(twoShortFrames, 100, 0.25, 16);
    expect(oneLongFrame).toBeCloseTo(twoShortFrames, 5);
  });

  it("moves toward the target and never past it", () => {
    expect(ease(0, 100, 0.25, 16)).toBeGreaterThan(0);
    expect(ease(0, 100, 0.25, 16)).toBeLessThan(100);
    expect(ease(100, 0, 0.25, 16)).toBeLessThan(100);
  });

  it("stands still on a zero-length frame", () => {
    expect(ease(10, 100, 0.25, 0)).toBe(10);
  });
});

describe("settled", () => {
  it("stops the ease once the gap is under the epsilon", () => {
    expect(settled(99.9, 100, 0.25)).toBe(true);
    expect(settled(99, 100, 0.25)).toBe(false);
  });
});

describe("roomZoom", () => {
  // A landscape phone at dpr 3, and the follow zoom topdown-world.tsx picks for it.
  const LANDSCAPE = { w: 2532, h: 1170 };

  it("shows a small room whole at the crispest whole zoom that fits it", () => {
    expect(roomZoom(LANDSCAPE.w, LANDSCAPE.h, 240, 160, 7)).toBe(7);
    expect(roomZoom(LANDSCAPE.w, LANDSCAPE.h, 320, 176, 7)).toBe(6);
  });

  it("drops below the follow zoom for a room the follow zoom would crop", () => {
    // 384 x 176 at zoom 7 is 2688 x 1232: wider and taller than the screen. Zoom 6 shows all of it.
    expect(roomZoom(LANDSCAPE.w, LANDSCAPE.h, 384, 176, 7)).toBe(6);
  });

  it("never pushes a tiny room in past the range a pinch could reach", () => {
    expect(roomZoom(LANDSCAPE.w, LANDSCAPE.h, 96, 64, 7)).toBe(9);
  });

  it("is always a whole number, which keeps the art crisp", () => {
    expect(Number.isInteger(roomZoom(2000, 913, 300, 170, 5))).toBe(true);
  });
});
