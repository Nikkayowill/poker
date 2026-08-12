import { describe, expect, it } from "vitest";
import {
  BET_SPOT_INSET,
  BOARD_POSITION,
  FAR_SEAT_SLOT,
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  FLOOR_Y,
  NEAR_SEAT_EXTRA_SETBACK,
  POT_POSITION,
  RAIL_LIP_HEIGHT,
  SEAT_COUNT_3D,
  SEAT_RING_RADIUS_X,
  SEAT_RING_RADIUS_Z,
  SEAT_SETBACK,
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
  betSpotPosition,
  faceCentreRotationY,
  holeCardPosition,
  seatAngle,
  seatPosition,
  tableSurfaceY,
} from "./seat-layout";

/** A slot's own ring radii — the far seat's plain SEAT_RING_RADIUS_X/Z, or
 * that plus NEAR_SEAT_EXTRA_SETBACK for every other seat. Mirrors
 * seatSetback in seat-layout.ts so tests assert the contract, not a copy of
 * the private implementation. */
function ringRadiusFor(slot: number): { x: number; z: number } {
  const extra = slot === FAR_SEAT_SLOT ? 0 : NEAR_SEAT_EXTRA_SETBACK;
  return { x: SEAT_RING_RADIUS_X + extra, z: SEAT_RING_RADIUS_Z + extra };
}

describe("the table's plan shape", () => {
  it("is a real six-max oval, not a rounder one", () => {
    // 2.15 x 1.32 was 1.63:1. A real table is 2.13 m x 1.07 m, essentially
    // 2:1 — and the difference is not only accuracy: the camera fit is bound
    // by DEPTH at every landscape aspect, so a rounder table pushes its own
    // camera back and then cannot use the width it freed.
    expect(FELT_RADIUS_X / FELT_RADIUS_Z).toBeCloseTo(TABLE_LENGTH_M / TABLE_WIDTH_M, 10);
  });

  it("seats the far seat at the plain setback and every other seat further back", () => {
    // The ring used to be two independent radii whose margins over the felt
    // were 0.47 and 0.46 — equal by coincidence, and un-linked from the felt
    // they sit outside of, so a change to the table's shape left the chairs
    // where they were. SEAT_RING_RADIUS_X/Z now names the FAR seat's own
    // radius specifically (see FAR_SEAT_SLOT); every other seat sits
    // NEAR_SEAT_EXTRA_SETBACK further out again.
    expect(SEAT_RING_RADIUS_X - FELT_RADIUS_X).toBeCloseTo(SEAT_SETBACK, 10);
    expect(SEAT_RING_RADIUS_Z - FELT_RADIUS_Z).toBeCloseTo(SEAT_SETBACK, 10);
    expect(NEAR_SEAT_EXTRA_SETBACK).toBeGreaterThan(0);
  });

  it("keeps the pot behind the board, both scaling with the plate", () => {
    // Stated as fractions of the felt's depth rather than as the literals
    // -0.52 and 0.08, which were measured against the old 1.32 plate: on a
    // shallower felt those absolute distances mean something different, and
    // the pot drifts proportionally further back until it is off the cloth.
    expect(POT_POSITION.z).toBeLessThan(BOARD_POSITION.z);
    expect(Math.abs(POT_POSITION.z)).toBeLessThan(FELT_RADIUS_Z);
    expect(Math.abs(BOARD_POSITION.z)).toBeLessThan(FELT_RADIUS_Z);
  });
});

