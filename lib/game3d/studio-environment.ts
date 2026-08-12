/**
 * The "Poker After Dark" studio: no room mesh at all — the set is one hard
 * spotlight pool over the felt and a darkness the rest of the world falls
 * into. Everything here is the pure half (fog distances, the light cone,
 * fold/bet pose targets, the dealer's mark), solved from the same modules
 * the room is already built on: camera-framing supplies where the camera
 * actually stands per screen shape, dimensions supplies the metre ruler,
 * seat-layout supplies the ring.
 *
 * WHY THE FOG IS LINEAR AND SOLVED, NOT FogExp2 AND A CONSTANT. The studio
 * brief asks for exponential fog, but at this room's scale no single
 * exponential density can hold both requirements at once: the camera stands
 * ~6.1 units from the felt in landscape, and a density that swallows the
 * floor rim 14 units out (≥90% fogged) leaves the felt itself at ~65%
 * visibility — a smoky table, not a televised one. (The brief's 0.28 is
 * further still: exp(-(0.28·6.1)²) ≈ 0.05 — a 95% fogged felt.) Linear fog
 * has the two independent knobs the look actually needs: `near` past the
 * far player's head so the whole table stays crisp, `far` short of the
 * floor rim so the void is total, with the folded players' slide-back
 * landing exactly in the fade band between them. And because the camera
 * distance changes with the viewport (portrait stands ~9 out, landscape
 * ~6), the distances are solved per framing, not typed once against
 * whichever screen the numbers were tuned on.
 */

import { frameCamera, type CameraFraming } from "./camera-framing";
import { UNITS_PER_METRE } from "./dimensions";
import type { RoomTheme } from "./room-theme";
import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  SEAT_COUNT_3D,
  SEAT_RING_RADIUS_X,
  SEAT_RING_RADIUS_Z,
  seatPosition,
  faceCentreRotationY,
  type Vec3,
} from "./seat-layout";
/**
 * Head heights the light rig has to cover, stated here rather than imported
 * from whatever is currently drawing the seats.
 *
 * These used to come from the procedural figures' own constants, which tied
 * the lighting solution to one renderer — and when that renderer was
 * deleted for the sprite turnaround, the fog and spotlight maths went with
 * it for no reason. What the studio actually needs is "roughly how high is
 * a head at a seat", which is a property of the room, not of the art.
 */
export const PLAYER_HEAD_Y = 1.5;
export const DEALER_HEAD_Y = 1.62;

/** Air between the last crisp point and the start of the fade. */
const FOG_NEAR_MARGIN = 0.3;

/**
 * Depth of the fade band. Short enough that the floor disc's rim (radius 9)
 * is fully swallowed at every framing — the test measures that against the
 * real camera positions rather than trusting this comment. Trimmed from
 * 3.0 when the upright fit widened for whole side seats: a camera further
 * back grows its distance to the (near, central) crisp points faster than
 * to the (lateral) rim, so the band that fit at the old distance poked
 * 0.11 units past the rim at the new one.
 */
export const FOG_SPAN = 2.7;

export interface StudioFog {
  color: string;
  near: number;
  far: number;
}

/**
 * The points that must stay entirely fog-free: the rail's extremes and
 * every head at the table — six seated players and the standing dealer.
 * Folded players are deliberately absent: their slide-back is supposed to
 * dip into the fade.
 */
export function crispProbePoints(): Vec3[] {
  const rail = 1.08;
  const points: Vec3[] = [
    { x: -FELT_RADIUS_X * rail, y: FELT_TOP_Y, z: 0 },
    { x: FELT_RADIUS_X * rail, y: FELT_TOP_Y, z: 0 },
    { x: 0, y: FELT_TOP_Y, z: -FELT_RADIUS_Z * rail },
    { x: 0, y: FELT_TOP_Y, z: FELT_RADIUS_Z * rail },
  ];
  for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
    const seat = seatPosition(slot);
    points.push({ x: seat.x, y: PLAYER_HEAD_Y, z: seat.z });
  }
  points.push({ x: DEALER_STAND.x, y: DEALER_HEAD_Y, z: DEALER_STAND.z });
  return points;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Solve the fog band for where this framing's camera actually stands.
 *
 * The band itself (near/far) is pure geometry — it does not depend on which
 * theme is active. Only `color` does, and it must be `theme.backdrop`: fog
 * and canvas background must match or the fade draws a horizon line, which
 * is the same equality `RoomTheme.carpetStops`' last stop owes `backdrop`.
 */
export function studioFog(framing: CameraFraming, theme: RoomTheme): StudioFog {
  const farthestCrisp = crispProbePoints().reduce(
    (max, point) => Math.max(max, distance(framing.position, point)),
    0
  );
  const near = farthestCrisp + FOG_NEAR_MARGIN;
  return { color: theme.backdrop, near, far: near + FOG_SPAN };
}

