import { describe, expect, it } from "vitest";
import {
  CAMERA_ELEVATION_DEG,
  DEALER_ANGLE_DEG,
  DESKTOP_LANDSCAPE_FRAME,
  FELT,
  FELT_TOP_Y,
  FLOOR_Y,
  HERO_SLOT,
  MOBILE_LANDSCAPE_FRAME,
  PEDESTAL,
  SEAT_COUNT,
  SEATED_HEAD_Y,
  SLAB_BOTTOM_Y,
  SLAB_THICKNESS,
  TABLE_OUTER,
  cameraAtDistance,
  chipAnchor,
  communityCardsAnchor,
  dealerAnchor,
  dealerButtonAnchor,
  dealerHead,
  debugMarkers,
  feltOutline,
  fitCamera,
  pedestalOutline,
  potAnchor,
  project,
  seatAnchor,
  seatAngleDeg,
  seatAnglesDeg,
  seatShoulderRoom,
  stadiumRayPoint,
  seatHead,
  tableOutline,
} from "./table-anchors";

/** Signed distance to a stadium's boundary: negative inside, positive out. */
function stadiumSignedDistance(point: { x: number; z: number }, halfLength: number, halfWidth: number): number {
  const straightHalf = Math.max(0, halfLength - halfWidth);
  const clampedX = Math.max(-straightHalf, Math.min(straightHalf, point.x));
  return Math.hypot(point.x - clampedX, point.z) - halfWidth;
}

describe("the table as a real object", () => {
  it("is a racetrack with a genuine straight run, near 2:1", () => {
    expect(TABLE_OUTER.halfLength).toBeGreaterThan(TABLE_OUTER.halfWidth);
    expect(TABLE_OUTER.halfLength - TABLE_OUTER.halfWidth).toBeGreaterThan(0);
    const ratio = TABLE_OUTER.halfLength / TABLE_OUTER.halfWidth;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
  });

  it("insets the felt from the outer edge by the rail all the way round", () => {
    expect(TABLE_OUTER.halfLength - FELT.halfLength).toBeCloseTo(TABLE_OUTER.halfWidth - FELT.halfWidth, 9);
    expect(FELT.halfWidth).toBeGreaterThan(0);
  });

  it("has real thickness standing on the floor, not a flat outline", () => {
    expect(SLAB_THICKNESS).toBeGreaterThan(0);
    expect(SLAB_BOTTOM_Y).toBeCloseTo(FELT_TOP_Y - SLAB_THICKNESS, 9);
    expect(SLAB_BOTTOM_Y).toBeGreaterThan(FLOOR_Y);
  });

  it("carries the slab on a pedestal narrower than the top it holds up", () => {
    expect(PEDESTAL.halfLength).toBeLessThan(TABLE_OUTER.halfLength);
    expect(PEDESTAL.halfWidth).toBeLessThan(TABLE_OUTER.halfWidth);
    expect(PEDESTAL.halfWidth).toBeGreaterThan(0);
    expect(pedestalOutline().length).toBeGreaterThan(0);
  });

  it("outlines the felt and the table top to their own extremes", () => {
    const felt = feltOutline();
    expect(Math.max(...felt.map((p) => p.x))).toBeCloseTo(FELT.halfLength, 6);
    expect(Math.max(...felt.map((p) => p.z))).toBeCloseTo(FELT.halfWidth, 6);
    const table = tableOutline();
    expect(Math.max(...table.map((p) => p.x))).toBeCloseTo(TABLE_OUTER.halfLength, 6);
  });
});

