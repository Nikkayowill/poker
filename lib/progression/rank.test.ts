import { describe, expect, it } from "vitest";
import { GOLD_PER_RANK_POINT } from "./solo-earnings";
import {
  GOLD_PER_XP,
  RANK_TIERS,
  TOP_TIER,
  goldForTierUps,
  rankProgress,
  rewardsBetween,
  tierByNumber,
  tierForPoints,
  xpForWager,
} from "./rank";

describe("earning XP", () => {
  it("converts a wager at the documented rate and never pays for nothing", () => {
    expect(xpForWager(250)).toBe(25);
    expect(xpForWager(5_000)).toBe(500);
    expect(xpForWager(GOLD_PER_XP - 1)).toBe(0);
    expect(xpForWager(0)).toBe(0);
    expect(xpForWager(-1_000)).toBe(0);
    expect(xpForWager(Number.NaN)).toBe(0);
  });
});

describe("the tier ladder", () => {
  it("starts at Bronze and tops out at GOAT", () => {
    expect(RANK_TIERS[0].name).toBe("Bronze");
    expect(RANK_TIERS[RANK_TIERS.length - 1].name).toBe("GOAT");
    expect(TOP_TIER).toBe(RANK_TIERS.length);
  });

  it("has Diamond and does not use Gold, which is the currency", () => {
    const names = RANK_TIERS.map((tier) => tier.name);
    expect(names).toContain("Diamond");
    expect(names).not.toContain("Gold");
  });

  it("begins at zero points and only ever climbs", () => {
    expect(RANK_TIERS[0].from).toBe(0);
    for (let index = 1; index < RANK_TIERS.length; index += 1) {
      expect(RANK_TIERS[index].from).toBeGreaterThan(RANK_TIERS[index - 1].from);
    }
  });

  it("gives every tier its own id", () => {
    expect(new Set(RANK_TIERS.map((tier) => tier.id)).size).toBe(RANK_TIERS.length);
  });

  it("places a player on the tier their points reach, exactly at each boundary", () => {
    for (const [index, tier] of RANK_TIERS.entries()) {
      expect(tierForPoints(tier.from).number).toBe(index + 1);
      if (tier.from > 0) expect(tierForPoints(tier.from - 1).number).toBe(index);
    }
  });

  it("treats junk and negative points as Bronze", () => {
    expect(tierForPoints(-50).id).toBe("bronze");
    expect(tierForPoints(Number.NaN).id).toBe("bronze");
  });

  it("clamps a tier number onto the ladder", () => {
    expect(tierByNumber(0).id).toBe("bronze");
    expect(tierByNumber(99).id).toBe("goat");
    expect(tierByNumber(Number.NaN).id).toBe("bronze");
  });
});

describe("the rank readout", () => {
  it("reports where in the tier the player is, and what is left to the next", () => {
    const silver = RANK_TIERS[1];
    const platinum = RANK_TIERS[2];
    const progress = rankProgress(silver.from + 1_000);

    expect(progress.tier.id).toBe("silver");
    expect(progress.nextTier?.id).toBe("platinum");
    expect(progress.intoTier).toBe(1_000);
    expect(progress.tierSpan).toBe(platinum.from - silver.from);
    expect(progress.toNext).toBe(platinum.from - silver.from - 1_000);
    expect(progress.ratio).toBeGreaterThan(0);
    expect(progress.ratio).toBeLessThan(1);
  });

  it("starts a fresh player at Bronze with the next tier in view", () => {
    const progress = rankProgress(0);
    expect(progress.tier.id).toBe("bronze");
    expect(progress.points).toBe(0);
    expect(progress.ratio).toBe(0);
    expect(progress.toNext).toBe(RANK_TIERS[1].from);
  });

  it("stops at GOAT with a full bar and nothing above it", () => {
    const goat = rankProgress(RANK_TIERS[RANK_TIERS.length - 1].from * 3);
    expect(goat.tier.id).toBe("goat");
    expect(goat.nextTier).toBeNull();
    expect(goat.toNext).toBeNull();
    expect(goat.tierSpan).toBe(0);
    expect(goat.ratio).toBe(1);
    expect(Number.isFinite(goat.ratio)).toBe(true);
  });

  it("floors fractions and never reads below zero", () => {
    expect(rankProgress(99.9).points).toBe(99);
    expect(rankProgress(-10).points).toBe(0);
  });
});

describe("tier rewards", () => {
  it("pays nothing for Bronze, where everyone starts", () => {
    expect(RANK_TIERS[0].rewardGold).toBe(0);
    expect(rewardsBetween(0, 1)).toEqual([expect.objectContaining({ gold: 0 })]);
  });

  it("pays every tier crossed, in order, when one win jumps several", () => {
    const rewards = rewardsBetween(1, 4);
    expect(rewards.map((reward) => reward.tier.id)).toEqual(["silver", "platinum", "emerald"]);
    expect(goldForTierUps(1, 4)).toBe(RANK_TIERS[1].rewardGold + RANK_TIERS[2].rewardGold + RANK_TIERS[3].rewardGold);
  });

  it("pays nothing when rank stands still or falls", () => {
    expect(rewardsBetween(4, 4)).toEqual([]);
    expect(rewardsBetween(6, 2)).toEqual([]);
  });

  it("does not run past GOAT", () => {
    expect(rewardsBetween(TOP_TIER, TOP_TIER + 5)).toEqual([]);
    expect(rewardsBetween(TOP_TIER - 1, TOP_TIER + 5).map((reward) => reward.tier.id)).toEqual(["goat"]);
  });

  it("grows with the climb", () => {
    for (let index = 2; index < RANK_TIERS.length; index += 1) {
      expect(RANK_TIERS[index].rewardGold).toBeGreaterThan(RANK_TIERS[index - 1].rewardGold);
    }
  });

  it("keeps the whole ladder a small fraction of the turnover it takes to climb", () => {
    // The economic guard, not a style point: tier rewards are a Gold faucet,
    // and Gold is sold for money. Reaching GOAT must pay back only a small
    // sliver of what it costs to get there, or grinding the ladder becomes a
    // way to print Gold that undermines what a real-money purchase is worth.
    // The cheapest route to GOAT is Easy-band net earnings, at weight 1.
    const turnover = RANK_TIERS[RANK_TIERS.length - 1].from * GOLD_PER_RANK_POINT;
    const paid = goldForTierUps(1, TOP_TIER);
    expect(paid / turnover).toBeLessThan(0.03);
  });
});
