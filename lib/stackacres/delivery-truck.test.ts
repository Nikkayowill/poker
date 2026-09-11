import { describe, expect, it } from "vitest";
import { BARN_FOOTPRINT } from "./world";
import { MONK_HOUSE_FOOTPRINT } from "./monk";
import { PATH_CLEARANCE, distanceToPath, type PathSpec } from "./paths";
import { yardRect } from "./yard";
import {
  DELIVERY_ROUTE,
  TRUCK_FOOTPRINT,
  TRUCK_PARK_SPOT,
  TRUCK_SPEED,
  TruckState,
  spawnTruck,
  stepTruck,
  truckHitAt,
} from "./delivery-truck";

/** A straight-line stand-in for the route, so distanceToPath can measure
 *  clearance along every leg the truck actually drives, not just its
 *  vertices -- the same "sample the whole body, not just the endpoints"
 *  rigor paths.test.ts's own Ray's-house-drive test uses. */
function routeAsPath(width: number): PathSpec {
  return { key: "route", surface: "dirt", tier: "service", width, points: DELIVERY_ROUTE, stones: 0 };
}

describe("DELIVERY_ROUTE", () => {
  it("starts at the mailbox end of the lane and ends at the dock", () => {
    expect(DELIVERY_ROUTE.length).toBeGreaterThanOrEqual(5);
    expect(TRUCK_PARK_SPOT).toEqual(DELIVERY_ROUTE[DELIVERY_ROUTE.length - 1]);
  });

  it("never runs its own body through the barn, the silo, or the monk's shrine", () => {
    // The barn's own footprint already covers the silo's feet too (both are
    // grouped under "the barn's feet on y 34" in props.ts's own header), so
    // one rect check stands in for both.
    const route = routeAsPath(TRUCK_FOOTPRINT.w);
    const half = TRUCK_FOOTPRINT.w / 2;
    for (const rect of [BARN_FOOTPRINT, MONK_HOUSE_FOOTPRINT]) {
      for (let x = rect.x; x <= rect.x + rect.width; x += 3) {
        for (let y = rect.y; y <= rect.y + rect.height; y += 3) {
          expect(distanceToPath(x, y, route)).toBeGreaterThanOrEqual(half);
        }
      }
    }
  });

  it("parks with real clearance on both sides of the road, not just past each landmark's edge", () => {
    // x 160 y 59: 25 units of open road south of the barn/silo's own feet
    // (y 34), 29 north of the monk's shrine (y 88) -- both comfortably past
    // PATH_CLEARANCE (6), which is the header's own claim.
    expect(TRUCK_PARK_SPOT.y - (BARN_FOOTPRINT.y + BARN_FOOTPRINT.height)).toBeGreaterThan(PATH_CLEARANCE * 2);
    expect(MONK_HOUSE_FOOTPRINT.y - TRUCK_PARK_SPOT.y).toBeGreaterThan(PATH_CLEARANCE * 2);
  });

  it("does not park exactly on a road vertex (the fork the junction paint owns)", () => {
    // yardRoad's own first two vertices, restated (paths.ts keeps these as
    // literals rather than exporting a lookup, same as this file's own
    // header explains for why DELIVERY_ROUTE is built from "lane" instead).
    for (const vertex of [yardRect(108, 58, 0, 0), yardRect(200, 60, 0, 0)]) {
      expect(TRUCK_PARK_SPOT.x === vertex.x && TRUCK_PARK_SPOT.y === vertex.y).toBe(false);
    }
  });
});

