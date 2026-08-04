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

/**
 * Eight-max readiness.
 *
 * SEAT_COUNT is still 6 and nothing renders eight seats yet. These exist
 * because the ring is parametric -- seatGeometry already takes `count`, and
 * poker-table.tsx already passes `orderedSeats.length` -- so the day the
 * constant moves, the layout follows with no geometry change at all. What
 * these lock down is that it follows *correctly*, rather than the eight-max
 * layout being discovered to be wrong at the moment it is switched on.
 */
describe("eight-max geometry", () => {
  const EIGHT = 8;

  it("puts the eight seats on the clock face", () => {
    // Slot 0 is the near edge -- six o'clock -- and each slot after it steps
    // 45 degrees anticlockwise on screen: 7:30, 9:00, 10:30, 12:00, 1:30,
    // 3:00, 4:30. Checked as positions rather than angles because the
    // positions are what has to be right.
    const at = (slot: number) => seatGeometry(slot, EIGHT, { rx: 40, ry: 40 });

    expect(at(0).x).toBeCloseTo(50, 5); // 6:00
    expect(at(0).y).toBeGreaterThan(50);
    expect(at(2).x).toBeLessThan(50); // 9:00
    expect(at(2).y).toBeCloseTo(50, 5);
    expect(at(4).x).toBeCloseTo(50, 5); // 12:00
    expect(at(4).y).toBeLessThan(50);
    expect(at(6).x).toBeGreaterThan(50); // 3:00
    expect(at(6).y).toBeCloseTo(50, 5);

    // Evenly spaced, which is what makes the ring read as a clock face rather
    // than merely as eight seats. Measured as the chord between neighbours on
    // a circular ring (rx == ry): every one of the eight gaps is the same.
    // Not the midpoint of its neighbours -- a point on an arc sits outside
    // the chord joining them, so that would be the wrong property.
    const gaps = Array.from({ length: EIGHT }, (_, slot) => {
      const a = at(slot);
      const b = at((slot + 1) % EIGHT);
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 5);
  });

  it("keeps every seat a distinct place on the ring", () => {
    const seen = new Set(
      Array.from({ length: EIGHT }, (_, slot) => {
        const { x, y } = seatGeometry(slot, EIGHT);
        return `${x.toFixed(4)},${y.toFixed(4)}`;
      }),
    );
    expect(seen.size).toBe(EIGHT);
  });

  it("still points every seat at the pot", () => {
    for (let slot = 0; slot < EIGHT; slot += 1) {
      const { x, y, towardPot } = seatGeometry(slot, EIGHT);
      // Same box-norm contract the six-max case has: the dominant component
      // is exactly 1, and the vector points back at the middle.
      expect(Math.max(Math.abs(towardPot.x), Math.abs(towardPot.y))).toBeCloseTo(1, 5);
      if (Math.abs(50 - x) > 0.001) expect(Math.sign(towardPot.x)).toBe(Math.sign(50 - x));
      if (Math.abs(50 - y) > 0.001) expect(Math.sign(towardPot.y)).toBe(Math.sign(50 - y));
    }
  });
});
