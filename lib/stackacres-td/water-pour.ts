/**
 * Water leaving the can.
 *
 * The farmer's `water` animation is four frames, and on the fourth the can is
 * tipped spout-down. The water pours on that frame, not on the tap: drops leave
 * the spout, fall onto the square he is watering and splash there. Without it
 * he mimes with an empty can and the bed just changes colour.
 *
 * ./water-pour.test.ts reads the tipped frame off the farmer's sheet, both its
 * timing and the spout's pixels, so redrawing the can without moving these
 * fails a test instead of pouring from thin air.
 *
 * Pure and renderer-free, same split as ./hoe.ts and ./pull.ts.
 */

import type { Facing } from "./work-square";

export interface Point {
  x: number;
  y: number;
}

/** Frames of a watering loop before the can tips. The fourth is the pour. */
export const POUR_FRAMES_BEFORE = 3;

/** The tipped frame as Phaser numbers them in an animation (from 1). */
export const POUR_FRAME_INDEX = POUR_FRAMES_BEFORE + 1;

/** Ms from the start of a watering loop to the can tipping. */
export const POUR_MS = 480;

/** How long the can stays tipped. Every drop leaves the spout inside it. */
export const POUR_HOLD_MS = 160;

/**
 * The spout on the tipped frame. `at` is where it is drawn, from the point at
 * his feet; `lift` is how high it is off the ground below it, which is what the
 * drops fall through. Facing down the can tips toward the camera, facing up it
 * is held out behind him.
 */
export const SPOUT: Readonly<Record<Facing, { at: Point; lift: number }>> = {
  down: { at: { x: -4, y: -2 }, lift: 4 },
  up: { at: { x: 7, y: -18 }, lift: 10 },
  left: { at: { x: -15, y: -6 }, lift: 6 },
  right: { at: { x: 14, y: -6 }, lift: 6 },
};

/**
 * Drops per pour, one art pixel each. Stardew pours 30 over 450ms; the can
 * here tips twice for 160ms, so 10 a tip keeps the same density.
 */
export const POUR_DROPS = 10;

/** How long one drop takes from the spout to the soil. */
export const DROP_FALL_MS = 150;

/** The two blues a drop is drawn in, Stardew's DeepSkyBlue and LightBlue. */
export const DROP_COLOURS = [0x00bfff, 0xadd8e6] as const;

/** How far the drops land from the square's centre, at most. A bed is 16 across. */
export const SPLASH_SPREAD = { x: 4, y: 2 } as const;

export interface Drop {
  /** Ms after the can tips that this drop leaves the spout. */
  delay: number;
  /** Where it lands, from the centre of the square being watered. */
  land: Point;
}

/**
 * The drops of one pour: released one after another across the tipped frame,
 * landing scattered over the middle of the square. Spread by the golden angle
 * rather than at random so every pour looks alike and a test can pin it.
 */
export function pourDrops(count = POUR_DROPS): Drop[] {
  const drops: Drop[] = [];
  const release = POUR_HOLD_MS - DROP_FALL_MS / 3;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996;
    const reach = Math.sqrt((i + 0.5) / count);
    drops.push({
      delay: count > 1 ? Math.round((release * i) / (count - 1)) : 0,
      land: {
        x: Math.round(Math.cos(angle) * reach * SPLASH_SPREAD.x),
        y: Math.round(Math.sin(angle) * reach * SPLASH_SPREAD.y),
      },
    });
  }
  return drops;
}

/**
 * Where a drop is, `t` from 0 (leaving the spout) to 1 (on the soil). Its
 * shadow on the ground moves evenly from under the spout to where it lands
 * while its height falls away under gravity, so it pours rather than slides.
 */
export function dropPoint(spout: Point, lift: number, land: Point, t: number): Point {
  const k = Math.max(0, Math.min(1, t));
  const groundX = spout.x + (land.x - spout.x) * k;
  const groundY = spout.y + lift + (land.y - spout.y - lift) * k;
  return { x: groundX, y: groundY - lift * (1 - k * k) };
}
