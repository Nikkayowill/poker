import { describe, expect, it } from "vitest";
import { atmosphere, FIRST_PERSON_SCALE, RAIL_Z, seatGeometry, seatZ } from "./table-geometry";

const SEATS = 6;

describe("table geometry", () => {
  it("places the near slot at the bottom and the opposite slot at the far rail", () => {
    const near = seatGeometry(0, SEATS);
    const far = seatGeometry(3, SEATS);

    expect(near.x).toBeCloseTo(50, 5);
    expect(far.x).toBeCloseTo(50, 5);
    // Screen y grows downward: the near seat is at the bottom of the box.
    expect(near.y).toBeGreaterThan(far.y);
    expect(near.depth).toBeCloseTo(1, 5);
    expect(far.depth).toBeCloseTo(0, 5);
  });

  it("mirrors left and right slots about the centre line", () => {
    const left = seatGeometry(2, SEATS);
    const right = seatGeometry(4, SEATS);
    expect(left.x + right.x).toBeCloseTo(100, 5);
    expect(left.y).toBeCloseTo(right.y, 5);
    expect(left.depth).toBeCloseTo(right.depth, 5);
  });

  it("shrinks monotonically with distance", () => {
    const slots = [0, 1, 2, 3].map((slot) => seatGeometry(slot, SEATS));
    expect(slots[0].scale).toBeCloseTo(1, 5);
    expect(slots[3].scale).toBeCloseTo(0.82, 2);

    const byDepthDescending = [...slots].sort((a, b) => b.depth - a.depth);
    for (let i = 1; i < byDepthDescending.length; i += 1) {
      expect(byDepthDescending[i].scale).toBeLessThanOrEqual(byDepthDescending[i - 1].scale);
    }
  });

  it("follows a perspective divide rather than a linear ramp", () => {
    // scale = f / (f + z) is convex, so the curve sits *below* the straight
    // line between its endpoints. That gap is the whole difference between a
    // receding table and a ring of progressively smaller boxes -- if this
    // ever equals the midpoint, someone has replaced the divide with a lerp.
    const nearScale = 1;
    const farScale = 0.82;
    const focal = farScale / (1 - farScale);
    const atHalfDepth = focal / (focal + 0.5);
    const linearMidpoint = (nearScale + farScale) / 2;

    expect(atHalfDepth).toBeLessThan(linearMidpoint);
    expect(linearMidpoint - atHalfDepth).toBeGreaterThan(0.005);
  });

  it("orders seats far-to-near without letting the rail cut any of them", () => {
    const order = [0, 1, 2, 3, 4, 5].map((slot) => seatGeometry(slot, SEATS));

    // Every seat's order must follow its depth, or the painter's algorithm
    // breaks and a far player draws over a near one where the two overlap.
    const byDepth = [...order].sort((a, b) => a.depth - b.depth);
    expect(byDepth.map((s) => s.z)).toEqual([...byDepth.map((s) => s.z)].sort((a, b) => a - b));

    // ...but all of them stay in front of the rail. A seat is scaled, so it is
    // its own stacking context and its children cannot climb out: putting a
    // body behind the rail put that player's hole cards and nameplate behind
    // it too. Measured on this table, three seats lost their cards and the far
    // seat lost its name entirely.
    for (const seat of order) {
      expect(seatZ(seat.depth)).toBeGreaterThan(RAIL_Z);
    }
    expect(seatZ(1)).toBeGreaterThan(seatZ(0));
  });

  it("points every seat at the pot, normalised to the seat's box", () => {
    for (const slot of [0, 1, 2, 3, 4, 5]) {
      const seat = seatGeometry(slot, SEATS);
      // Pointing inward: following the vector from the seat must reduce the
      // distance to the middle of the table.
      const before = Math.hypot(50 - seat.x, 50 - seat.y);
      const after = Math.hypot(50 - (seat.x + seat.towardPot.x), 50 - (seat.y + seat.towardPot.y));
      expect(after).toBeLessThan(before);

      // Box norm, not Euclidean. A Euclidean unit vector scaled by half a seat
      // lands on the box's inscribed ellipse -- inside the rectangle for any
      // diagonal seat, which drops the bet chip on the player's own name.
      const larger = Math.max(Math.abs(seat.towardPot.x), Math.abs(seat.towardPot.y));
      expect(larger).toBeCloseTo(1, 6);
    }
  });

  it("draws the local player larger than the nearest seat on the ring", () => {
    // You sit closer to the camera than anyone at the table. If your own
    // portrait were not the largest, the scene would be claiming the closest
    // figure is the furthest away, and the whole depth illusion inverts.
    const nearestOnRing = seatGeometry(0, SEATS).scale;
    expect(FIRST_PERSON_SCALE).toBeGreaterThan(nearestOnRing);
  });

  it("hazes the far rail without crushing legibility", () => {
    const near = atmosphere(1);
    const far = atmosphere(0);
    expect(near.brightness).toBeCloseTo(1, 5);
    expect(far.brightness).toBeLessThan(1);
    // Names and stacks still have to be readable over there.
    expect(far.brightness).toBeGreaterThan(0.7);
    expect(far.saturate).toBeGreaterThan(0.6);
  });
});
