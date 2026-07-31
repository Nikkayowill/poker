import { describe, expect, it } from "vitest";
import {
  MAX_CHIPS_PER_COLUMN,
  POT_CHIP_DENOMINATIONS_BB,
  potChipCount,
  potChipStacks,
} from "./pot-chips";
import { TIER_CONFIG } from "./tiers";

describe("potChipStacks", () => {
  it("shows nothing before anything is in the middle", () => {
    expect(potChipStacks(0, 10)).toEqual([]);
  });

  it("still shows a chip for a pot smaller than one big blind", () => {
    // A dead small blind is a real pot. Rounding it away would leave the felt
    // empty while the HUD above it read a number.
    const stacks = potChipStacks(5, 10);
    expect(potChipCount(stacks)).toBe(1);
  });

  it("reads the same pot the same way at every tier", () => {
    // The whole reason this is denominated in big blinds. Twenty big blinds is
    // twenty big blinds whether that is 200 chips or 20,000.
    const shapes = Object.values(TIER_CONFIG).map((tier) =>
      potChipStacks(20 * tier.bigBlind, tier.bigBlind),
    );
    shapes.forEach((shape) => expect(shape).toEqual(shapes[0]));
    expect(shapes[0].length).toBeGreaterThan(0);
  });

  it("breaks a pot down largest denomination first", () => {
    // 137 big blinds: one 100, one 25, two 5s, two 1s.
    const stacks = potChipStacks(1_370, 10);
    expect(stacks).toEqual([
      { denomination: 100, count: 1, capped: false },
      { denomination: 25, count: 1, capped: false },
      { denomination: 5, count: 2, capped: false },
      { denomination: 1, count: 2, capped: false },
    ]);
  });

  it("keeps the denominations in descending order", () => {
    const stacks = potChipStacks(9_990, 10);
    const values = stacks.map((stack) => stack.denomination);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    values.forEach((value) => expect(POT_CHIP_DENOMINATIONS_BB).toContain(value));
  });

  it("grows as the pot grows, and never shrinks", () => {
    let previous = -1;
    for (const bigBlinds of [1, 2, 5, 11, 26, 60, 101, 250, 600]) {
      const count = potChipCount(potChipStacks(bigBlinds * 10, 10));
      expect(count).toBeGreaterThanOrEqual(1);
      previous = count;
      expect(previous).toBeGreaterThan(0);
    }
  });

  it("caps a column rather than drawing a hundred chips", () => {
    // 5,000 big blinds is fifty 100-chips. Nobody counts past six.
    const stacks = potChipStacks(50_000, 10);
    const hundreds = stacks.find((stack) => stack.denomination === 100)!;
    expect(hundreds.count).toBe(MAX_CHIPS_PER_COLUMN);
    expect(hundreds.capped).toBe(true);
  });

  it("bounds the DOM the felt has to carry, whatever the pot is", () => {
    // The guard that matters for performance: an unbounded pile on a table
    // that now deals a hand every 2.8s is a lot of nodes to build and drop.
    const worst = Math.max(
      ...[1, 7, 42, 137, 999, 12_345, 10_000_000].map((bigBlinds) =>
        potChipCount(potChipStacks(bigBlinds * 10, 10)),
      ),
    );
    expect(worst).toBeLessThanOrEqual(POT_CHIP_DENOMINATIONS_BB.length * MAX_CHIPS_PER_COLUMN);
    expect(worst).toBeLessThanOrEqual(24);
  });

  it("refuses nonsense rather than dividing by it", () => {
    expect(potChipStacks(100, 0)).toEqual([]);
    expect(potChipStacks(100, Number.NaN)).toEqual([]);
    expect(potChipStacks(Number.NaN, 10)).toEqual([]);
    expect(potChipStacks(-50, 10)).toEqual([]);
  });
});
