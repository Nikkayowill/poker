import { describe, expect, it } from "vitest";
import {
  CHIP_DENOMINATIONS,
  MAX_CHIPS_PER_PILE,
  chipBreakdown,
} from "./denominations";

describe("chipBreakdown", () => {
  it("breaks an amount into largest-first denominations", () => {
    const chips = chipBreakdown(1631);
    expect(chips.map((c) => c.value)).toEqual([1000, 500, 100, 25, 5, 1]);
  });

  it("sums exactly to the amount when under the display cap", () => {
    for (const amount of [1, 6, 30, 155, 780, 2525]) {
      const total = chipBreakdown(amount).reduce((sum, c) => sum + c.value, 0);
      expect(total).toBe(amount);
    }
  });

  it("caps a huge pile at the display maximum", () => {
    expect(chipBreakdown(1_000_000)).toHaveLength(MAX_CHIPS_PER_PILE);
  });

  it("renders nothing for zero or negative amounts", () => {
    expect(chipBreakdown(0)).toEqual([]);
    expect(chipBreakdown(-40)).toEqual([]);
  });

  it("keeps the catalogue ordered largest-first, which greedy depends on", () => {
    const values = CHIP_DENOMINATIONS.map((d) => d.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });
});
