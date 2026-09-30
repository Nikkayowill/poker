import { describe, expect, it } from "vitest";
import { BACKSWING, GUST_EVERY_MS, RUSTLE, gustAt, rustleOffset, swayOffset } from "./wind";

describe("swayOffset", () => {
  it("stays between a little back past upright and the full amplitude downwind", () => {
    for (let t = 0; t < 60_000; t += 37) {
      const offset = swayOffset(t, 120, 300, 2);
      expect(offset).toBeGreaterThanOrEqual(-BACKSWING * 2);
      expect(offset).toBeLessThanOrEqual(2);
    }
  });

  it("moves smoothly rather than flicking between two positions", () => {
    // The old wind snapped to whole pixels, so a tree only ever had two places to be.
    const seen = new Set<number>();
    for (let t = 0; t < 20_000; t += 100) seen.add(Math.round(swayOffset(t, 40, 40, 2) * 100));
    expect(seen.size).toBeGreaterThan(50);
    // And a frame apart it barely moves: no jumps.
    for (let t = 0; t < 20_000; t += 16) {
      expect(Math.abs(swayOffset(t + 16, 40, 40, 2) - swayOffset(t, 40, 40, 2))).toBeLessThan(0.2);
    }
  });

  it("leans downwind far more than it swings back", () => {
    let east = 0;
    let west = 0;
    for (let t = 0; t < 60_000; t += 50) {
      const offset = swayOffset(t, 40, 40, 2);
      if (offset > 0) east++;
      else if (offset < 0) west++;
    }
    expect(east).toBeGreaterThan(west * 3);
  });

  it("keeps neighbouring trees out of step", () => {
    let differ = 0;
    for (let t = 0; t < 20_000; t += 100) if (swayOffset(t, 100, 100) !== swayOffset(t, 122, 104)) differ++;
    expect(differ).toBeGreaterThan(20);
  });

  it("is the same for the same moment and place", () => {
    expect(swayOffset(12_345, 7, 9)).toBe(swayOffset(12_345, 7, 9));
  });
});

describe("gustAt", () => {
  it("rolls east: the gust reaches a point further east later", () => {
    const peak = (x: number) => {
      let best = 0;
      let at = 0;
      for (let t = 0; t < GUST_EVERY_MS; t += 10) {
        const g = gustAt(t, x);
        if (g > best) [best, at] = [g, t];
      }
      return at;
    };
    expect(peak(300)).toBeGreaterThan(peak(100));
  });

  it("stays between calm and full", () => {
    for (let t = 0; t < GUST_EVERY_MS; t += 50) {
      const g = gustAt(t, 200);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });
});

describe("rustleOffset", () => {
  it("plays each step, then ends", () => {
    expect(rustleOffset(0)).toBe(RUSTLE[0]);
    expect(rustleOffset(75)).toBe(RUSTLE[1]);
    expect(rustleOffset(10_000)).toBeNull();
  });
});
