import { describe, expect, it } from "vitest";
import { METRES_PER_WORLD_UNIT, classicChipSpace, racetrackChipSpace } from "./chip-space";
import { CHIP_RADIUS, FELT } from "./scene-config";
import { CHIP_RADIUS_M, FELT as RACETRACK_FELT, FELT_TOP_Y, SEAT_COUNT } from "./table-anchors";
import { potPosition, seatBetOrigin } from "./seat-ring";

/** Signed distance to a stadium's boundary: negative inside, positive out. */
function stadiumSignedDistance(point: { x: number; z: number }, halfLength: number, halfWidth: number): number {
  const straightHalf = Math.max(0, halfLength - halfWidth);
  const clampedX = Math.max(-straightHalf, Math.min(straightHalf, point.x));
  return Math.hypot(point.x - clampedX, point.z) - halfWidth;
}

describe("the classic space", () => {
  it("is the same table the chip layer always animated on", () => {
    const space = classicChipSpace();
    expect(space.feltY).toBe(FELT.y);
    expect(space.pot()).toEqual(potPosition(FELT.radiusZ));
    expect(space.betSpot(2, 6)).toEqual(seatBetOrigin(2, 6, FELT.radiusZ));
  });

  it("carries the per-fit felt depth and near-seat reach it is given", () => {
    const space = classicChipSpace(7.4, 0.48);
    expect(space.pot()).toEqual(potPosition(7.4));
    expect(space.betSpot(0, 6)).toEqual(seatBetOrigin(0, 6, 7.4, 0.48));
  });

  it("needs no unit conversion -- its units are the layer's", () => {
    expect(classicChipSpace().roomUnitsPerWorldUnit).toBe(1);
  });
});

describe("the racetrack space", () => {
  const space = racetrackChipSpace();
  const metres = (value: number) => value * METRES_PER_WORLD_UNIT;

  /**
   * The scalar the whole two-unit arrangement rests on. Pinned to the chip
   * rather than to the table (see `METRES_PER_WORLD_UNIT`), so this is the
   * assertion that says a world unit is a fixed physical length: the layer's
   * own `CHIP_RADIUS` has to come out as a real 39mm casino chip.
   */
  it("makes one world unit a fixed physical length, sized off a real chip", () => {
    expect(metres(CHIP_RADIUS)).toBeCloseTo(CHIP_RADIUS_M, 12);
  });

  it("rests chips on the real table's cloth", () => {
    expect(metres(space.feltY)).toBeCloseTo(FELT_TOP_Y, 9);
  });

  it("puts the pot on the cloth, away from the viewer", () => {
    const pot = space.pot();
    expect(metres(pot.y)).toBeCloseTo(FELT_TOP_Y, 9);
    // Negative Z is away from the camera -- behind the board, toward the
    // dealer, never at the felt's own centre where the board is laid.
    expect(pot.z).toBeLessThan(0);
  });

  it("lands every seat's bet on the cloth", () => {
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      const spot = space.betSpot(slot, SEAT_COUNT);
      const plan = { x: metres(spot.x), z: metres(spot.z) };
      expect(stadiumSignedDistance(plan, RACETRACK_FELT.halfLength, RACETRACK_FELT.halfWidth)).toBeLessThan(0);
      expect(metres(spot.y)).toBeCloseTo(FELT_TOP_Y, 9);
    }
  });

  /**
   * A tray is on the rail, not on the cloth and not in the player's chest.
   * The classic room shipped for months with its launch point outside the
   * painted rail entirely, on the carpet behind the player, and nothing
   * failed -- nothing measures where a flight begins. Hence this.
   */
  it("launches bets from the rail, outside the cloth but on the table", () => {
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      const tray = space.tray(slot, SEAT_COUNT);
      const plan = { x: metres(tray.x), z: metres(tray.z) };
      const outsideFelt = stadiumSignedDistance(plan, RACETRACK_FELT.halfLength, RACETRACK_FELT.halfWidth);
      expect(outsideFelt).toBeGreaterThan(0);
    }
  });

  it("pays a winner nearer their own chair than the pot is", () => {
    const pot = space.pot();
    for (let slot = 1; slot < SEAT_COUNT; slot += 1) {
      const payout = space.payout(slot, SEAT_COUNT);
      const seatward = Math.hypot(payout.x - pot.x, payout.z - pot.z);
      expect(seatward).toBeGreaterThan(0);
      // ...and still on the cloth, not in the player's lap.
      const plan = { x: metres(payout.x), z: metres(payout.z) };
      expect(stadiumSignedDistance(plan, RACETRACK_FELT.halfLength, RACETRACK_FELT.halfWidth)).toBeLessThan(0);
    }
  });

  it("re-spaces its anchors when the table is short-handed", () => {
    // Three-handed: the two opponents flank the dealer, so neither sits where
    // one of six would. A space that ignored the count would hand back the
    // same point and land a payout under nobody.
    expect(space.betSpot(1, 3)).not.toEqual(space.betSpot(1, SEAT_COUNT));
  });
});
