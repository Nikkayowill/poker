/**
 * The delivery truck: StackAcres' one autonomous vehicle, driving the
 * cobbled entrance lane on a visit whenever the player has an open Town
 * Contract to hand off (see ./contracts.ts) -- the FarmVille-style pickup
 * truck ./paths.ts's own "lane" spec has been describing since before it
 * existed ("It is the road a delivery truck comes up").
 *
 * PRESENTATION, NOT AUTHORITY -- same posture ./drone.ts's own header
 * states for itself, and for the identical reason. Nothing here holds a
 * Gold balance or a contract row: whether a contract is open lives in
 * `StackAcresView.contract` (`lib/server/stackacres-service.ts`), and this
 * module never reads it directly. The caller (stackacres-farm.tsx, by way
 * of the scene) passes that fact in every frame as a plain boolean,
 * `wantPresent` -- the same shape `stepDrone`'s own `collectibleAt`
 * argument takes for a fact that lives on the server. The truck's own live
 * position, heading and route progress are exactly as ephemeral as a
 * drone's tile or a farmhand's target: lost on refresh, and that is fine,
 * because tapping the parked truck only ever opens the same Town Contracts
 * sheet the signpost already does (see stackacres-farm.tsx's
 * `onWorldTruckTap`) -- nothing here can move Gold, and nothing of value is
 * lost by forgetting where the truck was mid-drive.
 *
 * THE ROUTE RETRACES REAL PAVEMENT, BUILT FROM ./paths.ts AT MODULE LOAD --
 * not a second, hand-copied set of literals. Two files independently
 * agreeing on where the lane runs is exactly the kind of drift this
 * codebase has already been bitten by (see ./paths.ts's own header on the
 * 2026-09-07 re-lay, and ./props.ts's mailbox/signpost placements, which
 * are measured off the same paths for the same reason). Importing means a
 * future lane move carries the truck's route with it for free; see
 * `DELIVERY_ROUTE`'s own doc comment for the one point on the route that is
 * NOT one of the lane's own vertices, and why.
 *
 * Pure, and in lib/ for the usual reason: vitest only reaches lib/ and app/.
 */

import {
  FARMHAND_SPEED,
  advanceTowards,
  frameSeconds,
  type Walker,
} from "./farmhand-path";
import { FARM_PATHS } from "./paths";
import { yardPoint } from "./yard";
import type { WorldPoint } from "./world";

/* ------------------------------------------------------------------ */
/* The route                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every vertex of ./paths.ts's own "lane" spec but the first -- the wide
 * apron out of the barn door -- in reverse, so index 0 is the far end near
 * the mailbox (where the truck arrives from, off the visible map) and the
 * last is the corner the lane shares with `yardRoad` (`paths.test.ts`'s
 * "joins... at the barn's corner" holds that corner against both `yardRoad`
 * and `dockSpur` already; the truck forks off it the same way they do).
 * Throws rather than routing nothing if the spec is ever renamed out from
 * under this -- an empty route would make every function below either loop
 * forever or silently sit the truck at NaN, neither of which is a state
 * worth reaching quietly (see feedback_stackchips_no_fallbacks).
 */
function laneRouteReversed(): readonly WorldPoint[] {
  const lane = FARM_PATHS.find((p) => p.key === "lane");
  if (!lane) {
    throw new Error("delivery-truck: paths.ts has no 'lane' spec left to route the truck along");
  }
  return [...lane.points].slice(1).reverse();
}

/**
 * Where the truck drives, in order from its off-map arrival to its parking
 * spot: back up the cobbled lane (every vertex of ./paths.ts's "lane" spec
 * but the barn-door apron, see `laneRouteReversed`), then one more leg east
 * onto `yardRoad`'s own body to a dock south of the barn and silo.
 *
 * THE DOCK IS NOT ONE OF `yardRoad`'s OWN VERTICES -- it is a point measured
 * on that road's centreline, interpolated between its first two ((108,58)
 * and (200,60)), rather than parked at either. Parking exactly on a vertex
 * would sit the truck in the fork itself, in the way of the
 * lane/yardRoad/dockSpur junction paint. x 160 clears the barn (x 71..145)
 * and the silo (x 143..165, both feet at y 34) by 25 world units of open
 * road body between their south edge and the dock's own y 59, and clears
 * the monk's shrine (`MONK_HOUSE_FOOTPRINT`, y 88..134) by 29 more the
 * other way -- delivery-truck.test.ts holds both distances along the whole
 * route, not just this one endpoint, the same rigor
 * paths.test.ts's own drive-clearance test uses for Ray's house driveway.
 */
