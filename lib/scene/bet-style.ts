/**
 * The three ways a bet's chips can travel.
 *
 * ONE MOTION ENGINE, THREE SETTINGS OF IT. This used to be three separate
 * animations: a clocked cubic glide for the neat slide, a taller parabola with
 * its own trigonometric scatter for the splash, and a prebuilt column on a
 * shared clock for the stacked toss. Three implementations of "move a chip"
 * meant three places for a chip to land wrong, and two of them had no spring,
 * no squash and no per-chip variation at all — picking a style could silently
 * cost you most of the chip physics.
 *
 * Now every style is `chip-motion.ts`'s spring, arc, landing squash and
 * per-chip variance; a style says only *how much* of each. What survives from
 * the old file is the part that was actually about the preference — the stored
 * value, the cycle, the labels — and none of the part that was about geometry.
 *
 * All three are pure client presentation over the same server-validated
 * amounts: nothing in here touches what a bet *is*, only how its chips move.
 *
 * In `lib/` rather than beside the renderer because `vitest.config.ts`
 * collects only `lib/` and `app/`.
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
 * scatter turned out to be the thing making a bet unreadable: chips landing on
 * a spread never form a pile, so the felt could show a player's committed
 * chips but never show *how many*, and at six seats the clusters ran into each
 * other. A stack is legible at a glance and a scatter is not, and legibility
 * beats continuity at a poker table.
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
 * three — a `a === x ? "A" : "B"` reads the new third value as B. A test walks
 * every style so a fourth cannot be added without a name.
 */
export function betStyleLabel(style: BetAnimationStyle): string {
  switch (style) {
    case "neat_slide": return "Chip style: Neat slide";
    case "splash_chunk": return "Chip style: Splash";
    default: return "Chip style: Stacked toss";
  }
}

/**
 * How a style bends the motion the action already chose.
 *
 * Multipliers rather than absolute values, and that is the whole design: the
 * timing table in `chip-motion.ts` owns how long a call, a raise and a shove
 * take, so a style cannot make a call slower than a raise no matter how it is
 * tuned. The action's meaning survives the preference.
 */
export interface BetStyleMotion {
  /** Scales the arc's apex. */
  arcScale: number;
  /** Scales the gap between one chip leaving and the next. */
  staggerScale: number;
  /** Scales the per-chip tumble and drift. */
  varianceScale: number;
  /**
   * How far from the bet spot a chip may land, in chip radii. Zero keeps the
   * cut stack intact, which is what makes a bet countable.
   */
  scatterRadii: number;
}

export function betStyleMotion(style: BetAnimationStyle): BetStyleMotion {
  switch (style) {
    // One rigid pillar: a player cutting out a stack and pushing it over the
    // line. Almost no arc and no stagger, so the column stays perfectly
    // aligned the whole way — but it still springs and still lands, because
    // "tidy" is not the same as "weightless".
    case "neat_slide":
      return { arcScale: 0.35, staggerScale: 0, varianceScale: 0.15, scatterRadii: 0 };
    // Chips thrown in one at a time on tall parabolas that bloom into a
    // scattered cluster — splashing the pot.
    case "splash_chunk":
      return { arcScale: 1.6, staggerScale: 1.5, varianceScale: 2, scatterRadii: 3.2 };
    default:
      return { arcScale: 1, staggerScale: 1, varianceScale: 1, scatterRadii: 0 };
  }
}
