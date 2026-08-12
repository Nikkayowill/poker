/**
 * WHERE A SEATED PLAYER'S HANDS BELONG — the spatial half of making the
 * roster's arms read as alive rather than parked.
 *
 * THE MEASUREMENT THIS MODULE EXISTS BECAUSE OF. Before it, the only thing
 * touching an avatar's arms at runtime was `arm-ik.ts`'s felt clamp, which
 * is purely negative: it stops a wrist sinking through the cloth and has
 * nothing to say about where the wrist should be. So every hand sat wherever
 * the baked clip left it — mid-air, a hand's width short of the rail, fingers
 * closed on nothing. Rendered on the real GPU at 1440x900 and measured off
 * the live bones, the shoulder-to-hole-card distance ran 0.50-0.92 world
 * units against a fully-extended arm of 0.54-0.60: every seat but the far one
 * (which alone skips NEAR_SEAT_EXTRA_SETBACK) was between 0.12 and 0.38 units
 * SHORT of its own cards. That is not something inverse kinematics can fix —
 * a solver asked for an unreachable target returns its best miss — so this
 * module answers three questions instead of one:
 *
 *   1. where the wrist should go (`handAnchor`), stated as a point a hand's
 *      length BACK from the cards rather than on them, because the thing that
 *      has to arrive at the cards is the fingertips, and spending the palm's
 *      own length on the approach buys back ~0.14 units of the deficit above;
 *   2. what to do when it still cannot get there (`reachableTarget`), which
 *      is to stop short along the same line rather than flail at it — a hand
 *      reaching toward its cards and not quite arriving still reads as aware
 *      of them, which is the entire complaint being answered;
 *   3. nothing else — and specifically NOT a torso lean, which is the obvious
 *      third lever and was built, measured and removed. See the note in
 *      `components/game3d/avatars/arm-rig.ts` before adding one back.
 *
 * Pure, no three.js, so `npm test` reaches all of it — same convention as
 * `arm-ik.ts` and `camera-framing.ts`. The caller (glb-avatar.tsx) does the
 * bone reading and quaternion work.
 */

import { CARD, mm } from "./dimensions";
import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  holeCardPosition,
  seatAngle,
  seatPosition,
  type Vec3,
} from "./seat-layout";
import { add, clamp, cross, dist, len, norm, scale, sub, vec } from "./vec3-math";

/**
 * Which job a hand is doing. A poker player does not put both hands in the
 * same place: one covers the cards, the other rests at the table edge near
 * their chips. Modelling that as two roles rather than one shared target is
 * what keeps the two arms from being solved into each other — the same
 * failure the offline bake records under WRIST_CENTRELINE_PULL.
 */
export type HandRole = "cards" | "rail";

export interface HandAnchor {
  /** World point the wrist should reach. */
  wrist: Vec3;
  /** World point the fingers should point at, from the wrist. */
  aim: Vec3;
}

/**
 * How far above the felt a resting wrist floats. Not zero and not the same
 * as `arm-ik.ts`'s WRIST_CLEARANCE, which is a penetration guard: this is
 * the real anatomical offset between the wrist joint a rig animates and the
 * heel of the hand that actually touches the cloth, so a wrist driven to
 * exactly felt height buries the palm in it.
 */
export const WRIST_REST_HEIGHT = mm(34);

/**
 * How far BACK from the cards the wrist sits, along the player's own line
 * of approach — half a card (so the fingertips clear the near edge) plus a
 * palm. Stated in millimetres off the real card because the whole point is
 * that the fingertips, not the wrist, are what has to arrive at the cards.
 */
export const CARD_HAND_SETBACK = CARD.height / 2 + mm(92);

/**
 * How much of that setback is given up when the player is the one to act.
 *
 * This is the "aware of the cards" beat: at their turn the hand settles
 * forward onto the card backs the way a player covers a live hand, and
 * relaxes back off them when the action passes. Small — a couple of
 * centimetres — because the read comes from the movement happening at all,
 * not from its size.
 */
export const CARD_HAND_SNUG = mm(26);

/** Lateral offset of the card hand from the seat's own centre line. */
export const CARD_HAND_LATERAL = mm(18);

/**
 * The off hand rests at the table edge, out toward that side's chips.
 * `RAIL_HAND_INSET` is a fraction of the felt radii, like every other spot
 * in `seat-layout.ts`; just inside 1.0 keeps the hand on cloth rather than
 * on the rail's own crown, where it would need the rail's height instead.
 */
