import { describe, expect, it } from "vitest";
import {
  isLandscapeBand,
  radiiForTable,
  RAIL_Z,
  seatGeometry,
  seatZ,
} from "./table-geometry";

const SEATS = 6;

/** The two landscape handsets the ring was solved and rendered against. */
const IPHONE_14_LANDSCAPE = { width: 844, height: 390 };
/** The plate those stages actually measure, inside the letterbox. */
const LANDSCAPE_PLATE = { width: 793, height: 346 };

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

  it("centres the desktop ring on the desktop rail instead of the wrapper", () => {
    const ellipse = radiiForTable({ width: 1180, height: 641 });
    const near = seatGeometry(0, SEATS, ellipse);
    const far = seatGeometry(3, SEATS, ellipse);

    // .poker-rail is inset 15% from the top and 8% from the bottom, so its
    // centre is 53.5%. Both extrema consequently move down while staying
    // symmetric around the table players are visibly sitting at.
    //
    // 53.5 +/- 32 (RADIUS_Y), not +/- 38: the far seat's own upward lift
    // puts its avatar above the rail regardless of ry, and that band now
    // carries the room's real backdrop art instead of a plain gradient --
    // see table-geometry.ts's own comment on RADIUS_Y.
    expect((near.y + far.y) / 2).toBeCloseTo(53.5, 5);
    expect(near.y).toBeCloseTo(85.5, 5);
    expect(far.y).toBeCloseTo(21.5, 5);
  });

  it("keeps the portrait ring centred on its symmetric mobile rail", () => {
    const ellipse = radiiForTable({ width: 390, height: 629 });
    const near = seatGeometry(0, SEATS, ellipse);
    const far = seatGeometry(3, SEATS, ellipse);
    expect((near.y + far.y) / 2).toBeCloseTo(50, 5);
  });

  /**
   * The landscape band.
   *
   * These pin the two things a render cannot: that the ring is keyed on the
   * viewport rather than the plate, and that its radii still satisfy the
   * clearances they were solved from. Both had a real defect behind them --
   * the first cut keyed on the plate's aspect and never fired at all, and
   * the second put the far player's head under the header.
   */
  describe("landscape band", () => {
    it("switches on the viewport, not the plate", () => {
      // The plate is the SAME box in both calls. Only the window differs, and
      // that is the whole point: once the landscape rules make the wrap fill
      // its area, the plate's own aspect (793x346 = 2.29) is no longer far
      // enough from the desktop oval's 1.84 to tell them apart. Keyed on the
      // plate this ellipse silently never applied.
      const landscape = radiiForTable(LANDSCAPE_PLATE, IPHONE_14_LANDSCAPE);
      const desktop = radiiForTable(LANDSCAPE_PLATE, { width: 1440, height: 900 });
      expect(landscape).not.toEqual(desktop);
      // Flatter and centred lower -- the two vertical constraints it was
      // solved from. Deliberately NOT "rx is larger": the landscape radius is
      // the smaller of the two (43.5 against 46) because it is solved for the
      // seat BOX's edge landing at 4% rather than for its centre, and the
      // plate it sits on is already nearly the full width of the stage.
      expect(landscape.ry).toBeLessThan(desktop.ry);
      expect(landscape.cy).toBeGreaterThan(desktop.cy!);
    });

    it("is a short landscape window and nothing else", () => {
      expect(isLandscapeBand(IPHONE_14_LANDSCAPE)).toBe(true);
      expect(isLandscapeBand({ width: 667, height: 375 })).toBe(true);
      // A tall phone held upright: short enough on neither count.
      expect(isLandscapeBand({ width: 390, height: 844 })).toBe(false);
      // A desktop, which is landscape-shaped but nowhere near short enough.
      expect(isLandscapeBand({ width: 1440, height: 900 })).toBe(false);
      // A short *desktop* window -- wide, but the height clause alone would
      // wrongly claim this one, so both clauses have to be present.
      expect(isLandscapeBand({ width: 1440, height: 480 })).toBe(true);
      expect(isLandscapeBand({ width: 400, height: 480 })).toBe(false);
      // Never divide by a zero box on the first measured frame.
      expect(isLandscapeBand({ width: 0, height: 0 })).toBe(false);
    });

    it("falls back to the plate-derived ellipse when there is no window", () => {
      // A server render has no window. It must not crash and must not get the
      // landscape ring by accident.
      expect(radiiForTable(LANDSCAPE_PLATE)).toEqual(radiiForTable(LANDSCAPE_PLATE, undefined));
      expect(radiiForTable(LANDSCAPE_PLATE).rx).toBe(46);
    });

    it("beats the narrow-plate ellipse rather than losing to it", () => {
      // A landscape phone is short AND narrow enough to trip isNarrow, whose
      // radius pulls the ring *inward* -- the opposite of what this plate
      // wants. Ordering the checks the other way round fails silently.
      const ellipse = radiiForTable({ width: 600, height: 260 }, { width: 667, height: 375 });
      expect(ellipse.rx).toBeGreaterThan(38);
    });

    it("keeps the far seat clear of the header and the flanks clear of the bar", () => {
      const ellipse = radiiForTable(LANDSCAPE_PLATE, IPHONE_14_LANDSCAPE);
      const far = seatGeometry(3, SEATS, ellipse);
      const flank = seatGeometry(1, SEATS, ellipse);

      // The two constraints LANDSCAPE_RADIUS_Y was solved from, in the plate
      // percent they were solved in. `.seat-ring` lifts a seat box well above
      // its own ellipse point, so the far chair needs this much clearance or
      // its crown is drawn under the 42px header -- measured at -3px before.
      expect(far.y).toBeGreaterThanOrEqual(24.6);
      expect(flank.y).toBeLessThanOrEqual(72.2);
    });

    it("centres the ring on the landscape rail", () => {
      const ellipse = radiiForTable(LANDSCAPE_PLATE, IPHONE_14_LANDSCAPE);
      const near = seatGeometry(0, SEATS, ellipse);
      const far = seatGeometry(3, SEATS, ellipse);
      // .poker-rail is inset 14% top and 4% bottom in the landscape block of
      // 12-responsive.css, so its centre is 55%. The two are one decision;
      // this is the half of it a test can hold.
      expect((near.y + far.y) / 2).toBeCloseTo(55, 5);
    });
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
    const centreY = 53.5;
    for (let slot = 0; slot < EIGHT; slot += 1) {
      const { x, y, towardPot } = seatGeometry(slot, EIGHT);
      // Same box-norm contract the six-max case has: the dominant component
      // is exactly 1, and the vector points back at the middle.
      expect(Math.max(Math.abs(towardPot.x), Math.abs(towardPot.y))).toBeCloseTo(1, 5);
      if (Math.abs(50 - x) > 0.001) expect(Math.sign(towardPot.x)).toBe(Math.sign(50 - x));
      if (Math.abs(centreY - y) > 0.001) expect(Math.sign(towardPot.y)).toBe(Math.sign(centreY - y));
    }
  });
});
