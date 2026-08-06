/**
 * The two ways a bet's chips can travel, and the pure maths behind the one
 * that scatters.
 *
 * "neat_slide" pushes the whole bet as one rigid pillar — the tight,
 * casino-regular gesture of a player cutting out a stack and sliding it
 * over the line. "splash_chunk" throws the chips in on staggered parabolas
 * that bloom into a scattered cluster — splashing the pot. Both are pure
 * client presentation over the same server-validated amounts: nothing in
 * here touches what a bet *is*, only how its chips move.
 *
 * In `lib/` rather than beside the renderer because `vitest.config.ts`
 * collects only `lib/` and `app/`, and every formula here is exactly the
 * kind that must stay deterministic — the scatter is seeded from each
 * chip's index, never `Math.random()`, for the same reason
 * `chipSettleJitter` is: a pile rebuilt from a snapshot must hand every
 * settled chip its identical spot, and a seeded test must see the same
 * flight twice.
 */

export type BetAnimationStyle = "neat_slide" | "splash_chunk";

export const BET_STYLES: readonly BetAnimationStyle[] = ["neat_slide", "splash_chunk"];

/**
 * Splash is the default because it is the continuity choice: the spray this
 * system replaces already staggered its chips in on arcs with a settle
 * jitter, so an existing player sees a richer version of the gesture they
 * know, and the neat slide is the opt-in.
 */
export const DEFAULT_BET_STYLE: BetAnimationStyle = "splash_chunk";

/** Same `stackchips:` namespace as the sound and music preferences. */
export const BET_STYLE_STORAGE_KEY = "stackchips:bet-style";

/** A stored or wire value, coerced to a real style. Anything else is the default. */
export function normalizeBetStyle(value: unknown): BetAnimationStyle {
  return BET_STYLES.includes(value as BetAnimationStyle)
    ? (value as BetAnimationStyle)
    : DEFAULT_BET_STYLE;
}

/** The next style in the cycle, for a single menu entry that toggles through. */
export function nextBetStyle(style: BetAnimationStyle): BetAnimationStyle {
  const index = BET_STYLES.indexOf(style);
  return BET_STYLES[(index + 1) % BET_STYLES.length];
}

/**
 * How long a neat slide takes, start to parked. A fixed clock rather than
 * the friction slide's asymptote because the pillar must move as one body:
 * ten chips easing over the same duration stay perfectly aligned, where ten
 * friction slides from staggered heights would shear. Well under the 900ms
 * the parent keeps a flight event queued, so a slide is always finished
 * before its event is recycled.
 */
export const NEAT_SLIDE_DURATION_MS = 520;

/**
 * The splash's parabola, in world units. Taller than the ordinary slide arc
 * (CHIP_ARC_PEAK, 1.5): a splashed chip is thrown, not pushed, and the
 * extra height is what the decoupled ground shadow reads against.
 */
export const SPLASH_ARC_PEAK = 2.2;

/** How far from the bet spot a splashed chip may land, in world units. */
export const SPLASH_SCATTER_RADIUS = 0.55;

/**
 * Where a splashed chip lands relative to the bet spot — the trigonometric
 * index wave. `sin(index)`/`cos(index)` walk the circle in ~57° steps, so
 * ten chips cluster organically without two sharing a spot, and the whole
 * pattern is a pure function of each chip's index: re-running the same bet
 * lands the same cluster, frame for frame, which is what keeps the canvas
 * from vibrating and the test suite deterministic.
 *
 * The in-cluster reach cycles through four deterministic steps so the
 * cluster reads as a pile rather than a necklace of chips all at one
 * radius.
 *
 * Plan-space is deliberately *round*: the depth compression that makes the
 * landing cluster elliptical on screen (the spec's 0.62 factor) is exactly
 * `TILT_SIN` (sin 38° ≈ 0.616), and `project()` already applies it to
 * every ground-plane offset. Compressing Z here as well would squash the
 * cluster twice.
 */
export function splashScatterOffset(
  index: number,
  radius = SPLASH_SCATTER_RADIUS,
): { x: number; z: number } {
  const reach = radius * (0.45 + 0.55 * (((index * 3) % 4) / 3));
  return {
    x: Math.sin(index) * reach,
    z: Math.cos(index) * reach,
  };
}
