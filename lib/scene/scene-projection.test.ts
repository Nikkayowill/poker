import { describe, expect, it } from "vitest";
import { perspectiveProjection, scaledProjection } from "./scene-projection";
import { CAMERA_ELEVATION_DEG, FELT_TOP_Y, fitCamera } from "./table-anchors";

const FRAME = { width: 1440, height: 832, hudFraction: 0.12 };

describe("the racetrack room, as a projection", () => {
  const camera = fitCamera(FRAME);
  const projection = perspectiveProjection(camera);

  /* The whole reason this renderer exists: under an orthographic tilt these
     two would be identical, and the table would read as a plan view. */
  it("draws a nearer point larger than a further one", () => {
    const near = projection.scaleAt({ x: 0, y: FELT_TOP_Y, z: 0.4 });
    const far = projection.scaleAt({ x: 0, y: FELT_TOP_Y, z: -0.4 });
    expect(near).toBeGreaterThan(far);
  });

  it("squashes a disc on the felt by the camera's elevation", () => {
    expect(projection.groundSquash).toBeCloseTo(Math.sin((CAMERA_ELEVATION_DEG * Math.PI) / 180), 12);
  });

  /* A degenerate frame must hand back a number, not NaN: a NaN canvas
     coordinate does not throw, it silently draws nothing. */
  it("never returns NaN for a point at or behind the lens", () => {
    const scale = projection.scaleAt(camera.position);
    expect(Number.isNaN(scale)).toBe(false);
  });
});

describe("scaledProjection", () => {
  const camera = fitCamera(FRAME);
  const metres = perspectiveProjection(camera);
  const SCALE = 0.1393;
  const worldUnits = scaledProjection(metres, SCALE);

  it("puts a point where its converted self lands", () => {
    const inUnits = { x: 3, y: 5.4, z: -1.2 };
    const inMetres = { x: inUnits.x * SCALE, y: inUnits.y * SCALE, z: inUnits.z * SCALE };
    expect(worldUnits.project(inUnits)).toEqual(metres.project(inMetres));
  });

  /**
   * The half of this that is easy to get wrong: `scaleAt` answers "pixels per
   * OUTER unit", so it has to be multiplied by the conversion as well as
   * having its argument converted. Without the multiply a chip would be drawn
   * at its size in metres -- about a seventh of what it should be -- and the
   * error is a plausible-looking small chip rather than anything that fails.
   */
  it("reports pixels per outer unit, not per inner unit", () => {
    const inUnits = { x: 0, y: 5.4, z: 0 };
    const inMetres = { x: 0, y: inUnits.y * SCALE, z: 0 };
    expect(worldUnits.scaleAt(inUnits)).toBeCloseTo(metres.scaleAt(inMetres) * SCALE, 9);
  });

  it("leaves the ground squash alone -- a unit change cannot tilt the camera", () => {
    expect(worldUnits.groundSquash).toBe(metres.groundSquash);
  });
});
