/**
 * The four places a chip can be, on whichever table is being drawn.
 *
 * `ChipScene` (lib/scene/chips/chip-scene.ts) animates chips between a pot, a
 * bet spot, a tray and a payout landing. It has never cared what shape the
 * table is: it asks for those four points and moves chips along them, but the
 * chip system it replaced used to reach for them directly, through module
 * imports from `seat-ring.ts`, which quietly made the classic room's ellipse
 * the only table it could ever animate on.
 *
 * Naming that dependency is the whole of this file. The animation, stagger,
 * spring, pile layout, sweep and funnel are one implementation serving both
 * rooms; only these four anchors and the height of the cloth differ.
 *
 * Every space speaks the classic room's world units, including the
 * racetrack's, and that is the load-bearing decision here.
 *
 * The racetrack's geometry (`table-anchors.ts`) is in real metres, and the
 * obvious move is to hand the layer metres and scale its constants to suit.
 * That move is a trap, worth writing down so nobody spends an afternoon
 * rediscovering it. The layer's motion is tuned in world units in a dozen
 * places that have nothing to do with each other: the arc peak of a thrown
 * chip, the height a pile chip drops from, a standing bet's shorter drop, the
 * spring's rest distance and rest speed, the settle epsilon, the mid-flight
 * swell per unit of lift, the splash scatter offsets. Every one of those is
 * a distance. Converting the space to metres means finding and scaling all
 * of them, and the cost of missing one is not a crash, it is a chip that
 * never settles, or one that snaps to its target instantly, in a room
 * nobody was looking at when they changed something else.
 *
 * So the conversion happens exactly once, at the projection (see
 * `scaledProjection`), and the layer's units never change. What a space
 * declares is where its anchors are in those units, plus the one scalar that
 * says how big a unit is in its own room.
 */

import { CHIP_RADIUS, FELT, type Vec3 } from "./scene-config";
import {
  NEAR_SEAT_BET_INSET,
  potPosition,
  ringPoint,
  seatBetOrigin,
  seatTrayOrigin,
} from "./seat-ring";
import {
  CHIP_RADIUS_M,
  chipAnchor,
  payoutAnchor,
  potAnchor,
  seatTrayAnchor,
} from "./table-anchors";

export interface ChipSpace {
  /** The height of the cloth in world units: what a resting chip sits on. */
  readonly feltY: number;
  /**
   * How many of this room's own length units one world unit is worth.
   *
   * 1 for the classic room, whose units are already the layer's. For the
   * racetrack it is metres per world unit, and the projection multiplies by
   * it on the way to pixels. Solved rather than picked; see
   * `METRES_PER_WORLD_UNIT`.
   */
  readonly roomUnitsPerWorldUnit: number;
  /** The one point in the middle every chip in the room agrees on. */
  pot(): Vec3;
  /** Where a seat's bet comes to rest on the cloth. */
  betSpot(slot: number, count: number): Vec3;
  /** Where a seat's chips wait before it bets: the tray on the rail. */
  tray(slot: number, count: number): Vec3;
  /** Where a winner's share of the pot lands. */
  payout(slot: number, count: number): Vec3;
}

/**
 * The classic room's ellipse.
 *
 * Takes the two things that make it per-fit rather than constant: the felt's
 * solved plan depth (see `SceneView.radiusZ`, a portrait phone's table is a
 * different shape from a desktop's) and the near seat's bet inset, which
 * switches at the breakpoint where the local player's own figure stops being
 * drawn. Both used to live on the old chip system as mutable fields threaded
 * into every anchor call; here they are captured once and `ChipScene`
 * rebuilds its space when either changes.
 */
export function classicChipSpace(
  radiusZ: number = FELT.radiusZ,
  nearSeatInset: number = NEAR_SEAT_BET_INSET,
): ChipSpace {
  return {
    feltY: FELT.y,
    roomUnitsPerWorldUnit: 1,
    pot: () => potPosition(radiusZ),
    betSpot: (slot, count) => seatBetOrigin(slot, count, radiusZ, nearSeatInset),
    tray: (slot, count) => seatTrayOrigin(slot, count, radiusZ),
    // 0.92 of the seat ring: just inside the player, so a payout reads as
    // chips pushed to them rather than as a second pot forming.
    payout: (slot, count) => ringPoint(slot, count, 0.92, FELT.y, radiusZ),
  };
}

/**
 * Metres per world unit, on the racetrack table.
 *
 * Solved from the chip, not from the table, and the choice of which end to
 * pin matters. Pinning the table (making its felt 9 units wide, as the
 * classic room's is) would leave the chip's own 0.14-unit radius meaning
 * some arbitrary fraction of a real chip, and every motion constant tuned
 * against chip-sized distances would land at the wrong scale. Pinning the
 * chip instead makes one world unit a fixed physical length, so `CHIP_RADIUS`
 * is a real 39mm chip and every distance tuned in chip-radius terms stays
 * true. The table then comes out at whatever number of units it is, which is
 * a thing nothing depends on.
 */
export const METRES_PER_WORLD_UNIT = CHIP_RADIUS_M / CHIP_RADIUS;

/** Metres, as this layer's world units. */
function fromMetres(point: Vec3): Vec3 {
  return {
    x: point.x / METRES_PER_WORLD_UNIT,
    y: point.y / METRES_PER_WORLD_UNIT,
    z: point.z / METRES_PER_WORLD_UNIT,
  };
}

/**
 * The racetrack room.
 *
 * No per-fit parameters, and that is the substantive difference between the
 * two spaces: the classic room solves its table's plan shape against whatever
 * box the CSS left it, so its anchors move with the breakpoint. The
 * racetrack's table is a real object of a fixed size and the camera is what
 * adapts (see `fitCamera`), so these anchors are the same metres, and
 * therefore the same world units, at every viewport.
 */
export function racetrackChipSpace(): ChipSpace {
  return {
    feltY: fromMetres(potAnchor()).y,
    roomUnitsPerWorldUnit: METRES_PER_WORLD_UNIT,
    pot: () => fromMetres(potAnchor()),
    betSpot: (slot, count) => fromMetres(chipAnchor(slot, count)),
    tray: (slot, count) => fromMetres(seatTrayAnchor(slot, count)),
    payout: (slot, count) => fromMetres(payoutAnchor(slot, count)),
  };
}
