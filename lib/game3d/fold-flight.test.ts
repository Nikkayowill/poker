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
    expect(end.position).toEqual(MUCK_POSITION);
    expect(end.done).toBe(true);
  });

  it("lifts the cards above the felt during the flight", () => {
    const start = foldFlightPose(4, 0);
    const middle = foldFlightPose(4, FOLD_FLIGHT_DURATION_S / 2);
    expect(middle.position.y).toBeGreaterThan(start.position.y);
    expect(middle.scale).toBeLessThan(1);
  });
});
