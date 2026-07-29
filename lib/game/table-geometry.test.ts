import { describe, expect, it } from "vitest";
import { RAIL_Z, seatGeometry, seatZ } from "./table-geometry";

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

  it("orders seats far-to-near without letting the rail cut any of them", () => {
    const order = [0, 1, 2, 3, 4, 5].map((slot) => seatGeometry(slot, SEATS));

    // Every seat's order must follow its depth, or the painter's algorithm
    // breaks and a far player draws over a near one where the two overlap.
    const byDepth = [...order].sort((a, b) => a.depth - b.depth);
    expect(byDepth.map((s) => s.z)).toEqual([...byDepth.map((s) => s.z)].sort((a, b) => a - b));

    // ...but all of them stay in front of the rail, so names and hole cards
    // remain readable while the figures still overlap in natural depth order.
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
});
