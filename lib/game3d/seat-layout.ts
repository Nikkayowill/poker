/**
 * 6-max spatial layout for the 3D room.
 *
 * Pure math with no three.js import, so `npm test` reaches it. All
 * coordinates are world units: the floor is y = 0, +Y is up, and the local
 * player's seat (slot 0) sits on the +Z side, nearest the camera. Slots
 * proceed counter-clockwise seen from above, which reads left-to-right from
 * the camera the same way `orderedSeats` reads in the DOM table.
 *
 * This module is the one layout authority for the 3D layer — the seat ring,
 * bet spots, pot and board positions all come from here, so a table resize
 * is one edit, not five.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const SEAT_COUNT_3D = 6;

export const FLOOR_Y = 0;
/** Top surface of the felt; chips and cards rest here. */
export const FELT_TOP_Y = 0.86;

export const FELT_RADIUS_X = 2.15;
export const FELT_RADIUS_Z = 1.32;

/** Avatars stand on this larger ellipse, just outside the rail. */
export const SEAT_RING_RADIUS_X = 2.62;
export const SEAT_RING_RADIUS_Z = 1.78;

/**
 * How far a seat's bet spot sits from centre, as a fraction of the felt
 * radii. Far enough out to read as "in front of the bettor", far enough in
 * to be unambiguously on the cloth.
 */
export const BET_SPOT_INSET = 0.58;

/**
 * The pot rests behind the community cards (negative Z is away from the
 * camera), never in front of them — the near half of the felt belongs to the
 * local player's cards. Same invariant the 2D room documents on
 * POT_DEPTH_FRACTION.
 */
export const POT_POSITION: Vec3 = { x: 0, y: FELT_TOP_Y, z: -0.52 };

/** Centre of the community-card row. */
export const BOARD_POSITION: Vec3 = { x: 0, y: FELT_TOP_Y, z: 0.08 };

/** Angle for a seat slot; slot 0 is at +Z (nearest the camera). */
export function seatAngle(slot: number): number {
  return (slot / SEAT_COUNT_3D) * Math.PI * 2;
}

/** Where the avatar for a slot stands (on the floor, outside the rail). */
export function seatPosition(slot: number): Vec3 {
  const angle = seatAngle(slot);
  return {
    x: Math.sin(angle) * SEAT_RING_RADIUS_X,
    y: FLOOR_Y,
    z: Math.cos(angle) * SEAT_RING_RADIUS_Z,
  };
}

/**
 * Slot 0's bet spot sits deeper toward the board than everyone else's: its
 * hole cards take the near corridor (see holeCardPosition), and chips on
 * the ordinary inset would land on top of them.
 */
export const NEAR_SEAT_BET_INSET = 0.4;

/** Where a slot's committed street bet rests, on the felt. */
export function betSpotPosition(slot: number): Vec3 {
  const inset = slot === 0 ? NEAR_SEAT_BET_INSET : BET_SPOT_INSET;
  const angle = seatAngle(slot);
  return {
    x: Math.sin(angle) * FELT_RADIUS_X * inset,
    y: FELT_TOP_Y,
    z: Math.cos(angle) * FELT_RADIUS_Z * inset,
  };
}

/**
 * Where a slot's hole cards lie, on the felt just inside the rail.
 *
 * Slot 0 gets its own, deeper inset: the local player's avatar stands
 * between the camera and their edge of the felt, so cards at the ordinary
 * inset are hidden behind their own figure — the same near-seat occlusion
 * the 2D room's NEAR_SEAT_BET_INSET exists for. Measured on a render, not
 * assumed.
 */
const HOLE_CARD_INSET = 0.82;
const NEAR_SEAT_HOLE_CARD_INSET = 0.6;

export function holeCardPosition(slot: number): Vec3 {
  const inset = slot === 0 ? NEAR_SEAT_HOLE_CARD_INSET : HOLE_CARD_INSET;
  const angle = seatAngle(slot);
  return {
    x: Math.sin(angle) * FELT_RADIUS_X * inset,
    y: FELT_TOP_Y,
    z: Math.cos(angle) * FELT_RADIUS_Z * inset,
  };
}

/**
 * Y rotation that turns a model whose forward axis is +Z to face the table
 * centre from `position`.
 */
export function faceCentreRotationY(position: Vec3): number {
  return Math.atan2(-position.x, -position.z);
}