export const RAIL_HAND_INSET = 0.94;
export const RAIL_HAND_LATERAL = mm(165);
/** Pulled back from the edge by a palm, for the same reason as the card hand. */
export const RAIL_HAND_SETBACK = mm(76);

/**
 * The seat's own frame: `forward` runs from the player toward their cards,
 * `right` is that player's right hand side. Both flat in the XZ plane.
 *
 * `forward` is taken from the seat-to-CARD line rather than the seat-to-
 * centre line the avatar's yaw uses, and the difference is not rounding: the
 * felt is a 2:1 ellipse, so the radial direction at a side seat and the
 * direction to that seat's own card spot genuinely diverge. The hands are
 * being aimed at the cards, so the cards are what defines forward.
 */
export function seatFrame(slot: number): { forward: Vec3; right: Vec3 } {
  const seat = seatPosition(slot);
  const card = holeCardPosition(slot);
  const forward = norm(vec(card.x - seat.x, 0, card.z - seat.z), vec(0, 0, -1));
  // right = forward x up, which for a model facing +Z resolves to -X — the
  // handedness three.js gives a Y-up right-handed world. Derived rather than
  // written out so a change to the room's up axis cannot leave it silently
  // mirrored.
  const right = norm(cross(forward, vec(0, 1, 0)), vec(1, 0, 0));
  return { forward, right };
}

/**
 * Where one hand wants to be.
 *
 * `lateralSign` is +1 for the hand on the seat's own right and -1 for its
 * left, and it is passed in rather than derived from a bone name on purpose:
 * this roster's rigs do not agree about which local axis is which (the
 * offline bake documents the same thing under `_facing_sign`), so the caller
 * measures which chain is physically on which side and tells us.
 *
 * `snug` is 0 for a hand at rest and 1 for a player covering a live hand at
 * their own turn; it only moves the card hand.
 */
export function handAnchor(
  slot: number,
  role: HandRole,
  lateralSign: number,
  snug = 0
): HandAnchor {
  const { forward, right } = seatFrame(slot);
  const sign = lateralSign >= 0 ? 1 : -1;

  if (role === "cards") {
    const card = holeCardPosition(slot);
    const setback = CARD_HAND_SETBACK - CARD_HAND_SNUG * clamp(snug, 0, 1);
    const wrist = add(
      add(card, scale(forward, -setback)),
      scale(right, sign * CARD_HAND_LATERAL)
    );
    return {
      wrist: vec(wrist.x, FELT_TOP_Y + WRIST_REST_HEIGHT, wrist.z),
      aim: vec(card.x, FELT_TOP_Y, card.z),
    };
  }

  const angle = seatAngle(slot);
  const edge = vec(
    Math.sin(angle) * FELT_RADIUS_X * RAIL_HAND_INSET,
    FELT_TOP_Y,
    Math.cos(angle) * FELT_RADIUS_Z * RAIL_HAND_INSET
  );
  const wrist = add(
    add(edge, scale(forward, -RAIL_HAND_SETBACK)),
    scale(right, sign * RAIL_HAND_LATERAL)
  );
  return {
    wrist: vec(wrist.x, FELT_TOP_Y + WRIST_REST_HEIGHT, wrist.z),
    // The off hand still points into the table rather than off the side of
    // it — a hand resting at the edge with its fingers aimed at the rail
    // reads as a person facing away from the game.
    aim: add(vec(wrist.x, FELT_TOP_Y, wrist.z), scale(forward, mm(180))),
  };
}

export interface ReachResult {
  /** The point the arm should actually be solved to. */
  target: Vec3;
  /**
   * How far past comfortable extension the requested target was, in world
   * units. Zero when it was reachable.
   */
  deficit: number;
}

/**
 * The fraction of full extension a resting arm is allowed to use.
 *
 * Not a slack term in metres, which is what this was first written as, and
 * the difference shows on a render: an arm solved to within 2 cm of its own
 * length is straight, and a straight arm reads as *reaching* for something,
 * which is the opposite of resting. Reserving a proportion instead keeps a
 * real bend at the elbow on every character regardless of build, and it also
 * keeps the two-bone solve away from the degenerate case where a fully
 * extended chain has no defined bend plane and the elbow flips between
 * solutions on consecutive frames.
 */
