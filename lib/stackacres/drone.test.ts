import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STACKACRES_TILE } from "./world";
import {
  DRONE_DROP_MAX_GAP_TILES,
  DRONE_DROP_MIN_GAP_TILES,
  DRONE_FORAGE_COOLDOWN_MS,
  DRONE_FORAGE_COOLDOWN_SECONDS,
  DRONE_MAX_CHARGE,
  DRONE_SPEED,
  DroneState,
  calculatePerimeterWaypoint,
  isPerimeterTile,
  lockedDrone,
  nearestPerimeterTile,
  rollDropOffsetTiles,
  spawnDrone,
  stepDrone,
  tileAtRingOffset,
  type GridBounds,
  type TileCoord,
} from "./drone";

const SQUARE: GridBounds = { minTx: 0, minTy: 0, maxTx: 3, maxTy: 3 };
const RECT: GridBounds = { minTx: -2, minTy: 5, maxTx: 4, maxTy: 9 };
const COLUMN: GridBounds = { minTx: 5, minTy: 0, maxTx: 5, maxTy: 3 };
const ROW: GridBounds = { minTx: 0, minTy: 5, maxTx: 3, maxTy: 5 };
const SINGLE: GridBounds = { minTx: 1, minTy: 1, maxTx: 1, maxTy: 1 };

function walkFullLap(start: TileCoord, bounds: GridBounds, steps: number): TileCoord[] {
  const path: TileCoord[] = [start];
  let current = start;
  for (let i = 0; i < steps; i++) {
    current = calculatePerimeterWaypoint(current, bounds);
    path.push(current);
  }
  return path;
}

describe("calculatePerimeterWaypoint", () => {
  it("walks clockwise around a square ring and returns to the start", () => {
    const perimeterTileCount = 4 * (3 - 0); // 4 tiles per side, corners shared once each
    const path = walkFullLap({ tx: 0, ty: 0 }, SQUARE, perimeterTileCount);
    expect(path[path.length - 1]).toEqual({ tx: 0, ty: 0 });
    // Every intermediate tile stayed on the ring.
    for (const tile of path) {
      expect(isPerimeterTile(tile, SQUARE)).toBe(true);
    }
  });

  it("never steps into the interior of a multi-tile ring", () => {
    let current: TileCoord = { tx: RECT.minTx, ty: RECT.minTy };
    for (let i = 0; i < 200; i++) {
      current = calculatePerimeterWaypoint(current, RECT);
      expect(isPerimeterTile(current, RECT)).toBe(true);
    }
  });

  it("handles a one-tile-wide column ring without stalling", () => {
    const path = walkFullLap({ tx: 5, ty: 0 }, COLUMN, 10);
    // Should sweep down to ty=3 then wrap back to ty=0, never oscillate
    // between two tiles.
    const distinctRun = new Set(path.slice(0, 4).map((t) => t.ty));
    expect(distinctRun.size).toBeGreaterThan(1);
    expect(path[4]).toEqual({ tx: 5, ty: 0 });
  });

  it("handles a one-tile-tall row ring without stalling", () => {
    const path = walkFullLap({ tx: 0, ty: 5 }, ROW, 10);
    expect(path[4]).toEqual({ tx: 0, ty: 5 });
  });

  it("stays put on a single-tile ring", () => {
    const next = calculatePerimeterWaypoint({ tx: 1, ty: 1 }, SINGLE);
    expect(next).toEqual({ tx: 1, ty: 1 });
  });

  it("clamps a tile handed in off the ring onto the nearest boundary tile first", () => {
    // (1,1) is interior to SQUARE; clamp pulls it to (1,0) or similar before
    // routing -- whatever it resolves to must be on the perimeter.
    const next = calculatePerimeterWaypoint({ tx: 1, ty: 1 }, SQUARE);
    expect(isPerimeterTile(next, SQUARE)).toBe(true);
  });

  it("is agnostic to which corner of the bounds is min vs max", () => {
    const reversed: GridBounds = { minTx: 3, minTy: 3, maxTx: 0, maxTy: 0 };
    const a = calculatePerimeterWaypoint({ tx: 0, ty: 0 }, SQUARE);
    const b = calculatePerimeterWaypoint({ tx: 0, ty: 0 }, reversed);
    expect(b).toEqual(a);
  });
});

