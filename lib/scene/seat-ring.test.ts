import { describe, expect, it } from "vitest";
import { FELT, SEAT_RING } from "./scene-config";
import { POT_DEPTH_FRACTION, potPosition, ringPoint, seatAngle, seatBetOrigin, seatPlacement } from "./seat-ring";

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

  /**
   * The near seat is the only chair with a figure standing between it and the
   * pot: `.seat-figure` is a square box centred on the DOM ellipse with its
   * artwork anchored to the base, so it occupies the space *above* its seat —
   * which for slot 0 alone means out over the cloth. At the ordinary inset
   * the local player's own avatar was painted on top of their own bet (z-index
   * 4+ over the canvas's 0), so they were the one player at the table who
   * could not see their chips go out.
   */
  it("pulls the near seat's bet clear of the figure standing over it", () => {
    const near = seatBetOrigin(0, 6);
    const opponent = seatBetOrigin(3, 6);
    // Both on the centre line, so the comparison is purely one of depth.
    expect(near.x).toBeCloseTo(0, 9);
    expect(opponent.x).toBeCloseTo(0, 9);
    // Meaningfully further in than an opponent pushes theirs. Without this
    // the two are mirror images and the near one sits inside its own avatar.
    expect(near.z).toBeLessThan(Math.abs(opponent.z));
    // Still the viewer's side of the middle: a bet is between its player and
    // the pot, never past the board.
    expect(near.z).toBeGreaterThan(0);
    expect(near.z).toBeLessThan(FELT.radiusZ * (1 - POT_DEPTH_FRACTION));
    // And every other seat is left exactly where it was — the asymmetry is
    // slot 0's alone, because the occlusion is slot 0's alone.
    for (let slot = 1; slot < 6; slot += 1) {
      const theta = seatAngle(slot, 6);
      expect(seatBetOrigin(slot, 6).z).toBeCloseTo(FELT.radiusZ * 0.74 * Math.sin(theta), 9);
    }
  });

  it("rests the pot on the felt, behind the board rather than under it", () => {
    const pot = potPosition();
    expect(pot.x).toBe(0);
    expect(pot.y).toBeCloseTo(FELT.y, 9);
    // Away from the viewer: world Z grows *nearer*, and the near half of the
    // felt is where the local player's own figure and hole cards sit. A pot
    // at z=0 is a pot stacked on the flop.
    expect(pot.z).toBeLessThan(0);
    // Still comfortably on the cloth, not pushed off the far rail.
    expect(Math.abs(pot.z) / FELT.radiusZ).toBeLessThan(0.8);
  });

  it("keeps the pot at the same fraction of the felt however deep it is", () => {
    // The plan depth is per-fit -- a portrait plate makes a far deeper
    // table than a desktop one -- so the offset has to scale with it or the
    // pot sits on the board on one plate and off the felt on the other.
    for (const radiusZ of [FELT.radiusZ, 12, 28]) {
      expect(potPosition(radiusZ).z).toBeCloseTo(-radiusZ * POT_DEPTH_FRACTION, 9);
    }
  });

  it("rings a deeper felt further out, and leaves the width alone", () => {
    const shallow = ringPoint(1, 6, 1, 0, FELT.radiusZ);
    const deep = ringPoint(1, 6, 1, 0, FELT.radiusZ * 3);
    expect(deep.x).toBeCloseTo(shallow.x, 9);
    expect(Math.abs(deep.z)).toBeCloseTo(Math.abs(shallow.z) * 3, 9);
  });
});