describe("the six seats", () => {
  it("puts seat0 -- the local player -- at the near edge, centred", () => {
    const seat = seatAnchor(HERO_SLOT);
    expect(seat.x).toBeCloseTo(0, 6);
    expect(seat.z).toBeGreaterThan(0);
  });

  it("puts every opponent on the far side of the table from the camera", () => {
    // Not literally z < 0 for all of them -- the near flanks sit slightly
    // forward of the table's waist -- but every one of them is further from
    // the camera than the local player is.
    const hero = seatAnchor(HERO_SLOT);
    for (let slot = 1; slot < SEAT_COUNT; slot += 1) {
      expect(seatAnchor(slot).z).toBeLessThan(hero.z);
    }
  });

  it("splits the flanks left and right", () => {
    expect(seatAnchor(1).x).toBeLessThan(0);
    expect(seatAnchor(2).x).toBeLessThan(0);
    expect(seatAnchor(3).x).toBeLessThan(0);
    expect(seatAnchor(4).x).toBeGreaterThan(0);
    expect(seatAnchor(5).x).toBeGreaterThan(0);
  });

  it("seats everyone outside the table's own edge", () => {
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      const seat = seatAnchor(slot);
      expect(stadiumSignedDistance(seat, TABLE_OUTER.halfLength, TABLE_OUTER.halfWidth)).toBeGreaterThan(0);
    }
  });

  it("stands seats on the floor and puts their heads above the felt", () => {
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      expect(seatAnchor(slot).y).toBeCloseTo(FLOOR_Y, 9);
      expect(seatHead(slot).y).toBeCloseTo(SEATED_HEAD_Y, 9);
      expect(seatHead(slot).y).toBeGreaterThan(FELT_TOP_Y);
    }
  });

  it("clusters everyone on the far arc, leaving the table's tips empty", () => {
    // The composition rule: the TABLE is the widest thing on screen, not the
    // crowd. A ring spread over the whole table puts a player at each tip,
    // which forces the camera back and shrinks the table to half the frame.
    for (let slot = 1; slot < SEAT_COUNT; slot += 1) {
      const seat = seatAnchor(slot);
      // Nobody overhangs a tip: a head out there has bare floor under it.
      expect(Math.abs(seat.x)).toBeLessThanOrEqual(TABLE_OUTER.halfLength);
      // Everyone is genuinely on the far half, not wrapped round the sides.
      expect(seat.z).toBeLessThan(0);
    }
  });

  it("leaves the far centre free -- no player seat sits where the dealer works", () => {
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      expect(seatAngleDeg(slot)).not.toBeCloseTo(DEALER_ANGLE_DEG, 6);
    }
  });
});

describe("the dealer", () => {
  it("sits at the table, dead centre of the far rail", () => {
    const dealer = dealerAnchor();
    expect(dealer.x).toBeCloseTo(0, 6);
    expect(dealer.z).toBeLessThan(0);
    expect(dealer.y).toBeCloseTo(FLOOR_Y, 9);
  });

  it("is at the table, NOT parked behind the players", () => {
    // The regression this replaces: the dealer used to sit metres back,
    // behind the whole seat ring, reading as someone standing in the room.
    const dealer = dealerAnchor();
    for (let slot = 1; slot < SEAT_COUNT; slot += 1) {
      const seat = seatAnchor(slot);
      // Every opponent is at least as far from the table's centre as the
      // dealer is -- nobody is between the dealer and the felt.
      expect(Math.hypot(dealer.x, dealer.z)).toBeLessThanOrEqual(Math.hypot(seat.x, seat.z) + 1e-9);
    }
  });

  it("is close enough to the rail to reach the board", () => {
    const dealer = dealerAnchor();
    const board = communityCardsAnchor();
    const reach = Math.hypot(dealer.x - board.x, dealer.z - board.z);
    // A seated adult's forward reach is roughly 0.7m; the dealer has to be
    // able to lay the board without leaving their chair.
    expect(reach).toBeLessThan(0.75);
  });

  it("is not one of the six seats", () => {
    const dealer = dealerAnchor();
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      const seat = seatAnchor(slot);
      expect(Math.hypot(dealer.x - seat.x, dealer.z - seat.z)).toBeGreaterThan(0.3);
    }
  });

  it("keeps their head above the players' eyeline, as a working dealer sits", () => {
    expect(dealerHead().y).toBeGreaterThan(SEATED_HEAD_Y);
  });
});

