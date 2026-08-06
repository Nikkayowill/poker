/**
 * How a chip moves, and what colour it is.
 *
 * The motion is a friction slide: every frame a chip closes a fixed fraction
 * of whatever distance is left, on all three axes at once, plus an arc on Y
 * that lifts it off the felt and sets it back down. That is a deliberately
 * different curve from a tween -- it starts fast and never quite stops, which
 * is what a pushed stack of clay actually does on cloth, and it means a chip
 * needs no duration, no easing table and no keyframes to be told about. It
 * only needs to know where it is going.
 *
 * Pure, and in `lib/` rather than beside the renderer, because this is the
 * arithmetic the whole felt's timing rests on and `vitest.config.ts` only
 * collects `lib/` and `app/`.
 */

import type { Vec3 } from "./scene-config";
import { POT_CHIP_DENOMINATIONS_BB, potChipStacks } from "@/lib/game/pot-chips";

/**
 * The fraction of the remaining distance a chip closes per frame *at 60fps*.
 *
 * The qualifier is the whole point. `position += (target - position) * 0.075`
 * written straight into a render loop is frame-rate dependent: the same chip
 * takes twice as long to arrive on a phone rendering at 30fps as on a desktop
 * at 60, and the entire celebration budget below would be wrong on exactly
 * the hardware this scene is built to run on. `lerpFactorForDelta` converts
 * this into a per-frame factor for the frame actually being drawn, so the
 * curve is identical at any refresh rate -- see the note there.
 */
export const CHIP_LERP_PER_FRAME = 0.075;

/** The frame this constant was tuned against. */
export const REFERENCE_FRAME_MS = 1000 / 60;

/** How high a chip lifts off the felt at the midpoint of its slide. */
export const CHIP_ARC_PEAK = 1.5;

/** Close enough to the target to stop animating and be parked exactly on it. */
export const CHIP_SETTLE_EPSILON = 0.01;

/**
 * The two sprays, and their staggers.
 *
 * The staggers are carried over unchanged from the CSS system these replaced
 * -- a bet leaves its chips 20ms apart, a won pot returns 34ms apart; tuned
 * against the felt, and a change of renderer was no reason to retune them.
 *
 * The counts changed meaning: they used to be how many chips *every* spray
 * had, and are now the fallback (bets) and the ceiling (funnel) around a
 * count derived from the actual amount -- see the spray functions below.
 * FUNNEL_CHIP_COUNT must stay the funnel's hard cap, because the celebration
 * budget proof in chip-physics.test.ts solves the worst case from it: a
 * larger spray at the same stagger would still be leaving the pot when the
 * next hand is dealt.
 */
export const BET_CHIP_COUNT = 3;
export const BET_CHIP_STAGGER_MS = 20;
export const FUNNEL_CHIP_COUNT = 12;
export const FUNNEL_CHIP_STAGGER_MS = 34;

/**
 * The most chips a single bet pushes in.
 *
 * A bet has no next-hand deadline the way the funnel does, so this cap is
 * about legibility rather than a clock: past ten discs a spray reads as a
 * particle effect, not a bet, and the pile it joins is already capped at
 * what the eye can count. Ten is enough for the breakdown itself to carry
 * the signal -- a call is one chip, a raise a few, a shove a heavy spray
 * topped with the black hundreds.
 */
export const BET_SPRAY_MAX_CHIPS = 10;

/**
 * Frame-rate-independent form of CHIP_LERP_PER_FRAME.
 *
 * Retaining `1 - factor` of the distance every reference frame means
 * retaining `(1 - factor) ^ (dt / reference)` over an arbitrary one. Solving
 * that for the equivalent single-step factor is the expression below, and it
 * collapses to exactly CHIP_LERP_PER_FRAME when dt is one 60fps frame.
 *
 * The delta is clamped before use by the caller: a backgrounded tab hands
 * back a delta of several seconds on its first frame, which would teleport
 * every chip in flight onto its target at once.
 */
export function lerpFactorForDelta(deltaMs: number, perFrame = CHIP_LERP_PER_FRAME): number {
  if (deltaMs <= 0) return 0;
  return 1 - Math.pow(1 - perFrame, deltaMs / REFERENCE_FRAME_MS);
}

/** One axis of the slide. */
export function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

/** Straight-line distance, used to decide when a chip has arrived. */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * How far through its journey a chip is, from 0 at the origin to 1 on the
 * target.
 *
 * A friction slide has no clock, so progress has to be read off the geometry:
 * it is how much of the original gap has been closed. This is what drives the
 * arc, and it is why the arc works without anyone having to know how long the
 * flight takes.
 */
export function flightProgress(current: Vec3, target: Vec3, originalDistance: number): number {
  if (originalDistance <= 0) return 1;
  const remaining = distance(current, target);
  return Math.min(1, Math.max(0, 1 - remaining / originalDistance));
}

