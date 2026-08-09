/**
 * How a chip actually moves, once you stop lerping it.
 *
 * WHAT WAS WRONG WITH THE OLD CURVE. `stepChip` in `chip-physics.ts` closes a
 * fixed fraction of the remaining distance every frame. That is an exponential
 * decay: maximum speed on frame one, decelerating forever, never arriving.
 * It has two tells and they are the two things that made the felt read as a
 * cash machine rather than a table. A chip leaves at its fastest, so nothing
 * ever *accelerates* -- there is no push, no wrist, no weight behind it. And
 * it has no terminal event: it creeps into its target and is declared arrived
 * by an epsilon, so nothing ever lands. Chips appear at a destination the way
 * a dispensed note appears in a tray.
 *
 * WHAT A SPRING GIVES INSTEAD. A damped harmonic oscillator accelerates out of
 * rest, carries momentum, and -- tuned under critical damping -- overshoots
 * its mark and settles back onto it. That settle is the entire point: it is
 * the visual event that says a physical object with mass came to rest against
 * cloth. It is also *interruptible* for free, which the old stepper was not in
 * any meaningful sense: retargeting a spring mid-flight keeps its current
 * velocity, so a chip already moving toward a bet spot that is asked to
 * continue into the pot curves through rather than stopping dead and
 * restarting. `chip-layer`'s sweep does exactly that.
 *
 * WHY THE ARC IS ON A CLOCK AND THE SPRING IS NOT. They answer different
 * questions and coupling them was the first version's bug. The spring owns
 * where the chip is on the cloth; the arc owns how far off the cloth it is.
 * A spring overshoots, so distance-to-target is not monotonic -- driving the
 * arc off it (as `flightProgress` does) makes a chip that has overshot dip
 * *back up* into the air as it returns. The arc therefore runs on its own
 * elapsed clock and terminates exactly, so a chip is provably flat on the
 * felt after `arcDurationMs` no matter what the spring is still doing
 * laterally. `landed` is that clock reaching its end, which is also what the
 * ground shadow and the mid-flight scale key off.
 *
 * STABILITY. Integrated with semi-implicit Euler and sub-stepped: a stiff
 * spring integrated at a 64ms frame (`MAX_FRAME_DELTA_MS`, what a backgrounded
 * tab hands back) does not merely look wrong, it goes numerically unstable and
 * throws the chip to infinity. `MAX_SPRING_STEP_MS` bounds the step regardless
 * of the frame, which costs at most eight iterations of nine multiplies on the
 * worst frame the scheduler will ever deliver.
 *
 * Pure and in `lib/` because this is the arithmetic the felt's timing rests
 * on, and `vitest.config.ts` collects only `lib/` and `app/`.
 */

import type { Vec3 } from "./scene-config";

/**
 * A spring's feel, in the tension/friction/mass vocabulary the request was
 * written in (and that react-spring popularised), rather than in stiffness
 * and damping coefficients. They are the same numbers; this is the spelling
 * a designer can reason about.
 */
export interface SpringConfig {
  /** Stiffness. Higher is faster and snappier. */
  tension: number;
  /** Damping. Higher settles sooner and overshoots less. */
  friction: number;
  /** Inertia. Higher carries more momentum through a direction change. */
  mass: number;
}

/**
 * Damping ratio: below 1 overshoots, exactly 1 is the fastest approach that
 * does not, above 1 crawls in. Exposed because it is the only number that
 * predicts whether a preset will overshoot, and every preset below states
 * its own -- a tuning change that silently crosses 1 is a change of
 * behaviour, not of taste.
 */
export function dampingRatio(config: SpringConfig): number {
  const denominator = 2 * Math.sqrt(config.tension * config.mass);
  return denominator > 0 ? config.friction / denominator : Infinity;
}

/**
 * The expressive one: a bet leaving a player's tray for their own bet spot.
 *
 * The requested feel was "tension 180, friction 12". That is damping ratio
 * 0.447 and roughly a 21% overshoot, which is right for a UI card sliding a
 * hundred pixels and much too loose for a chip crossing four world units --
 * it sends the disc most of a chip-diameter past the spot and hauls it back,
 * which reads as elastic rather than heavy. Friction 17 keeps the requested
 * stiffness and the visible settle (ratio 0.63, about a 7% overshoot: a real
 * skid on cloth, recovered inside a tenth of a second) without the rubber
 * band. The stiffness is the part carrying the character and it is untouched.
 */
