/**
 * Wind over the top-down farm.
 *
 * The wind blows east. Each swaying thing (a tree's crown, a reed's tops) bends from its base: mostly
 * downwind, with a little swing back past upright, on its own slow rhythm, and a gust rolls across the map
 * from the west every few seconds, pushing everything it passes over. Grass and reeds also rustle when the
 * farmer walks through them. docs/stackacres-premium-life.md has the reasoning.
 *
 * SMOOTH, not whole pixels. The first version snapped every lean to a whole art pixel so the old
 * one-pixel-per-unit art would never blur, which left every tree flicking between two positions a pixel
 * apart: it read as a tree standing still with a twitch, and as the world stuttering. The trees are the LPC
 * pack's now, drawn at twice the map's resolution and scaled down, so a fractional bend stays sharp.
 */

const TAU = Math.PI * 2;

/** A stable 0..1 value per map position, so neighbouring trees don't sway in step. */
export function hashPoint(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0;
  // murmur3's finaliser, so points a few pixels apart land far apart
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How hard a gust is pushing at map column `x`, 0..1: a band that rolls east every GUST_EVERY_MS. */
export const GUST_EVERY_MS = 9000;
const GUST_SPEED = 0.09; // map px per ms

export function gustAt(timeMs: number, x: number): number {
  const phase = ((timeMs * GUST_SPEED - x) / (GUST_EVERY_MS * GUST_SPEED)) % 1;
  const p = phase < 0 ? phase + 1 : phase;
  return Math.pow(Math.max(0, Math.sin(p * TAU)), 6);
}

/** How far back past upright a swaying thing may go, as a share of its amplitude. */
export const BACKSWING = 0.25;

/**
 * The lean of a swaying thing at (x, y): how far its top sits east of upright, in map px, from
 * `-amp * BACKSWING` to `amp`. Continuous -- see the header on why it is no longer whole pixels.
 */
export function swayOffset(timeMs: number, x: number, y: number, amp = 1): number {
  const seed = hashPoint(x, y);
  const period = 3400 + seed * 2200;
  const own = Math.sin((timeMs / period) * TAU + seed * TAU);
  const lean = 0.35 + 0.4 * own + 0.6 * gustAt(timeMs, x);
  return Math.max(-BACKSWING, Math.min(1, lean)) * amp;
}

/** A rustle when the farmer brushes past: offsets played one step at a time. */
export const RUSTLE = [1, -1, 1, 0] as const;
export const RUSTLE_STEP_MS = 70;
/** How close the farmer's feet must come, in map px, and how long before the same clump rustles again. */
export const RUSTLE_REACH = { x: 7, y: 5 };
export const RUSTLE_COOLDOWN_MS = 600;

/** The rustle offset `sinceMs` after it started, or null once it has played out. */
export function rustleOffset(sinceMs: number): number | null {
  const step = Math.floor(sinceMs / RUSTLE_STEP_MS);
  return step < RUSTLE.length ? RUSTLE[step] : null;
}