describe("seat layout", () => {
  it("places slot 0 nearest the camera, on the +Z axis", () => {
    const seat = seatPosition(0);
    expect(seat.x).toBeCloseTo(0, 10);
    expect(seat.z).toBeCloseTo(ringRadiusFor(0).z, 10);
    for (let slot = 1; slot < SEAT_COUNT_3D; slot++) {
      expect(seatPosition(slot).z).toBeLessThan(seat.z);
    }
  });

  it("keeps every seat on ITS OWN ring ellipse, standing on the floor", () => {
    // Not one shared ellipse any more — the far seat (FAR_SEAT_SLOT) sits on
    // SEAT_RING_RADIUS_X/Z exactly, every other seat on a slightly larger
    // one (ringRadiusFor mirrors seatSetback in seat-layout.ts).
    for (let slot = 0; slot < SEAT_COUNT_3D; slot++) {
      const { x, y, z } = seatPosition(slot);
      const ring = ringRadiusFor(slot);
      const onEllipse = (x / ring.x) ** 2 + (z / ring.z) ** 2;
      expect(onEllipse, `slot ${slot}`).toBeCloseTo(1, 10);
      expect(y).toBe(FLOOR_Y);
    }
  });

  it("keeps the far seat put while pulling every other seat back further", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot++) {
      const angle = seatAngle(slot);
      const ring = ringRadiusFor(slot);
      const seat = seatPosition(slot);
      expect(seat.x, `slot ${slot}`).toBeCloseTo(Math.sin(angle) * ring.x, 10);
      expect(seat.z, `slot ${slot}`).toBeCloseTo(Math.cos(angle) * ring.z, 10);
    }
  });

  it("spaces the six seats at distinct angles a full turn apart", () => {
    const angles = Array.from({ length: SEAT_COUNT_3D }, (_, slot) => {
      const { x, z } = seatPosition(slot);
      return Math.atan2(x, z);
    });
    const unique = new Set(angles.map((a) => a.toFixed(6)));
    expect(unique.size).toBe(SEAT_COUNT_3D);
  });

  it("rests bet spots on the felt, inset from each seat", () => {
    for (let slot = 1; slot < SEAT_COUNT_3D; slot++) {
      const spot = betSpotPosition(slot);
      expect(spot.y).toBe(FELT_TOP_Y);
      const onFelt =
        (spot.x / (FELT_RADIUS_X * BET_SPOT_INSET)) ** 2 +
        (spot.z / (FELT_RADIUS_Z * BET_SPOT_INSET)) ** 2;
      expect(onFelt).toBeCloseTo(1, 10);
    }
  });

  it("gives the near seat its own corridor: bet spot, then cards, then the seat", () => {
    // Slot 0's figure stands between the camera and the felt, so its cards
    // and chips take distinct, deeper positions instead of hiding behind it.
    const bet = betSpotPosition(0);
    const cards = holeCardPosition(0);
    const seat = seatPosition(0);
    expect(bet.z).toBeLessThan(cards.z);
    expect(cards.z).toBeLessThan(seat.z);
    // And the ordinary seats keep bet spots inside their cards.
    for (let slot = 1; slot < SEAT_COUNT_3D; slot++) {
      const b = betSpotPosition(slot);
      const c = holeCardPosition(slot);
      expect(b.x ** 2 + b.z ** 2).toBeLessThan(c.x ** 2 + c.z ** 2);
    }
  });

  it("turns an avatar at +Z fully around to face the centre", () => {
    // A model's forward is +Z; from (0, 0, +ring) facing centre is a half turn.
    expect(Math.abs(faceCentreRotationY(seatPosition(0)))).toBeCloseTo(Math.PI, 10);
    // From the -Z side, no turn at all.
    expect(faceCentreRotationY({ x: 0, y: 0, z: -1 })).toBeCloseTo(0, 10);
  });
});

describe("tableSurfaceY", () => {
  it("reports the plain felt height over the cloth", () => {
    expect(tableSurfaceY({ x: 0, z: 0 })).toBe(FELT_TOP_Y);
    // Just inside the felt's own edge, still the felt.
    expect(tableSurfaceY({ x: FELT_RADIUS_X * 0.99, z: 0 })).toBe(FELT_TOP_Y);
  });

  it("reports the rail's higher top just past the felt's edge", () => {
    expect(tableSurfaceY({ x: FELT_RADIUS_X * 1.05, z: 0 })).toBe(FELT_TOP_Y + RAIL_LIP_HEIGHT);
    expect(tableSurfaceY({ x: 0, z: FELT_RADIUS_Z * 1.05 })).toBe(FELT_TOP_Y + RAIL_LIP_HEIGHT);
  });

  it("holds the same contract Table3D's rail geometry builds to", () => {
    // RAIL_LIP_HEIGHT is the one number both the rail mesh (table-3d.tsx's
    // alignTop target) and this clamp read — a wrist correction can only
    // guard against the rail it renders if the two stay equal.
    expect(RAIL_LIP_HEIGHT).toBeGreaterThan(0);
    expect(tableSurfaceY({ x: FELT_RADIUS_X + 1, z: 0 }) - tableSurfaceY({ x: 0, z: 0 })).toBeCloseTo(
      RAIL_LIP_HEIGHT,
      10
    );
  });
});
