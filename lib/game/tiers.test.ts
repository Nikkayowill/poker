import { describe, expect, it } from "vitest";
import {
  CHEAPEST_TIER,
  clampBuyIn,
  isStakesTier,
  STAKES_TIERS,
  TIER_CONFIG,
} from "./tiers";

/**
 * The ladder is one tuple that everything else derives from, and these tests
 * exist to keep it that way.
 *
 * Four API routes used to restate the eight tier strings inline in a
 * `z.enum([...])`. Nothing failed when they drifted: a ninth tier would have
 * been offered by the lobby, priced by TIER_CONFIG, and then rejected as
 * invalid by every route that could actually take a wager -- with a 400 that
 * blamed the player for picking a stake the app showed them.
 */
describe("the stakes ladder", () => {
  it("keeps TIER_CONFIG and STAKES_TIERS in step", () => {
    // Record<StakesTier, TierConfig> already makes the compiler reject a
    // missing config. This catches the other direction: a config for a tier
    // that is not on the ladder, which the type system permits and which
    // would never render.
    expect(Object.keys(TIER_CONFIG).sort()).toEqual([...STAKES_TIERS].sort());
  });

  it("orders the ladder cheapest first, since the UI renders it in this order", () => {
    const buyIns = STAKES_TIERS.map((tier) => TIER_CONFIG[tier].minBuyIn);
    expect(buyIns).toEqual([...buyIns].sort((a, b) => a - b));
  });

  it("starts the ladder at CHEAPEST_TIER", () => {
    expect(STAKES_TIERS[0]).toBe(CHEAPEST_TIER);
    expect(TIER_CONFIG[CHEAPEST_TIER].minBuyIn).toBe(
      Math.min(...STAKES_TIERS.map((tier) => TIER_CONFIG[tier].minBuyIn)),
    );
  });

  it("accepts every tier on the ladder and nothing else", () => {
    for (const tier of STAKES_TIERS) expect(isStakesTier(tier)).toBe(true);
    for (const value of ["", "2k", "1K", "1000", null, undefined, 1000, {}]) {
      expect(isStakesTier(value)).toBe(false);
    }
  });

  it("holds minBuyIn === maxBuyIn on every rung", () => {
    // Fixed buy-ins are load-bearing: claimSeat resets a claiming player's
    // stack to precisely this number, so a range would let two players at the
    // same table hold different amounts of un-backed chips.
    for (const tier of STAKES_TIERS) {
      const config = TIER_CONFIG[tier];
      expect(config.minBuyIn).toBe(config.maxBuyIn);
    }
  });

  it("clamps any amount to the rung's one legal buy-in", () => {
    for (const tier of STAKES_TIERS) {
      const { minBuyIn } = TIER_CONFIG[tier];
      expect(clampBuyIn(tier, 0)).toBe(minBuyIn);
      expect(clampBuyIn(tier, Number.MAX_SAFE_INTEGER)).toBe(minBuyIn);
      expect(clampBuyIn(tier, Number.NaN)).toBe(minBuyIn);
      expect(clampBuyIn(tier, -1)).toBe(minBuyIn);
    }
  });

  it("prices blinds below the buy-in on every rung", () => {
    // A big blind at or above the buy-in means a player is all-in before
    // acting, which is not a cash game.
    for (const tier of STAKES_TIERS) {
      const { smallBlind, bigBlind, minBuyIn } = TIER_CONFIG[tier];
      expect(smallBlind).toBeGreaterThan(0);
      expect(bigBlind).toBe(smallBlind * 2);
      expect(bigBlind).toBeLessThan(minBuyIn);
    }
  });
});