describe("what sits on the felt", () => {
  it("keeps the pot behind the board, both on the cloth", () => {
    const board = communityCardsAnchor();
    const pot = potAnchor();
    expect(pot.z).toBeLessThan(board.z);
    for (const point of [board, pot]) {
      expect(stadiumSignedDistance(point, FELT.halfLength, FELT.halfWidth)).toBeLessThan(0);
      expect(point.y).toBeCloseTo(FELT_TOP_Y, 9);
    }
  });

  it("keeps every seat's chips and button on the cloth", () => {
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      for (const point of [chipAnchor(slot), dealerButtonAnchor(slot)]) {
        expect(stadiumSignedDistance(point, FELT.halfLength, FELT.halfWidth)).toBeLessThan(0);
      }
    }
  });

  it("puts the button nearer its own seat than that seat's bet", () => {
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      const seat = seatAnchor(slot);
      const chips = chipAnchor(slot);
      const button = dealerButtonAnchor(slot);
      expect(Math.hypot(seat.x - button.x, seat.z - button.z))
        .toBeLessThan(Math.hypot(seat.x - chips.x, seat.z - chips.z));
    }
  });
});

describe("the camera", () => {
  it("looks across the table, not down at it", () => {
    // The whole point of the rebuild. A plan view is what this replaces.
    expect(CAMERA_ELEVATION_DEG).toBeLessThan(35);
    expect(CAMERA_ELEVATION_DEG).toBeGreaterThan(5);
  });

  it("sits above the table and behind the local player", () => {
    const camera = fitCamera(DESKTOP_LANDSCAPE_FRAME);
    expect(camera.position.y).toBeGreaterThan(FELT_TOP_Y);
    expect(camera.position.z).toBeGreaterThan(seatAnchor(HERO_SLOT).z);
  });

  it("gives real depth: the far rail projects narrower than the near rail", () => {
    const camera = fitCamera(DESKTOP_LANDSCAPE_FRAME);
    const nearLeft = project(camera, { x: -TABLE_OUTER.halfWidth, y: FELT_TOP_Y, z: TABLE_OUTER.halfWidth });
    const nearRight = project(camera, { x: TABLE_OUTER.halfWidth, y: FELT_TOP_Y, z: TABLE_OUTER.halfWidth });
    const farLeft = project(camera, { x: -TABLE_OUTER.halfWidth, y: FELT_TOP_Y, z: -TABLE_OUTER.halfWidth });
    const farRight = project(camera, { x: TABLE_OUTER.halfWidth, y: FELT_TOP_Y, z: -TABLE_OUTER.halfWidth });
    expect(farRight.x - farLeft.x).toBeLessThan(nearRight.x - nearLeft.x);
  });

  it("stands the table up: the slab's underside draws below its own top edge", () => {
    const camera = fitCamera(DESKTOP_LANDSCAPE_FRAME);
    const edge = { x: 0, z: TABLE_OUTER.halfWidth };
    const top = project(camera, { ...edge, y: FELT_TOP_Y });
    const bottom = project(camera, { ...edge, y: SLAB_BOTTOM_Y });
    expect(bottom.y).toBeGreaterThan(top.y);
  });

  for (const [name, frame] of Object.entries({
    desktop: DESKTOP_LANDSCAPE_FRAME,
    mobile: MOBILE_LANDSCAPE_FRAME,
  })) {
    it(`holds every opponent and the dealer in the ${name} frame`, () => {
      const camera = fitCamera(frame);
      const hudLine = frame.height * (1 - (frame.hudFraction ?? 0));
      for (let slot = 1; slot < SEAT_COUNT; slot += 1) {
        const head = project(camera, seatHead(slot));
        expect(head.depth).toBeGreaterThan(0);
        expect(head.x).toBeGreaterThanOrEqual(0);
        expect(head.x).toBeLessThanOrEqual(frame.width);
        expect(head.y).toBeGreaterThanOrEqual(0);
        expect(head.y).toBeLessThanOrEqual(hudLine);
      }
      const dealer = project(camera, dealerHead());
      expect(dealer.y).toBeGreaterThanOrEqual(0);
      expect(dealer.y).toBeLessThanOrEqual(hudLine);
    });

    it(`keeps the crowd in the upper half of the ${name} frame`, () => {
      // "All the characters at the top" -- the composition, asserted.
      const camera = fitCamera(frame);
      for (let slot = 1; slot < SEAT_COUNT; slot += 1) {
        expect(project(camera, seatHead(slot)).y).toBeLessThan(frame.height * 0.5);
      }
      expect(project(camera, dealerHead()).y).toBeLessThan(frame.height * 0.5);
    });

    it(`fills the ${name} frame -- the table is not a distant oval`, () => {
      const camera = fitCamera(frame);
      const left = project(camera, { x: -TABLE_OUTER.halfLength, y: FELT_TOP_Y, z: 0 });
      const right = project(camera, { x: TABLE_OUTER.halfLength, y: FELT_TOP_Y, z: 0 });
      expect(right.x - left.x).toBeGreaterThan(frame.width * 0.7);
    });

    it(`runs the near rail down to the ${name} HUD, so we are sitting at it`, () => {
      const camera = fitCamera(frame);
      const nearRail = project(camera, {
        x: 0,
        y: FELT_TOP_Y,
        z: TABLE_OUTER.halfWidth,
      });
      expect(nearRail.y).toBeGreaterThan(frame.height * 0.55);
    });
  }

  it("moves the camera back when the frame gets tighter", () => {
    const roomy = fitCamera({ width: 1600, height: 900 });
    const tight = fitCamera({ width: 600, height: 900 });
    expect(tight.position.z).toBeGreaterThan(roomy.position.z);
  });

  it("projects a point behind the lens with negative depth rather than NaN", () => {
    const camera = cameraAtDistance(DESKTOP_LANDSCAPE_FRAME, 3);
    const behind = project(camera, { x: 0, y: FELT_TOP_Y, z: camera.position.z + 5 });
    expect(behind.depth).toBeLessThan(0);
    expect(Number.isFinite(behind.x)).toBe(true);
    expect(Number.isFinite(behind.y)).toBe(true);
  });
});

