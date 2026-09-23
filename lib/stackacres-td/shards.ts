/**
 * The chips one swing knocks off a tree or rock: a few of its own pixels,
 * flung out and then drawn into the farmer. When the thing comes down it is
 * the arcade orb instead (./orb-burst.ts); this is the small beat before that.
 *
 * A chip is thrown out from the middle of what was hit, hangs a moment, then
 * flies to him along a curve, shrinking and warming as it arrives, nearest
 * first so they reach him as a stream.
 *
 * Pure and renderer-free: components/arcade/stackacres-td/orb-burst.ts
 * samples the pixels and draws what this answers.
 */

export interface ShardPoint {
  readonly x: number;
  readonly y: number;
}

export interface Shard {
  /** Where the pixel was in the thing that broke. */
  readonly from: ShardPoint;
  /** Where the throw leaves it, before it heads for him. */
  readonly out: ShardPoint;
  /** When, in ms after the burst, it sets off toward him. */
  readonly leaveMs: number;
  /** Which way its flight bows, and how far, in map pixels. */
  readonly bow: number;
  /** A phase for its drift while it hangs. */
  readonly drift: number;
  readonly colour: number;
}

export interface ShardFrame {
  readonly x: number;
  readonly y: number;
  /** 1 as thrown, smaller as it is drawn in. */
  readonly size: number;
  /** 0 as thrown, 1 on arrival: how far it has warmed toward the glow. */
  readonly glow: number;
  readonly arrived: boolean;
}

/** How long the throw takes. */
export const THROW_MS = 240;
/** The shortest hang before the first shard leaves. */
export const HANG_MS = 120;
/** From the first shard leaving to the last. */
export const STREAM_MS = 320;
/** One shard's flight to him. */
export const FLY_MS = 360;
/** The whole burst, throw to the last arrival. */
export const BURST_MS = THROW_MS + HANG_MS + STREAM_MS + FLY_MS;

export interface ShardSource {
  readonly x: number;
  readonly y: number;
  readonly colour: number;
}

/**
 * Shards for a set of pixels. `centre` is the middle of what broke, `toward`
 * is where the farmer is as it breaks (only used to order the stream), and
 * `force` is how hard it comes apart: 1 for a tree coming down, less for the
 * chips a single swing knocks off. `random` is injectable for the tests.
 */
export function makeShards(
  pixels: readonly ShardSource[],
  centre: ShardPoint,
  toward: ShardPoint,
  force: number,
  random: () => number = Math.random,
): Shard[] {
  // Thrown about as far as the thing was big: a tree's pieces fly wider than a rock's.
  let radius = 0;
  for (const pixel of pixels) radius = Math.max(radius, Math.hypot(pixel.x - centre.x, pixel.y - centre.y));
  const spread = (6 + 0.7 * radius) * (0.4 + 0.6 * force);
  const ranked = pixels
    .map((pixel) => ({ pixel, d: Math.hypot(pixel.x - toward.x, pixel.y - toward.y) }))
    .sort((a, b) => a.d - b.d);
  const count = ranked.length;
  return ranked.map(({ pixel }, rank) => {
    let dx = pixel.x - centre.x;
    let dy = pixel.y - centre.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    const push = spread * (0.45 + 0.55 * random());
    const angle = (random() - 0.5) * 0.9;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      from: { x: pixel.x, y: pixel.y },
      // Thrown outward and a little up, the way a chip leaves a trunk.
      out: {
        x: pixel.x + (dx * cos - dy * sin) * push,
        y: pixel.y + (dx * sin + dy * cos) * push - 6 * force * random(),
      },
      leaveMs: THROW_MS + HANG_MS + (count > 1 ? (rank / (count - 1)) * STREAM_MS : 0),
      bow: (random() < 0.5 ? -1 : 1) * (4 + 10 * random()),
      drift: random() * Math.PI * 2,
      colour: pixel.colour,
    };
  });
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInCubic = (t: number): number => t * t * t;

/** Where one shard is `ms` into the burst, flying to `target` (his chest, read live). */
export function shardAt(shard: Shard, ms: number, target: ShardPoint): ShardFrame {
  if (ms <= THROW_MS) {
    const e = easeOutCubic(Math.max(0, ms) / THROW_MS);
    return {
      x: shard.from.x + (shard.out.x - shard.from.x) * e,
      y: shard.from.y + (shard.out.y - shard.from.y) * e,
      size: 1,
      glow: 0,
      arrived: false,
    };
  }
  if (ms < shard.leaveMs) {
    const t = (ms - THROW_MS) / 1000;
    return {
      x: shard.out.x + Math.sin(shard.drift + t * 7) * 0.6,
      y: shard.out.y + Math.cos(shard.drift + t * 5) * 0.6,
      size: 1,
      glow: Math.min(0.3, t * 1.2),
      arrived: false,
    };
  }
  const u = Math.min(1, (ms - shard.leaveMs) / FLY_MS);
  const e = easeInCubic(u);
  const dx = target.x - shard.out.x;
  const dy = target.y - shard.out.y;
  const length = Math.hypot(dx, dy) || 1;
  const bow = Math.sin(Math.PI * u) * shard.bow;
  return {
    x: shard.out.x + dx * e + (-dy / length) * bow,
    y: shard.out.y + dy * e + (dx / length) * bow,
    size: 1 - 0.6 * u,
    glow: 0.3 + 0.7 * u,
    arrived: u >= 1,
  };
}

/**
 * How far apart the sampled pixels sit, so a big tree and a small rock both
 * come apart into about `max` pieces. Assumes a bit over half the picture's
 * box is opaque, which holds for the trees and rocks on the map.
 */
export function shardGrid(width: number, height: number, max: number): number {
  let step = 1;
  while (Math.ceil(width / step) * Math.ceil(height / step) * 0.55 > max) step += 1;
  return step;
}
