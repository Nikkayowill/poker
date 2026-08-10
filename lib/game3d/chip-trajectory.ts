/**
 * Closed-form chip motion for the 3D room: where a chip rests inside a pile,
 * and where it is part-way through a dealer's push.
 *
 * Every sample is a pure function of elapsed time — there is no integrator
 * and no per-frame feedback. That is deliberate: the 2D room's spray physics
 * once fed the *drawn* (arc-inflated) position back into its stepper and the
 * chips hovered forever, holding the render loop awake. A time-parametric
 * curve cannot reproduce that bug, and it terminates exactly, so the frame
 * loop always goes back to sleep.
 *
 * No Math.random anywhere — pile jitter is a deterministic index wave, the
 * same contract chipSettleJitter follows in lib/scene.
 *
 * WHAT REPLACED THE SPRAY, AND WHY. Chips used to be thrown at a *point*
 * and scattered around it by a golden-angle wave whose radius grew as
 * sqrt(index) — a funnel. Two things were wrong with it and both were
 * visible: a group of chips aimed at one spot has no stack to land in, so
 * they piled up by `index % 3` at scattered offsets and read as chips
 * lying inside one another; and the same wave doubled as a resting pile's
 * "jitter", where the sqrt growth meant a pile seeded 101 offset its discs
 * by three and a half chip radii — a strewn heap, not a stack. A chip now
 * has ONE destination, the exact slot it will occupy in the pile it is
 * joining (see chip-instance-model.ts's `pileSlot`), and pile jitter is
 * bounded to a fraction of a chip radius, which is how far a real hand-
 * stacked column is out of true.
 */

import { CHIP } from "./dimensions";
import type { Vec3 } from "./seat-layout";

/** Golden angle, in radians — the index wave every deterministic offset here
 * is phased by, so consecutive chips never line up. */
const GOLDEN_ANGLE = 2.39996;

/**
 * THE one definition of stack spacing: the nth chip of a pile whose base
 * sits at `baseY` rests exactly `CHIP.thickness / 2 + n * CHIP.thickness`
 * above it — half a chip to lift the first disc's centre off the cloth,
 * then flush discs after it.
 *
 * Stated once and imported, rather than written out at each of the three
 * places that need it (a resting pile, a flight's landing target, a test),
 * because "flush" is an invariant a re-derivation can silently break by a
 * half thickness and nothing but a render would notice.
 */
export function chipStackY(baseY: number, index: number): number {
  return baseY + CHIP.thickness / 2 + index * CHIP.thickness;
}

/**
 * How far out of true a hand-stacked column sits, as a fraction of a chip's
 * radius. Deliberately small and CONSTANT — see the header for the sqrt-
 * growth version this replaced. At 6% a 39 mm chip is out by ~1.2 mm, which
 * is what a real pushed stack looks like; anything approaching a radius
 * perches each disc off the edge of the one below it, which is exactly the
 * "chips overlap or appear inside each other" read.
 */
export const PILE_JITTER_FRACTION = 0.06;

/**
 * Per-chip settle jitter for the nth chip of a resting pile. Bounded (see
 * above) and unequal by axis — depth squashed against width — so a column
 * reads as one pile, the same unequal-axes lesson the 2D room's
 * chipSettleJitter carries.
 *
 * Lives here, not in a component, because the InstancedMesh chip layer
 * (chip-instance-model.ts) needs the identical numbers from a three.js-free
 * call site: a chip in flight is aimed at the very slot this function will
 * place it in once it rests, and two derivations of "the same slot" that
 * agree only by luck put a landing a visible step away from its own pile.
 */
export function pileChipJitter(index: number, seed: number): { dx: number; dz: number } {
  const angle = (index + seed) * GOLDEN_ANGLE;
  const radius = CHIP.radius * PILE_JITTER_FRACTION;
  return { dx: Math.sin(angle) * radius, dz: Math.cos(angle) * radius * 0.6 };
}

/** Per-chip spin, so eight moulded inserts never line up into a seam down a pile. */
export function pileChipRotationY(index: number, seed: number): number {
  return ((index + seed) * 0.73) % Math.PI;
}

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * The shape of one chip's push: how long it travels, how far behind the
 * chip ahead of it it leaves, how high it clears the cloth, and how hard it
 * rocks when it lands. lib/game3d/chip-push.ts holds the table of styles and
 * the mapping from a seat's `lastAction` to one of them.
 */