/**
 * The lift, at a given progress.
 *
 * A half-sine: zero at both ends, CHIP_ARC_PEAK in the middle. Zero at both
 * ends matters more than the shape -- it means the arc adds nothing to the
 * chip's resting height, so a chip that has landed is exactly on the felt
 * rather than a hair above it, with no special case to park it.
 */
export function arcHeight(progress: number, peak = CHIP_ARC_PEAK): number {
  return Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) * peak;
}

/**
 * Advance one chip by one frame.
 *
 * Returns the new position and whether it has arrived. The Y axis is lerped
 * toward the target like the other two and *then* has the arc added on top,
 * rather than the arc replacing it: the base Y still has to travel from the
 * seat's felt height to the pot's, and a chip whose Y was pure arc would drop
 * through the table on a table that was not perfectly flat.
 *
 * `arcPeak` is per-flight because the splash style throws its chips on a
 * taller parabola than the default slide arc; everything else keeps the
 * default.
 */
export function stepChip(
  current: Vec3,
  target: Vec3,
  originalDistance: number,
  deltaMs: number,
  perFrame = CHIP_LERP_PER_FRAME,
  arcPeak = CHIP_ARC_PEAK,
): { position: Vec3; base: Vec3; progress: number; arrived: boolean } {
  const factor = lerpFactorForDelta(deltaMs, perFrame);
  const base: Vec3 = {
    x: lerp(current.x, target.x, factor),
    y: lerp(current.y, target.y, factor),
    z: lerp(current.z, target.z, factor),
  };
  const progress = flightProgress(base, target, originalDistance);
  const arrived = distance(base, target) <= CHIP_SETTLE_EPSILON;
  return {
    position: arrived ? { ...target } : { ...base, y: base.y + arcHeight(progress, arcPeak) },
    base,
    progress,
    arrived,
  };
}

/**
 * Cubic ease-out: fast off the line, a heavy stop. `1 - (1 - t)^3`, clamped,
 * so a glide can be driven straight off its own clock with no easing table.
 */
export function cubicEaseOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/**
 * The neat slide's stepper: a clocked glide, where `stepChip` above is a
 * clockless friction slide. The distinction is the whole feature — a bet
 * pushed as one rigid pillar must move as one body, and ten chips easing
 * over the same fixed duration stay perfectly aligned where ten asymptotic
 * slides would shear apart near the target. Driven by elapsed time rather
 * than per-frame deltas, it is frame-rate independent by construction, and
 * it *terminates*: at the duration the chip is parked exactly on target,
 * so the render loop always gets to sleep.
 */
export function stepGlideChip(
  from: Vec3,
  target: Vec3,
  elapsedMs: number,
  durationMs: number,
): { position: Vec3; progress: number; arrived: boolean } {
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, elapsedMs / durationMs)) : 1;
  if (progress >= 1) return { position: { ...target }, progress: 1, arrived: true };
  const eased = cubicEaseOut(progress);
  return {
    position: {
      x: lerp(from.x, target.x, eased),
      y: lerp(from.y, target.y, eased),
      z: lerp(from.z, target.z, eased),
    },
    progress,
    arrived: false,
  };
}

/**
 * How long a slide takes, in milliseconds, to close all but `epsilon` of a
 * gap of `startDistance`.
 *
 * A friction slide is asymptotic, so this is a derived quantity rather than a
 * declared one -- which is exactly why it needs a function. The winner
 * celebration has a hard budget (`NEXT_HAND_DELAY_MS`), and the only honest
 * way to check a keyframe-less animation against it is to solve for the frame
 * count: retaining `(1 - factor)` per frame, the gap falls below epsilon
 * after `log(epsilon / start) / log(1 - factor)` frames.
 */
export function flightDurationMs(
  startDistance: number,
  epsilon = CHIP_SETTLE_EPSILON,
  perFrame = CHIP_LERP_PER_FRAME,
): number {
  if (startDistance <= epsilon) return 0;
  const frames = Math.log(epsilon / startDistance) / Math.log(1 - perFrame);
  return frames * REFERENCE_FRAME_MS;
}

/**
 * The casino colours, keyed to the same denominations `lib/game/pot-chips.ts`
 * breaks a pot into.
 *
 * The hexes are carried over verbatim from the `.chip-denom-*` classes this
 * replaced, so the felt did not change palette when it changed renderer.
 * `core` is the bright inlay disc on the chip's face and `accent` the edge
 * wedges -- the same three-part anatomy the CSS chip face had, now painted
 * into a canvas texture (see `components/table/scene/chip-texture.ts`) rather
 * than stacked as background-image layers.
 */
export interface ChipPalette {
  base: number;
  accent: number;
  core: number;
}