/** Convenience for the scene: fog for a viewport aspect in one call. */
export function studioFogForAspect(aspect: number, theme: RoomTheme): StudioFog {
  return studioFog(frameCamera(aspect), theme);
}

/* ------------------------------------------------------------------ */
/* The spotlight                                                       */
/* ------------------------------------------------------------------ */

/**
 * How far a folded figure slides away from the table, along its seat's
 * outward radial.
 *
 * Declared up here, ahead of the light, because the lit pool below is
 * DERIVED from it — the pool's whole specification is "the outermost folded
 * player sits at the rim", and that sentence cannot be evaluated before the
 * fold exists.
 *
 * Deep enough to walk down the spotlight's penumbra and into the fog band;
 * shallow enough that a folded *side* seat still projects inside the
 * landscape frame — at 0.8 the slot-1 head lands at NDC x ~ 1.06 (clipped);
 * at 0.55 it is ~0.97. The layout test measures this against the solved
 * camera at every target aspect, so a deeper slide cannot silently push a
 * player off screen again — and note the camera sits CLOSER than it did
 * since the fit was made exact, so this ceiling is tighter now, not looser.
 */
export const FOLD_SLIDE = 0.55;

/**
 * Height of the studio truss over the floor, in metres, converted through
 * the room's one ruler like every physical dimension.
 *
 * Lowered from 3.2 m when the felt took its true 2.13 x 1.07 proportions,
 * and the reason is geometric rather than aesthetic. On the rounder plate
 * the six seats sat at plan radii 1.78 and 2.44; on the real one they sit
 * at 1.55 and 2.40, so the near and far players moved a quarter of a unit
 * IN while the side players did not move. That puts the two of them deep
 * inside the cone, where a smoothstep is at its flattest — and a fold is an
 * absolute slide, so from there it no longer bought a visible drop in
 * light. Folding stopped reading as walking into the dark for exactly the
 * two seats the camera looks straight at.
 *
 * A lower truss subtends the same pool over a shorter drop, which steepens
 * the gradient across the whole table and restores it. 2.6 m over the floor
 * is ~1.85 m over the cloth: a pendant over a card table, which is what
 * this is.
 */
const SPOT_HEIGHT_M = 2.6;

/**
 * Radius of the lit pool on the felt plane. Sized so the outermost *folded*
 * player sits at the very rim of the cone — everyone at the table is inside
 * the light, and folding is a walk down the penumbra gradient into the dark.
 *
 * That was always this constant's stated job; it is now actually computed
 * that way rather than being a 3.3 that happened to satisfy it on the plate
 * it was typed against. The margin is what keeps the outermost folded seat
 * just inside the rim rather than exactly on it, where the falloff is zero
 * and a figure disappears rather than dims.
 */
const SPOT_POOL_MARGIN = 1.08;

function maxFoldedPlanRadius(): number {
  let widest = 0;
  for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
    const seat = seatPosition(slot);
    widest = Math.max(widest, Math.hypot(seat.x, seat.z) + FOLD_SLIDE);
  }
  return widest;
}

const SPOT_POOL_RADIUS = maxFoldedPlanRadius() * SPOT_POOL_MARGIN;

const SPOT_Y = SPOT_HEIGHT_M * UNITS_PER_METRE;
const SPOT_DROP = SPOT_Y - FELT_TOP_Y;

/**
 * The spotlight's RIG — where it stands, what it aims at, and the cone
 * shape that puts the outermost folded player right at its rim (see
 * SPOT_POOL_RADIUS above). Every theme shares this geometry; only
 * `RoomTheme.spot`'s colour/intensity/decay differ, in poker-scene.tsx's
 * `<spotLight>`.
 *
 * Intensity/decay used to live here too, and the note on why matters for
 * any future retune of SPOT_DROP: intensity falls as distance^decay, so
 * shortening the throw from 5.60 to 4.39 units brightens the felt by
 * (5.60/4.39)^1.6 = 1.48x — a blown-out cloth, from a change that was about
 * the shape of the gradient and was never meant to touch exposure at all.
 * `after_dark`'s 156 (room-theme.ts) is 230 / 1.48, holding the table at the
 * level it was judged at; a further SPOT_DROP change owes every theme's
 * intensity the same correction.
 */
export const STUDIO_SPOT = {
  position: { x: 0, y: SPOT_Y, z: 0.35 } as Vec3,
  target: { x: 0, y: FELT_TOP_Y, z: 0 } as Vec3,
  angle: Math.atan(SPOT_POOL_RADIUS / SPOT_DROP),
  /** The televised soft edge: light falls off across most of the cone. */
  penumbra: 0.85,
} as const;

