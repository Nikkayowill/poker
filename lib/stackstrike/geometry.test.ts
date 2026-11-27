import { describe, expect, it } from "vitest";
import { distanceToWall, lineOfSight, poly, resolveCircleAgainstWalls, segmentCircleHit, segmentClear, segmentPolyHit, segmentRectHit, segmentWallHit, wallBounds } from "./geometry";

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

describe("resolveCircleAgainstWalls", () => {
  it("pushes a circle out of a wall face", () => {
    const pos = { x: 95, y: 125 };
    resolveCircleAgainstWalls(pos, 10, [box]);
    expect(pos.x).toBeCloseTo(90, 5);
    expect(pos.y).toBe(125);
  });

  it("leaves a circle that is clear alone", () => {
    const pos = { x: 50, y: 50 };
    resolveCircleAgainstWalls(pos, 10, [box]);
    expect(pos).toEqual({ x: 50, y: 50 });
  });

  it("ejects a centre that ended up inside the rect", () => {
    const pos = { x: 110, y: 125 };
    resolveCircleAgainstWalls(pos, 10, [box]);
    expect(pos.x).toBeCloseTo(90, 5);
  });
});

/** A diamond centred on (200, 200), 40 from the centre to each point, wound clockwise on purpose. */
const diamond = poly([
  { x: 200, y: 160 },
  { x: 240, y: 200 },
  { x: 200, y: 240 },
  { x: 160, y: 200 },
]);
const post = { x: 400, y: 200, r: 20 };

describe("poly", () => {
  it("winds the points one way whichever way they came", () => {
    const reversed = poly([...diamond.points].reverse());
    expect(segmentPolyHit({ x: 100, y: 200 }, { x: 300, y: 200 }, reversed)).toBeCloseTo(segmentPolyHit({ x: 100, y: 200 }, { x: 300, y: 200 }, diamond) ?? -1, 6);
  });

  it("does not change the points it was given", () => {
    const given = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ];
    poly(given);
    expect(given[1]).toEqual({ x: 0, y: 10 });
  });
});

describe("segmentPolyHit", () => {
  it("enters a diamond at its left point when it comes straight in", () => {
    expect(segmentPolyHit({ x: 100, y: 200 }, { x: 300, y: 200 }, diamond)).toBeCloseTo(0.3, 5);
  });

  it("is clipped by a slanted edge where a rectangle would not be", () => {
    // Along the diamond's top-left corner: inside its bounding box, outside the shape.
    expect(segmentPolyHit({ x: 100, y: 165 }, { x: 300, y: 165 }, diamond)).not.toBeNull();
    expect(segmentPolyHit({ x: 100, y: 162 }, { x: 170, y: 162 }, diamond)).toBeNull();
    expect(segmentRectHit({ x: 100, y: 162 }, { x: 170, y: 162 }, wallBounds(diamond))).not.toBeNull();
  });

  it("misses beside and short, and returns 0 from inside", () => {
    expect(segmentPolyHit({ x: 100, y: 100 }, { x: 300, y: 100 }, diamond)).toBeNull();
    expect(segmentPolyHit({ x: 100, y: 200 }, { x: 150, y: 200 }, diamond)).toBeNull();
    expect(segmentPolyHit({ x: 200, y: 200 }, { x: 300, y: 200 }, diamond)).toBe(0);
  });
});

describe("walls of every shape", () => {
  const walls = [box, post, diamond];

  it("blocks sight through each shape and not past it", () => {
    expect(lineOfSight({ x: 0, y: 125 }, { x: 80, y: 125 }, walls)).toBe(true);
    expect(lineOfSight({ x: 330, y: 200 }, { x: 480, y: 200 }, walls)).toBe(false);
    expect(lineOfSight({ x: 100, y: 200 }, { x: 300, y: 200 }, walls)).toBe(false);
    expect(segmentWallHit({ x: 330, y: 200 }, { x: 480, y: 200 }, post)).toBeCloseTo(1 / 3, 5);
  });

  it("measures the gap to each shape, zero inside", () => {
    expect(distanceToWall(100, 125, box)).toBe(0);
    expect(distanceToWall(300, 125, box)).toBe(150);
    expect(distanceToWall(450, 200, post)).toBe(30);
    expect(distanceToWall(400, 200, post)).toBe(0);
    expect(distanceToWall(200, 200, diamond)).toBe(0);
    expect(distanceToWall(300, 200, diamond)).toBeCloseTo(60, 5);
    expect(distanceToWall(200, 120, diamond)).toBeCloseTo(40, 5);
  });

  it("lets a body of some width pass only where it fits", () => {
    expect(segmentClear({ x: 330, y: 150 }, { x: 480, y: 150 }, 10, [post])).toBe(true);
    expect(segmentClear({ x: 330, y: 170 }, { x: 480, y: 170 }, 12, [post])).toBe(false);
    expect(segmentClear({ x: 100, y: 130 }, { x: 300, y: 130 }, 20, [diamond])).toBe(true);
    expect(segmentClear({ x: 100, y: 150 }, { x: 300, y: 150 }, 20, [diamond])).toBe(false);
  });

  it("gives each shape's bounds", () => {
    expect(wallBounds(post)).toEqual({ x: 380, y: 180, w: 40, h: 40 });
    expect(wallBounds(diamond)).toEqual({ x: 160, y: 160, w: 80, h: 80 });
    expect(wallBounds(box)).toBe(box);
  });
});

describe("pushing a body out of a round or angled wall", () => {
  it("slides a circle round a post rather than stopping dead", () => {
    const pos = { x: 372, y: 200 };
    resolveCircleAgainstWalls(pos, 10, [post]);
    expect(pos.x).toBeCloseTo(370, 5);
    const nearTop = { x: 395, y: 172 };
    resolveCircleAgainstWalls(nearTop, 10, [post]);
    expect(Math.hypot(nearTop.x - post.x, nearTop.y - post.y)).toBeCloseTo(30, 5);
  });

  it("ejects a centre that is inside a post", () => {
    const pos = { x: 405, y: 200 };
    resolveCircleAgainstWalls(pos, 10, [post]);
    expect(Math.hypot(pos.x - post.x, pos.y - post.y)).toBeCloseTo(30, 5);
  });

  it("pushes off a slanted face along its normal", () => {
    // The diamond's top-left edge runs from (160,200) to (200,160); its outward normal points up and left.
    const pos = { x: 175, y: 175 };
    resolveCircleAgainstWalls(pos, 10, [diamond]);
    expect(distanceToWall(pos.x, pos.y, diamond)).toBeCloseTo(10, 4);
    expect(pos.x).toBeLessThan(175);
    expect(pos.y).toBeLessThan(175);
  });

  it("leaves a circle clear of an angled wall alone, and ejects one inside it", () => {
    const clear = { x: 100, y: 100 };
    resolveCircleAgainstWalls(clear, 10, [diamond]);
    expect(clear).toEqual({ x: 100, y: 100 });
    const inside = { x: 205, y: 200 };
    resolveCircleAgainstWalls(inside, 10, [diamond]);
    expect(distanceToWall(inside.x, inside.y, diamond)).toBeCloseTo(10, 4);
  });
});
