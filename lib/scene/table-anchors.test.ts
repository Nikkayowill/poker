import { describe, expect, it } from "vitest";
import {
  DEALER_WORKSPACE_DEPTH,
  DESKTOP_LANDSCAPE_VIEWPORT,
  FAR_CENTER_SLOT,
  FELT,
  MOBILE_LANDSCAPE_VIEWPORT,
  RAIL_THICKNESS,
  chipAnchor,
  dealerAnchor,
  dealerButtonAnchor,
  debugMarkers,
  feltOutline,
  fitCameraToBox,
  potAnchor,
  communityCardsAnchor,
  project,
  railOutline,
  sceneBounds,
  seatAnchor,
} from "./table-anchors";

/** Signed distance from a point to a stadium's own boundary: negative
 * inside, positive outside. Test-only -- production code never needs to ask
 * "is this point outside the rail", only "place a seat this far past it". */
function stadiumSignedDistance(point: { x: number; z: number }, halfLength: number, halfWidth: number): number {
  const straightHalf = Math.max(0, halfLength - halfWidth);
  const clampedX = Math.max(-straightHalf, Math.min(straightHalf, point.x));
  const dx = point.x - clampedX;
  const distanceToCore = Math.hypot(dx, point.z);
  return distanceToCore - halfWidth;
}

describe("the racetrack felt", () => {
  it("has a real straight run -- a racetrack, not a circle", () => {
    expect(FELT.radiusX).toBeGreaterThan(FELT.radiusZ);
    const straightHalf = FELT.radiusX - FELT.radiusZ;
    expect(straightHalf).toBeGreaterThan(0);
  });

  it("outlines a closed shape with the felt's own extremes", () => {
    const outline = feltOutline();
    const xs = outline.map((p) => p.x);
    const zs = outline.map((p) => p.z);
    expect(Math.max(...xs)).toBeCloseTo(FELT.radiusX, 6);
    expect(Math.min(...xs)).toBeCloseTo(-FELT.radiusX, 6);
    expect(Math.max(...zs)).toBeCloseTo(FELT.radiusZ, 6);
    expect(Math.min(...zs)).toBeCloseTo(-FELT.radiusZ, 6);
  });
});

describe("the rail", () => {
  it("sits outside the felt by exactly RAIL_THICKNESS", () => {
    const rail = railOutline();
    const felt = feltOutline();
    expect(Math.max(...rail.map((p) => p.x))).toBeCloseTo(Math.max(...felt.map((p) => p.x)) + RAIL_THICKNESS, 6);
    expect(Math.max(...rail.map((p) => p.z))).toBeCloseTo(Math.max(...felt.map((p) => p.z)) + RAIL_THICKNESS, 6);
  });
});

describe("the six seats", () => {
  it("puts seat0 nearest the viewer, centred", () => {
    const seat = seatAnchor(0);
    expect(seat.x).toBeCloseTo(0, 6);
    expect(seat.z).toBeGreaterThan(0);
  });

  it("puts seat3 directly opposite, at the far centre", () => {
    const seat = seatAnchor(FAR_CENTER_SLOT);
    expect(seat.x).toBeCloseTo(0, 6);
    expect(seat.z).toBeLessThan(0);
  });

  it("splits the flanks near-left/far-left and near-right/far-right", () => {
    const nearLeft = seatAnchor(1);
    const farLeft = seatAnchor(2);
    const farRight = seatAnchor(4);
    const nearRight = seatAnchor(5);

    expect(nearLeft.x).toBeLessThan(0);
    expect(nearLeft.z).toBeGreaterThan(0);
    expect(farLeft.x).toBeLessThan(0);
    expect(farLeft.z).toBeLessThan(0);

    expect(nearRight.x).toBeGreaterThan(0);
    expect(nearRight.z).toBeGreaterThan(0);
    expect(farRight.x).toBeGreaterThan(0);
    expect(farRight.z).toBeLessThan(0);
  });

  it("sits every seat strictly outside the true rail shape, not just past its tips", () => {
    // Rail radii aren't exported directly; railOutline()'s own extremes give
    // them back (feltOutline's own "closed shape" test above pins that this
    // recovers the real radii, not an approximation of them).
    const outline = railOutline();
    const halfLength = Math.max(...outline.map((p) => p.x));
    const halfWidth = Math.max(...outline.map((p) => p.z));
    for (let slot = 0; slot < 6; slot += 1) {
      const seat = seatAnchor(slot);
      const distance = stadiumSignedDistance(seat, halfLength, halfWidth);
      expect(distance).toBeGreaterThan(0);
    }
  });

  it("all sit at table height", () => {
    for (let slot = 0; slot < 6; slot += 1) {
      expect(seatAnchor(slot).y).toBeCloseTo(FELT.y, 9);
    }
  });
});

