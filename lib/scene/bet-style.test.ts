import { describe, expect, it } from "vitest";
import {
  BET_STYLE_STORAGE_KEY,
  BET_STYLES,
  betStyleLabel,
  betStyleMotion,
  DEFAULT_BET_STYLE,
  nextBetStyle,
  normalizeBetStyle,
  type BetAnimationStyle,
} from "./bet-style";
import { MOTION } from "./chips/chip-motion";

describe("the style preference", () => {
  it("passes real styles through and coerces everything else to the default", () => {
    expect(normalizeBetStyle("neat_slide")).toBe("neat_slide");
    expect(normalizeBetStyle("splash_chunk")).toBe("splash_chunk");
    expect(normalizeBetStyle(null)).toBe(DEFAULT_BET_STYLE);
    expect(normalizeBetStyle(undefined)).toBe(DEFAULT_BET_STYLE);
    expect(normalizeBetStyle("platinum_rain")).toBe(DEFAULT_BET_STYLE);
    expect(normalizeBetStyle(42)).toBe(DEFAULT_BET_STYLE);
  });

  it("cycles through every style and returns home", () => {
    const seen = new Set<BetAnimationStyle>();
    let style = DEFAULT_BET_STYLE;
    for (let i = 0; i < BET_STYLES.length; i += 1) {
      seen.add(style);
      style = nextBetStyle(style);
    }
    expect(seen.size).toBe(BET_STYLES.length);
    expect(style).toBe(DEFAULT_BET_STYLE);
  });

  it("stores under the app's own namespace, like sound and music", () => {
    expect(BET_STYLE_STORAGE_KEY.startsWith("stackchips:")).toBe(true);
  });

  it("is the stacked toss by default, because a stack can be counted and a scatter cannot", () => {
    expect(DEFAULT_BET_STYLE).toBe("stacked_toss");
  });

  it("names every style, so a new one cannot ship unlabelled", () => {
    // A ternary at the call site is what this replaced, and a ternary reads a
    // third value as the second one's label.
    const labels = BET_STYLES.map(betStyleLabel);
    expect(new Set(labels).size).toBe(BET_STYLES.length);
    for (const label of labels) expect(label.startsWith("Chip style: ")).toBe(true);
  });
});

describe("a style as a motion modifier", () => {
  it("gives every style the same engine, only turned up or down", () => {
    // The whole point of the rewrite: no style may opt out of the spring, the
    // arc or the per-chip variation by being a separate animation.
    for (const style of BET_STYLES) {
      const motion = betStyleMotion(style);
      expect(motion.arcScale).toBeGreaterThan(0);
      expect(motion.varianceScale).toBeGreaterThan(0);
      expect(motion.staggerScale).toBeGreaterThanOrEqual(0);
      expect(motion.scatterRadii).toBeGreaterThanOrEqual(0);
    }
  });

  it("cannot reorder the actions: a styled call still beats a styled raise", () => {
    // Multipliers, never absolute values. A style that could make a call
    // slower than a raise would destroy the one thing the timings encode.
    for (const style of BET_STYLES) {
      void betStyleMotion(style);
      expect(MOTION.call.durationMs).toBeLessThan(MOTION.raise.durationMs);
      expect(MOTION.raise.durationMs).toBeLessThan(MOTION.all_in.durationMs);
    }
  });

  it("keeps the neat slide a rigid pillar: no stagger and no scatter", () => {
    const neat = betStyleMotion("neat_slide");
    expect(neat.staggerScale).toBe(0);
    expect(neat.scatterRadii).toBe(0);
    expect(neat.arcScale).toBeLessThan(1);
  });

  it("keeps the stacked toss countable — chips land in a column, not a cluster", () => {
    expect(betStyleMotion("stacked_toss").scatterRadii).toBe(0);
  });

  it("makes splash the only style that breaks the column", () => {
    const splash = betStyleMotion("splash_chunk");
    expect(splash.scatterRadii).toBeGreaterThan(0);
    expect(splash.arcScale).toBeGreaterThan(1);
    expect(splash.varianceScale).toBeGreaterThan(1);
  });
});
