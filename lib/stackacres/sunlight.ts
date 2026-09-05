/**
 * The farm's sunlight: shafts of light leaning across the screen, and the
 * flecks of gold that catch on the ground under them.
 *
 * Pure and tested, for the same reason ./ambience-plan.ts is: the thing that
 * turns this into pixels (`stackacres-scene.ts`) can only be judged by eye,
 * so every decision that can be made as data is made here, where it can be
 * asserted. The scene owns textures and blend modes; it owns no opinions
 * about how bright a sunbeam is allowed to get.
 *
 * TWO BUDGETS, and they are the whole reason this file exists as data rather
 * than as a handful of magic numbers inside the scene:
 *
 *   `GOD_RAY_MAX_ALPHA` (0.08) is a CEILING, not a setting. A god-ray layer
 *   is drawn additively over the entire viewport, so it is the one effect on
 *   this map that can wash the art out everywhere at once -- and the art is
 *   flat three-tone vector work whose whole legibility rests on the tones
 *   staying distinct. Above about a tenth the lit and turned planes of every
 *   material start converging. `godRayAlpha` clamps to it rather than
 *   trusting its own arithmetic, so no later retune of the breathing curve
 *   can quietly raise the ceiling.
 *
 *   `SPARKLE_MAX` (15) is a HARD POOL SIZE, not a spawn rate. The scene
 *   allocates exactly this many sprites once, at boot, and recycles them
 *   forever; `sparkleField` never returns more, so a frame can never allocate
 *   a game object and the effect costs the same on the last minute of a
 *   session as on the first. Fifteen is also an aesthetic number, not just a
 *   cheap one -- ground glitter reads as weather at this density and as a
 *   particle system above it.
 *
 * Neither effect knows what the player owns, what time it is, or where they
 * are standing. That is deliberate: this is weather.
 */

import { stepParticlePool } from "./particle-pool";
import { clamp01, type WorldRect } from "./world";

/* ------------------------------------------------------------------ */
/* God rays                                                            */
/* ------------------------------------------------------------------ */

/**
 * The hard ceiling on the ray layer's opacity. Nothing in this module or in
 * the scene may draw the rays above this, and `godRayAlpha` clamps rather
 * than assumes.
 */
export const GOD_RAY_MAX_ALPHA = 0.08;

/** The floor of the breathing curve. The rays never go fully out -- a layer
 *  that vanishes and returns reads as a bug; one that only ever thickens and
 *  thins reads as cloud. */
export const GOD_RAY_MIN_ALPHA = 0.035;

/** How long one breath takes, ms. Deliberately far longer than any animation
 *  on this map: a sunbeam that visibly pulses is a strobe. */
export const GOD_RAY_PERIOD_MS = 19_000;

/** The lean of the shafts, radians clockwise from straight down. Matches the
 *  upper-left key light every painter in art-palette.ts is drawn against, so
 *  the beams fall the way the art is already shaded. */
export const GOD_RAY_TILT = 0.42;

/**
 * One shaft, in SCREEN-FRACTION space: `centre` and `width` are fractions of
 * the viewport's width, so the same table renders correctly on a phone held
 * landscape and on a desktop window without the scene rescaling anything.
 *
 * `weight` is a fraction of whatever alpha `godRayAlpha` returns for the
 * frame, which is what keeps the ceiling meaningful: the brightest shaft is
 * weight 1 and every other one is dimmer, so no combination of these can
 * exceed the budget above.
 */
export interface GodRayBeam {
  centre: number;
  width: number;
  weight: number;
}

/**
 * The shafts, once. Uneven on purpose -- evenly spaced beams of equal width
 * read as a printed pattern, and the two narrow ones exist to break up the
 * three wide ones rather than to be seen in their own right.
 *
 * Frozen and module-level rather than computed per call: the scene bakes
 * these into one texture at boot and never asks again.
 */
export const GOD_RAY_BEAMS: readonly GodRayBeam[] = Object.freeze([
  { centre: 0.08, width: 0.13, weight: 0.72 },
  { centre: 0.26, width: 0.05, weight: 0.45 },
  { centre: 0.44, width: 0.17, weight: 1 },
  { centre: 0.66, width: 0.06, weight: 0.5 },
  { centre: 0.84, width: 0.15, weight: 0.83 },
]);

/**
 * The ray layer's opacity at a moment, breathing between the floor and the
 * ceiling on a slow sine.
 *
 * Clamped on the way out, unconditionally. The clamp is not defensive
 * paranoia about the sine -- it is the contract: whatever anyone later does
 * to the curve, the layer cannot wash the farm out.
 */
