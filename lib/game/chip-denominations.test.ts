import { describe, expect, it } from "vitest";
import {
  ALL_CHIP_DENOMINATIONS,
  CHIP_COLOURS,
  CHIP_DENOMINATIONS_GOLD,
  calculateChipDenominations,
  chipBucketCount,
  chipColour,
  chipFlightPlan,
  flattenChipBuckets,
} from "./chip-denominations";
import { MAX_CHIPS_PER_COLUMN, POT_CHIP_DENOMINATIONS_BB, potChipStacks } from "./pot-chips";

describe("calculateChipDenominations, in big blinds", () => {
  it("is the felt's existing breakdown, not a second opinion", () => {
    // The whole argument for this module is that it does not add a third
    // greedy. If these ever disagree, the felt has two answers for one pot.
    for (const [pot, bigBlind] of [[1_370, 10], [50, 10], [9_990, 10], [5, 10], [250_000, 500]]) {
      const buckets = calculateChipDenominations(pot, { bigBlind });
      expect(buckets.map((b) => ({ denomination: b.denomination, count: b.count, capped: b.capped })))
        .toEqual(potChipStacks(pot, bigBlind));
    }
  });

  it("only ever wears denominations the house stocks", () => {
    const buckets = calculateChipDenominations(123_456, { bigBlind: 7 });
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      expect(POT_CHIP_DENOMINATIONS_BB).toContain(bucket.denomination);
      expect(bucket.colour).toEqual(CHIP_COLOURS[bucket.denomination]);
    }
  });

  it("still puts one chip on the cloth for a pot under one big blind", () => {
    // Something really is in the middle; rounding it away makes the felt
    // disagree with the number printed above it.
    expect(calculateChipDenominations(5, { bigBlind: 10 })).toHaveLength(1);
  });
});

describe("calculateChipDenominations, in Gold", () => {
  it("breaks an amount down largest-first and sums back to it", () => {
    const buckets = calculateChipDenominations(1_631);
    expect(buckets.map((b) => b.denomination)).toEqual([1000, 500, 100, 25, 5, 1]);
    const total = buckets.reduce((sum, b) => sum + b.denomination * b.count, 0);
    expect(total).toBe(1_631);
  });

  it("keeps the ladder descending, which the greedy depends on", () => {
    expect([...CHIP_DENOMINATIONS_GOLD]).toEqual([...CHIP_DENOMINATIONS_GOLD].sort((a, b) => b - a));
  });

  it("caps a column rather than drawing a tower nobody counts", () => {
    const buckets = calculateChipDenominations(1_000_000);
    for (const bucket of buckets) expect(bucket.count).toBeLessThanOrEqual(MAX_CHIPS_PER_COLUMN);
    expect(buckets.some((b) => b.capped)).toBe(true);
  });

  it("does not leak a swallowed chip's value into a tower of ones", () => {
    // The cap is visual. If the greedy subtracted only what it drew, capping
    // the hundreds column would hand 900 to the ones and the pile would grow
    // instead of shrinking -- the exact opposite of what a cap is for.
    const capped = calculateChipDenominations(1_000_000);
    expect(chipBucketCount(capped)).toBeLessThanOrEqual(
      CHIP_DENOMINATIONS_GOLD.length * MAX_CHIPS_PER_COLUMN,
    );
  });

  it("honours a shorter column when one is asked for", () => {
    const buckets = calculateChipDenominations(1_000_000, { maxPerColumn: 2 });
    for (const bucket of buckets) expect(bucket.count).toBeLessThanOrEqual(2);
    expect(buckets.every((b) => b.capped)).toBe(true);
  });

  it("renders nothing for an amount that is not a positive number", () => {
    expect(calculateChipDenominations(0)).toEqual([]);
    expect(calculateChipDenominations(-40)).toEqual([]);
    expect(calculateChipDenominations(Number.NaN)).toEqual([]);
    expect(calculateChipDenominations(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(calculateChipDenominations(100, { maxPerColumn: 0 })).toEqual([]);
  });
});

describe("chip colours", () => {
  it("has one entry per denomination the house stocks", () => {
    for (const denomination of CHIP_DENOMINATIONS_GOLD) {
      expect(CHIP_COLOURS[denomination]).toBeDefined();
    }
    expect(ALL_CHIP_DENOMINATIONS).toEqual([...CHIP_DENOMINATIONS_GOLD]);
  });

  it("covers every denomination a pot can break into in big blinds", () => {
    for (const denomination of POT_CHIP_DENOMINATIONS_BB) {
      expect(CHIP_COLOURS[denomination]).toBeDefined();
    }
  });

  it("falls back rather than handing back an untextured chip", () => {
    expect(chipColour(7)).toEqual(CHIP_COLOURS[1]);
    expect(chipColour(Number.NaN)).toEqual(CHIP_COLOURS[1]);
  });

  it("keeps every colour a distinct disc", () => {
    // Two denominations painted the same is a pile that lies at a glance,
    // which is the one thing the colours exist to prevent.
    const bodies = new Set(ALL_CHIP_DENOMINATIONS.map((d) => chipColour(d).body));
    expect(bodies.size).toBe(ALL_CHIP_DENOMINATIONS.length);
  });
});

describe("flattenChipBuckets", () => {
  it("leaves the rail smallest denomination first", () => {
    // A dealer's change goes out ahead of the big ones.
    const plan = flattenChipBuckets(calculateChipDenominations(1_631));
    expect(plan.map((c) => c.denomination)).toEqual([1, 5, 25, 100, 500, 1000]);
  });

  it("numbers the chips in departure order, which the stagger multiplies", () => {
    const plan = flattenChipBuckets(calculateChipDenominations(1_631));
    expect(plan.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("throws away the small change, never the big chips, when truncated", () => {
    // The regression this pins: slicing after the reverse keeps the wrong
    // end, and a 100k shove arrives on the felt looking like a limp.
    const plan = flattenChipBuckets(calculateChipDenominations(1_631), 2);
    expect(plan.map((c) => c.denomination)).toEqual([500, 1000]);
  });

  it("is empty for an amount that shows nothing", () => {
    expect(flattenChipBuckets(calculateChipDenominations(0))).toEqual([]);
    expect(flattenChipBuckets(calculateChipDenominations(500), 0)).toEqual([]);
  });
});

describe("chipFlightPlan", () => {
  it("is the breakdown and the flattening in one call", () => {
    expect(chipFlightPlan(1_631, { maxChips: 3 }))
      .toEqual(flattenChipBuckets(calculateChipDenominations(1_631), 3));
  });

  it("works in big blinds too, which is what the felt asks for", () => {
    const plan = chipFlightPlan(1_370, { bigBlind: 10, maxChips: 10 });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.length).toBeLessThanOrEqual(10);
    for (const chip of plan) expect(POT_CHIP_DENOMINATIONS_BB).toContain(chip.denomination);
  });
});
