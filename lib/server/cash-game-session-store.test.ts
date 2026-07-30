import { describe, expect, it } from "vitest";
import {
  calculateSessionSettlement,
  earningsMultiplier,
} from "./cash-game-session-store";

describe("cash-game retention settlement", () => {
  it.each([
    [100, 0, 1],
    [100, 4, 1],
    [100, 5, 1.1],
    [100, 9, 1.1],
    [100, 10, 1.25],
    [100, 19, 1.25],
    [100, 20, 1.5],
  ] as const)(
    "uses the requested multiplier for %i profit and %i wins",
    (net, wins, multiplier) => {
      expect(earningsMultiplier(net, wins)).toBe(multiplier);
    },
  );

  it("never multiplies a losing session", () => {
    expect(earningsMultiplier(-500, 100)).toBe(1);
    expect(calculateSessionSettlement(1_000, 500, 100)).toEqual({
      currentChips: 500,
      handsWonCount: 100,
      netEarnings: -500,
      multiplier: 1,
      payout: 500,
    });
  });

  it("multiplies only profit, not the returned buy-in", () => {
    expect(calculateSessionSettlement(1_000, 2_000, 20)).toEqual({
      currentChips: 2_000,
      handsWonCount: 20,
      netEarnings: 1_000,
      multiplier: 1.5,
      payout: 2_500,
    });
  });

  it("rounds fractional bonus chips down deterministically", () => {
    expect(calculateSessionSettlement(1_000, 1_001, 5).payout).toBe(1_001);
  });
});