describe("isPerimeterTile / nearestPerimeterTile", () => {
  it("rejects an interior tile", () => {
    expect(isPerimeterTile({ tx: 1, ty: 1 }, SQUARE)).toBe(false);
  });

  it("accepts every edge tile", () => {
    for (let tx = 0; tx <= 3; tx++) {
      expect(isPerimeterTile({ tx, ty: 0 }, SQUARE)).toBe(true);
      expect(isPerimeterTile({ tx, ty: 3 }, SQUARE)).toBe(true);
    }
  });

  it("snaps an interior tile to its nearest edge", () => {
    const snapped = nearestPerimeterTile({ tx: 1, ty: 1 }, SQUARE);
    expect(isPerimeterTile(snapped, SQUARE)).toBe(true);
    // (1,1) is one step from both the top and left edges -- either is a
    // valid nearest tile, but it must actually be adjacent to (1,1).
    const distance = Math.abs(snapped.tx - 1) + Math.abs(snapped.ty - 1);
    expect(distance).toBe(1);
  });

  it("leaves an already-perimeter tile untouched", () => {
    expect(nearestPerimeterTile({ tx: 0, ty: 2 }, SQUARE)).toEqual({ tx: 0, ty: 2 });
  });
});

describe("drop spacing", () => {
  it("rolls a gap within the documented min/max, inclusive of both ends", () => {
    // Deterministic sources pinned at the extremes of Math.random's range.
    expect(rollDropOffsetTiles(() => 0)).toBe(DRONE_DROP_MIN_GAP_TILES);
    expect(rollDropOffsetTiles(() => 0.999999)).toBe(DRONE_DROP_MAX_GAP_TILES);
  });

  it("never rolls outside the range across many draws", () => {
    for (let i = 0; i < 500; i++) {
      const gap = rollDropOffsetTiles();
      expect(gap).toBeGreaterThanOrEqual(DRONE_DROP_MIN_GAP_TILES);
      expect(gap).toBeLessThanOrEqual(DRONE_DROP_MAX_GAP_TILES);
    }
  });

  it("tileAtRingOffset walks exactly that many perimeter steps", () => {
    let expected: TileCoord = { tx: 0, ty: 0 };
    for (let i = 0; i < 5; i++) expected = calculatePerimeterWaypoint(expected, SQUARE);
    expect(tileAtRingOffset({ tx: 0, ty: 0 }, 5, SQUARE)).toEqual(expected);
  });

  it("tileAtRingOffset with an offset of 0 returns the (clamped) starting tile", () => {
    expect(tileAtRingOffset({ tx: 0, ty: 0 }, 0, SQUARE)).toEqual({ tx: 0, ty: 0 });
  });

  it("a rolled drop tile always lands on the perimeter", () => {
    const from: TileCoord = { tx: 0, ty: 0 };
    for (let i = 0; i < 50; i++) {
      const offset = rollDropOffsetTiles();
      const tile = tileAtRingOffset(from, offset, RECT);
      expect(isPerimeterTile(tile, RECT)).toBe(true);
    }
  });
});

describe("stepDrone", () => {
  it("never updates a LOCKED drone", () => {
    const drone = lockedDrone("d1", { tx: 0, ty: 0 });
    const { drone: after, arrivedAtCollectible } = stepDrone(drone, 5_000, null, SQUARE);
    expect(after).toEqual(drone);
    expect(arrivedAtCollectible).toBe(false);
  });

  it("moves an IDLE drone straight into PATROLLING on its first tick", () => {
    const drone = spawnDrone("d1", { tx: 0, ty: 0 }, SQUARE);
    expect(drone.state).toBe(DroneState.Idle);
    const { drone: after } = stepDrone(drone, 16, null, SQUARE);
    expect(after.state).toBe(DroneState.Patrolling);
  });

  it("drains charge while patrolling and eventually recharges", () => {
    let drone = spawnDrone("d1", { tx: 0, ty: 0 }, SQUARE);
    expect(drone.charge).toBe(DRONE_MAX_CHARGE);
    // Run enough frames to burn through the whole battery on flight alone.
    for (let i = 0; i < 5_000 && drone.state !== DroneState.Recharging; i++) {
      drone = stepDrone(drone, 50, null, SQUARE).drone;
    }
    expect(drone.state).toBe(DroneState.Recharging);
    expect(drone.charge).toBe(0);

    // Recharge fully resolves after its fixed duration -- driven in
    // frame-clamped steps, the same way a real scene tick would, since
    // `frameSeconds` caps any single call's delta at `MAX_FRAME_MS`.
    for (let i = 0; i < 100 && drone.state !== DroneState.Patrolling; i++) {
      drone = stepDrone(drone, 250, null, SQUARE).drone;
    }
    expect(drone.state).toBe(DroneState.Patrolling);
    expect(drone.charge).toBe(DRONE_MAX_CHARGE);
  });

  it("vacuums a collectible the instant it arrives at that tile, then resumes patrolling", () => {
    let drone = spawnDrone("d1", { tx: 0, ty: 0 }, SQUARE);
    let arrivedFlag = false;
    // Walk until the drone reaches its very first patrol waypoint, with a
    // collectible sitting on it.
    for (let i = 0; i < 200; i++) {
      const target = drone.waypoint;
      const step = stepDrone(drone, 50, target, SQUARE);
      drone = step.drone;
      if (step.arrivedAtCollectible) {
        arrivedFlag = true;
        break;
      }
      if (drone.state === DroneState.Vacuuming) break;
    }
    expect(arrivedFlag).toBe(true);
    expect(drone.state).toBe(DroneState.Vacuuming);

    // The arrival flag fires exactly once, not on every frame of the vacuum
    // animation that follows.
    const midVacuum = stepDrone(drone, 10, drone.targetCollectible, SQUARE);
    expect(midVacuum.arrivedAtCollectible).toBe(false);

    drone = midVacuum.drone;
    for (let i = 0; i < 100 && drone.state !== DroneState.Patrolling; i++) {
      drone = stepDrone(drone, 250, null, SQUARE).drone;
    }
    expect(drone.state).toBe(DroneState.Patrolling);
    expect(drone.targetCollectible).toBeNull();
  });

  it("is pure: stepping never mutates the drone object passed in", () => {
    const drone = spawnDrone("d1", { tx: 0, ty: 0 }, SQUARE);
    const snapshot = { ...drone };
    stepDrone(drone, 500, null, SQUARE);
    expect(drone).toEqual(snapshot);
  });
});