describe("debug markers", () => {
  it("labels all six seats, the dealer, and the felt anchors", () => {
    const markers = debugMarkers();
    expect(markers.filter((m) => m.kind === "seat")).toHaveLength(SEAT_COUNT);
    expect(markers.filter((m) => m.id === "dealerAnchor")).toHaveLength(1);
    expect(markers.map((m) => m.id)).toContain("pot");
    expect(markers.map((m) => m.id)).toContain("communityCards");
  });
});

describe("seating a table that is not full", () => {
  /* The game seats two to six. A fixed six-slot arc leaves a short-handed
     hand with holes in the middle of the crowd while the outermost chairs
     stay occupied, which reads as players having stood up and walked round
     rather than as a smaller game. */
  it("keeps the measured six-handed arrangement as its own six-handed case", () => {
    expect(seatAnglesDeg(SEAT_COUNT)).toEqual([90, 210, 230, 250, 290, 310]);
  });

  it("always seats the local player at the near edge", () => {
    for (let count = 1; count <= SEAT_COUNT; count += 1) {
      expect(seatAnglesDeg(count)[0]).toBe(90);
      expect(seatAngleDeg(HERO_SLOT, count)).toBe(90);
    }
  });

  it("gives every seat its own place, in ring order", () => {
    for (let count = 2; count <= SEAT_COUNT; count += 1) {
      const angles = seatAnglesDeg(count);
      expect(angles).toHaveLength(count);
      expect(new Set(angles).size).toBe(count);
      // Monotonically increasing, which is what makes ring slot N mean the
      // same chair here as in lib/game/table-geometry.ts. Two layouts that
      // disagreed would land a payout under someone else's nameplate.
      for (let slot = 1; slot < count; slot += 1) {
        expect(angles[slot]).toBeGreaterThan(angles[slot - 1]);
      }
    }
  });

  it("never seats a player where the dealer is working", () => {
    for (let count = 2; count <= SEAT_COUNT; count += 1) {
      expect(seatAnglesDeg(count)).not.toContain(DEALER_ANGLE_DEG);
    }
  });

  it("clusters every opponent on the far arc, never at the table's tips", () => {
    for (let count = 2; count <= SEAT_COUNT; count += 1) {
      for (let slot = 1; slot < count; slot += 1) {
        const seat = seatAnchor(slot, count);
        // Behind the far half of the table: negative Z is away from the camera.
        expect(seat.z).toBeLessThan(0);
        // Inside the table's own tips, so no head hangs over bare floor.
        expect(Math.abs(seat.x)).toBeLessThan(TABLE_OUTER.halfLength);
      }
    }
  });

  it("balances the arc about the dealer, the odd chair going left", () => {
    for (let count = 2; count <= SEAT_COUNT; count += 1) {
      const angles = seatAnglesDeg(count).slice(1);
      const left = angles.filter((angle) => angle < DEALER_ANGLE_DEG).length;
      const right = angles.filter((angle) => angle > DEALER_ANGLE_DEG).length;
      expect(left - right).toBeGreaterThanOrEqual(0);
      expect(left - right).toBeLessThanOrEqual(1);
    }
  });

  it("gives a short-handed table more elbow room, not less", () => {
    expect(seatShoulderRoom(1, 3)).toBeGreaterThan(seatShoulderRoom(1, SEAT_COUNT));
  });
});

