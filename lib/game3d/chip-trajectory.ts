/**
 * Closed-form chip flight: an eased horizontal glide under a parabolic arc,
 * finished with a damped bounce at the landing spot.
 *
 * Every sample is a pure function of elapsed time — there is no integrator
 * and no per-frame feedback. That is deliberate: the 2D room's spray physics
 * once fed the *drawn* (arc-inflated) position back into its stepper and the
 * chips hovered forever, holding the render loop awake. A time-parametric
 * curve cannot reproduce that bug, and it terminates exactly, so the frame
 * loop always goes back to sleep.
 *
 * No Math.random anywhere — landing scatter is a deterministic index wave,
 * the same contract chipSettleJitter follows in lib/scene.
 */

import { CHIP } from "./dimensions";
import type { Vec3 } from "./seat-layout";

/** Main launch-to-landing time for one chip. */
export const FLIGHT_MS = 480;
/** Damped bounce time appended after landing. */
export const BOUNCE_MS = 280;
/** Per-chip launch stagger inside one bet, for the poured-out look. */
export const STAGGER_MS = 45;
/** Peak arc height above the straight line between endpoints. */
export const ARC_HEIGHT = 0.5;
/** First-bounce apex; later hops decay from here. */
export const BOUNCE_HEIGHT = 0.05;

/** Total wall time for a flight of `count` staggered chips. */
export function flightDurationMs(count: number): number {
  return FLIGHT_MS + BOUNCE_MS + Math.max(0, count - 1) * STAGGER_MS;
}

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Deterministic landing scatter for the nth chip of a pile. Golden-angle
 * index wave, elliptical (z squashed) so the scatter reads as lying on the
 * tilted felt rather than pasted on a wall.
 */
export function landingOffset(index: number): { dx: number; dz: number } {
  const angle = index * 2.39996; // golden angle in radians
  // Derived from the chip rather than a literal. Scatter is only ever read
  // relative to the discs it separates, so chips resized to a real 39mm
  // must not keep a spread tuned when they were two and a half times
  // bigger — the same pile would land strewn halfway across the felt.
  const radius = CHIP.radius * 0.92 * Math.sqrt(index);
  return {
    dx: Math.sin(angle) * radius,
    dz: Math.cos(angle) * radius * 0.6,
  };
}

/**
 * Per-chip settle jitter for the nth chip of a RESTING pile. Deliberately
 * smaller than a landing scatter and unequal by axis (depth squashed
 * against width) so a column reads as one pile — the same unequal-axes
 * lesson the 2D room's chipSettleJitter carries.
 *
 * Lives here, not in chip-stack.tsx, because the InstancedMesh chip layer
 * (chip-instance-model.ts) needs the identical numbers from a three.js-free
 * call site — two renderers computing "the same pile" must never be able to
 * drift into two different jitters for the same chip.
 */
export function pileChipJitter(index: number, seed: number): { dx: number; dz: number } {
  const wave = landingOffset(index + seed);
  return { dx: wave.dx * 0.35, dz: wave.dz * 0.2 };
}

/** Per-chip spin, so eight moulded inserts never line up into a seam down a pile. */
export function pileChipRotationY(index: number, seed: number): number {
  return ((index + seed) * 0.73) % Math.PI;
}

export interface ChipFlightSample {
  position: Vec3;
  /** True from the first sample at or past touchdown (bounce may continue). */
  landed: boolean;
  /** True once the bounce has fully settled; the chip can join its pile. */
  done: boolean;
}

/**
 * Sample one chip's pose `elapsedMs` after the flight group launched.
 * `index` staggers this chip's own start inside the group.
 */
export function sampleChipFlight(
  from: Vec3,
  to: Vec3,
  elapsedMs: number,
  index: number
): ChipFlightSample {
  const local = elapsedMs - index * STAGGER_MS;

  if (local <= 0) {
    return { position: { ...from }, landed: false, done: false };
  }

  if (local < FLIGHT_MS) {
    // Launch: ease-out horizontal travel (fast leave, soft arrive) with the
    // arc applied on the eased parameter, so the rise is quicker than the
    // fall — the "tossed" read, not a ballistic simulation.
    const eased = easeOutCubic(local / FLIGHT_MS);
    return {
      position: {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased + ARC_HEIGHT * 4 * eased * (1 - eased),
        z: from.z + (to.z - from.z) * eased,
      },
      landed: false,
      done: false,
    };
  }

  const bounceT = (local - FLIGHT_MS) / BOUNCE_MS;
  if (bounceT < 1) {
    // Two decaying hops: |sin| rectifies the wave into bounces, the
    // exponential shrinks each one.
    const lift =
      BOUNCE_HEIGHT * Math.exp(-3.4 * bounceT) * Math.abs(Math.sin(Math.PI * 2 * bounceT));
    return {
      position: { x: to.x, y: to.y + lift, z: to.z },
      landed: true,
      done: false,
    };
  }

  return { position: { ...to }, landed: true, done: true };
}
