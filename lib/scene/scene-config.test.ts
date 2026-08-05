import { describe, expect, it } from "vitest";
import {
  FELT,
  MAX_PIXEL_RATIO,
  RAIL_SCALE,
  SEAT_RING,
  TILT_COS,
  TILT_DEG,
  TILT_SIN,
} from "./scene-config";

/**
 * These are the numbers the composition is, so the things worth asserting
 * are the relationships between them rather than the values themselves. A
 * tweak to the tilt is a design decision; a tilt that puts the camera under
 * the table is a bug, and only one of the two should fail a test.
 */
describe("the tilt", () => {
  it("looks down at the table, not along it or through it", () => {
    expect(TILT_DEG).toBeGreaterThan(0);
    expect(TILT_DEG).toBeLessThan(90);
  });

  it("derives both coefficients from the one angle", () => {
    const rad = (TILT_DEG * Math.PI) / 180;
    expect(TILT_SIN).toBeCloseTo(Math.sin(rad), 12);
    expect(TILT_COS).toBeCloseTo(Math.cos(rad), 12);
    // The identity that makes them a projection rather than two dials.
    expect(TILT_SIN ** 2 + TILT_COS ** 2).toBeCloseTo(1, 12);
  });

  it("shows more face than edge, which is what reads as a table view", () => {
    // Below ~30° the table collapses toward a side view and the felt's far
    // half hides behind its near half; the classic table-game look sits in
    // the 30–45° band.
    expect(TILT_SIN).toBeGreaterThan(0.5);
  });
});

describe("the table", () => {
  it("keeps the felt a wide oval rather than a circle", () => {
    expect(FELT.radiusX).toBeGreaterThan(FELT.radiusZ);
  });

  it("keeps the table surface above the floor", () => {
    expect(FELT.y).toBeGreaterThan(0);
  });

  it("seats players outside the felt, and the rail between them and it", () => {
    expect(SEAT_RING.radiusScale).toBeGreaterThan(1);
    expect(RAIL_SCALE).toBeGreaterThan(1);
    expect(SEAT_RING.radiusScale).toBeGreaterThan(RAIL_SCALE);
  });
});

describe("low-end safeguards", () => {
  it("caps the pixel ratio below what a modern phone reports", () => {
    // Invisible in development, expensive in the field: a ratio of 4 has a
    // phone shading sixteen times the pixels for soft gradients.
    expect(MAX_PIXEL_RATIO).toBeLessThan(3);
    expect(MAX_PIXEL_RATIO).toBeGreaterThanOrEqual(1);
  });
});
