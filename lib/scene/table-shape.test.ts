import { describe, expect, it } from "vitest";
import {
  STADIUM_CAP_SEGMENTS,
  offsetStadium,
  stadiumOutline,
  stadiumStraightHalf,
} from "./table-shape";

describe("stadiumStraightHalf", () => {
  it("is the length minus the width when longer than it is wide", () => {
    expect(stadiumStraightHalf(2.15, 1.08)).toBeCloseTo(1.07, 10);
  });

  it("clamps at zero once the shape is rounder than it is long", () => {
    expect(stadiumStraightHalf(1, 1)).toBe(0);
    expect(stadiumStraightHalf(1, 2)).toBe(0);
  });
});

describe("stadiumOutline", () => {
  const halfLength = 2.15;
  const halfWidth = 1.08;
  const straightHalf = stadiumStraightHalf(halfLength, halfWidth);
  const points = stadiumOutline(halfLength, halfWidth);

  it("returns two capSegments+1 arcs, right cap then left cap", () => {
    expect(points).toHaveLength(2 * (STADIUM_CAP_SEGMENTS + 1));
  });

  it("starts at the near-right corner and ends at the near-left corner", () => {
    expect(points[0].x).toBeCloseTo(straightHalf, 10);
    expect(points[0].z).toBeCloseTo(-halfWidth, 10);
    const last = points[points.length - 1];
    expect(last.x).toBeCloseTo(-straightHalf, 10);
    expect(last.z).toBeCloseTo(-halfWidth, 10);
  });

  it("the right cap ends and the left cap starts at the shared top corners", () => {
    const rightCapEnd = points[STADIUM_CAP_SEGMENTS];
    const leftCapStart = points[STADIUM_CAP_SEGMENTS + 1];
    expect(rightCapEnd.x).toBeCloseTo(straightHalf, 10);
    expect(rightCapEnd.z).toBeCloseTo(halfWidth, 10);
    expect(leftCapStart.x).toBeCloseTo(-straightHalf, 10);
    expect(leftCapStart.z).toBeCloseTo(halfWidth, 10);
  });

  it("every right-cap point sits exactly halfWidth from the right cap centre", () => {
    for (let i = 0; i <= STADIUM_CAP_SEGMENTS; i += 1) {
      const p = points[i];
      const distance = Math.hypot(p.x - straightHalf, p.z);
      expect(distance).toBeCloseTo(halfWidth, 10);
    }
  });

  it("every left-cap point sits exactly halfWidth from the left cap centre", () => {
    for (let i = STADIUM_CAP_SEGMENTS + 1; i < points.length; i += 1) {
      const p = points[i];
      const distance = Math.hypot(p.x + straightHalf, p.z);
      expect(distance).toBeCloseTo(halfWidth, 10);
    }
  });

  it("stays within the declared bounding box and reaches every edge", () => {
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    expect(Math.max(...xs)).toBeCloseTo(halfLength, 10);
    expect(Math.min(...xs)).toBeCloseTo(-halfLength, 10);
    expect(Math.max(...zs)).toBeCloseTo(halfWidth, 10);
    expect(Math.min(...zs)).toBeCloseTo(-halfWidth, 10);
  });

  it("degenerates to a circle's outline when width exceeds length", () => {
    const round = stadiumOutline(1, 1);
    for (const p of round) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(1, 10);
    }
  });
});

describe("offsetStadium", () => {
  it("grows both half-extents by delta, preserving the straight run's length", () => {
    const base = { halfLength: 2.15, halfWidth: 1.08 };
    const grown = offsetStadium(base.halfLength, base.halfWidth, 0.16);
    expect(grown.halfLength).toBeCloseTo(base.halfLength + 0.16, 10);
    expect(grown.halfWidth).toBeCloseTo(base.halfWidth + 0.16, 10);
    const baseStraight = stadiumStraightHalf(base.halfLength, base.halfWidth);
    const grownStraight = stadiumStraightHalf(grown.halfLength, grown.halfWidth);
    expect(grownStraight).toBeCloseTo(baseStraight, 10);
  });

  it("shrinks with a negative delta and clamps at zero rather than going negative", () => {
    const shrunk = offsetStadium(0.1, 0.1, -0.5);
    expect(shrunk.halfLength).toBe(0);
    expect(shrunk.halfWidth).toBe(0);
  });
});
