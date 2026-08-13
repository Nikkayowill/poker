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
  RAIL_WIDTH,
  holeCardPosition,
  seatAngle,
  seatPosition,
  type Vec3,
} from "./seat-layout";
import { add, clamp, cross, dist, len, lerp, norm, scale, sub, vec } from "./vec3-math";

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

/** Lateral offset of the card hand from the seat's own centre line. */
export const CARD_HAND_LATERAL = mm(18);

/**
 * How far onto the padded rail — not just up to the felt's own edge — a
 * resting hand reaches, as a fraction of the rail's real modelled width
 * (`RAIL_WIDTH`, shared with `table-3d.tsx`'s rail mesh via
 * `seat-layout.ts`).
 *
 * THE MEASUREMENT THIS CONSTANT EXISTS BECAUSE OF: resting a hand at the
 * felt's own inner edge (this file's first cut, a plain fraction just under
 * 1.0 of the felt radii) still measured 0.49-0.52 world units from the
 * seat — against the roster's 0.54-0.60 arm length, that is 87-91% of full
 * extension, i.e. the same near-max reach this module exists to remove, not
 * fixed. The felt's own edge is close to the SEAT_SETBACK away from every
 * seat regardless of which point on the felt is chosen; a real player's
 * idle hand does not reach that far, because it doesn't rest on the felt at
 * all — it rests on the padded rail in front of them, which is physically
 * closer. 0.6 leaves the hand shy of the rail's own outer lip rather than
 * hanging off it.
 */
export const RAIL_HAND_RIDGE = RAIL_WIDTH * 0.6;
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
 * The near-rail resting point shared by BOTH hands — the off hand always
 * sits here, and (see `handAnchor`) the card hand now rests here too rather
 * than staying parked near the cards.
 *
 * Real reference (Governor of Poker 3, Vegas Infinite): an idle hand sits
 * close to the body, resting on the table's own padded rail, and travels
 * only a short distance from there — not out onto the felt toward the
 * middle. The point is stated as the felt's own boundary ellipse pushed
 * OUTWARD by `RAIL_HAND_RIDGE`, onto the rail, rather than as a fraction of
 * the felt radii short of 1.0 — see that constant for the render-measured
 * reason a felt-side point wasn't close enough.
 */
function railAnchor(slot: number, sign: number, forward: Vec3, right: Vec3): HandAnchor {
  const angle = seatAngle(slot);
  const edge = vec(
    Math.sin(angle) * (FELT_RADIUS_X + RAIL_HAND_RIDGE),
    FELT_TOP_Y,
    Math.cos(angle) * (FELT_RADIUS_Z + RAIL_HAND_RIDGE)
  );
  const wrist = add(
    add(edge, scale(forward, -RAIL_HAND_SETBACK)),
    scale(right, sign * RAIL_HAND_LATERAL)
  );
  return {
    wrist: vec(wrist.x, FELT_TOP_Y + WRIST_REST_HEIGHT, wrist.z),
    // Points into the table rather than off the side of it — a hand resting
    // at the edge with its fingers aimed at the rail reads as a person
    // facing away from the game.
    aim: add(vec(wrist.x, FELT_TOP_Y, wrist.z), scale(forward, mm(180))),
  };
}

const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

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
 *
 * THE CARD HAND'S REST POINT IS THE RAIL POINT, NOT A SPOT NEAR THE CARDS.
 * An earlier cut of this module rested the card hand `CARD_HAND_SETBACK`
 * back from the card and only nudged it a further `CARD_HAND_SNUG` (a
 * couple of centimetres) forward at `snug = 1` — which meant every seat's
 * resting hand sat permanently close to `reachableTarget`'s comfortable-reach
 * ceiling, reading as an arm stretched out rather than one at rest. Real
 * reference games keep an idle hand near the body and only extend it onto
 * the felt for something to do — checking a bet, covering a live hand at
 * your own turn — so `snug` now sweeps the WHOLE distance from `railAnchor`
 * (rest) to the true card-approach point (`snug = 1`), and the two roles
 * share one rest formula rather than each tuning their own.
 */
export function handAnchor(
  slot: number,
  role: HandRole,
  lateralSign: number,
  snug = 0
): HandAnchor {
  const { forward, right } = seatFrame(slot);
  const sign = lateralSign >= 0 ? 1 : -1;
  const rest = railAnchor(slot, sign, forward, right);

  if (role === "cards") {
    const card = holeCardPosition(slot);
    const wrist = add(
      add(card, scale(forward, -CARD_HAND_SETBACK)),
      scale(right, sign * CARD_HAND_LATERAL)
    );
    const acting: HandAnchor = {
      wrist: vec(wrist.x, FELT_TOP_Y + WRIST_REST_HEIGHT, wrist.z),
      aim: vec(card.x, FELT_TOP_Y, card.z),
    };
    const t = clamp(snug, 0, 1);
    return {
      wrist: lerpVec(rest.wrist, acting.wrist, t),
      aim: lerpVec(rest.aim, acting.aim, t),
    };
  }

  return rest;
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
 * The ceiling a RESTING hand is held to specifically — lower than
 * `COMFORTABLE_REACH`, which stays what it always was: the ceiling for a
 * hand actively settling onto its own cards at the player's own turn.
 *
 * THE MEASUREMENT THIS CONSTANT EXISTS BECAUSE OF. Moving the rest anchor
 * onto the padded rail (`RAIL_HAND_RIDGE`) meaningfully shortened the raw
 * target for most seats, but the near/local seat carries its own extra
 * setback (`NEAR_SEAT_EXTRA_SETBACK`, seat-layout.ts) on top of the shared
 * one, and its shoulder-to-rail-point distance still exceeds even a fairly
 * generous ceiling — rendered, that seat's rest pose was unchanged by the
 * anchor move alone, because 0.89 was still the binding constraint, not the
 * raw target. A single shared ceiling can't serve both states: acting needs
 * to stay close to 0.89 or a settling hand visibly stops well short of the
 * cards it's meant to cover; resting needs to be well under that or the
 * worst-case seat's elbow never bends regardless of where the raw anchor
 * asks for. `poseAvatar` (arm-rig.ts) blends between the two by `snug`, the
 * same lever the wrist target itself already blends by, so the ceiling
 * relaxes in step with the pose rather than snapping at some threshold.
 */
export const RESTING_COMFORTABLE_REACH = 0.72;

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
export function reachableTarget(
  shoulder: Vec3,
  armLength: number,
  target: Vec3,
  comfortableFraction: number = COMFORTABLE_REACH
): ReachResult {
  const maxReach = Math.max(armLength * comfortableFraction, 0);
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
