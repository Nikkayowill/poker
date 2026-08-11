import { describe, expect, it } from "vitest";
import {
  CHIP_DENOMINATIONS,
  MAX_CHIPS_PER_PILE,
  chipBreakdown,
  pileChipTarget,
} from "./denominations";

describe("pileChipTarget", () => {
  it("NEVER shows fewer chips for more money", () => {
    // The defect this whole design exists for. Under the old pure-greedy
    // breakdown a 90 pot drew nine chips and a 100 pot drew ONE, so a pot
    // growing across a denomination boundary made its own pile visibly
    // collapse — at 100, at 500, at 1,000, and at every boundary above.
    // Walked exhaustively rather than sampled, because the failures were
    // exactly at the boundaries a sample would step over.
    let previous = 0;
    for (let amount = 1; amount <= 100_000; amount += 1) {
      const count = pileChipTarget(amount);
      expect(count, `fell at ${amount}`).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it("agrees with the pile it actually draws", () => {
    // The target is only meaningful if the breakdown reaches it. It cannot
    // for very small amounts (nothing is smaller than a 1 chip), so this
    // asserts the two agree wherever the denominations allow.
    for (const amount of [50, 100, 150, 500, 900, 1000, 5000, 20_000]) {
      expect(chipBreakdown(amount).length, `at ${amount}`).toBe(pileChipTarget(amount));
    }
  });

  it("draws nothing for nothing", () => {
    expect(pileChipTarget(0)).toBe(0);
    expect(pileChipTarget(-5)).toBe(0);
  });
});

describe("chipBreakdown", () => {
  it("orders a pile largest-first, so the big clay is at the bottom", () => {
    const values = chipBreakdown(1631).map((c) => c.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("reaches for smaller clay rather than drawing a lone big chip", () => {
    // A 1,000 pot used to be one gold chip, which is both unreadable and
    // not what anybody pushes into a middle at a 10-blind table. It is ten
    // blacks now — the first band that can make the target count.
    expect(chipBreakdown(1000).map((c) => c.value)).toEqual(Array(10).fill(100));
    expect(chipBreakdown(100).every((c) => c.value < 100)).toBe(true);
  });

  it("is a size cue, not a value encoding — and says so", () => {
    // Worth stating as a test rather than only as prose, because the old
    // contract WAS exact value under the cap and someone reading these
    // files later will reasonably assume it still is.
    //
    // Exactness survives only where a square-root count and 5x denomination
    // steps happen to agree, which is a minority of amounts: a 6 bet draws
    // one 5-chip, a 5,000 pot draws 21 blacks. The authority on value is the
    // number beside the pile (hud/bet-amounts.tsx) and the HUD's pot
    // readout. What IS guaranteed is the direction of the error — see the
    // over-representation guard below — and the count's monotonicity above.
    expect(chipBreakdown(1000).reduce((s, c) => s + c.value, 0)).toBe(1000);
    expect(chipBreakdown(6).reduce((s, c) => s + c.value, 0)).toBe(5);
  });

  it("never draws MORE clay than the pot is worth", () => {
    // Under-representing a big pot is the stated trade; over-representing it
    // would be a lie in the other direction, and the one a player could
    // actually catch — a pile that prices higher than the pot beside it.
    for (let amount = 1; amount <= 60_000; amount += 137) {
      const total = chipBreakdown(amount).reduce((sum, c) => sum + c.value, 0);
      expect(total, `at ${amount}`).toBeLessThanOrEqual(amount);
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