export const DELIVERY_ROUTE: readonly WorldPoint[] = [...laneRouteReversed(), yardPoint(160, 59)];

/** The last stop: where the truck sits while a contract is open. */
export const TRUCK_PARK_SPOT: WorldPoint = DELIVERY_ROUTE[DELIVERY_ROUTE.length - 1];

/* ------------------------------------------------------------------ */
/* Tuning                                                               */
/* ------------------------------------------------------------------ */

/**
 * World units a second. Faster than `FARMHAND_SPEED` (20) -- a vehicle
 * outpaces a person on foot -- and well clear of `DRONE_SPEED` (12), which
 * is deliberately a lingering sweep nobody is waiting on; the truck is the
 * one thing on this farm somebody DOES watch for, so its drive reads as
 * purposeful rather than idle. At this speed the full lane-to-dock route
 * (roughly 450 world units) takes a little over eleven seconds -- long
 * enough to actually see the cobblestone it is driving up, short enough
 * that a player who tapped the signpost to request a contract is not left
 * waiting on a commute before there is anything to fulfil.
 */
export const TRUCK_SPEED = 40;

const TRUCK_SPEED_RATIO = TRUCK_SPEED / FARMHAND_SPEED;

/** The truck's own footprint at its parking spot, in world units -- sized
 *  like a `props.ts` `PropSize` entry even though the truck is not a
 *  `PropKind` (see this module's own header on why: it is conditional,
 *  moving, driven state, the same reason a Drone or the Midnight Merchant
 *  are not `PropKind` members either). Roughly two tiles long, the size
 *  `paths.ts`'s own `yardRoad` comment already reserved room on the road
 *  for ("A truck up to about two tiles parks on it"). */
export const TRUCK_FOOTPRINT = { w: 34, h: 18 } as const;

/* ------------------------------------------------------------------ */
/* The truck itself                                                    */
/* ------------------------------------------------------------------ */

/** The three states a truck can be in, and the only three -- a real TS enum
 *  for the identical reason `DroneState` is one rather than this codebase's
 *  usual string-literal union: nothing about a truck's state crosses a JSON
 *  boundary the way a stored row's column would, it is scene-local,
 *  ephemeral state. */
export enum TruckState {
  Arriving = "ARRIVING",
  Parked = "PARKED",
  Departing = "DEPARTING",
}

export interface DeliveryTruck extends Walker {
  readonly id: string;
  readonly state: TruckState;
  /**
   * Which vertex of `DELIVERY_ROUTE` the truck is walking toward
   * (`Arriving`/`Departing`), or parked at (`Parked`, always
   * `DELIVERY_ROUTE.length - 1`). Arriving counts UP toward the last index;
   * Departing counts DOWN toward 0, where the truck vanishes rather than
   * ever reaching a negative index.
   */
  readonly routeIndex: number;
}

/**
 * A freshly spawned truck.
 *
 * `alreadyParked` is for the one case this is not an animated entrance: a
 * player who opens the farm with a contract already open should see the
 * truck simply standing at its dock, not replay an eleven-second drive on
 * every reload. The caller (stackacres-farm.tsx) is expected to pass this
 * true only the very first time it learns a contract is open after mount --
 * see its own `truckKnownRef` doc comment -- and false for every later,
 * genuinely-observed transition from no contract to one.
 */
export function spawnTruck(id: string, alreadyParked = false): DeliveryTruck {
  const at = alreadyParked ? TRUCK_PARK_SPOT : DELIVERY_ROUTE[0];
  return {
    id,
    state: alreadyParked ? TruckState.Parked : TruckState.Arriving,
    routeIndex: alreadyParked ? DELIVERY_ROUTE.length - 1 : 1,
    x: at.x,
    y: at.y,
    facing: 1,
    towards: 1,
    travelled: 0,
  };
}