describe("the dealer's own anchor", () => {
  it("is not one of the six seats", () => {
    const dealer = dealerAnchor();
    for (let slot = 0; slot < 6; slot += 1) {
      const seat = seatAnchor(slot);
      const distance = Math.hypot(dealer.x - seat.x, dealer.z - seat.z);
      expect(distance).toBeGreaterThan(1);
    }
  });

  it("sits centred, on seat3's own ray, behind the far rail", () => {
    const dealer = dealerAnchor();
    expect(dealer.x).toBeCloseTo(0, 6);
    expect(dealer.z).toBeLessThan(0);
  });

  it("sits further back than seat3 by exactly the reserved workspace depth", () => {
    const dealer = dealerAnchor();
    const farSeat = seatAnchor(FAR_CENTER_SLOT);
    expect(farSeat.z - dealer.z).toBeCloseTo(DEALER_WORKSPACE_DEPTH, 6);
  });
});

describe("board, pot and per-seat spots", () => {
  it("keeps the pot behind the board, never stacked under it", () => {
    const board = communityCardsAnchor();
    const pot = potAnchor();
    expect(board.z).toBeLessThan(0);
    expect(pot.z).toBeLessThan(board.z);
  });

  it("pulls each seat's chips in from the rail, toward the felt centre", () => {
    for (let slot = 0; slot < 6; slot += 1) {
      const seat = seatAnchor(slot);
      const chips = chipAnchor(slot);
      expect(Math.hypot(chips.x, chips.z)).toBeLessThan(Math.hypot(seat.x, seat.z));
    }
  });

  it("keeps the dealer button nearer its seat than that seat's own bet -- a bet travels further onto the felt", () => {
    for (let slot = 0; slot < 6; slot += 1) {
      const seat = seatAnchor(slot);
      const chips = chipAnchor(slot);
      const button = dealerButtonAnchor(slot);
      const seatToButton = Math.hypot(seat.x - button.x, seat.z - button.z);
      const seatToChips = Math.hypot(seat.x - chips.x, seat.z - chips.z);
      expect(seatToButton).toBeLessThan(seatToChips);
    }
  });
});

describe("camera fit", () => {
  for (const [name, box] of Object.entries({ desktop: DESKTOP_LANDSCAPE_VIEWPORT, mobile: MOBILE_LANDSCAPE_VIEWPORT })) {
    it(`keeps every debug marker inside the ${name} landscape frame`, () => {
      const view = fitCameraToBox(box);
      for (const marker of debugMarkers()) {
        const screen = project(view, marker.position);
        expect(screen.x).toBeGreaterThanOrEqual(-1);
        expect(screen.x).toBeLessThanOrEqual(box.width + 1);
        expect(screen.y).toBeGreaterThanOrEqual(-1);
        expect(screen.y).toBeLessThanOrEqual(box.height + 1);
      }
    });

    it(`keeps the rail's own outline inside the ${name} frame too`, () => {
      const view = fitCameraToBox(box);
      for (const point of railOutline()) {
        const screen = project(view, { ...point, y: FELT.y });
        expect(screen.x).toBeGreaterThanOrEqual(-1);
        expect(screen.x).toBeLessThanOrEqual(box.width + 1);
      }
    });
  }

  it("scales up for a wider box and down for a narrower one", () => {
    const wide = fitCameraToBox({ width: 3200, height: 1800 });
    const narrow = fitCameraToBox({ width: 400, height: 300 });
    expect(wide.scale).toBeGreaterThan(narrow.scale);
  });
});

describe("scene bounds", () => {
  it("contains every seat and the dealer's reserved space", () => {
    const bounds = sceneBounds();
    for (let slot = 0; slot < 6; slot += 1) {
      const seat = seatAnchor(slot);
      expect(seat.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(seat.x).toBeLessThanOrEqual(bounds.maxX);
      expect(seat.z).toBeGreaterThanOrEqual(bounds.minZ);
      expect(seat.z).toBeLessThanOrEqual(bounds.maxZ);
    }
    const dealer = dealerAnchor();
    expect(dealer.z).toBeGreaterThanOrEqual(bounds.minZ);
  });
});