export const CHIP_PALETTE: Record<number, ChipPalette> = {
  1: { base: 0xe9e4d4, accent: 0x2f67a8, core: 0xf7f2e4 },
  5: { base: 0xbe3538, accent: 0xf1e9d8, core: 0xf7f2e4 },
  25: { base: 0x24704a, accent: 0xeef2e6, core: 0xf7f2e4 },
  100: { base: 0x1d1e1f, accent: 0xd6c77f, core: 0xefe4bd },
};

/** The palette for a denomination, falling back to the smallest chip. */
export function chipPalette(denomination: number): ChipPalette {
  return CHIP_PALETTE[denomination] ?? CHIP_PALETTE[1];
}

/**
 * A palette colour, pushed toward white (positive) or black (negative) by
 * `amount` in [-1, 1]. This is how the painter derives a chip's bevel
 * highlight and edge shade from its one base colour instead of the palette
 * having to triple in size — the palette stays the four hexes that have now
 * survived two renderer changes, and the lighting is arithmetic on top.
 */
export function shadeHex(color: number, amount: number): number {
  const clamped = Math.min(1, Math.max(-1, amount));
  const toward = clamped >= 0 ? 255 : 0;
  const mix = (channel: number) => Math.round(channel + (toward - channel) * Math.abs(clamped));
  return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff);
}

/**
 * The denomination a decorative chip should wear.
 *
 * The two sprays do not carry real denominations -- a bet of 40 is not "three
 * chips" of anything in particular -- but drawing them in a fifth, made-up
 * colour would put two chip systems on one felt. Cycling the four real ones
 * keeps every disc in the room drawn from the same set.
 */
export function decorativeDenomination(index: number): number {
  return POT_CHIP_DENOMINATIONS_BB[index % POT_CHIP_DENOMINATIONS_BB.length];
}

/**
 * The chips an amount is worth, as a flight plan.
 *
 * This is what makes a spray *mean* its number: the same greedy breakdown
 * `potChipStacks` uses for the pile, flattened into individual chips. Both
 * ends of a bet therefore agree -- the chips that fly in are denominated
 * exactly as the pile they land in, and a payout leaves as the money it is.
 *
 * Truncation keeps the *largest* chips: the breakdown lists denominations
 * descending, so cutting the tail drops singles before it ever drops a
 * hundred, which is the cut a dealer would make. The returned order is
 * smallest-first, because that is the order the chips should *leave* in --
 * the big denominations land last and end up on top, where they read.
 *
 * Empty only when the inputs are (amount or big blind zero, negative, or not
 * finite); any positive amount yields at least one chip, exactly as the pile
 * does. Callers fall back to the old decorative spray on empty rather than
 * showing nothing, so a malformed snapshot degrades to the previous
 * behaviour instead of a silent bet.
 */
export function sprayDenominations(amount: number, bigBlind: number, maxChips: number): number[] {
  const chips: number[] = [];
  for (const stack of potChipStacks(amount, bigBlind)) {
    for (let index = 0; index < stack.count && chips.length < maxChips; index += 1) {
      chips.push(stack.denomination);
    }
  }
  return chips.reverse();
}

/** A bet's spray: the amount actually committed, capped for legibility. */
export function betSprayDenominations(amount: number, bigBlind: number): number[] {
  return sprayDenominations(amount, bigBlind, BET_SPRAY_MAX_CHIPS);
}

/**
 * A winner's payout spray: the amount actually won -- each winner of a split
 * pot flies their own share, not an equal-looking dozen. Capped at
 * FUNNEL_CHIP_COUNT because the celebration budget is solved from that
 * worst case; see the constant's note.
 */
export function funnelSprayDenominations(amount: number, bigBlind: number): number[] {
  return sprayDenominations(amount, bigBlind, FUNNEL_CHIP_COUNT);
}

/**
 * A stable scatter for a chip's landing spot, in world units.
 *
 * The 3D descendant of `potChipSettleJitter`, and deterministic for the same
 * reason that one was: the pile is rebuilt from the pot on every snapshot, so
 * a chip that has already settled must be handed the identical offset again
 * or it twitches every time anybody bets. Seeded from the chip's own identity
 * rather than a counter so it survives a pile being rebuilt in a different
 * order.
 *
 * The two axes are deliberately unequal. An x offset only shifts a chip
 * sideways; a z offset moves it *up or down the screen* by z·TILT_SIN,
 * directly against the stack's own pitch of CHIP_THICKNESS·TILT_COS. At the
 * old ±0.09 the depth scatter was ~90% of a pitch, so two neighbours in one
 * column could sit almost two pitches apart on screen — chips visibly
 * detached from the chip they rest on. The z step is sized so a column's
 * whole depth range stays well under one pitch (a test pins the invariant);
 * x keeps a larger wobble, which is where a real stack's raggedness lives.
 */
export function chipSettleJitter(denomination: number, index: number): { x: number; z: number } {
  const seed = denomination * 7 + index * 13;
  return {
    x: ((seed % 5) - 2) * 0.03,
    z: (((seed * 3) % 5) - 2) * 0.012,
  };
}
