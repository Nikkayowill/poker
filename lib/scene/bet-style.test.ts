import { describe, expect, it } from "vitest";
import {
  BET_STYLE_STORAGE_KEY,
  BET_STYLES,
  betStyleLabel,
  DEFAULT_BET_STYLE,
  NEAT_SLIDE_DURATION_MS,
  nextBetStyle,
  normalizeBetStyle,
  SPLASH_SCATTER_RADIUS,
  splashScatterOffset,
  stackLeanOffset,
  type BetAnimationStyle,
} from "./bet-style";
import { CHIP_RADIUS } from "./chip-layer";
import { TILT_SIN } from "./scene-config";

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
    let style = DEFAULT_BET_STYLE;
    const seen = new Set([style]);
    for (let i = 0; i < BET_STYLES.length - 1; i += 1) {
      style = nextBetStyle(style);
      seen.add(style);
    }
    expect(seen.size).toBe(BET_STYLES.length);
    expect(nextBetStyle(style)).toBe(DEFAULT_BET_STYLE);
  });

  it("stores under the app's own namespace, like sound and music", () => {
    expect(BET_STYLE_STORAGE_KEY.startsWith("stackchips:")).toBe(true);
  });

  it("keeps the neat slide inside the parent's 900ms flight-event window", () => {
    // poker-table.tsx recycles a bet-flight event after 900ms; a slide still
    // in the air past that would be cleared mid-glide.
    expect(NEAT_SLIDE_DURATION_MS).toBeLessThan(900);
  });
});

describe("the splash scatter wave", () => {
  it("is a pure function of the chip's index — the same bet lands the same cluster", () => {
    for (let index = 0; index < 12; index += 1) {
      expect(splashScatterOffset(index)).toEqual(splashScatterOffset(index));
    }
  });

  it("never lands a chip outside the scatter radius", () => {
    for (let index = 0; index < 24; index += 1) {
      const { x, z } = splashScatterOffset(index);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(SPLASH_SCATTER_RADIUS + 1e-9);
    }
  });

  it("spreads consecutive chips apart instead of piling them on one spot", () => {
    for (let index = 0; index < 9; index += 1) {
      const a = splashScatterOffset(index);
      const b = splashScatterOffset(index + 1);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.05);
    }
  });

  it("leaves the plan-space cluster round: the tilt supplies the ~0.62 squash", () => {
    // The design's 0.62 depth compression is sin(TILT_DEG) ≈ 0.616, applied
    // by project() to every ground-plane offset. If someone re-adds a Z
    // squash here the cluster gets compressed twice on screen.
    expect(TILT_SIN).toBeCloseTo(0.6157, 3);
    let maxAbsX = 0;
    let maxAbsZ = 0;
    for (let index = 0; index < 100; index += 1) {
      const { x, z } = splashScatterOffset(index);
      maxAbsX = Math.max(maxAbsX, Math.abs(x));
      maxAbsZ = Math.max(maxAbsZ, Math.abs(z));
    }
    expect(maxAbsZ / maxAbsX).toBeGreaterThan(0.9);
    expect(maxAbsZ / maxAbsX).toBeLessThan(1.1);
  });
});

describe("the stacked toss", () => {
  it("is the default, because a stack can be counted and a scatter cannot", () => {
    expect(DEFAULT_BET_STYLE).toBe("stacked_toss");
  });

  it("cycles through every style and back", () => {
    const seen = new Set<BetAnimationStyle>();
    let style = DEFAULT_BET_STYLE;
    for (let i = 0; i < BET_STYLES.length; i += 1) {
      seen.add(style);
      style = nextBetStyle(style);
    }
    expect(seen.size).toBe(BET_STYLES.length);
    expect(style).toBe(DEFAULT_BET_STYLE);
  });

  it("names every style, so a new one cannot ship unlabelled", () => {
    // A ternary at the call site is what this replaced, and a ternary reads a
    // third value as the second one's label.
    const labels = BET_STYLES.map(betStyleLabel);
    expect(new Set(labels).size).toBe(BET_STYLES.length);
    for (const label of labels) expect(label.startsWith("Chip style: ")).toBe(true);
  });

  it("leans the column without letting it stop reading as one stack", () => {
    let previous = 0;
    for (let index = 0; index < 12; index += 1) {
      const { x, z } = stackLeanOffset(index);
      const reach = Math.hypot(x, z);
      // Opens up as the column gets tall, the way a hand-built stack drifts.
      expect(reach).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = reach;
      // Never past a chip's own radius, or it is a slump rather than a stack.
      expect(reach).toBeLessThan(CHIP_RADIUS);
    }
  });

  it("sits the first chip dead true, so the column has a foot", () => {
    expect(stackLeanOffset(0)).toEqual({ x: 0, z: 0 });
  });

  it("is deterministic: the same bet builds the same column twice", () => {
    for (let index = 0; index < 8; index += 1) {
      expect(stackLeanOffset(index)).toEqual(stackLeanOffset(index));
    }
  });
});
