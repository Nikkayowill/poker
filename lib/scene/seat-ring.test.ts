import { describe, expect, it } from "vitest";
import { seatAngle } from "./seat-ring";

/**
 * The one thing left in this ring is the angle -- the racetrack's own chip
 * animation reads it to place a pile on the arc. It still has to agree with
 * the DOM ring in `lib/game/table-geometry.ts` about which chair a slot
 * means, or a chip lands under someone else's nameplate and nothing throws.
 */
describe("seat ring", () => {
  it("spaces every seat evenly however many are sitting", () => {
    for (const count of [2, 6, 8, 9]) {
      const angles = Array.from({ length: count }, (_, slot) => seatAngle(slot, count));
      const gaps = angles.slice(1).map((angle, index) => angle - angles[index]);
      for (const gap of gaps) expect(gap).toBeCloseTo((2 * Math.PI) / count, 9);
    }
  });

  it("survives a degenerate count rather than dividing by zero", () => {
    expect(seatAngle(0, 0)).toBe(0);
  });
});