export const COMFORTABLE_REACH = 0.89;

/**
 * Bring a wrist target inside what the arm can comfortably reach.
 *
 * THE HEIGHT IS PRESERVED WHERE IT CAN BE, and that is the whole design.
 * Clamping straight down the shoulder-to-target line — the obvious answer,
 * and the first one here — leaves a hand that cannot reach the cards hanging
 * in the air halfway there, because the line rises away from the table as it
 * shortens. Rendered, the near seat sat with both hands floating at chest
 * height. Shortening only the HORIZONTAL run instead keeps the wrist at
 * table height, so a player who cannot get to their cards still rests their
 * hands on the cloth in front of them and points at the cards, which is both
 * what a real short reach looks like and what "aware of where their cards
 * are" has to mean when the cards are out of reach.
 *
 * The pure sphere clamp survives as the fallback for the one case where no
 * point at that height is reachable at all — an arm shorter than its own
 * height above the table, which no character here has, but which must not
 * produce a NaN if one ever does.
 */
export function reachableTarget(shoulder: Vec3, armLength: number, target: Vec3): ReachResult {
  const maxReach = Math.max(armLength * COMFORTABLE_REACH, 0);
  const toTarget = sub(target, shoulder);
  const distance = len(toTarget);
  if (distance <= maxReach || distance < 1e-6) return { target, deficit: 0 };

  const deficit = distance - maxReach;
  const rise = target.y - shoulder.y;
  const run = Math.hypot(toTarget.x, toTarget.z);
  if (Math.abs(rise) < maxReach && run > 1e-6) {
    const allowedRun = Math.sqrt(maxReach * maxReach - rise * rise);
    const k = allowedRun / run;
    return {
      target: vec(shoulder.x + toTarget.x * k, target.y, shoulder.z + toTarget.z * k),
      deficit,
    };
  }
  return { target: add(shoulder, scale(toTarget, maxReach / distance)), deficit };
}

/**
 * Millimetre-scale wander added to a resting wrist target so a settled hand
 * is never perfectly still.
 *
 * Deterministic — two incommensurate sines per axis, phased by slot and
 * side — for the same reason `chipSettleJitter` and the 2D room's splash
 * scatter are: presentation in this codebase is allowed to look arbitrary
 * and is not allowed to be untestable. The frequencies are irrational
 * multiples of each other so the pattern does not visibly loop; the
 * amplitudes are a few millimetres, which is a living hand rather than a
 * drifting one.
 */
export const DRIFT_AMPLITUDE = mm(4.5);

export function idleDrift(slot: number, lateralSign: number, timeS: number): Vec3 {
  const phase = slot * 1.7 + (lateralSign >= 0 ? 0 : 0.9);
  return vec(
    DRIFT_AMPLITUDE * Math.sin(timeS * 0.37 + phase),
    DRIFT_AMPLITUDE * 0.45 * Math.sin(timeS * 0.53 + phase * 1.3),
    DRIFT_AMPLITUDE * Math.sin(timeS * 0.29 + phase * 2.1)
  );
}

/**
 * How strongly the procedural rest pose overrides the baked clip, 0..1.
 *
 * Zero is a real answer and the important one: fold and celebrate are
 * authored one-shots whose whole content is what the arms do, and a rest
 * pose blended over the top of them would flatten the only two gestures the
 * roster has. The same goes for a live bet/raise transient. What is left —
 * idling and thinking, i.e. nearly all of the time a table is on screen —
 * is exactly the case the clips have nothing to say about and where hands in
 * mid-air were being looked at.
 */
export function handPoseWeight(options: {
  folded: boolean;
  celebrating: boolean;
  gesturing: boolean;
}): number {
  if (options.folded || options.celebrating) return 0;
  return options.gesturing ? 0.25 : 1;
}

/**
 * True when this seat still has cards to be aware of. A seat with no live
 * hand has no reason to hold the card spot, so its "card" hand rests at the
 * table edge like the other one — which is also what stops a folded seat
 * cradling cards that are no longer there.
 */
export function roleForHand(hasCards: boolean, isCardHand: boolean): HandRole {
  return hasCards && isCardHand ? "cards" : "rail";
}

/** Distance between two anchors, for tests that pin the two hands apart. */
export function anchorSeparation(a: HandAnchor, b: HandAnchor): number {
  return dist(a.wrist, b.wrist);
}
