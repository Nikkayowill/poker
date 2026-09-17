import { describe, expect, it } from "vitest";
import { GUST_EVERY_MS, RUSTLE, gustAt, rustleOffset, swayOffset } from "./wind";

describe("swayOffset", () => {
  it("stays in whole pixels between upright and the amplitude", () => {
    for (let t = 0; t < 60_000; t += 37) {
      const offset = swayOffset(t, 120, 300, 1);
      expect(Number.isInteger(offset)).toBe(true);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(1);
    }
  });

  it("actually moves over time", () => {
    const seen = new Set<number>();
    for (let t = 0; t < 20_000; t += 100) seen.add(swayOffset(t, 40, 40));
    expect(seen).toEqual(new Set([0, 1]));
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
