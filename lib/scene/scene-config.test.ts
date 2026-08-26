import { describe, expect, it } from "vitest";
import { MAX_PIXEL_RATIO, TILT_SIN } from "./scene-config";

describe("the squash ratio", () => {
  it("stays in the (0, 1) range a sine of an elevation angle must", () => {
    expect(TILT_SIN).toBeGreaterThan(0);
    expect(TILT_SIN).toBeLessThan(1);
  });

  it("shows more face than edge, which is what reads as a table view", () => {
    // Below ~30° the table collapses toward a side view; the classic
    // table-game look sits in the 30-45° band, which is where this value
    // (sin of 38°) still comes from.
    expect(TILT_SIN).toBeGreaterThan(0.5);
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