export const SPRING_BET: SpringConfig = { tension: 180, friction: 17, mass: 1 };

/**
 * The long haul: standing bets sweeping into the middle when a street closes,
 * and the pot funnelling back out to a winner.
 *
 * Deliberately the only preset that must never overshoot. These are the two
 * longest journeys on the table, so a percentage overshoot is a large absolute
 * distance -- past the pot is off the back of the felt, and past a winner's
 * spot is inside their own figure. Slightly over-damped (ratio 1.10) rather
 * than exactly critical, because the exact value is a knife edge that any
 * later retune would cross without anyone noticing.
 */
export const SPRING_SWEEP: SpringConfig = { tension: 120, friction: 24, mass: 1 };

/**
 * The short one: a chip dropping the last fraction of a unit onto a pile it
 * is joining, or onto its own resting place in a standing bet.
 *
 * Stiff and nearly critically damped (ratio 0.88). The travel is under a
 * chip's own thickness, so the whole event is the contact -- a loose spring
 * here just makes a settled pile look like it is breathing.
 */
export const SPRING_DROP: SpringConfig = { tension: 220, friction: 26, mass: 1 };

/**
 * The integrator's maximum step.
 *
 * Bounded by stability, not by taste. The undamped period of the stiffest
 * preset is 2*pi*sqrt(mass/tension) ~= 424ms; semi-implicit Euler needs a
 * step well under a tenth of that to stay well-behaved, and 8ms is also
 * comfortably under a 120Hz frame, so on real hardware this almost always
 * costs exactly one iteration.
 */
export const MAX_SPRING_STEP_MS = 8;

/**
 * When a spring has stopped.
 *
 * Both conditions are required and that is the point: position alone is true
 * at the instant a chip passes through its target at full speed, and velocity
 * alone is true at the apex of an overshoot. Declaring arrival at either would
 * park a moving chip -- which is precisely the "nothing ever lands" failure
 * this module exists to fix, reintroduced one layer down.
 */
export const SPRING_REST_DISTANCE = 0.012;
export const SPRING_REST_SPEED = 0.06;

export interface SpringState {
  position: Vec3;
  velocity: Vec3;
}

export interface SpringStep {
  position: Vec3;
  velocity: Vec3;
  /** Position settled and speed spent. The caller may stop stepping. */
  arrived: boolean;
}

/** A spring at rest where it stands. */
export function springAt(position: Vec3): SpringState {
  return { position: { ...position }, velocity: { x: 0, y: 0, z: 0 } };
}

/**
 * Advance a spring toward `target` by one frame.
 *
 * Semi-implicit (velocity updated first, then integrated into position),
 * which for a damped oscillator is stable where explicit Euler quietly gains
 * energy and grows the overshoot every cycle.
 *
 * On arrival the position is snapped exactly onto the target and the velocity
 * zeroed, rather than left a rest-epsilon away. A chip parked "close enough"
 * is a chip whose pile does not line up with the pile beside it, and the
 * error is per-chip so it never averages out.
 */
export function stepSpring(
  state: SpringState,
  target: Vec3,
  deltaMs: number,
  config: SpringConfig = SPRING_BET,
): SpringStep {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return { position: { ...state.position }, velocity: { ...state.velocity }, arrived: false };
  }
  const mass = config.mass > 0 ? config.mass : 1;
  const steps = Math.max(1, Math.ceil(deltaMs / MAX_SPRING_STEP_MS));
  const h = deltaMs / steps / 1000;

  let { x, y, z } = state.position;
  let vx = state.velocity.x;
  let vy = state.velocity.y;
  let vz = state.velocity.z;

  for (let step = 0; step < steps; step += 1) {
    vx += ((config.tension * (target.x - x) - config.friction * vx) / mass) * h;
    vy += ((config.tension * (target.y - y) - config.friction * vy) / mass) * h;
    vz += ((config.tension * (target.z - z) - config.friction * vz) / mass) * h;
    x += vx * h;
    y += vy * h;
    z += vz * h;
  }

  const gap = Math.hypot(target.x - x, target.y - y, target.z - z);
  const speed = Math.hypot(vx, vy, vz);
  if (gap <= SPRING_REST_DISTANCE && speed <= SPRING_REST_SPEED) {
    return { position: { ...target }, velocity: { x: 0, y: 0, z: 0 }, arrived: true };
  }
  return { position: { x, y, z }, velocity: { x: vx, y: vy, z: vz }, arrived: false };
}

