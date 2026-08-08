import { describe, expect, it } from "vitest";
import {
  BET_SPOT_INSET,
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  FLOOR_Y,
  SEAT_COUNT_3D,
  SEAT_RING_RADIUS_X,
  SEAT_RING_RADIUS_Z,
  betSpotPosition,
  faceCentreRotationY,
  holeCardPosition,
  seatPosition,
} from "./seat-layout";

describe("seat layout", () => {
  it("places slot 0 nearest the camera, on the +Z axis", () => {
    const seat = seatPosition(0);
    expect(seat.x).toBeCloseTo(0, 10);
    expect(seat.z).toBeCloseTo(SEAT_RING_RADIUS_Z, 10);
    for (let slot = 1; slot < SEAT_COUNT_3D; slot++) {
      expect(seatPosition(slot).z).toBeLessThan(seat.z);
    }
  });

  it("keeps every seat on the ring ellipse, standing on the floor", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot++) {
      const { x, y, z } = seatPosition(slot);
      const onEllipse =
        (x / SEAT_RING_RADIUS_X) ** 2 + (z / SEAT_RING_RADIUS_Z) ** 2;
      expect(onEllipse).toBeCloseTo(1, 10);
      expect(y).toBe(FLOOR_Y);
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
