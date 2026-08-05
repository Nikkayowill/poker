import { describe, expect, it } from "vitest";
import { fitView, project, projectedFeltWidth } from "./projection";
import { FELT, TILT_COS, TILT_SIN } from "./scene-config";

const WRAP = { left: 100, top: 80, width: 900, height: 400 };

describe("the fit", () => {
  it("pins the felt's width to the wrap's width exactly", () => {
    const view = fitView(WRAP);
    expect(projectedFeltWidth(view)).toBeCloseTo(WRAP.width, 9);
  });

  it("lands the felt surface's centre on the wrap's centre", () => {
    const view = fitView(WRAP);
    const centre = project(view, { x: 0, y: FELT.y, z: 0 });
    expect(centre.x).toBeCloseTo(WRAP.left + WRAP.width / 2, 9);
    expect(centre.y).toBeCloseTo(WRAP.top + WRAP.height / 2, 9);
  });

  it("survives a zero-width wrap rather than dividing by zero", () => {
    const view = fitView({ left: 0, top: 0, width: 0, height: 0 });
    expect(Number.isFinite(view.scale)).toBe(true);
    expect(view.scale).toBeGreaterThan(0);
  });
});

describe("the projection", () => {
  const view = fitView(WRAP);

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