export interface PushStyle {
  /** One chip's launch-to-touchdown glide. */
  travelMs: number;
  /** Gap between consecutive chips' launches — the domino cadence. */
  staggerMs: number;
  /** Peak height above the straight line between the endpoints. Low: this
   * is a chip being pushed across cloth, not lobbed. */
  arcHeight: number;
  /** Rock-and-settle time appended after touchdown. */
  settleMs: number;
  /** Peak landing tilt, radians. */
  tiltRad: number;
}

/** Total wall time for a push of `count` staggered chips. */
export function pushDurationMs(count: number, style: PushStyle): number {
  if (count <= 0) return 0;
  return style.travelMs + style.settleMs + (count - 1) * style.staggerMs;
}

export interface ChipPushSample {
  position: Vec3;
  /** Landing tilt, decomposed onto the two ground axes. Both are exactly 0
   * once the chip has settled — a resting chip is flat. */
  tiltX: number;
  tiltZ: number;
  /** True from the first sample at or past touchdown (the rock may continue). */
  landed: boolean;
  /** True once the chip is flat at its target and can be handed to its pile. */
  done: boolean;
}

const SETTLED: Omit<ChipPushSample, "position"> = {
  tiltX: 0,
  tiltZ: 0,
  landed: true,
  done: true,
};

/**
 * Sample one chip's pose `elapsedMs` after the group launched. `index` is
 * both this chip's place in the launch order (its stagger) and its place in
 * the destination stack — the caller has already resolved `to` to that
 * exact slot, which is why nothing here scatters.
 *
 * `reducedMotion` lands the chip immediately, at the identical position it
 * would have reached by travelling. A player who has asked their OS for
 * less motion gets the state change, not the choreography — and because the
 * destination is explicit rather than integrated, "no animation" and "the
 * animation finished" are the same coordinates, not merely similar ones.
 */
export function sampleChipPush(
  from: Vec3,
  to: Vec3,
  elapsedMs: number,
  index: number,
  style: PushStyle,
  reducedMotion = false,
): ChipPushSample {
  if (reducedMotion) return { position: { ...to }, ...SETTLED };

  const local = elapsedMs - index * style.staggerMs;

  if (local <= 0) {
    return { position: { ...from }, tiltX: 0, tiltZ: 0, landed: false, done: false };
  }

  if (local < style.travelMs) {
    // Ease-out travel (firm leave, soft arrive — a push, not a throw) with
    // the arc applied on the eased parameter, so the rise is quicker than
    // the fall.
    const eased = easeOutCubic(local / style.travelMs);
    return {
      position: {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased + style.arcHeight * 4 * eased * (1 - eased),
        z: from.z + (to.z - from.z) * eased,
      },
      tiltX: 0,
      tiltZ: 0,
      landed: false,
      done: false,
    };
  }

  const settleT = (local - style.travelMs) / style.settleMs;
  if (settleT < 1) {
    // A rocking chip, not a bouncing one: the disc touches down on its
    // leading edge and rolls flat. `(1 - t)^2` reaches exactly 0 at the end
    // of the window, so the chip is provably flat the instant it is done —
    // an exponential decay would only ever be nearly flat, and "nearly"
    // is what keeps a demand loop awake.
    const angle = style.tiltRad * (1 - settleT) ** 2 * Math.cos(Math.PI * 3 * settleT);
    // Tip about the axis across the direction of travel, so the chip rocks
    // over its leading edge rather than in some fixed world direction.
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const travel = Math.hypot(dx, dz);
    const ax = travel > 1e-9 ? -dz / travel : 0;
    const az = travel > 1e-9 ? dx / travel : 0;
    return {
      // A tilted disc rests on its rim, so its centre rides slightly higher
      // than flush. Small-angle: radius * sin(angle) ~ radius * angle.
      position: { x: to.x, y: to.y + CHIP.radius * Math.abs(angle), z: to.z },
      tiltX: angle * ax,
      tiltZ: angle * az,
      landed: true,
      done: false,
    };
  }

  return { position: { ...to }, ...SETTLED };
}