describe("stadiumRayPoint", () => {
  const RADII = { halfLength: 0.925, halfWidth: 0.3945 };

  /* The property the tray anchor depends on, and the one `ringPoint`'s
     inscribed ellipse silently fails at every angle but four. */
  it("lands on the boundary at every angle, not inside it", () => {
    for (let angle = 0; angle < 360; angle += 3) {
      const point = stadiumRayPoint(angle, RADII);
      expect(stadiumSignedDistance(point, RADII.halfLength, RADII.halfWidth)).toBeCloseTo(0, 9);
    }
  });

  it("agrees with the ellipse exactly where the two shapes touch", () => {
    expect(stadiumRayPoint(0, RADII).x).toBeCloseTo(RADII.halfLength, 9);
    expect(stadiumRayPoint(90, RADII).z).toBeCloseTo(RADII.halfWidth, 9);
    expect(stadiumRayPoint(180, RADII).x).toBeCloseTo(-RADII.halfLength, 9);
    expect(stadiumRayPoint(270, RADII).z).toBeCloseTo(-RADII.halfWidth, 9);
  });

  /**
   * The bug itself, stated directly: the ellipse `ringPoint` traces is INSIDE
   * this stadium everywhere except the four axis points. So offsetting the
   * felt outward and then reading the result off the ellipse can still land
   * on the cloth -- which is exactly what it did at the chairs flanking the
   * dealer.
   *
   * Note the two parameterisations are not comparable angle for angle: the
   * ellipse's parameter is not a polar angle, so this compares each ellipse
   * point against the stadium itself rather than against `stadiumRayPoint` at
   * the same number.
   */
  it("bounds an ellipse that is otherwise strictly inside the stadium", () => {
    let strictlyInside = 0;
    for (let parameter = 0; parameter < 360; parameter += 3) {
      const theta = (parameter * Math.PI) / 180;
      const onEllipse = { x: RADII.halfLength * Math.cos(theta), z: RADII.halfWidth * Math.sin(theta) };
      const distance = stadiumSignedDistance(onEllipse, RADII.halfLength, RADII.halfWidth);
      expect(distance).toBeLessThanOrEqual(1e-9);
      if (distance < -1e-9) strictlyInside += 1;
    }
    // Not a formality: if the two shapes agreed, the tray anchor would not
    // have needed this function at all.
    expect(strictlyInside).toBeGreaterThan(0);
  });
});
