import { describe, expect, it } from "vitest";
import {
  FOLD_FLIGHT_DURATION_S,
  MUCK_POSITION,
  foldFlightPose,
} from "./fold-flight";
import { holeCardPosition } from "./seat-layout";

describe("foldFlightPose", () => {
  it("starts at the folding seat and finishes in the muck", () => {
    const start = foldFlightPose(2, 0);
    const source = holeCardPosition(2);
    expect(start.position).toEqual(source);
    expect(start.done).toBe(false);

    const end = foldFlightPose(2, FOLD_FLIGHT_DURATION_S);
    // Not toEqual: at raw = 1, foldFlightPose adds Math.sin(Math.PI) * CARD.height
    // * 0.1 to y — mathematically zero, but Math.sin(Math.PI) is ~1.22e-16 in
    // IEEE754, not exactly 0. That residual (and x's own start + (end - start)
    // * 1, which isn't guaranteed bit-exact either) is real floating-point
    // noise, not a claim that the flight lands anywhere but the muck.
    expect(end.position.x).toBeCloseTo(MUCK_POSITION.x, 12);
    expect(end.position.y).toBeCloseTo(MUCK_POSITION.y, 12);
    expect(end.position.z).toBeCloseTo(MUCK_POSITION.z, 12);
    expect(end.done).toBe(true);
  });

  it("lifts the cards above the felt during the flight", () => {
    const start = foldFlightPose(4, 0);
    const middle = foldFlightPose(4, FOLD_FLIGHT_DURATION_S / 2);
    expect(middle.position.y).toBeGreaterThan(start.position.y);
    expect(middle.scale).toBeLessThan(1);
  });
});
