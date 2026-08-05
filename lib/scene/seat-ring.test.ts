import { describe, expect, it } from "vitest";
import { FELT, SEAT_RING } from "./scene-config";
import { POT_POSITION, ringPoint, seatAngle, seatBetOrigin, seatPlacement } from "./seat-ring";

/**
 * The world-space ring has one job beyond looking right: agreeing with the
 * DOM ring in `lib/game/table-geometry.ts` about which chair a slot means.
 * They are drawn by two different systems into the same rectangle, so a
 * disagreement lands a payout under someone else's nameplate and nothing
 * throws.
 */
describe("seat ring", () => {
  it("puts slot 0 nearest the viewer, where the local player sits", () => {
    const near = seatPlacement(0, 6);
    // +Z is toward the viewer, and slot 0 should be as far that way as the
    // ellipse goes — the same near edge table-geometry.ts puts at y = 86%.
    expect(near.position.z).toBeGreaterThan(0);
    expect(near.position.x).toBeCloseTo(0, 6);
    expect(near.nearness).toBeCloseTo(1, 6);
  });

  it("puts the opposite seat at the far rail", () => {
    const far = seatPlacement(3, 6);
    expect(far.position.z).toBeLessThan(0);
    expect(far.position.x).toBeCloseTo(0, 6);
    expect(far.nearness).toBeCloseTo(0, 6);
  });

  it("advances in the same direction as the DOM ring", () => {
    // table-geometry.ts uses theta = 90deg + slot * 360/count with x = cos,
    // y = sin. Slot 1 of 6 therefore lands left of centre and above the near
    // edge on screen; here that is left of centre and less near.
    const first = seatPlacement(1, 6);
    expect(first.position.x).toBeLessThan(0);
    expect(first.nearness).toBeLessThan(1);
    expect(first.nearness).toBeGreaterThan(0);
  });

  it("spaces every seat evenly however many are sitting", () => {
    for (const count of [2, 6, 8, 9]) {
      const angles = Array.from({ length: count }, (_, slot) => seatAngle(slot, count));
      const gaps = angles.slice(1).map((angle, index) => angle - angles[index]);
      for (const gap of gaps) expect(gap).toBeCloseTo((2 * Math.PI) / count, 9);
    }
  });

  it("survives a degenerate count rather than dividing by zero", () => {
    expect(seatAngle(0, 0)).toBe(0);
    expect(Number.isFinite(ringPoint(0, 0, 1).x)).toBe(true);
  });

  it("seats players outside the felt, at table height", () => {
    expect(SEAT_RING.radiusScale).toBeGreaterThan(1);
    for (let slot = 0; slot < 6; slot += 1) {
      const seat = seatPlacement(slot, 6);
      // Outside the felt's own ellipse: (x/rx)^2 + (z/rz)^2 > 1.
      const outside = (seat.position.x / FELT.radiusX) ** 2 + (seat.position.z / FELT.radiusZ) ** 2;
      expect(outside).toBeGreaterThan(1);
      expect(seat.position.y).toBeCloseTo(FELT.y, 9);
    }
  });

  it("pushes bets onto the felt rather than launching them from a chest", () => {
    for (let slot = 0; slot < 6; slot += 1) {
      const origin = seatBetOrigin(slot, 6);
      // Inside the felt's own ellipse: (x/rx)^2 + (z/rz)^2 < 1.
      const inside = (origin.x / FELT.radiusX) ** 2 + (origin.z / FELT.radiusZ) ** 2;
      expect(inside).toBeLessThan(1);
      // And resting on the table surface, not floating over it.
      expect(origin.y).toBeCloseTo(FELT.y, 9);
    }
  });

  it("puts the pot on the felt at the middle of the table", () => {
    expect(POT_POSITION).toEqual({ x: 0, y: FELT.y, z: 0 });
  });
});
