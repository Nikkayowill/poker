/**
 * How a chip moves: the curve, the arc over the cloth, the landing, and how
 * long each of them is allowed to take.
 *
 * THE CURVE IS AN ANALYTIC SPRING ON A CLOCK, and both halves of that phrase
 * are load-bearing.
 *
 * A spring, because the two curves this replaces could not communicate weight
 * and it is worth naming why. A per-frame friction slide (`p += (target - p) *
 * k`) is an exponential decay: maximum speed on the first frame, decelerating
 * forever, never arriving. Nothing accelerates, so there is no wrist behind
 * it; nothing lands, so a chip appears at its destination the way a note
 * appears in a cash machine's tray. A cubic ease-out has the same first
 * problem — it also leaves at its fastest. A damped oscillator starts from
 * rest, accelerates under the force, carries momentum past the mark and
 * settles back onto it, and that settle is the whole illusion: it is the
 * visual event that says an object with mass came to rest against cloth.
 *
 * On a clock, because the render loop has to be able to sleep. This scene
 * sleeps when nothing is moving (`render-scheduler.ts`) and that is what keeps
 * an idle table off the battery. A numerically-integrated spring is
 * asymptotic — it never reaches its target, so it can only be *declared*
 * arrived by an epsilon, which is the same "nothing ever lands" failure one
 * layer down, plus a tail of sub-pixel frames the loop cannot sleep through.
 * The closed form below is evaluated at a normalised time and snapped exactly
 * at t = 1, so a flight of N milliseconds is provably over after N
 * milliseconds. Every preset's residual at t = 1 is under a third of a pixel
 * on the longest journey on the table, so the snap is invisible.
 *
 * The trade is that a chip cannot be retargeted mid-flight with its velocity
 * carried across, which a numerically integrated spring gets for free. Nothing
 * in this system needs that: a chip caught by a street sweep is respawned from
 * where it stands, and starting a fresh flight from rest is what a dealer's
 * hand does to it anyway.
 *
 * Pure, deterministic, and in `lib/` because `vitest.config.ts` collects only
 * `lib/` and `app/`. No clock is read here — elapsed time is always passed in.
 */

import { clamp, type FlightVariance } from "./chip-spec";

/* ------------------------------------------------------------------ *
 * The spring curve.
 * ------------------------------------------------------------------ */

/**
 * A spring's feel, in the two numbers that actually predict what it looks
 * like rather than in stiffness/damping/mass.
 *
 * `overshoot` is exact, not approximate: for the under-damped step response
 * below, the first peak is at 1 + e^(-decay·π/omega), and `omega` is solved
 * from this field so that the peak lands exactly here. A designer asking for
 * "8% past the mark" gets 8% past the mark.
 *
 * `decay` is how many e-foldings of the residual fit inside the duration. It
 * is what buys the exact termination: at decay 7 the chip is within 0.2% of
 * its target when the clock runs out, so the terminal snap moves it a fraction
 * of a pixel.
 */
export interface SpringFeel {
  /** How far past the target the first peak goes, as a fraction of the trip. */
  overshoot: number;
  /** Residual e-foldings over the whole duration. Higher settles harder. */
  decay: number;
}

/** Into a stack: a real skid on cloth, recovered fast. */
export const FEEL_SETTLE: SpringFeel = { overshoot: 0.06, decay: 7.0 };

/**
 * The big gesture. A shove is the one bet at the table that is allowed to look
 * theatrical, so it gets twice the overshoot and the slowest settle.
 */
export const FEEL_THROW: SpringFeel = { overshoot: 0.12, decay: 7.2 };

/**
 * The long hauls — a street sweeping in, a pot going home.
 *
 * Barely any overshoot, and the reason is arithmetic rather than taste: these
 * are the two longest journeys on the table, so a percentage of the trip is a
 * large absolute distance. Six per cent past the pot is off the back of the
 * felt; three per cent is a few pixels, which still reads as a settle.
 */
export const FEEL_PUSH: SpringFeel = { overshoot: 0.03, decay: 8.0 };

/** The last fraction of a unit onto a pile. Almost all contact, no journey. */
export const FEEL_DROP: SpringFeel = { overshoot: 0.05, decay: 7.5 };

/**
 * Where a spring is, `t` of the way through its clock.
 *
 * The step response of a damped harmonic oscillator, normalised so that
 * s(0) = 0, s'(0) = 0 — it starts from rest and accelerates, which is the
 * whole reason it is here — and s(t >= 1) = 1 exactly.
 */
