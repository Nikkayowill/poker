/**
 * Where a seat's head sits in world space.
 *
 * This used to be the six-angle avatar sprite renderer's own module (which
 * render to show, how big the quad stood, its motion, its rail fade). The
 * quads are gone -- seats render through GlbAvatar now -- but the geometry
 * that located a sprite's crown from a seat's position and the camera's
 * framing is still load-bearing: `seat-nameplates.tsx` projects
 * `spriteCrownWorld` to place each player's plate. Everything else that
 * module carried (the angle picker, the rail fade, the warm rim, the
 * breathing/sway/tint motion contract) had no other caller and was deleted
 * with it.
 *
 * Pure module — no three.js import — so `npm test` reaches all of it.
 */

import { seatPosition, type Vec3 } from "./seat-layout";
import { cameraBasis, type CameraFraming } from "./camera-framing";

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every render is cropped to one common bust box by scripts/build the
 * avatar sprites: 1200×800 source pixels centred on that render's own
 * measured head centre, starting 20px above its crown. Because the six
 * were generated at one scale (measured crown-to-neck heights agreed to
 * within 5%), a single box keeps the character from growing or bobbing as
 * the ring turns.
 */
export const SPRITE_PIXELS = { width: 900, height: 600 } as const;
export const SPRITE_ASPECT = SPRITE_PIXELS.width / SPRITE_PIXELS.height;

/**
 * Fractions measured off the source renders, kept here so the world-space
 * sizing below is checkable arithmetic rather than a number picked by eye.
 * `shoulderSpan` is the widest row inside the crop; `headHeight` is crown
 * to neck pinch; `crownInset` is the transparent air above the hair.
 */
export const ART_FRACTIONS = {
  shoulderSpan: 1024 / 1200,
  headHeight: 372 / 800,
  headWidth: 500 / 1200,
  crownInset: 20 / 800,
} as const;

/**
 * Width of the quad in world units. Sizing on shoulders rather than on the
 * head is deliberate: the artwork's head is stylised (head-to-shoulder
 * ratio ~0.49 against a real 0.33), so anchoring on the head would inflate
 * the whole figure.
 *
 * The number itself was set on a render, not from a ratio. A first pass
 * put the shoulders at 1.0 unit, reasoning from the mockup's shoulder-to-
 * felt-width proportion — and on screen the players came out visibly
 * smaller than the mockup and were dwarfed by their own chairs. The
 * arithmetic was misleading because the seat ring sits *behind* the felt:
 * a figure at the far seat is much further from the camera than the felt's
 * near edge, so measuring it against the felt's full on-screen width
 * understates it. Judged against the mockup at matching seats instead.
 */
export const SPRITE_WIDTH = 1.3;
export const SPRITE_HEIGHT = SPRITE_WIDTH / SPRITE_ASPECT;

/**
 * Height of the quad's BASE above the floor, before the quad is tipped to
 * face the camera. Low enough that the rail crosses the chest, so the
 * crop's own bottom edge is never the silhouette.
 */
export const SPRITE_BASE_Y = 0.64;

/**
 * How far above the base the head's centre sits, and therefore where the
 * quad pivots when it squares up to the camera.
 *
 * THE HEAD IS THE ANCHOR, not the foot. A screen-aligned quad's up axis
 * leans away from the camera, so whichever point you pivot about is the
 * only one that stays where you put it. Pivoting at the foot looked
 * natural on paper and was wrong on a render: it swung the top of the
 * plane ~0.8 units further from the camera, which pushed every head behind
 * its own chair back and left six faceless silhouettes. Pivoting at the
 * head pins the one part that must not move — correct depth, in front of
 * the chair, at the right height — and swings the foot forward instead,
 * where it is both faded to nothing and below the felt, so it disappears
 * into the table exactly as a body should.
 */
export const HEAD_RISE = SPRITE_HEIGHT * (1 - ART_FRACTIONS.crownInset - ART_FRACTIONS.headHeight / 2);

/** camera-framing.ts solves its fits against this headroom. */
export const CAMERA_HEADROOM_Y = 1.75;

/** Top of the padded rail (table-3d.tsx: FELT_TOP_Y + 0.005 + tube 0.075). */
export const RAIL_TOP_Y = 0.94;

/** Derived world sizes — what the numbers above actually produce. */
export const SHOULDER_SPAN = SPRITE_WIDTH * ART_FRACTIONS.shoulderSpan;
export const HEAD_HEIGHT = SPRITE_HEIGHT * ART_FRACTIONS.headHeight;

/**
 * How far the crown sits from the quad's base, along the quad's own up
 * axis. Not a world height any more — see spriteCrownWorld.
 */
export const CROWN_RISE = SPRITE_HEIGHT * (1 - ART_FRACTIONS.crownInset);

/**
 * Where a seat's crown actually is in world space.
 *
 * The quads were SCREEN-ALIGNED — parallel to the camera's image plane, not
 * standing vertically in the world — so a sprite's up axis was the camera's
 * up axis, and its crown was the base plus CROWN_RISE along that. A fixed
 * world Y would only be right for a vertical quad, and the nameplates have
 * to land on the head the same way regardless of which renderer is seated
 * there.
 *
 * Why the quads were screen-aligned at all: a world-vertical billboard does
 * not project to screen-vertical under a camera that is pitched down. It
 * keystones — measured at ±25.8° at the near-side seats on a desktop and
 * ±47.8° upright — which read exactly as the players lounging backwards in
 * their chairs. The same pitch also squashed every figure vertically by
 * ~31%, so aligning to the image plane fixed the proportions as well as
 * the lean.
 */
export function spriteCrownWorld(
  slot: number,
  framing: CameraFraming,
  folded: boolean
): Vec3 {
  const seat = folded ? spriteFoldedSeatPosition(slot) : seatPosition(slot);
  const { up } = cameraBasis(framing);
  // The pivot is the head, at a fixed world height; the crown is that plus
  // the rest of the way up the quad's own (camera-aligned) axis.
  const rise = CROWN_RISE - HEAD_RISE;
  return {
    x: seat.x + up.x * rise,
    y: seat.y + SPRITE_BASE_Y + HEAD_RISE + up.y * rise,
    z: seat.z + up.z * rise,
  };
}

/**
 * How far a folded figure settles back from the rail, world units.
 *
 * Measured: at a larger recede (0.55, the studio's own FOLD_SLIDE) a folded
 * near seat's head reached NDC 1.08 — off screen, because a seat at ±60°
 * recedes outward *and* toward the camera and both magnify how far out it
 * projects. `spriteFoldedSeatPosition` is the one place it is applied, so
 * the nameplates cannot drift from the figure.
 */
export const SPRITE_FOLD_RECEDE = 0.14;

/**
 * Where a slot's figure ends up once folded — the seat position pushed out
 * along its own radial by SPRITE_FOLD_RECEDE. The nameplates project it, so
 * a plate can never float away from the head it names.
 */
export function spriteFoldedSeatPosition(slot: number): Vec3 {
  const seat = seatPosition(slot);
  const planLength = Math.hypot(seat.x, seat.z) || 1;
  return {
    x: seat.x + (seat.x / planLength) * SPRITE_FOLD_RECEDE,
    y: seat.y,
    z: seat.z + (seat.z / planLength) * SPRITE_FOLD_RECEDE,
  };
}
