/**
 * The payout half of the arcade's coin animation: the same spinning gold
 * ring the page-change orb shows while a page loads (lib/loading/
 * orb-transition.ts, drawn with lib/loading/coin-sprites.ts's art), except
 * instead of gathering back to the middle and fading, its coins peel off one
 * at a time and fly to wherever the header's Gold badge actually sits.
 *
 * A payout used to get its own custom particle "orb" -- a different look
 * from the one players already see between pages. This reuses the exact
 * ring: same coin count's neighbourhood, same orbit/spin speed, same tilt,
 * so a win reads as "that Gold, arriving" rather than a second, unrelated
 * effect.
 *
 * Pure and renderer-free -- components/celebration/win-celebration.tsx
 * samples nothing and draws whatever this answers on a plain 2D canvas.
 */

import { clamp01, easeOutBack, easeOutCubic } from "@/lib/loading/orb-transition";

/** Coins rise into the ring, one after another -- matches the page-change
 * orb's own ENTER_MS so the ring forms at the same pace. */
export const RING_ENTER_MS = 420;
/** The ring holds and turns before any coin leaves. */
export const RING_HOLD_MS = 380;
/** Fewer than the page-change orb's 8 -- a payout is a small accent, not
 * the same spectacle as a full page load. */
export const COIN_COUNT = 6;
/** Between one coin leaving and the next -- long enough that each departure
 * reads as its own event ("one at a time"), short enough that the whole
 * ring empties as one continuous stream rather than eight separate waits. */
export const COIN_STAGGER_MS = 130;
/** One coin's flight to the balance. */
export const COIN_FLY_MS = 380;

const RING_ENTER_STAGGER = 0.45;
const HOLD_AT = RING_ENTER_MS + RING_HOLD_MS;
/** From the win landing to the last coin reaching the balance. */
export const WIN_COINS_MS = HOLD_AT + (COIN_COUNT - 1) * COIN_STAGGER_MS + COIN_FLY_MS;

/** Radians/sec the ring turns and each coin flips -- the page-change orb's
 * own speeds, so a payout's ring moves exactly like the one between pages. */
const ORBIT_SPEED = 1.1;
const SPIN_SPEED = 6.5;
/** How flat the ring sits: 1 is face-on, 0 is edge-on. */
const RING_TILT = 0.36;
const TAU = Math.PI * 2;

export interface CoinRing {
  readonly centre: { readonly x: number; readonly y: number };
  readonly radius: number;
  /** Each coin's place in the release order: 0 leaves first -- whichever
   * coin sits nearest the live target the moment the ring finishes forming. */
  readonly order: readonly number[];
  /** Each coin's ring position frozen at the instant it leaves, so its
   * flight interpolates from a fixed point rather than chasing a still-
   * orbiting position every frame. */
  readonly launch: readonly { readonly x: number; readonly y: number }[];
}

export interface CoinFrame {
  readonly x: number;
  readonly y: number;
  /** 1 at full size. */
  readonly scale: number;
  /** 0-1. */
  readonly alpha: number;
  /** Radians -- feed straight into drawCoin's own flip angle. */
  readonly angle: number;
  /** -1 (far side of the ring) to 1 (near side): draw far-to-near for a
   * correct ring, same as the page-change orb's own depth sort. */
  readonly depth: number;
  readonly landed: boolean;
}

function ringPoint(centre: { x: number; y: number }, radius: number, index: number, ms: number) {
  const t = ms / 1000;
  const theta = t * ORBIT_SPEED + (index / COIN_COUNT) * TAU;
  const depth = Math.sin(theta);
  const bob = Math.sin(t * 3 + index * 0.9) * radius * 0.036;
  return { x: centre.x + Math.cos(theta) * radius, y: centre.y + depth * radius * RING_TILT + bob, depth };
}

/** A ring over `centre`, whose coins fly to `toward` (the live target) once formed, nearest first. */
export function makeCoinRing(centre: { x: number; y: number }, radius: number, toward: { x: number; y: number }): CoinRing {
  const launch = Array.from({ length: COIN_COUNT }, (_, i) => ringPoint(centre, radius, i, HOLD_AT));
  const byDistance = launch
    .map((point, i) => ({ i, d: Math.hypot(point.x - toward.x, point.y - toward.y) }))
    .sort((a, b) => a.d - b.d);
  const order: number[] = new Array(COIN_COUNT);
  byDistance.forEach(({ i }, rank) => (order[i] = rank));
  return { centre: { x: centre.x, y: centre.y }, radius, order, launch };
}

function staggeredEnter(ms: number, index: number): number {
  const start = (index / COIN_COUNT) * RING_ENTER_STAGGER * RING_ENTER_MS;
  return clamp01((ms - start) / (RING_ENTER_MS * (1 - RING_ENTER_STAGGER)));
}

/** Where coin `index` is at `ms`, its flight (once released) aimed at the live `target`. */
export function coinFrameAt(ring: CoinRing, index: number, ms: number, target: { x: number; y: number }): CoinFrame {
  const t = ms / 1000;
  const angle = t * SPIN_SPEED + (index / COIN_COUNT) * TAU;

  if (ms < RING_ENTER_MS) {
    const k = easeOutBack(staggeredEnter(ms, index));
    const spread = 0.3 + 0.7 * k;
    const theta = t * ORBIT_SPEED + (index / COIN_COUNT) * TAU;
    const depth = Math.sin(theta);
    const bob = Math.sin(t * 3 + index * 0.9) * ring.radius * 0.036;
    return {
      x: ring.centre.x + Math.cos(theta) * ring.radius * spread,
      y: ring.centre.y + depth * ring.radius * RING_TILT * spread + bob,
      scale: Math.max(0, k),
      alpha: Math.min(1, k * 1.6),
      angle,
      depth,
      landed: false,
    };
  }

  const leaveAt = HOLD_AT + ring.order[index] * COIN_STAGGER_MS;
  if (ms < leaveAt) {
    const point = ringPoint(ring.centre, ring.radius, index, ms);
    return { x: point.x, y: point.y, scale: 1, alpha: 1, angle, depth: point.depth, landed: false };
  }

  const u = clamp01((ms - leaveAt) / COIN_FLY_MS);
  // Cubic ease-out: the coin leaves with the speed it already had orbiting
  // and glides into the badge rather than accelerating into it. The arc's
  // lift rides the same eased value as the position, not raw time, so the
  // whole flight reads as one continuous motion.
  const e = easeOutCubic(u);
  const launch = ring.launch[index];
  const x = launch.x + (target.x - launch.x) * e;
  const y = launch.y + (target.y - launch.y) * e - ring.radius * 0.55 * Math.sin(Math.PI * e);
  const scale = 1 - 0.85 * e;
  // Flattens out of its spin on the way in rather than staying a blur.
  const flightAngle = t * SPIN_SPEED * (1 - 0.5 * e) + (index / COIN_COUNT) * TAU;
  return { x, y, scale, alpha: u >= 1 ? 0 : 1, angle: flightAngle, depth: 1, landed: u >= 1 };
}

/** How many coins have reached the target by `ms`. */
export function coinsLanded(ring: CoinRing, ms: number): number {
  let landed = 0;
  for (let i = 0; i < COIN_COUNT; i++) if (ms >= HOLD_AT + ring.order[i] * COIN_STAGGER_MS + COIN_FLY_MS) landed += 1;
  return landed;
}