export function godRayAlpha(timeMs: number): number {
  if (!Number.isFinite(timeMs)) return GOD_RAY_MIN_ALPHA;
  const phase = (timeMs % GOD_RAY_PERIOD_MS) / GOD_RAY_PERIOD_MS;
  const swell = (Math.sin(phase * Math.PI * 2) + 1) / 2;
  const alpha = GOD_RAY_MIN_ALPHA + swell * (GOD_RAY_MAX_ALPHA - GOD_RAY_MIN_ALPHA);
  return Math.min(GOD_RAY_MAX_ALPHA, Math.max(0, alpha));
}

/* ------------------------------------------------------------------ */
/* Ground sparkles                                                     */
/* ------------------------------------------------------------------ */

/** The pool size. See this file's own header: a ceiling on live objects, not
 *  a spawn rate, and the scene allocates exactly this many once. */
export const SPARKLE_MAX = 15;

/** How long one fleck lives, ms. Rolled per fleck between the two so the
 *  field never falls into step with itself. */
export const SPARKLE_MIN_LIFE_MS = 1_100;
export const SPARKLE_MAX_LIFE_MS = 2_400;

/** The widest a fleck gets, in world units, at the peak of its life. */
export const SPARKLE_SIZE = 3.2;

/** One live fleck. Plain data: the scene owns the sprite this drives. */
export interface Sparkle {
  x: number;
  y: number;
  /** 0 at birth, rising to `lifeMs`. */
  ageMs: number;
  lifeMs: number;
  /** How fast it drifts upward in world units per second. Barely at all --
   *  a fleck of light on grass sits on the grass; it does not rise. */
  driftY: number;
  /** Rotation offset so fifteen identical diamonds do not all face the same
   *  way. Radians. */
  spin: number;
}

/**
 * A fleck somewhere inside a rectangle of ground.
 *
 * Takes its own random source rather than reaching for Math.random, the same
 * posture `rollGapMs` in ./ambience-plan.ts takes and for the same reason:
 * the scene already threads a seeded generator through every other scatter it
 * does, and a test needs to be able to pin this one.
 */
export function spawnSparkle(area: WorldRect, random: () => number): Sparkle {
  return {
    x: area.x + random() * area.width,
    y: area.y + random() * area.height,
    ageMs: 0,
    lifeMs: SPARKLE_MIN_LIFE_MS + random() * (SPARKLE_MAX_LIFE_MS - SPARKLE_MIN_LIFE_MS),
    driftY: -2 - random() * 3,
    spin: random() * Math.PI,
  };
}

/**
 * One frame of a fleck's life. Returns null once it is spent, which the scene
 * reads as "this pool slot is free" rather than as "draw nothing".
 */
export function stepSparkle(sparkle: Sparkle, deltaMs: number): Sparkle | null {
  const step = Math.min(Math.max(deltaMs, 0), 64);
  const ageMs = sparkle.ageMs + step;
  if (ageMs >= sparkle.lifeMs) return null;
  return { ...sparkle, ageMs, y: sparkle.y + (sparkle.driftY * step) / 1000 };
}

/**
 * A fleck's opacity, 0..1: up fast, down slow.
 *
 * The asymmetry is the whole effect. A symmetric fade reads as a blinking
 * light; a fast rise and a long tail reads as something catching the sun for
 * a moment and losing it.
 */
export function sparkleAlpha(sparkle: Sparkle): number {
  const t = clamp01(sparkle.lifeMs > 0 ? sparkle.ageMs / sparkle.lifeMs : 1);
  return t < 0.22 ? t / 0.22 : 1 - (t - 0.22) / 0.78;
}

/** A fleck's size in world units. Peaks a touch before its opacity does, so
 *  it is already at full size while it is still brightening. */
export function sparkleScale(sparkle: Sparkle): number {
  const t = clamp01(sparkle.lifeMs > 0 ? sparkle.ageMs / sparkle.lifeMs : 1);
  return SPARKLE_SIZE * (0.45 + 0.55 * Math.sin(Math.min(1, t * 1.25) * Math.PI));
}

/**
 * One frame of the whole field: age everything, drop what is spent, and
 * refill the free slots from `area`.
 *
 * Refilling every free slot every frame rather than on a timer is what keeps
 * the density constant. The count cannot exceed `SPARKLE_MAX` by
 * construction -- the loop refills up to a fixed ceiling, and the scene's
 * pool is that same size -- so this is also the guarantee the header
 * promises, held in one place rather than trusted to each caller.
 */
export function sparkleField(
  live: readonly Sparkle[],
  area: WorldRect,
  deltaMs: number,
  random: () => number,
): Sparkle[] {
  return stepParticlePool(
    live,
    SPARKLE_MAX,
    (sparkle) => stepSparkle(sparkle, deltaMs),
    () => spawnSparkle(area, random),
  );
}