function advance(truck: DeliveryTruck, dt: number, target: WorldPoint, speedMultiplier: number) {
  // Same "fold the ratio into advanceTowards's own multiplier" seam
  // ./drone.ts's own `advance` uses rather than forking a second copy of
  // the walk math for one different constant.
  return advanceTowards(truck, target, dt, speedMultiplier * TRUCK_SPEED_RATIO);
}

/**
 * One frame of the truck's drive, or its stay at the dock.
 *
 * `wantPresent` is consulted ONLY while `Parked` -- a truck already mid-drive
 * finishes the leg it is on rather than reversing between two vertices of
 * its own route. A contract that opens and clears again before an
 * eleven-second arrival finishes still plays out as a full arrival followed
 * immediately by a full departure, never a random U-turn on the tarmac; that
 * is a deliberate simplification (an actual mid-route reversal would need
 * its own arrival ramp back to speed, its own turn, and would read as a
 * glitch far more often than the rare early-clear it would save), not an
 * oversight. Pure -- returns a new `DeliveryTruck`, or `null` once a
 * `Departing` truck reaches `DELIVERY_ROUTE[0]` and drives off the map
 * entirely; the caller (stackacres-scene.ts) is what turns that `null` into
 * actually destroying the truck's sprite.
 */
export function stepTruck(
  truck: DeliveryTruck,
  dtMs: number,
  wantPresent: boolean,
  speedMultiplier = 1,
): DeliveryTruck | null {
  const dt = frameSeconds(dtMs);

  if (truck.state === TruckState.Parked) {
    if (wantPresent) return truck;
    // The order was handed off (or the contract otherwise cleared) -- head
    // back out the way it came in. Steps immediately rather than waiting a
    // frame, the same "do not lose this frame's motion to a state
    // transition" reasoning `stepDrone`'s own Idle->Patrolling branch uses.
    const departing: DeliveryTruck = {
      ...truck,
      state: TruckState.Departing,
      routeIndex: truck.routeIndex - 1,
    };
    return stepTruck(departing, dtMs, wantPresent, speedMultiplier);
  }

  const arriving = truck.state === TruckState.Arriving;
  const target = DELIVERY_ROUTE[truck.routeIndex];
  const moved = advance(truck, dt, target, speedMultiplier);

  if (!moved.arrived) {
    return { ...moved.walker, state: truck.state, routeIndex: truck.routeIndex };
  }

  if (arriving) {
    if (truck.routeIndex === DELIVERY_ROUTE.length - 1) {
      return { ...moved.walker, state: TruckState.Parked, routeIndex: truck.routeIndex };
    }
    return { ...moved.walker, state: TruckState.Arriving, routeIndex: truck.routeIndex + 1 };
  }

  // Departing.
  if (truck.routeIndex === 0) return null;
  return { ...moved.walker, state: TruckState.Departing, routeIndex: truck.routeIndex - 1 };
}

/**
 * Whether a tapped ground point lands on the parked truck.
 *
 * Evaluated at the fixed `TRUCK_PARK_SPOT` rather than the live truck's own
 * `x`/`y` -- deliberately: the caller (stackacres-scene.ts's tap chain)
 * only ever consults this while `truck.state === TruckState.Parked`, the
 * one state in which the truck's position and `TRUCK_PARK_SPOT` are the
 * same point. A truck mid-drive is never a valid tap target in the first
 * place, so there is nothing to gain from tracking its live position here
 * too -- the same "fixed box, only checked while present" shape
 * `rayHouseHitAt`/`barnHitAt` (./world.ts) use for a structure that never
 * moves at all.
 */
export function truckHitAt(x: number, y: number): boolean {
  const { x: px, y: py } = TRUCK_PARK_SPOT;
  return (
    x >= px - TRUCK_FOOTPRINT.w / 2 &&
    x <= px + TRUCK_FOOTPRINT.w / 2 &&
    y >= py - TRUCK_FOOTPRINT.h &&
    y <= py
  );
}
