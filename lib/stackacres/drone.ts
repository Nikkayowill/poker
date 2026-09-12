/**
 * The Mechanical Forage Drone: a hangar-gated automaton that flies the
 * outer boundary of a district and vacuums up dropped forage.
 *
 * PRESENTATION, NOT AUTHORITY -- same posture as ./farmhand.ts and
 * `stepCritter` in ./world.ts. Everything in this file is pure and
 * everything it returns is a new object; nothing here holds a database
 * connection or a Gold balance. The two facts that actually have to be
 * durable -- whether a profile owns a hangar-unlocked drone, and whether a
 * given forage claim has already been paid out -- live in
 * lib/server/stackacres-drone-service.ts and the migration behind it, never
 * here. A drone's live tile, waypoint and charge are exactly as ephemeral as
 * a farmhand's `targetX`/`targetY`: lost on refresh, and that is fine,
 * because nothing here can move Gold on its own.
 *
 * GATING IS STRUCTURAL, NOT A FIELD CHECK BURIED IN THE STEP FUNCTION.
 * `DroneState.Locked` exists so a caller has a type to hold before a hangar
 * is unlocked, but `stepDrone` on a locked drone is a deliberate no-op --
 * the actual gate (Requirement 1) is that nothing calls `spawnDrone` or
 * `stepDrone` at all until the server has confirmed the hangar is unlocked
 * (see `isDroneHangarUnlocked` in the service file). This module cannot
 * enforce that on its own; it only refuses to make a locked drone do
 * anything if one is ever constructed anyway.
 *
 * Lives in lib/ for the same reason every other pure StackAcres module does:
 * vitest only reaches lib/ and app/.
 */

import {
  FARMHAND_SPEED,
  advanceTowards,
  frameSeconds,
  sameTile,
  tileCentre,
  tileOf,
  type TileCoord,
  type WalkStep,
  type Walker,
} from "./farmhand-path";
import type { WorldPoint, WorldRect } from "./world";

export type { TileCoord };

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

/**
 * The five states a drone can be in, and the only five.
 *
 * A real TS enum rather than this codebase's usual string-literal union
 * (compare `FarmhandPhase`) -- called for explicitly, and safe here because
 * nothing about a drone's state crosses a JSON boundary the way a stored
 * row's column would; it is scene-local, ephemeral state exactly like a
 * `Farmhand`'s own `phase`. The string values are kept human-readable for
 * the same reason `FarmhandPhase`'s are: a debugger or a log line reads
 * `"VACUUMING"`, never a bare ordinal.
 */
export enum DroneState {
  Locked = "LOCKED",
  Idle = "IDLE",
  Patrolling = "PATROLLING",
  Vacuuming = "VACUUMING",
  Recharging = "RECHARGING",
}

/* ------------------------------------------------------------------ */
/* The perimeter                                                       */
/* ------------------------------------------------------------------ */

/**
 * The tile-space rectangle a drone's flight path is confined to: the four
 * inclusive edges `tx`/`ty` may reach. Not `WorldRect` -- that is a
 * continuous world-unit rectangle (a unit's footprint, a zone's grow area);
 * this is the discrete ring of tiles `calculatePerimeterWaypoint` walks.
 */
export interface GridBounds {
  readonly minTx: number;
  readonly minTy: number;
  readonly maxTx: number;
  readonly maxTy: number;
}

/** `GridBounds` for a district's own `WorldRect` -- the tile that contains
 *  its top-left corner through the tile that contains its bottom-right one.
 *  A drone patrolling one district's grow area passes `tileGridBounds` the
 *  same rect `growAreaInterior`/`growAreaBounds` already hand every other
 *  boundary check in this codebase; this file has no opinion about which of
 *  the two a caller should choose. */