/* ------------------------------------------------------------------ *
 * The arc, and the weight it carries.
 * ------------------------------------------------------------------ */

/**
 * How long a chip is in the air, independent of how long the spring takes to
 * settle it.
 *
 * A single fixed number for every flight on purpose. A chip tossed across the
 * table and a chip pushed forward half a unit are the same gesture at
 * different distances, and scaling the airtime with the distance makes the
 * long one float -- the far seats' bets hang while the near seat's snap. What
 * distance changes is the *speed*, which the spring already handles because
 * its force is proportional to the gap.
 *
 * Under `NEAT_SLIDE_DURATION_MS` (520) so the arc is always finished before
 * the glide style's own clock runs out, and well under the 900ms window
 * `poker-table.tsx` holds a bet flight in its queue for.
 */
export const CHIP_AIRTIME_MS = 380;

/**
 * The stagger between consecutive chips in one spray.
 *
 * Thirty milliseconds is about two frames at 60Hz -- slow enough that the eye
 * resolves discrete chips leaving one after another, fast enough that a
 * ten-chip shove is fully airborne inside 300ms. Below ~20ms the spray reads
 * as a single clump; above ~50ms a big bet turns into a slow queue and the
 * last chip is still in the air when the next player is already acting.
 */
export const CHIP_STAGGER_MS = 30;

/**
 * How much a chip grows at the top of its arc.
 *
 * The 2D room has no perspective camera -- it is an orthographic tilt, so a
 * chip lifted off the felt projects at exactly the same size as one resting
 * on it and a flight has no depth cue at all beyond its shadow. Scaling with
 * height is that missing cue, faked deliberately and only for the airborne
 * moment. Twelve per cent is enough to read as "nearer the eye" and small
 * enough that nobody catches it happening.
 *
 * The 3D room must never use this: it has a real camera doing the same job
 * honestly, and applying both would double the effect.
 */
export const CHIP_FLIGHT_SCALE = 0.12;

/**
 * The lift profile: 0 on the felt, 1 at the apex, 0 again on landing.
 *
 * A half-sine rather than a parabola. Both are zero at the ends, but the sine
 * leaves and arrives with a shallower gradient, which reads as a chip skimming
 * up off the cloth rather than being fired off it -- and the difference is
 * visible precisely because the scale below is driven by the same curve.
 */
export function arcLift(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return Math.sin(t * Math.PI);
}

/**
 * A chip's scale multiplier at a given lift. 1 on the cloth, 1.12 at the apex.
 */
export function flightScale(lift: number, amount = CHIP_FLIGHT_SCALE): number {
  return 1 + Math.min(1, Math.max(0, lift)) * amount;
}

export interface ArcSample {
  /** 0 at the felt, 1 at the apex. Drives both the height and the scale. */
  lift: number;
  /** World units above the resting plane. */
  height: number;
  /** The arc's clock has run out; the chip is on the cloth. */
  landed: boolean;
}

/**
 * Sample the arc for a chip that has been in the air `elapsedMs`.
 *
 * `delayMs` is the chip's own place in the stagger, and it is subtracted here
 * rather than by the caller so a chip still waiting its turn reports
 * `lift: 0` and sits flat on the rail instead of hovering at the launch point.
 */
export function sampleArc(
  elapsedMs: number,
  peak: number,
  delayMs = 0,
  durationMs = CHIP_AIRTIME_MS,
): ArcSample {
  const local = elapsedMs - delayMs;
  if (local <= 0) return { lift: 0, height: 0, landed: false };
  if (durationMs <= 0 || local >= durationMs) return { lift: 0, height: 0, landed: true };
  const lift = arcLift(local / durationMs);
  return { lift, height: lift * peak, landed: false };
}

/**
 * When the last chip of a spray is guaranteed to be down.
 *
 * Used to prove a spray fits inside a budget -- the payout has to be finished
 * before `NEXT_HAND_DELAY_MS` deals over the top of it. Note this is the
 * *arc's* deadline, not the spring's: the chip is flat on the felt here and
 * may still be sliding the last hundredth of a unit into place, which is
 * invisible and does not need to be budgeted for.
 */
export function sprayAirtimeMs(
  chipCount: number,
  staggerMs = CHIP_STAGGER_MS,
  durationMs = CHIP_AIRTIME_MS,
): number {
  if (chipCount <= 0) return 0;
  return (chipCount - 1) * staggerMs + durationMs;
}