export function springCurve(t: number, feel: SpringFeel = FEEL_SETTLE): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (t >= 1) return 1;
  const overshoot = clamp(feel.overshoot, 0.005, 0.5);
  const decay = clamp(feel.decay, 1, 20);
  // Solved so the first peak is exactly `1 + overshoot`: the peak of this
  // response is at t = pi/omega and equals 1 + e^(-decay*pi/omega).
  const omega = (decay * Math.PI) / -Math.log(overshoot);
  return 1 - Math.exp(-decay * t) * (Math.cos(omega * t) + (decay / omega) * Math.sin(omega * t));
}

/* ------------------------------------------------------------------ *
 * The arc over the cloth.
 * ------------------------------------------------------------------ */

/**
 * How much of a flight's clock the chip spends in the air.
 *
 * Under 1 on purpose. The chip touches down with the trip not quite finished
 * and skids the last few per cent into place, which is what cloth does to a
 * thrown chip — and it means the landing squash and the arrival are separate
 * events the eye can actually see in sequence, rather than one simultaneous
 * pop.
 */
export const ARC_FRACTION = 0.72;

/**
 * The lift profile: 0 on the cloth, 1 at the apex, 0 again on landing.
 *
 * Deliberately asymmetric — the apex sits at 44% of the airtime, so the chip
 * leaves faster than it comes down. A symmetric parabola is what a projectile
 * in a vacuum does; a chip thrown by a hand gets its energy in one push and
 * then falls, and the eye knows the difference even when it cannot name it.
 *
 * Zero at both ends matters more than the shape: it means the arc contributes
 * nothing to a landed chip's height, so a chip that has arrived is exactly on
 * the felt with no special case to park it.
 */
export function arcLift(t: number): number {
  const local = clamp(t, 0, 1) / ARC_FRACTION;
  if (local >= 1) return 0;
  return Math.sin(Math.PI * Math.pow(local, 0.85));
}

/** True once the arc's own clock has run out and the chip is on the cloth. */
export function hasLanded(t: number): boolean {
  return t >= ARC_FRACTION;
}

/* ------------------------------------------------------------------ *
 * Squash and stretch.
 * ------------------------------------------------------------------ */

/** Peak deformation. Four per cent, which is felt rather than seen. */
export const SQUASH_AMOUNT = 0.04;

/** The launch's opposite: a brief vertical stretch as the chip is released. */
export const STRETCH_AMOUNT = 0.02;
const STRETCH_FRACTION = 0.12;

/**
 * How long the landing squash has to play out and recover, for a flight of
 * `durationMs`.
 *
 * DERIVED FROM THE FLIGHT RATHER THAN FIXED, and the first draft got this
 * wrong in a way worth recording. A fixed 110ms squash is longer than the
 * post-landing window of every flight in the timing table — a call lands with
 * 56ms of clock left — so the terminal snap chopped the recovery off partway
 * through and every chip arrived still visibly squashed. Tying it to the
 * window means it always completes exactly as the chip parks, and it scales
 * with the gesture: a shove's impact lasts three times a call's, which is what
 * the extra weight should buy.
 */
export function squashWindowMs(durationMs: number): number {
  return Math.max(0, durationMs) * (1 - ARC_FRACTION);
}

export interface Deformation {
  scaleX: number;
  scaleY: number;
}

const NO_DEFORMATION: Deformation = { scaleX: 1, scaleY: 1 };

/**
 * Squash and stretch, for a chip `t` of the way through its flight.
 *
 * The only depth cue a 2.5D chip has for the vertical axis, and the cheapest
 * one in animation: widen on impact, narrow on release. Because the projection
 * has no perspective on height (the classic room is an orthographic tilt), a
 * chip rising off the cloth would otherwise be pixel-identical to one lying on
 * it, and the whole flight would read as a decal sliding across the felt.
 *
 * Fast in, slow out — the peak lands at about a third of the recovery, which
 * is how a compressed elastic body actually behaves. Exactly 1 at t = 1, so a
 * parked chip is never left deformed.
 */
export function deformation(t: number): Deformation {
  if (!Number.isFinite(t) || t <= 0 || t >= 1) return NO_DEFORMATION;

  if (t < STRETCH_FRACTION) {
    const amp = Math.sin((Math.PI * t) / STRETCH_FRACTION);
    return { scaleX: 1 - STRETCH_AMOUNT * amp, scaleY: 1 + STRETCH_AMOUNT * amp };
  }

  if (t < ARC_FRACTION) return NO_DEFORMATION;
  const p = clamp((t - ARC_FRACTION) / (1 - ARC_FRACTION), 0, 1);
  const amp = Math.sin(Math.PI * Math.pow(p, 0.6));
  return { scaleX: 1 + SQUASH_AMOUNT * amp, scaleY: 1 - SQUASH_AMOUNT * amp };
}

