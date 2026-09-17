/**
 * Wind over the top-down farm, in whole art pixels so the pixel art never blurs or crawls.
 *
 * The wind blows east. Each swaying thing (a tree's canopy, a reed's tops) leans between upright and one
 * pixel east on its own slow rhythm, and a gust rolls across the map from the west every few seconds,
 * pushing everything it passes over. Grass and reeds also rustle when the farmer walks through them.
 * docs/stackacres-premium-life.md has the reasoning.
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

/** The lean of a swaying thing at (x, y), in whole art pixels east: 0..amp. */
export function swayOffset(timeMs: number, x: number, y: number, amp = 1): number {
  const seed = hashPoint(x, y);
  const period = 3400 + seed * 2200;
  const own = Math.sin((timeMs / period) * TAU + seed * TAU);
  const lean = 0.5 + 0.45 * own + 0.55 * gustAt(timeMs, x);
  return Math.max(0, Math.min(amp, Math.round(lean * amp)));
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
