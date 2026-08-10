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

/**
 * The playing surface of a six-max oval, both axes, in metres.
 *
 * These live here rather than in dimensions.ts — which is the room's metre
 * ruler and is the more natural home — only because dimensions.ts imports
 * FELT_RADIUS_X from this file to BUILD that ruler, so stating them there
 * would be a cycle. It re-exports `TABLE_LENGTH_M` from here so there is
 * still exactly one 2.13 in the codebase, and dimensions.test.ts pins that
 * the felt's rendered width really is TABLE_WIDTH_M under that ruler.
 */
export const TABLE_LENGTH_M = 2.13;
export const TABLE_WIDTH_M = 1.07;

export const FELT_RADIUS_X = 2.15;

/**
 * Depth is DERIVED from the table's real plan proportions, not typed.
 *
 * It was 1.32, which against a 2.15 half-length is a 1.63:1 oval. A real
 * six-max table is 2.13 m x 1.07 m — very close to 2:1 — so the felt was
 * markedly rounder than the object it claims to be, and dimensions.ts was
 * anchoring the entire room's metre ruler to the one axis that happened to
 * be right.
 *
 * Fixing it is not only an accuracy point, and that is worth spelling out.
 * The camera fit is bound by DEPTH at every landscape aspect — the felt's
 * far edge plus the far player's headroom is what sets the distance, and
 * width has slack to spare on anything wider than about 16:9. A rounder
 * table is therefore a table that pushes its own camera back and then
 * cannot use the width it freed. Measured, giving the table its true shape
 * moves the felt from 46% to 53% of an ultrawide frame and from 50% to 57%
 * on a landscape phone, purely by letting the camera come in.
 */
export const FELT_RADIUS_Z = FELT_RADIUS_X * (TABLE_WIDTH_M / TABLE_LENGTH_M);

/**
 * How far behind the rail a player sits — one number, applied to both axes.
 *
 * The seat ring used to be two independent radii (2.62 and 1.78) whose
 * margins over the felt were 0.47 and 0.46: equal by coincidence rather
 * than by construction, and silently un-linked from the felt they are
 * supposed to sit outside of. Stated once, a player is the same distance
 * back from the cloth wherever they are sitting, and a change to the
 * table's shape moves the chairs with it.
 */
export const SEAT_SETBACK = 0.47;

/** Avatars stand on this larger ellipse, just outside the rail. */
export const SEAT_RING_RADIUS_X = FELT_RADIUS_X + SEAT_SETBACK;
export const SEAT_RING_RADIUS_Z = FELT_RADIUS_Z + SEAT_SETBACK;

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
export const POT_DEPTH_FRACTION = 0.39;
export const POT_POSITION: Vec3 = {
  x: 0,
  y: FELT_TOP_Y,
  z: -POT_DEPTH_FRACTION * FELT_RADIUS_Z,
};

/**
 * Centre of the community-card row — just past the middle, toward the far
 * side, so the near half of the cloth stays the local player's.
 *
 * Both of these are fractions of the felt's depth now rather than the
 * literals -0.52 and 0.08. Those were measured against a 1.32 plate, so a
 * change to the table's shape used to leave the pot and the board sitting
 * at absolute distances that meant something different — the pot drifting
 * proportionally further back on a shallower felt, which is exactly where
 * it stops being on the cloth at all. The fractions reproduce the tuned
 * positions on the old plate to within a millimetre.
 */
export const BOARD_DEPTH_FRACTION = 0.06;
export const BOARD_POSITION: Vec3 = {
  x: 0,
  y: FELT_TOP_Y,
  z: BOARD_DEPTH_FRACTION * FELT_RADIUS_Z,
};

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
 * Chips leave a bettor's hands, not their chair: just inside their place at
 * the rail, at hand height above the floor.
 *
 * Stated here rather than in whichever component happens to launch a push,
 * because two of them do — the ordinary bet diff and the mid-flight
 * handoff a renderer switch rebuilds — and a launch point that differs
 * between them makes the same bet leave from two places depending on
 * whether the player changed renderer while it was in the air.
 */
export const HAND_HEIGHT_Y = 1.05;
const HAND_INSET = 0.82;

export function handLaunchPosition(slot: number): Vec3 {
  const seat = seatPosition(slot);
  return { x: seat.x * HAND_INSET, y: HAND_HEIGHT_Y, z: seat.z * HAND_INSET };
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
/*
 * Pulled in from 0.82 when the felt took its true 2.13 x 1.07 proportions,
 * and the reason is an ordering rule rather than a look: from the rail
 * inward a real table reads bankroll, cards, bet, board, and the bankroll
 * props are physical objects at a fixed real size. On the narrower plate the
 * outermost inset at which the deepest pile keeps every corner on the cloth
 * is 0.82 — the value the cards already occupied — so the two could not
 * both stay there and still be in that order. The cards are the ones with
 * room to give: they are small, and 0.78 keeps them well outside the bet
 * spot at 0.58.
 *
 * The near seat's 0.6 is untouched. It was measured on a render against the
 * local player's own figure occluding their cards, which is a fact about
 * where that figure stands, not about how deep the felt is.
 */
const HOLE_CARD_INSET = 0.78;
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
