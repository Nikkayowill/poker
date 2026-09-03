import { describe, expect, it } from "vitest";
import {
  ISO_EDGE_ANGLE,
  isoProject,
  isoUnproject,
  projectedBounds,
  projectedCorners,
  unprojectBoundsApprox,
} from "./iso";

describe("isoProject / isoUnproject", () => {
  it("round-trips arbitrary points exactly", () => {
    const points = [
      [0, 0],
      [1, 0],
      [0, 1],
      [80, 80],
      [-40, 260],
      [304.5, -12.25],
    ];
    for (const [x, y] of points) {
      const projected = isoProject(x, y);
      const back = isoUnproject(projected.x, projected.y);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
  });

  it("is additive: projecting a sum equals summing the projections", () => {
    // What lets a container sit at the projected cell origin while its
    // children are placed at their own projected cell-local offsets.
    const a = { x: 37, y: -14 };
    const b = { x: -9, y: 62 };
    const sum = isoProject(a.x + b.x, a.y + b.y);
    const parts = isoProject(a.x, a.y);
    const partsB = isoProject(b.x, b.y);
    expect(sum.x).toBeCloseTo(parts.x + partsB.x, 9);
    expect(sum.y).toBeCloseTo(parts.y + partsB.y, 9);
  });

  it("makes a unit square's diamond exactly 2:1", () => {
    const c = projectedCorners({ x: 0, y: 0, width: 1, height: 1 });
    const width = Math.max(c.n.x, c.e.x, c.s.x, c.w.x) - Math.min(c.n.x, c.e.x, c.s.x, c.w.x);
    const height = Math.max(c.n.y, c.e.y, c.s.y, c.w.y) - Math.min(c.n.y, c.e.y, c.s.y, c.w.y);
    expect(width / height).toBeCloseTo(2, 9);
  });

  it("puts the corner with the largest (x + y) at S, the nearest point", () => {
    const c = projectedCorners({ x: 10, y: 20, width: 30, height: 40 });
    // S is the (x+width, y+height) corner -- the largest x+y in world space.
    expect(c.s.y).toBeGreaterThan(c.n.y);
    expect(c.s.y).toBeGreaterThanOrEqual(c.e.y);
    expect(c.s.y).toBeGreaterThanOrEqual(c.w.y);
  });
});

describe("projectedBounds", () => {
  it("matches projectedCorners' own min/max", () => {
    const rect = { x: -20, y: 5, width: 80, height: 80 };
    const bounds = projectedBounds(rect);
    const c = projectedCorners(rect);
    expect(bounds.x).toBeCloseTo(Math.min(c.n.x, c.e.x, c.s.x, c.w.x), 9);
    expect(bounds.y).toBeCloseTo(Math.min(c.n.y, c.e.y, c.s.y, c.w.y), 9);
  });

  it("a wider rect never produces a narrower bounding box", () => {
    const small = projectedBounds({ x: 0, y: 0, width: 80, height: 80 });
    const big = projectedBounds({ x: 0, y: 0, width: 320, height: 320 });
    expect(big.width).toBeGreaterThan(small.width);
    expect(big.height).toBeGreaterThan(small.height);
  });
});

describe("unprojectBoundsApprox", () => {
  it("contains every corner a screen rect could have come from", () => {
    const screenRect = { x: -100, y: -50, width: 300, height: 150 };
    const worldBox = unprojectBoundsApprox(screenRect);
    const screenCorners = [
      { x: screenRect.x, y: screenRect.y },
      { x: screenRect.x + screenRect.width, y: screenRect.y },
      { x: screenRect.x + screenRect.width, y: screenRect.y + screenRect.height },
      { x: screenRect.x, y: screenRect.y + screenRect.height },
    ];
    for (const corner of screenCorners) {
      const world = isoUnproject(corner.x, corner.y);
      expect(world.x).toBeGreaterThanOrEqual(worldBox.x - 1e-6);
      expect(world.x).toBeLessThanOrEqual(worldBox.x + worldBox.width + 1e-6);
      expect(world.y).toBeGreaterThanOrEqual(worldBox.y - 1e-6);
      expect(world.y).toBeLessThanOrEqual(worldBox.y + worldBox.height + 1e-6);
    }
  });

  it("round-trips a box that was itself produced by projectedBounds, loosely", () => {
    // Not exact (projectedBounds' box corners are not the diamond's actual
    // corners), but unprojecting it must at least still cover the original
    // world rect -- the property tendWorld's chunk loading actually depends on.
    const worldRect = { x: 0, y: 0, width: 320, height: 320 };
    const screen = projectedBounds(worldRect);
    const back = unprojectBoundsApprox(screen);
    expect(back.x).toBeLessThanOrEqual(worldRect.x + 1e-6);
    expect(back.y).toBeLessThanOrEqual(worldRect.y + 1e-6);
    expect(back.x + back.width).toBeGreaterThanOrEqual(worldRect.x + worldRect.width - 1e-6);
    expect(back.y + back.height).toBeGreaterThanOrEqual(worldRect.y + worldRect.height - 1e-6);
  });
});

describe("ISO_EDGE_ANGLE", () => {
  it("alongX and alongY are mirror images of the same magnitude", () => {
    expect(ISO_EDGE_ANGLE.alongX).toBeCloseTo(-ISO_EDGE_ANGLE.alongY, 9);
  });

  it("matches the actual screen direction of a +x step", () => {
    const origin = isoProject(0, 0);
    const stepped = isoProject(1, 0);
    const angle = Math.atan2(stepped.y - origin.y, stepped.x - origin.x);
    expect(angle).toBeCloseTo(ISO_EDGE_ANGLE.alongX, 9);
  });

  it("matches the actual screen direction of a +y step", () => {
    const origin = isoProject(0, 0);
    const stepped = isoProject(0, 1);
    const angle = Math.atan2(stepped.y - origin.y, stepped.x - origin.x);
    // A +y step runs screen-left-and-down; its angle from the positive
    // x-axis is the reflex of alongY, which atan2 reports past +/- pi/2 --
    // compare directions (mod pi) since a rail's rotation is a line, not an
    // arrow, and 180 degrees off looks identical.
    const diff = ((angle - ISO_EDGE_ANGLE.alongY + Math.PI * 3) % Math.PI) - 0;
    expect(Math.min(diff, Math.PI - diff)).toBeLessThan(1e-6);
  });
});
