/**
 * How a ripe crop comes out of the ground and into the farmer's hands.
 *
 * Picking is the sheet's `harvest` animation (art/stackacres-td/lpc/build.py
 * PICK): he bends down to the plant, grips it at the bottom of the bend,
 * straightens with it and holds it at his chest. The crop has to move with
 * those frames or it reads as the plant vanishing while he mimes. It wiggles
 * while he grips it, comes out of the soil as he straightens, hops up to his
 * chest and lands there as the hold frame starts, with a squash so it bounces
 * into him.
 *
 * ./pull.test.ts reads the frame times out of the farmer's sheet, so redrawing
 * the animation without moving these fails a test instead of drifting.
 *
 * Pure and renderer-free, same split as ./hoe.ts.
 */

export interface Point {
  x: number;
  y: number;
}

/** Frames before his hands reach the plant: the first half of the bend. */
export const PULL_FRAMES_BEFORE_GRIP = 1;

/** Frames before the crop lets go of the ground: the bend, then the grip at the bottom of it. */
export const PULL_FRAMES_BEFORE_POP = 2;

/** Frames before it lands in his hands: bend, grip, straighten. The fourth is the hold. */
export const PULL_FRAMES_BEFORE_CATCH = 3;

/** Ms from the start of the pick to his hands reaching the plant. */
export const PULL_GRIP_MS = 110;

/** Ms from the start of the pick to the crop coming loose. */
export const PULL_POP_MS = 280;

/** Ms from the start of the pick to the crop landing in his hands. */
export const PULL_CATCH_MS = 450;

/** How long it rises straight up out of the soil before it hops toward him. */
export const PULL_RISE_MS = 60;

/** How far it rises out of the soil, in art pixels. */
export const PULL_RISE_PX = 5;

/** How far above the straight line from the bed to his hands the hop peaks. */
export const PULL_HOP_PX = 9;

/** Where his hands are when he holds something, above the point at his feet. */
export const PULL_HANDS_ABOVE_FEET = 12;

/** How big he holds it, against its size in the bed: small enough to sit against his chest. */
export const PULL_HELD_SCALE = 0.7;

/** How long the landing squash and the tuck into him take after the catch. */
export const PULL_SETTLE_MS = 300;

/**
 * A point on the hop from where the crop came loose to his hands. `t` runs
 * 0 to 1; the rise is a parabola over the straight line, peaking at the middle.
 */
export function pullHopPoint(t: number, from: Point, to: Point, hop = PULL_HOP_PX): Point {
  const k = Math.min(1, Math.max(0, t));
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k - hop * 4 * k * (1 - k),
  };
}
