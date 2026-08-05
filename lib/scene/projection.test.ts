import { describe, expect, it } from "vitest";
import { fitView, project, projectedFeltDepth, projectedFeltWidth } from "./projection";
import { FELT, RAIL_SCALE, TILT_COS, TILT_SIN } from "./scene-config";

/** A desktop plate: `.poker-rail`'s box, wider than it is tall. */
const RAIL = { left: 100, top: 80, width: 900, height: 400 };
/** A portrait phone's, which is the case the old width-only fit got wrong. */
const PORTRAIT_RAIL = { left: 20, top: 40, width: 323, height: 497 };

describe("the fit", () => {
  it("fills the rail's box with the painted rail, both ways", () => {
    const view = fitView(RAIL);
    expect(projectedFeltWidth(view) * RAIL_SCALE).toBeCloseTo(RAIL.width, 9);
    expect(projectedFeltDepth(view) * RAIL_SCALE).toBeCloseTo(RAIL.height, 9);
  });

  it("lands the felt surface's centre on the rail's centre", () => {
    const view = fitView(RAIL);
    const centre = project(view, { x: 0, y: FELT.y, z: 0 });
    expect(centre.x).toBeCloseTo(RAIL.left + RAIL.width / 2, 9);
    expect(centre.y).toBeCloseTo(RAIL.top + RAIL.height / 2, 9);
  });

  /**
   * The regression this fit exists for. `.poker-table-wrap` is 1.84 wide on
   * a desktop and 0.62 on a portrait phone, so a fit that reads only the
   * width and carries a fixed plan shape paints the *same* wide horizontal
   * oval on both -- a pancake lying across a tall plate, with the seat ring
   * looping far above and below it.
   */
  it("paints a tall table on a tall plate and a wide one on a wide plate", () => {
    const desktop = fitView(RAIL);
    const portrait = fitView(PORTRAIT_RAIL);
    expect(projectedFeltWidth(desktop)).toBeGreaterThan(projectedFeltDepth(desktop));
    expect(projectedFeltDepth(portrait)).toBeGreaterThan(projectedFeltWidth(portrait));
  });

  it("keeps the painted table inside the box it was handed", () => {
    for (const rail of [RAIL, PORTRAIT_RAIL]) {
      const view = fitView(rail);
      expect(projectedFeltWidth(view) * RAIL_SCALE).toBeLessThanOrEqual(rail.width + 1e-6);
      expect(projectedFeltDepth(view) * RAIL_SCALE).toBeLessThanOrEqual(rail.height + 1e-6);
    }
  });

  it("survives a zero-sized rail rather than dividing by zero", () => {
    const view = fitView({ left: 0, top: 0, width: 0, height: 0 });
    expect(Number.isFinite(view.scale)).toBe(true);
    expect(view.scale).toBeGreaterThan(0);
    expect(Number.isFinite(view.radiusZ)).toBe(true);
    expect(view.radiusZ).toBeGreaterThan(0);
  });
});

describe("the projection", () => {
  const view = fitView(RAIL);

  it("moves nearer points down the screen by the tilt's sine", () => {
    const far = project(view, { x: 0, y: 0, z: -1 });
    const near = project(view, { x: 0, y: 0, z: 1 });
    expect(near.y - far.y).toBeCloseTo(2 * TILT_SIN * view.scale, 9);
    expect(near.x).toBeCloseTo(far.x, 9);
  });

  it("lifts taller points up the screen by the tilt's cosine", () => {
    const base = project(view, { x: 2, y: 0, z: 3 });
    const raised = project(view, { x: 2, y: 1, z: 3 });
    expect(base.y - raised.y).toBeCloseTo(TILT_COS * view.scale, 9);
    expect(raised.x).toBeCloseTo(base.x, 9);
  });

  it("keeps lateral distance undistorted, as orthography must", () => {
    const left = project(view, { x: -3, y: 0, z: 0 });
    const right = project(view, { x: 3, y: 0, z: 0 });
    expect(right.x - left.x).toBeCloseTo(6 * view.scale, 9);
  });

  it("hands back world Z as the painter's sort key", () => {
    // Depth must be independent of height: a chip mid-arc sorts by where it
    // is over the table, not by how high it happens to be.
    expect(project(view, { x: 0, y: 0, z: 2 }).depth).toBe(2);
    expect(project(view, { x: 5, y: 3, z: 2 }).depth).toBe(2);
    expect(project(view, { x: 0, y: 0, z: -2 }).depth).toBeLessThan(
      project(view, { x: 0, y: 0, z: 2 }).depth,
    );
  });
});