export function tileGridBounds(rect: WorldRect): GridBounds {
  const topLeft = tileOf({ x: rect.x, y: rect.y });
  const bottomRight = tileOf({ x: rect.x + rect.width, y: rect.y + rect.height });
  return { minTx: topLeft.tx, minTy: topLeft.ty, maxTx: bottomRight.tx, maxTy: bottomRight.ty };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Normalizes a caller-supplied `GridBounds` so `minTx <= maxTx` and
 *  `minTy <= maxTy` hold regardless of the order the two corners were
 *  given in -- the geometric functions below all assume it. */
function normalize(bounds: GridBounds): GridBounds {
  return {
    minTx: Math.min(bounds.minTx, bounds.maxTx),
    maxTx: Math.max(bounds.minTx, bounds.maxTx),
    minTy: Math.min(bounds.minTy, bounds.maxTy),
    maxTy: Math.max(bounds.minTy, bounds.maxTy),
  };
}

/** Whether `tile` sits on the outer ring of `bounds` -- `tx === minTx` or
 *  `tx === maxTx` or `ty === minTy` or `ty === maxTy`. This generalizes the
 *  literal "X === 0 or Y === 0" framing of a perimeter to any district's own
 *  tile-space rectangle: StackAcres has no world origin corner (see
 *  ./farmhand-path.ts's own `TileCoord` doc comment -- the Wallow sits at
 *  negative tile coordinates), so a boundary check anchored at zero would
 *  simply never fire for three of the four districts. */
export function isPerimeterTile(tile: TileCoord, bounds: GridBounds): boolean {
  const b = normalize(bounds);
  return tile.tx === b.minTx || tile.tx === b.maxTx || tile.ty === b.minTy || tile.ty === b.maxTy;
}

/**
 * Pure geometric spacing: given a tile the drone is standing on -- which
 * must itself be a perimeter tile, or is clamped onto the nearest one before
 * anything else runs -- returns the next tile one clockwise step further
 * around the ring, starting the lap over at the top-left corner once the
 * circuit closes.
 *
 * O(1), no allocation beyond the returned coordinate, no lookup table: four
 * edge tests decide which of the four directions the drone is currently
 * walking, and a tile at a corner falls through to the next edge's test on
 * its own, which is what keeps the four `if`s from needing to special-case
 * the corners explicitly.
 *
 * A ring one tile wide or tall (`minTx === maxTx` or `minTy === maxTy`) has
 * no second edge to turn onto, so it is handled first as a straight line
 * walked end to end and restarted at its first tile -- the quadrant logic
 * below would otherwise walk such a ring into a two-tile stall, endlessly
 * bouncing between its last tile and the one before it.
 */
export function calculatePerimeterWaypoint(currentTile: TileCoord, gridBounds: GridBounds): TileCoord {
  const { minTx, minTy, maxTx, maxTy } = normalize(gridBounds);
  const tx = clamp(currentTile.tx, minTx, maxTx);
  const ty = clamp(currentTile.ty, minTy, maxTy);

  if (minTx === maxTx) {
    return ty < maxTy ? { tx, ty: ty + 1 } : { tx, ty: minTy };
  }
  if (minTy === maxTy) {
    return tx < maxTx ? { tx: tx + 1, ty } : { tx: minTx, ty };
  }

  const onTop = ty === minTy;
  const onBottom = ty === maxTy;
  const onLeft = tx === minTx;
  const onRight = tx === maxTx;

  // Clockwise from the top-left corner: right along the top edge, down the
  // right edge, left along the bottom edge, up the left edge.
  if (onTop && tx < maxTx) return { tx: tx + 1, ty };
  if (onRight && ty < maxTy) return { tx, ty: ty + 1 };
  if (onBottom && tx > minTx) return { tx: tx - 1, ty };
  if (onLeft && ty > minTy) return { tx, ty: ty - 1 };
  // Only reachable from the bottom-left corner closing the loop, or from a
  // tile handed in off the ring entirely (clamped above but still, say, in
  // the interior of one edge with no direction left to try) -- either way,
  // restart the circuit.
  return { tx: minTx, ty: minTy };
}

/** The nearest perimeter tile to `tile`, for placing a freshly deployed
 *  drone: a hangar sits wherever Ray built it, not necessarily on the ring
 *  itself, so a spawn point is snapped onto the boundary the same way
 *  `calculatePerimeterWaypoint` already clamps a stray tile before routing
 *  it. */
export function nearestPerimeterTile(tile: TileCoord, gridBounds: GridBounds): TileCoord {
  const { minTx, minTy, maxTx, maxTy } = normalize(gridBounds);
  const tx = clamp(tile.tx, minTx, maxTx);
  const ty = clamp(tile.ty, minTy, maxTy);
  if (isPerimeterTile({ tx, ty }, gridBounds)) return { tx, ty };
  // Interior tile: pull it to whichever edge is closest.
  const distances: Array<[number, TileCoord]> = [
    [ty - minTy, { tx, ty: minTy }],
    [maxTy - ty, { tx, ty: maxTy }],
    [tx - minTx, { tx: minTx, ty }],
    [maxTx - tx, { tx: maxTx, ty }],
  ];
  distances.sort((a, b) => a[0] - b[0]);
  return distances[0][1];
}

/* ------------------------------------------------------------------ */
/* Tuning                                                               */
/* ------------------------------------------------------------------ */

/** World units a second. Slower than `FARMHAND_SPEED` (20) on purpose -- a
 *  drone is a lingering perimeter sweep the player glances at, not an
 *  errand somebody is waiting on. */
export const DRONE_SPEED = 12;

/** Charge spent making one hop between adjacent perimeter tiles. */
export const DRONE_FLIGHT_COST_PER_TILE = 4;

/** Full battery. At `DRONE_FLIGHT_COST_PER_TILE` per hop this is 25 hops --
 *  most of one full lap of a district-sized ring -- before a recharge stop
 *  is forced, so the loop reads as "mostly patrolling, occasionally
 *  parked" rather than spending equal time on each. */
export const DRONE_MAX_CHARGE = 100;

/** How long the magnetic-vacuum animation plays once a drone reaches a
 *  collectible's tile, in milliseconds. Long enough to read as a pull,
 *  short enough that it never reads as a second, competing action timer the
 *  way `FARMHAND_WORK_MS` is for a person. */
export const DRONE_VACUUM_MS = 450;

/** How long a drained drone sits parked before its battery is full again. */
export const DRONE_RECHARGE_MS = 8_000;

/**
 * How long one drone must wait between paid forage claims. The server owns
 * this -- `collectDroneForage` re-checks it inside its own locked
 * transaction, and that check is the authority -- but it lives here, beside
 * the rest of the flight tuning, because the SCENE has to honour it too.
 *
 * A drone whose next drop spawns sooner than this flies to gold that cannot
 * pay: the claim it fires on arrival is refused, the animation lies to the
 * player, and the farm takes a 409 (plus a reserve/release pair against the
 * day's allowance) for nothing. Holding the next drop for a full cooldown
 * before rolling it -- see `stepDrones` -- is what keeps the picture and the
 * payout the same event.
 */
export const DRONE_FORAGE_COOLDOWN_SECONDS = 20;
export const DRONE_FORAGE_COOLDOWN_MS = DRONE_FORAGE_COOLDOWN_SECONDS * 1000;

/** Flat Gold cost to deploy one drone. Debited before the drone entity
 *  exists -- see `deployStackAcresDrone` in the service file for the
 *  debit-then-create pairing this funds.
 *
 *  Priced as a late-game permanent buy, not a consumable. The hangar sits
 *  behind every one of the farm's milestones (lib/stackacres/shop-locks.ts)
 *  and every drone is a standing Gold faucet (one forage claim of 15 to 60
 *  Gold every 20 to 30 seconds the farm is open, capped only by the shared
 *  daily ceiling), so a drone should take hours of patrolling to pay itself
 *  off. The 2,500 it launched at earned itself back in about half an hour. */
export const DRONE_DEPLOY_COST_GOLD = 25_000;

/* ------------------------------------------------------------------ */
/* Drop spacing                                                        */
/* ------------------------------------------------------------------ */

/**
 * Minimum and maximum gap, in ring tiles, between where a drone currently
 * stands and its next spawned collectible.
 *
 * This is the perimeter's own analogue of Poisson-disc sampling rather than
 * the textbook 2D version: a collectible is not free to land anywhere on
 * the map, it is constrained to the same one-tile-wide ring the drone
 * walks, so "minimum distance between samples" collapses from a 2D disc
 * radius to a 1D gap along that ring. `rollDropOffsetTiles` is the
 * minimum-distance draw; `tileAtRingOffset` is what turns a drawn gap into
 * an actual tile, by walking `calculatePerimeterWaypoint` that many times
 * from wherever the drone is now.
 */
export const DRONE_DROP_MIN_GAP_TILES = 4;
export const DRONE_DROP_MAX_GAP_TILES = 10;

/** One minimum-spaced draw: a gap in `[DRONE_DROP_MIN_GAP_TILES,
 *  DRONE_DROP_MAX_GAP_TILES]`, inclusive. `random` defaults to `Math.random`
 *  but takes an injectable source so a test can pin the roll without
 *  mocking a global. */
export function rollDropOffsetTiles(random: () => number = Math.random): number {
  const span = DRONE_DROP_MAX_GAP_TILES - DRONE_DROP_MIN_GAP_TILES;
  return DRONE_DROP_MIN_GAP_TILES + Math.floor(random() * (span + 1));
}

/** Walks `calculatePerimeterWaypoint` `offsetTiles` times from `from`,
 *  returning the tile that many ring-steps ahead. `offsetTiles` of 0 returns
 *  `from` itself (clamped onto the ring, same as every other function
 *  here). */
export function tileAtRingOffset(from: TileCoord, offsetTiles: number, gridBounds: GridBounds): TileCoord {
  let tile = from;
  for (let i = 0; i < offsetTiles; i++) {
    tile = calculatePerimeterWaypoint(tile, gridBounds);
  }
  return tile;
}

/* ------------------------------------------------------------------ */
/* The drone itself                                                    */
/* ------------------------------------------------------------------ */

export interface Drone extends Walker {
  readonly id: string;
  readonly state: DroneState;
  /** The tile currently being walked toward (`PATROLLING`), or the tile the
   *  drone is parked/working at otherwise. */
  readonly waypoint: TileCoord;
  /** [0, DRONE_MAX_CHARGE]. Depleted by flight, restored by a full
   *  `RECHARGING` cycle. */
  readonly charge: number;
  /** Counts down while `VACUUMING`; zero in every other state. */
  readonly vacuumMs: number;
  /** Counts down while `RECHARGING`; zero in every other state. */
  readonly rechargeMs: number;
  /** The collectible tile currently being vacuumed, or null. Set the frame
   *  a patrol arrives at a collectible and cleared once the vacuum
   *  finishes. */
  readonly targetCollectible: TileCoord | null;
}

/** A freshly built, but still `LOCKED`, drone -- what a hangar without an
 *  unlocked blueprint has: a shape to hold, nothing that runs. */
export function lockedDrone(id: string, tile: TileCoord): Drone {
  return {
    id,
    state: DroneState.Locked,
    waypoint: tile,
    charge: 0,
    vacuumMs: 0,
    rechargeMs: 0,
    targetCollectible: null,
    x: tileCentre(tile).x,
    y: tileCentre(tile).y,
    facing: 1,
    towards: 1,
    travelled: 0,
  };
}

/**
 * A newly deployed, unlocked drone, parked at the perimeter tile nearest
 * `hangarTile` and ready to start its first lap on the next `stepDrone`
 * call. Only ever call this once the server has confirmed both halves of
 * Requirement 1 and 2 -- the hangar blueprint is unlocked and the deploy fee
 * has actually been debited (see `deployStackAcresDrone`).
 */
export function spawnDrone(id: string, hangarTile: TileCoord, gridBounds: GridBounds): Drone {
  const spawnTile = nearestPerimeterTile(hangarTile, gridBounds);
  const centre = tileCentre(spawnTile);
  return {
    id,
    state: DroneState.Idle,
    waypoint: spawnTile,
    charge: DRONE_MAX_CHARGE,
    vacuumMs: 0,
    rechargeMs: 0,
    targetCollectible: null,
    x: centre.x,
    y: centre.y,
    facing: 1,
    towards: 1,
    travelled: 0,
  };
}

export interface DroneStep {
  readonly drone: Drone;
  /** True on the exact frame a patrol arrives at `collectibleAt` -- the
   *  frame a caller should fire the (local-optimistic) forage-collect
   *  request. False every other frame, including every frame of the vacuum
   *  animation that follows -- this fires once per pickup, not once per
   *  frame it is playing. */
  readonly arrivedAtCollectible: boolean;
}

/** `advanceTowards`'s stride is fixed to `FARMHAND_SPEED`, so a drone
 *  (its own, slower `DRONE_SPEED`) rides the same walk math by folding the
 *  ratio between the two into the multiplier it already accepts, rather
 *  than forking a second copy of `advanceTowards` for one different
 *  constant. */
const DRONE_SPEED_RATIO = DRONE_SPEED / FARMHAND_SPEED;

function advance(drone: Drone, dt: number, target: WorldPoint, speedMultiplier: number): WalkStep<Drone> {
  return advanceTowards(drone, target, dt, speedMultiplier * DRONE_SPEED_RATIO);
}

/**
 * One frame of a drone's flight.
 *
 * `collectibleAt` is the tile (if any) a spawned pickup currently sits on --
 * re-read every frame by the caller, the same contract `stepFarmhand`'s
 * `next` task has, since a pickup can appear or be claimed by the time a
 * patrol reaches it. Pure: returns a new `Drone`, never mutates its input,
 * and clamps its own frame delta internally via `frameSeconds` exactly like
 * `stepFarmhand` does.
 *
 * `speedMultiplier` is passed straight through to `advanceTowards`, same
 * seam `stepFarmhand` exposes for the Frenzy/Synergy speed stack -- this
 * function has no opinion about where it came from.
 */
export function stepDrone(
  drone: Drone,
  dtMs: number,
  collectibleAt: TileCoord | null,
  gridBounds: GridBounds,
  speedMultiplier = 1,
): DroneStep {
  const dt = frameSeconds(dtMs);

  // Requirement 1's runtime half: a locked drone's update loop does not
  // execute. Whatever state it was built with, it never leaves LOCKED here.
  if (drone.state === DroneState.Locked) {
    return { drone, arrivedAtCollectible: false };
  }

  if (drone.state === DroneState.Idle) {
    const target = calculatePerimeterWaypoint(drone.waypoint, gridBounds);
    const patrolling: Drone = { ...drone, state: DroneState.Patrolling, waypoint: target };
    // Move on the same frame it starts patrolling, same reasoning as
    // `stepFarmhand`'s "claimed" branch: a state transition on a frame with
    // a long delta should not lose that frame's motion.
    return stepDrone(patrolling, dtMs, collectibleAt, gridBounds, speedMultiplier);
  }

  if (drone.state === DroneState.Patrolling) {
    const moved = advance(drone, dt, tileCentre(drone.waypoint), speedMultiplier);
    if (!moved.arrived) return { drone: moved.walker, arrivedAtCollectible: false };

    const here = moved.walker;
    if (collectibleAt && sameTile(here.waypoint, collectibleAt)) {
      return {
        drone: {
          ...here,
          state: DroneState.Vacuuming,
          vacuumMs: DRONE_VACUUM_MS,
          targetCollectible: collectibleAt,
        },
        arrivedAtCollectible: true,
      };
    }

    const spentCharge = Math.max(0, here.charge - DRONE_FLIGHT_COST_PER_TILE);
    if (spentCharge <= 0) {
      return {
        drone: { ...here, state: DroneState.Recharging, charge: 0, rechargeMs: DRONE_RECHARGE_MS },
        arrivedAtCollectible: false,
      };
    }
    const next = calculatePerimeterWaypoint(here.waypoint, gridBounds);
    return { drone: { ...here, waypoint: next, charge: spentCharge }, arrivedAtCollectible: false };
  }

  if (drone.state === DroneState.Vacuuming) {
    const vacuumMs = drone.vacuumMs - dt * 1000;
    if (vacuumMs > 0) return { drone: { ...drone, vacuumMs }, arrivedAtCollectible: false };
    const next = calculatePerimeterWaypoint(drone.waypoint, gridBounds);
    return {
      drone: { ...drone, state: DroneState.Patrolling, vacuumMs: 0, targetCollectible: null, waypoint: next },
      arrivedAtCollectible: false,
    };
  }

  // DroneState.Recharging
  const rechargeMs = drone.rechargeMs - dt * 1000;
  if (rechargeMs > 0) return { drone: { ...drone, rechargeMs }, arrivedAtCollectible: false };
  return {
    drone: { ...drone, state: DroneState.Patrolling, rechargeMs: 0, charge: DRONE_MAX_CHARGE },
    arrivedAtCollectible: false,
  };
}

/* ------------------------------------------------------------------ */
/* Floating hover                                                       */
/* ------------------------------------------------------------------ */

/**
 * A closed-form vertical hover offset for a drone's sprite, in world units.
 * Time-parameterized rather than integrated (no stored velocity, nothing to
 * leak) -- the same shape as the pond duck's orbit and the livestock
 * breathing sway in stackacres-scene.ts's `animatePond`/idle-sway code:
 * `Math.sin` of the running clock, read fresh every frame and thrown away.
 *
 * `phaseSeed` (any per-drone constant, e.g. a hash of `drone.id`) offsets
 * the wave so two drones hovering near each other don't bob in lockstep --
 * same reason the lily pads carry `i * 1.3` in their own sine term.
 */
export function droneHoverOffset(timeMs: number, phaseSeed: number): number {
  return Math.sin(timeMs / 260 + phaseSeed) * 1.6;
}
