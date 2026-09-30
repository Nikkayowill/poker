/**
 * What a felled tree or a broken rock leaves on the ground, and how it gets to
 * the farmer.
 *
 * A tree tips over away from him, lands, and breaks into three chunks of wood
 * where it lay. A rock or a bush just breaks where it stood. Each chunk pops
 * out, bounces twice and settles, the way Stardew drops its debris. When he
 * comes within two tiles it flies into him, speeding up as it goes. What it is
 * worth was paid by the server when the thing came down, so a chunk is never
 * lost: one he walks away from comes to him anyway after a while.
 *
 * Pure and renderer-free, same split as ./hoe.ts and ./pull.ts. Numbers are
 * art pixels (one per map unit, 16 to a tile) and ms.
 */

export interface Point {
  x: number;
  y: number;
}

/** -1 falls to the left, 1 to the right. */
export type FallSide = -1 | 1;

/** How long a tree takes to tip from standing to lying flat. Stardew's is near
 *  two seconds; on a phone, between two swings, that is a long wait. */
export const FELL_MS = 720;

/**
 * A tree falls away from whoever cut it: to the left when he stands to its
 * right, and the other way. Straight above or below it, it falls to the right.
 */
export function fallSide(farmerX: number, trunkX: number): FallSide {
  return farmerX > trunkX + 2 ? -1 : 1;
}

/** Its lean, in radians, `t` from 0 (standing) to 1 (flat). It starts slow and
 *  gathers speed, so it creaks over and then crashes. */
export function fallAngle(t: number, side: FallSide): number {
  const k = Math.max(0, Math.min(1, t));
  return side * (Math.PI / 2) * k * k;
}

export type ChunkKind = "wood" | "stone";

/** How many chunks each thing breaks into. */
export const CHUNKS_PER_BREAK: Readonly<Record<"tree" | "scrub" | "rock", number>> = {
  tree: 3,
  scrub: 2,
  rock: 3,
};

/**
 * Where each chunk comes to rest, from the base of what broke. A felled tree's
 * lie along the trunk on the side it fell; anything else scatters round where
 * it stood. All within two tiles of the base.
 */
export function chunkRests(count: number, fell: FallSide | null): Point[] {
  const rests: Point[] = [];
  for (let i = 0; i < count; i++) {
    if (fell !== null) {
      rests.push({ x: fell * (9 + i * 9), y: i % 2 === 0 ? 3 : -1 });
    } else {
      const angle = -Math.PI / 2 + ((i + 0.5) / count) * Math.PI * 2;
      rests.push({ x: Math.round(Math.cos(angle) * 11), y: Math.round(Math.sin(angle) * 5) + 3 });
    }
  }
  return rests;
}

/** The hop out and the two bounces: how long each takes and how high it goes.
 *  Each bounce keeps two thirds of the speed, so four ninths of the height. */
export const HOPS: readonly { ms: number; height: number }[] = [
  { ms: 320, height: 9 },
  { ms: 200, height: 4 },
  { ms: 130, height: 1.8 },
];

/** From the pop to lying still. */
export const SETTLE_MS = HOPS.reduce((sum, hop) => sum + hop.ms, 0);

/** A chunk can't be drawn in until it has landed and lain still a beat, so
 *  every drop is seen even when he is standing right beside it. */
export const MAGNET_DELAY_MS = SETTLE_MS + 250;

/** Stagger between one chunk's pop and the next. */
export const CHUNK_STAGGER_MS = 70;

/**
 * Where a chunk is `ms` after it popped out, from `from` (where it broke off)
 * to `rest`. It crosses the ground on the first hop and bounces in place after.
 */
export function chunkAt(from: Point, rest: Point, ms: number): { ground: Point; lift: number } {
  const first = HOPS[0].ms;
  const k = Math.max(0, Math.min(1, ms / first));
  const ground = { x: from.x + (rest.x - from.x) * k, y: from.y + (rest.y - from.y) * k };
  let start = 0;
  for (const hop of HOPS) {
    if (ms < start + hop.ms) {
      const t = (ms - start) / hop.ms;
      return { ground, lift: 4 * hop.height * t * (1 - t) };
    }
    start += hop.ms;
  }
  return { ground, lift: 0 };
}

/** He draws a chunk in from this far, on either axis: two tiles, like Stardew. */
export const MAGNET_REACH = 32;



/** Past this, a chunk he has walked away from comes to him anyway. It is his already. */
export const CHUNK_WAIT_MS = 15_000;

/** How fast a drawn-in chunk gathers speed, and its top speed, per second. */
export const MAGNET_ACCEL = 720;
export const MAGNET_TOP_SPEED = 150;

/** Within this of his middle it is his. */
export const COLLECT_RADIUS = 4;

/** Whether he is near enough to draw a chunk in. */
export function inMagnetReach(chunk: Point, farmer: Point): boolean {
  return Math.abs(chunk.x - farmer.x) <= MAGNET_REACH && Math.abs(chunk.y - farmer.y) <= MAGNET_REACH;
}

export interface Flight {
  at: Point;
  speed: number;
}

/**
 * One frame of a chunk flying at him: straight at where he is now, a little
 * faster every frame, up to its top speed. `arrived` once it reaches him.
 */
export function flyToward(flight: Flight, target: Point, dtMs: number): Flight & { arrived: boolean } {
  const dt = Math.max(0, dtMs) / 1000;
  const speed = Math.min(MAGNET_TOP_SPEED, flight.speed + MAGNET_ACCEL * dt);
  const dx = target.x - flight.at.x;
  const dy = target.y - flight.at.y;
  const distance = Math.hypot(dx, dy);
  const step = speed * dt;
  if (distance <= Math.max(COLLECT_RADIUS, step)) return { at: { ...target }, speed, arrived: true };
  return { at: { x: flight.at.x + (dx / distance) * step, y: flight.at.y + (dy / distance) * step }, speed, arrived: false };
}