/* ------------------------------------------------------------------ *
 * Per-chip trajectory variation.
 * ------------------------------------------------------------------ */

/**
 * A bump that is zero at both ends of the flight and peaks at the chip's own
 * phase.
 *
 * The phase warp is the same trick `arcLift` uses: raising t to a power that
 * maps the chip's phase onto 0.5 slides the peak without changing either
 * endpoint. Zero at both ends is the requirement — a scattered *trajectory*
 * is the goal, a scattered *landing* is a bug, because the layout has already
 * decided exactly where this chip goes.
 */
function driftEnvelope(t: number, phase: number): number {
  const x = clamp(t, 0, 1);
  if (x <= 0 || x >= 1) return 0;
  const p = clamp(phase, 0.1, 0.9);
  return Math.sin(Math.PI * Math.pow(x, Math.log(0.5) / Math.log(p)));
}

/** This chip's deviation from the straight path, in CSS pixels. */
export function flightDrift(t: number, variance: FlightVariance): { x: number; y: number } {
  const envelope = driftEnvelope(t, variance.driftPhase);
  return { x: variance.driftXPx * envelope, y: variance.driftYPx * envelope };
}

/**
 * This chip's tumble through the air, in radians.
 *
 * Zero at launch and zero at landing, so it hands over cleanly to the resting
 * tilt each chip carries in its stack. A chip that landed still rotated would
 * have to be un-rotated by something, and there is nothing left to do it.
 */
export function flightRoll(t: number, variance: FlightVariance): number {
  return variance.rollRad * Math.sin(Math.PI * clamp(t, 0, 1));
}

/* ------------------------------------------------------------------ *
 * Timings.
 * ------------------------------------------------------------------ */

/**
 * What a chip is doing, which is the only thing that sets how long it takes.
 *
 * Named for the poker action rather than for the distance, deliberately. A
 * call from the far seat and a call from the near seat are the same gesture
 * and should read as the same gesture; what the distance changes is the
 * chip's *speed*, which the spring handles for free because it covers a fixed
 * fraction of whatever gap it is given.
 */
export type ChipMoveKind = "call" | "bet" | "raise" | "all_in" | "sweep" | "payout" | "drop";

export interface MotionProfile {
  /** Launch to parked, in milliseconds. */
  durationMs: number;
  /** Apex of the throw arc, in chip radii. */
  arcPeakRadii: number;
  /** Between one chip of a spray leaving and the next. */
  staggerMs: number;
  feel: SpringFeel;
}

/**
 * The timing table.
 *
 * Poker animations are fast or they are in the way — every one of these is
 * shorter than the gap between two players acting, so the felt is never
 * catching up with the game. The ordering carries the meaning: a call is the
 * quickest thing at the table, a raise takes visibly longer than a call
 * because it is a bigger decision, and a shove is allowed to be a moment.
 *
 * The arc peaks are in chip radii rather than world units so they survive a
 * change of table: the racetrack room's world unit is a different physical
 * length from the classic room's, and an arc measured in chips is the same
 * gesture on both.
 */
export const MOTION: Record<ChipMoveKind, MotionProfile> = {
  call: { durationMs: 200, arcPeakRadii: 1.6, staggerMs: 18, feel: FEEL_SETTLE },
  bet: { durationMs: 250, arcPeakRadii: 2.2, staggerMs: 18, feel: FEEL_SETTLE },
  raise: { durationMs: 300, arcPeakRadii: 2.6, staggerMs: 18, feel: FEEL_SETTLE },
  all_in: { durationMs: 620, arcPeakRadii: 4.0, staggerMs: 26, feel: FEEL_THROW },
  sweep: { durationMs: 350, arcPeakRadii: 3.0, staggerMs: 12, feel: FEEL_PUSH },
  payout: { durationMs: 400, arcPeakRadii: 3.0, staggerMs: 16, feel: FEEL_PUSH },
  // A chip settling onto the pile it is joining travels about its own
  // thickness, so the whole event is the contact. No arc: this is already a
  // vertical move, and arcing it would send the chip up before it came down.
  drop: { durationMs: 180, arcPeakRadii: 0, staggerMs: 14, feel: FEEL_DROP },
};

/**
 * When the last chip of a spray is guaranteed to be parked.
 *
 * Used to prove a spray fits a budget — the payout has to finish before
 * `NEXT_HAND_DELAY_MS` deals over the top of it, which is the sort of thing
 * that is obvious in a spec and invisible in a running game.
 */
export function sprayDurationMs(chipCount: number, profile: MotionProfile): number {
  if (chipCount <= 0) return 0;
  return (chipCount - 1) * profile.staggerMs + profile.durationMs;
}
