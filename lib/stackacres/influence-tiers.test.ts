import { describe, expect, it } from "vitest";
import {
  INFLUENCE_TIERS,
  applyInfluenceDiscount,
  influenceTier,
  nextInfluenceTier,
} from "./influence-tiers";

describe("influenceTier", () => {
  it("resolves a fresh farm to the base rung, never to nothing", () => {
    expect(influenceTier(0)).toEqual(INFLUENCE_TIERS[0]);
    expect(influenceTier(0).discountBps).toBe(0);
  });

  it("climbs one rung at a time as cumulative Influence clears each threshold", () => {
    expect(influenceTier(24)).toEqual(INFLUENCE_TIERS[0]);
    expect(influenceTier(25)).toEqual(INFLUENCE_TIERS[1]);
    expect(influenceTier(99)).toEqual(INFLUENCE_TIERS[1]);
    expect(influenceTier(100)).toEqual(INFLUENCE_TIERS[2]);
  });

  it("never regresses -- the top rung holds for any total past its threshold", () => {
    const top = INFLUENCE_TIERS[INFLUENCE_TIERS.length - 1];
    expect(influenceTier(top.threshold)).toEqual(top);
    expect(influenceTier(top.threshold + 1_000_000)).toEqual(top);
  });

  it("is monotone: a higher total never resolves to a lower rung", () => {
    const totals = [0, 1, 25, 26, 99, 100, 299, 300, 749, 750, 5_000];
    let lastIndex = -1;
    for (const total of totals) {
      const index = INFLUENCE_TIERS.indexOf(influenceTier(total));
      expect(index).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = index;
    }
  });
});

describe("nextInfluenceTier", () => {
  it("names the next unreached rung", () => {
    expect(nextInfluenceTier(0)).toEqual(INFLUENCE_TIERS[1]);
    expect(nextInfluenceTier(25)).toEqual(INFLUENCE_TIERS[2]);
  });

  it("is null once every rung is reached", () => {
    const top = INFLUENCE_TIERS[INFLUENCE_TIERS.length - 1];
    expect(nextInfluenceTier(top.threshold)).toBeNull();
    expect(nextInfluenceTier(top.threshold + 1)).toBeNull();
  });
});

describe("applyInfluenceDiscount", () => {
  it("charges the full price at the base rung", () => {
    expect(applyInfluenceDiscount(1_000, 0)).toBe(1_000);
  });

  it("floors to a whole Gold rather than rounding", () => {
    // 3% off 999 = 969.03 -> floors to 969.
    expect(applyInfluenceDiscount(999, 25)).toBe(969);
  });

  it("never lets a discount reach zero", () => {
    expect(applyInfluenceDiscount(1, 100_000)).toBe(1);
  });

  it("applies the top rung's discount past its threshold", () => {
    expect(applyInfluenceDiscount(10_000, 750)).toBe(8_500);
    expect(applyInfluenceDiscount(10_000, 999_999)).toBe(8_500);
  });

  it("never discounts below what the actual price would be at a lower rung", () => {
    const base = 10_000;
    let lastPrice = base;
    for (const total of [0, 25, 100, 300, 750]) {
      const price = applyInfluenceDiscount(base, total);
      expect(price).toBeLessThanOrEqual(lastPrice);
      lastPrice = price;
    }
  });
});
