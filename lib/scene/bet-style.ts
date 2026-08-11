/**
 * The three ways a bet's chips can travel, and the pure maths behind the two
 * that need any.
 *
 * "stacked_toss" is the house gesture and the default: a prebuilt 2D chip
 * pool travels intact from the player's tray to the betting line, matching
 * PlayPokerGO's container motion and 16-high stack layout. Every chip shares
 * one clock, so the column remains countable throughout the animation.
 *
 * "neat_slide" pushes the whole bet as one rigid pillar — the tight,
 * casino-regular gesture of a player cutting out a stack and sliding it
 * over the line, no stagger and no arc, every chip perfectly aligned the
 * whole way.
 *
 * "splash_chunk" throws the chips in on taller parabolas that bloom into a
 * scattered cluster — splashing the pot.
 *
 * All three are pure client presentation over the same server-validated
 * amounts: nothing in here touches what a bet *is*, only how its chips move.
 *
 * In `lib/` rather than beside the renderer because `vitest.config.ts`
 * collects only `lib/` and `app/`, and every formula here is exactly the
 * kind that must stay deterministic — the scatter and the stack's lean are
 * seeded from each chip's index, never `Math.random()`, for the same reason
 * `chipSettleJitter` is: a pile rebuilt from a snapshot must hand every
 * settled chip its identical spot, and a seeded test must see the same
 * flight twice.
 */

export type BetAnimationStyle = "stacked_toss" | "neat_slide" | "splash_chunk";

export const BET_STYLES: readonly BetAnimationStyle[] = [
  "stacked_toss",
  "neat_slide",
  "splash_chunk",
];

/**
 * The stacked toss is the default.
 *
 * It replaced splash, which held the slot on a continuity argument — the CSS
 * spray it succeeded also scattered, so an existing player saw a richer
 * version of a gesture they already knew. That argument expired when the
 * scatter turned out to be the thing making a bet unreadable: chips landing
 * on a trigonometric spread never form a pile, so the felt could show a
 * player's committed chips but never show *how many*, and at six seats the
 * clusters ran into each other. A stack is legible at a glance and a scatter
 * is not, and legibility beats continuity at a poker table.
 *
 * Splash is still there, one menu entry away, for anyone who preferred it.
 */
export const DEFAULT_BET_STYLE: BetAnimationStyle = "stacked_toss";

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
 * What the table menu prints for each style.
 *
 * Here rather than as a ternary at the call site, which is what it was while
 * there were two styles and which silently mislabels the moment there are
 * three — a `a === x ? "A" : "B"` reads the new third value as B. Same shape
 * as `tableRendererLabel`, and a test walks every style so a fourth cannot
 * be added without a name.
 */
export function betStyleLabel(style: BetAnimationStyle): string {
  switch (style) {
    case "neat_slide": return "Chip style: Neat slide";
    case "splash_chunk": return "Chip style: Splash";
    default: return "Chip style: Stacked toss";
  }
}

/**
 * The lean of chip `index` in a tossed stack, in world units.
 *
 * A hand-built stack is never a perfect cylinder — each chip lands a hair
 * off the one below, and the column leans as it grows. Without this a
 * `stacked_toss` pile is a machined tube, which is the "ATM" read this whole
 * pass exists to remove.
 *
 * Kept far under a chip's radius (0.4) so the column still reads as one
 * stack rather than a slumped mess, and it is the same trigonometric
 * index-wave discipline as `splashScatterOffset` — a pure function of the
 * chip's index, so a re-synced pile hands every settled chip its identical
 * spot.
 */
export const STACK_LEAN_RADIUS = 0.035;

export function stackLeanOffset(
  index: number,
  radius = STACK_LEAN_RADIUS,
): { x: number; z: number } {
  // Growing with the square root of the height, the way a real column drifts:
  // the first few chips sit nearly true and the lean opens up as it gets tall.
  const reach = radius * Math.sqrt(index);
  return {
    x: Math.sin(index * 2.4) * reach,
    z: Math.cos(index * 2.4) * reach,
  };
}

/**
 * How long a neat slide takes, start to parked. A fixed clock rather than
 * the friction slide's asymptote because the pillar must move as one body:
 * ten chips easing over the same duration stay perfectly aligned, where ten
 * friction slides from staggered heights would shear. Well under the 900ms
 * the parent keeps a flight event queued, so a slide is always finished
 * before its event is recycled.
 */
export const NEAT_SLIDE_DURATION_MS = 820;

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