describe("forage cooldown vs. the drop cadence", () => {
  // The bug this pins: a drone's SIMULATED pickup rate ran far ahead of the
  // rate the server will actually pay one out at. Every extra pickup fired a
  // request that came back 409 "still recharging its magnets", so a fleet of
  // five drones sat there refusing a POST every couple of seconds, all day,
  // and the vacuum animation showed gold being collected that nobody was
  // ever paid for.
  //
  // The fix is the scene holding each drone's next drop for a full cooldown
  // (`nextDropAtMs`) rather than rolling one the instant the last was swept.
  // These two tests pin the two halves of why that hold is needed at all:
  // the flight is short, and the cooldown is long.
  it("cannot fly even its longest drop gap in one cooldown", () => {
    const secondsPerTile = STACKACRES_TILE / DRONE_SPEED;
    const longestFlightSeconds = DRONE_DROP_MAX_GAP_TILES * secondsPerTile;
    expect(longestFlightSeconds).toBeLessThan(DRONE_FORAGE_COOLDOWN_SECONDS);
  });

  it("holds long enough that even the shortest gap lands outside the cooldown", () => {
    // With the hold in place the real interval is cooldown + flight, so the
    // tightest possible claim still clears the server's window rather than
    // racing it.
    const secondsPerTile = STACKACRES_TILE / DRONE_SPEED;
    const shortestInterval =
      DRONE_FORAGE_COOLDOWN_SECONDS + DRONE_DROP_MIN_GAP_TILES * secondsPerTile;
    expect(shortestInterval).toBeGreaterThan(DRONE_FORAGE_COOLDOWN_SECONDS);
    expect(DRONE_FORAGE_COOLDOWN_MS).toBe(DRONE_FORAGE_COOLDOWN_SECONDS * 1000);
  });

  it("is honoured by the scene, which vitest cannot run", () => {
    // stackacres-scene.ts is Phaser and lives outside lib/, so the hold
    // itself is asserted on the source: the gate on the drop roll, and the
    // arming of it the moment a drop is vacuumed.
    const SCENE = readFileSync(
      join(process.cwd(), "components/arcade/stackacres/stackacres-scene.ts"),
      "utf8",
    );
    expect(SCENE).toContain("time >= node.nextDropAtMs");
    expect(SCENE).toContain("node.nextDropAtMs = this.time.now + DRONE_FORAGE_COOLDOWN_MS");
  });

  it("stops entirely once the farm is day-capped", () => {
    // The other refusal a patrolling drone can walk into, and the worse one:
    // a capped farm refuses EVERY claim until UTC midnight, so nothing about
    // waiting one more cooldown helps. The server has to say which refusal
    // it was, and the client has to park the fleet on hearing it.
    const SERVICE = readFileSync(
      join(process.cwd(), "lib/server/stackacres-service.ts"),
      "utf8",
    );
    expect(SERVICE).toContain('result.reason === "day-capped" ? { reason: "day-capped" as const } : {}');
    const FARM = readFileSync(
      join(process.cwd(), "components/arcade/stackacres/stackacres-farm.tsx"),
      "utf8",
    );
    expect(FARM).toContain("holdDroneForage(msUntilNextExchangeDay(new Date()))");
  });
});