describe("spawnTruck", () => {
  it("starts at the route's first vertex, heading to the second, when arriving", () => {
    const truck = spawnTruck("t1");
    expect(truck.state).toBe(TruckState.Arriving);
    expect(truck.x).toBe(DELIVERY_ROUTE[0].x);
    expect(truck.y).toBe(DELIVERY_ROUTE[0].y);
    expect(truck.routeIndex).toBe(1);
  });

  it("starts already parked, with no drive to play, when told it is", () => {
    const truck = spawnTruck("t1", true);
    expect(truck.state).toBe(TruckState.Parked);
    expect(truck.x).toBe(TRUCK_PARK_SPOT.x);
    expect(truck.y).toBe(TRUCK_PARK_SPOT.y);
    expect(truck.routeIndex).toBe(DELIVERY_ROUTE.length - 1);
  });
});

describe("stepTruck", () => {
  it("drives the whole route and arrives parked", () => {
    let truck = spawnTruck("t1");
    // Comfortably more frames than the route could ever need at 60fps.
    for (let i = 0; i < 3000 && truck.state !== TruckState.Parked; i += 1) {
      const next = stepTruck(truck, 16, true);
      expect(next).not.toBeNull();
      truck = next!;
    }
    expect(truck.state).toBe(TruckState.Parked);
    expect(truck.x).toBe(TRUCK_PARK_SPOT.x);
    expect(truck.y).toBe(TRUCK_PARK_SPOT.y);
  });

  it("sits parked indefinitely while a contract stays open", () => {
    const parked = spawnTruck("t1", true);
    const next = stepTruck(parked, 16, true);
    expect(next).toEqual(parked);
  });

  it("departs the moment presence is no longer wanted, and vanishes at the route's start", () => {
    let truck: ReturnType<typeof spawnTruck> | null = spawnTruck("t1", true);
    // First frame flips it to Departing and it should already have moved --
    // stepTruck steps immediately rather than losing a frame to the
    // transition (see its own doc comment).
    truck = stepTruck(truck, 16, false);
    expect(truck).not.toBeNull();
    expect(truck!.state).toBe(TruckState.Departing);
    expect(truck!.x === TRUCK_PARK_SPOT.x && truck!.y === TRUCK_PARK_SPOT.y).toBe(false);

    for (let i = 0; i < 3000 && truck !== null; i += 1) {
      truck = stepTruck(truck, 16, false);
    }
    expect(truck).toBeNull();
  });

  it("ignores a flip back to present mid-drive, finishing the leg it is already on", () => {
    // Arriving, then presence clears before it reaches the dock: it keeps
    // arriving rather than reversing between two vertices of its own route
    // (the deliberate simplification the function's own header names).
    let truck = spawnTruck("t1");
    truck = stepTruck(truck, 16, true)!;
    const midDrive = { ...truck };
    const stillArriving = stepTruck(midDrive, 16, false);
    expect(stillArriving).not.toBeNull();
    expect(stillArriving!.state).toBe(TruckState.Arriving);
  });

  it("covers ground at TRUCK_SPEED, not FARMHAND_SPEED", () => {
    const truck = spawnTruck("t1");
    // Within MAX_FRAME_MS (world.ts, 250), so the frame-delta clamp every
    // walk goes through (./farmhand-path.ts's `frameSeconds`) doesn't mask
    // the speed this is actually testing.
    const dtMs = 200;
    const next = stepTruck(truck, dtMs, true)!;
    const travelled = Math.hypot(next.x - truck.x, next.y - truck.y);
    expect(travelled).toBeCloseTo(TRUCK_SPEED * (dtMs / 1000), 5);
  });
});

describe("truckHitAt", () => {
  it("hits inside the parked footprint and misses just past its edges", () => {
    const { x, y } = TRUCK_PARK_SPOT;
    expect(truckHitAt(x, y - 1)).toBe(true);
    expect(truckHitAt(x - TRUCK_FOOTPRINT.w / 2 + 1, y)).toBe(true);
    expect(truckHitAt(x + TRUCK_FOOTPRINT.w / 2 + 5, y)).toBe(false);
    expect(truckHitAt(x, y + 5)).toBe(false);
    expect(truckHitAt(x, y - TRUCK_FOOTPRINT.h - 5)).toBe(false);
  });
});
