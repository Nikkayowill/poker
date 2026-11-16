import { describe, expect, it } from "vitest";
import { lineOfSight, resolveCircleAgainstRects, segmentCircleHit, segmentRectHit } from "./geometry";

const box = { x: 100, y: 100, w: 50, h: 50 };

describe("segmentRectHit", () => {
  it("returns the entry fraction for a segment through the rect", () => {
    expect(segmentRectHit({ x: 0, y: 125 }, { x: 200, y: 125 }, box)).toBeCloseTo(0.5, 5);
  });

  it("misses a segment that stops short or passes beside", () => {
    expect(segmentRectHit({ x: 0, y: 125 }, { x: 90, y: 125 }, box)).toBeNull();
    expect(segmentRectHit({ x: 0, y: 50 }, { x: 200, y: 50 }, box)).toBeNull();
  });

  it("returns 0 when the segment starts inside", () => {
    expect(segmentRectHit({ x: 120, y: 120 }, { x: 300, y: 120 }, box)).toBe(0);
  });

  it("handles a vertical segment", () => {
    expect(segmentRectHit({ x: 125, y: 0 }, { x: 125, y: 300 }, box)).toBeCloseTo(100 / 300, 5);
    expect(segmentRectHit({ x: 10, y: 0 }, { x: 10, y: 300 }, box)).toBeNull();
  });
});

describe("segmentCircleHit", () => {
  it("hits the near edge, not the centre", () => {
    const t = segmentCircleHit({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }, 10);
    expect(t).toBeCloseTo(0.4, 5);
  });

  it("misses a circle off to the side", () => {
    expect(segmentCircleHit({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 30 }, 10)).toBeNull();
  });

  it("misses a circle behind the start", () => {
    expect(segmentCircleHit({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 0 }, 10)).toBeNull();
  });
});

describe("lineOfSight", () => {
  it("is blocked by a wall between the points and clear around it", () => {
    expect(lineOfSight({ x: 0, y: 125 }, { x: 300, y: 125 }, [box])).toBe(false);
    expect(lineOfSight({ x: 0, y: 20 }, { x: 300, y: 20 }, [box])).toBe(true);
  });
});

describe("resolveCircleAgainstRects", () => {
  it("pushes a circle out of a wall face", () => {
    const pos = { x: 95, y: 125 };
    resolveCircleAgainstRects(pos, 10, [box]);
    expect(pos.x).toBeCloseTo(90, 5);
    expect(pos.y).toBe(125);
  });

  it("leaves a circle that is clear alone", () => {
    const pos = { x: 50, y: 50 };
    resolveCircleAgainstRects(pos, 10, [box]);
    expect(pos).toEqual({ x: 50, y: 50 });
  });

  it("ejects a centre that ended up inside the rect", () => {
    const pos = { x: 110, y: 125 };
    resolveCircleAgainstRects(pos, 10, [box]);
    expect(pos.x).toBeCloseTo(90, 5);
  });
});
