/**
 * The farm's ambient critters: who is out at which hour, and the small rules each one moves by.
 *
 * Modelled on Stardew Valley's critters (rare, tied to the time of day, never in the way): butterflies,
 * a dragonfly over the pond and the odd bird by day, falling leaves when the wind gusts, a fish jumping,
 * fireflies at night. They only ever use the `ambient` tiles an area exports, which keep clear of anything a
 * player taps. docs/stackacres-premium-life.md has the reasoning.
 */

export type Critter = "butterflies" | "dragonfly" | "birds" | "leaves" | "fish" | "fireflies";

export function activeCritters(hour: number): Set<Critter> {
  const h = ((hour % 24) + 24) % 24;
  const out = new Set<Critter>();
  if (h >= 7 && h < 19) {
    out.add("butterflies");
    out.add("dragonfly");
    out.add("birds");
  }
  if (h >= 6 && h < 20.5) out.add("leaves");
  if (h >= 6 && h < 21) out.add("fish");
  if (h >= 20.5 || h < 5) out.add("fireflies");
  return out;
}

export const BUTTERFLIES = 3;
export const FIREFLIES = 7;
/** How often, in ms, the rarer things happen: a random wait between the two numbers. */
export const BIRD_EVERY: readonly [number, number] = [20_000, 50_000];
export const FISH_EVERY: readonly [number, number] = [12_000, 30_000];
export const LEAF_EVERY: readonly [number, number] = [2_500, 6_000];

export type Tile = readonly [number, number];
export const tileId = ([tx, ty]: Tile) => `${tx},${ty}`;

/** A random tile near `from` that critters may use, within `reach` tiles, or null when there is none. */
export function nearbyTile(allowed: ReadonlySet<string>, from: Tile, reach: number, random: () => number): Tile | null {
  const options: Tile[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx === 0 && dy === 0) continue;
      const tile: Tile = [from[0] + dx, from[1] + dy];
      if (allowed.has(tileId(tile))) options.push(tile);
    }
  }
  return options.length === 0 ? null : options[Math.floor(random() * options.length)];
}

/** Waits a random time between the two ends of a range. */
export function between([lo, hi]: readonly [number, number], random: () => number): number {
  return lo + random() * (hi - lo);
}

/**
 * A firefly's glow over its own cycle: on, fading out in steps, dark, back on.
 * Stepped rather than smooth so it reads like pixel-art blinking.
 */
export function fireflyAlpha(msIntoCycle: number, onMs: number, offMs: number): number {
  const t = ((msIntoCycle % (onMs + offMs)) + onMs + offMs) % (onMs + offMs);
  if (t < onMs) return 1;
  const fade = (t - onMs) / Math.min(400, offMs);
  if (fade < 1 / 3) return 0.6;
  if (fade < 2 / 3) return 0.3;
  return 0;
}

/** A falling leaf `ageMs` after it let go: how far it has drifted and dropped, whether it has landed, and its alpha. */
export function leafFall(ageMs: number, drop: number): { dx: number; dy: number; landed: boolean; alpha: number } {
  const fallMs = (drop / 7) * 1000;
  const t = Math.min(ageMs, fallMs);
  const dx = Math.round((t / 1000) * 3 + Math.sin(t / 420) * 3);
  const dy = Math.round((t / 1000) * 7);
  if (ageMs < fallMs) return { dx, dy, landed: false, alpha: 1 };
  const resting = ageMs - fallMs;
  const alpha = resting < 1500 ? 1 : resting < 1900 ? 0.6 : resting < 2300 ? 0.3 : 0;
  return { dx, dy, landed: true, alpha };
}

/** The fish-jump sprite's frame at `ageMs`, or null once the ripple has closed. */
export const FISH_FRAME_MS = 140;
export function fishFrame(ageMs: number, frames: number): number | null {
  const i = Math.floor(ageMs / FISH_FRAME_MS);
  return i < frames ? i : null;
}
