import { describe, expect, it } from "vitest";
import {
  ellipseRimSamples,
  ndcToViewport,
  scaleBetween,
  screenExtent,
} from "./scene-projection";

const RECT = { left: 40, top: 100, width: 800, height: 400 };

describe("ndcToViewport", () => {
  it("puts the NDC origin at the canvas's centre", () => {
    expect(ndcToViewport({ x: 0, y: 0 }, RECT)).toEqual({ x: 440, y: 300 });
  });

  it("flips y, because NDC counts up and the DOM counts down", () => {
    // NDC +1 is the TOP of the viewport, which is the SMALLEST DOM y. Getting
    // this backwards is invisible on a centred point and wrong everywhere
    // else, so both extremes are pinned rather than the midpoint.
    expect(ndcToViewport({ x: 0, y: 1 }, RECT).y).toBe(RECT.top);
    expect(ndcToViewport({ x: 0, y: -1 }, RECT).y).toBe(RECT.top + RECT.height);
  });

  it("carries the canvas's own offset, so answers are page coordinates", () => {
    // Every consumer compares this against a getBoundingClientRect() from the
    // DOM HUD. Dropping the offset would be wrong by the header's height on
    // every page that has one, and would still look plausible.
    expect(ndcToViewport({ x: -1, y: 1 }, RECT)).toEqual({ x: 40, y: 100 });
    expect(ndcToViewport({ x: 1, y: -1 }, RECT)).toEqual({ x: 840, y: 500 });
  });

  it("does not clamp a point projected off-screen", () => {
    // A chip mid-arc can leave the frustum. Clamping would report it sitting
    // on the edge, which reads as a real position rather than an absent one.
    const off = ndcToViewport({ x: 2, y: -3 }, RECT);
    expect(off.x).toBeGreaterThan(RECT.left + RECT.width);
    expect(off.y).toBeGreaterThan(RECT.top + RECT.height);
  });
});

describe("screenExtent", () => {
  it("is the bounding box of the points it was given", () => {
    expect(screenExtent([
      { x: 10, y: 5 },
      { x: 30, y: 25 },
      { x: 20, y: 15 },
    ])).toEqual({ width: 20, height: 20 });
  });

  it("is zero for no points rather than throwing or reporting Infinity", () => {
    // A room mid-teardown can answer with nothing. -Infinity here would
    // propagate into a spec's arithmetic and fail somewhere unrelated.
    expect(screenExtent([])).toEqual({ width: 0, height: 0 });
  });

  it("handles a single point as a degenerate box", () => {
    expect(screenExtent([{ x: 7, y: 9 }])).toEqual({ width: 0, height: 0 });
  });
});

describe("ellipseRimSamples", () => {
  it("returns the requested count, evenly around the rim", () => {
    const samples = ellipseRimSamples(2, 1, 0.86, 4);
    expect(samples).toHaveLength(4);
    expect(samples[0].x).toBeCloseTo(2, 10);
    expect(samples[0].z).toBeCloseTo(0, 10);
    expect(samples[1].x).toBeCloseTo(0, 10);
    expect(samples[1].z).toBeCloseTo(1, 10);
  });

  it("keeps every sample on the ellipse and on the given plane", () => {
    const radiusX = 2.15;
    const radiusZ = 1.32;
    for (const point of ellipseRimSamples(radiusX, radiusZ, 0.86, 32)) {
      expect((point.x / radiusX) ** 2 + (point.z / radiusZ) ** 2).toBeCloseTo(1, 10);
      expect(point.y).toBe(0.86);
    }
  });

  it("does not repeat the first point as the last", () => {
    // A duplicated seam point costs nothing in an extent, but it would in
    // anything that averages these, so the interval is half-open by design.
    const samples = ellipseRimSamples(2, 1, 0, 8);
    expect(samples[0]).not.toEqual(samples[samples.length - 1]);
  });
});

describe("scaleBetween", () => {
  it("is projected distance over world distance", () => {
    expect(scaleBetween({ x: 0, y: 0 }, { x: 200, y: 0 }, 2)).toBe(100);
  });

  it("measures the real separation, not just the horizontal one", () => {
    // The probe is horizontal in world space, but a tilted camera projects it
    // to a slanted screen segment; taking only dx would understate the scale.
    expect(scaleBetween({ x: 0, y: 0 }, { x: 30, y: 40 }, 5)).toBe(10);
  });

  it("is zero for a zero baseline rather than dividing by it", () => {
    expect(scaleBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBe(0);
  });
});