/**
 * three.js's own spotlight attenuation (a smoothstep between the penumbra's
 * inner cone and the outer cone), restated here as pure math so tests can
 * assert who is lit and who is dark instead of eyeballing a render.
 */
export function spotFalloffAt(planRadius: number): number {
  const angle = Math.atan(planRadius / SPOT_DROP);
  const cosAngle = Math.cos(angle);
  const cosOuter = Math.cos(STUDIO_SPOT.angle);
  const cosInner = Math.cos(STUDIO_SPOT.angle * (1 - STUDIO_SPOT.penumbra));
  const t = Math.min(1, Math.max(0, (cosAngle - cosOuter) / (cosInner - cosOuter)));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ */
/* Fold / bet posing                                                   */
/* ------------------------------------------------------------------ */

/** Backward tilt (radians about local X) for a folded figure. */
export const FOLD_TILT = -0.16;

/** Forward slide while chips are committed — into the light, not onto it. */
export const BET_SLIDE = 0.14;

export interface SeatPoseTarget {
  /** Local-Z offset for the seat group; +Z faces the table centre. */
  slide: number;
  /** Sustained lean (radians about local X); positive is toward the felt. */
  tilt: number;
}

/**
 * The sustained pose a seat damps toward. Fold wins over betting: a seat
 * with chips already committed that then folds belongs in the dark.
 */
export function seatPoseTarget(folded: boolean, betting: boolean): SeatPoseTarget {
  if (folded) return { slide: -FOLD_SLIDE, tilt: FOLD_TILT };
  if (betting) return { slide: BET_SLIDE, tilt: 0.05 };
  return { slide: 0, tilt: 0 };
}

/** Where a slot's figure stands once fully folded back, in world plan. */
export function foldedSeatPosition(slot: number): Vec3 {
  const seat = seatPosition(slot);
  const planLength = Math.hypot(seat.x, seat.z) || 1;
  return {
    x: seat.x + (seat.x / planLength) * FOLD_SLIDE,
    y: seat.y,
    z: seat.z + (seat.z / planLength) * FOLD_SLIDE,
  };
}

/* ------------------------------------------------------------------ */
/* The dealer's mark                                                   */
/* ------------------------------------------------------------------ */

/**
 * The dealer stands outside the ring between seats 2 and 3 — the far-middle
 * spot a croupier would take is exactly where slot 3 sits (the ring has no
 * gap), so the house stands at the table's shoulder instead. Half a slot's
 * angle past seat 2, pushed just off the ring.
 */
const DEALER_ANGLE = ((2.5 / SEAT_COUNT_3D) * Math.PI) * 2;

/**
 * Was 0.25, then 0.18, then 0.1, tuned against progressively larger
 * SEAT_RING_RADIUS values. Each further pull-in of the table
 * (seat-layout.ts) shrinks the ring the six seats sit on, and DEALER_ANGLE
 * puts the dealer at the exact angular midpoint between seats 2 and 3 — a
 * fixed 60 degrees apart regardless of ring size — so a smaller ring leaves
 * less ARC between neighbouring seats for any margin to buy clearance from.
 *
 * The fourth pull-in (FELT_RADIUS_X 1.45 → 1.2) hit the wall this comment
 * predicted: DEALER_ANGLE was tried away from the symmetric midpoint, on the
 * theory that separating from seat 2 specifically (the tighter of the two,
 * on this ellipse — see below) would help. It does not. A search over every
 * angle between the two seats and every margin from -0.05 to 0.3 found NO
 * combination that both clears seat 2 by more than 0.7 and keeps the
 * dealer's head on screen at 844x390 — moving the angle toward seat 3 barely
 * moves seat 2's distance (the margin push is roughly radial, not tangential
 * to seat 2's own arc) while it costs seat 3 its slack much faster than it
 * buys any. The symmetric midpoint (DEALER_ANGLE unchanged) remains the best
 * available point; margin is the only real lever left, and 0.084 is the
 * exact boundary where the head leaves the 844x390 frame. 0.08 sits just
 * inside it. See the test's own comment for the clearance threshold this
 * now sets, which is lower than the 0.7 it was once tuned to.
 */
const DEALER_STAND_MARGIN = 0.08;

export const DEALER_STAND: Vec3 = {
  x: Math.sin(DEALER_ANGLE) * (SEAT_RING_RADIUS_X + DEALER_STAND_MARGIN),
  y: 0,
  z: Math.cos(DEALER_ANGLE) * (SEAT_RING_RADIUS_Z + DEALER_STAND_MARGIN),
};

export const DEALER_FACING_Y = faceCentreRotationY(DEALER_STAND);
