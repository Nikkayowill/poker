import { describe, expect, it } from "vitest";
import {
  AGING_TIERS,
  VAT_INPUT_QUANTITY,
  agedGoldValue,
  baseGoldValueForSeal,
  firstAgingTier,
  msUntilAgingTier,
  nextAgingTier,
  toVatContainer,
  vatTierForElapsed,
  type AgingManifest,
} from "./aging";
import { recipeRawGoldValue } from "./recipes";

describe("AGING_TIERS", () => {
  it("is exactly the three rungs the brief specified: 2x/4x/8x, doubling each step", () => {
    expect(AGING_TIERS.map((t) => t.multiplier)).toEqual([2, 4, 8]);
    expect(AGING_TIERS.map((t) => t.stars)).toEqual([1, 2, 3]);
    // Strictly increasing duration -- a later tier is always further out than
    // the one before it, or vatTierForElapsed's "walk from the top down"
    // search would find the wrong rung.
    for (let i = 1; i < AGING_TIERS.length; i += 1) {
      expect(AGING_TIERS[i].durationMs).toBeGreaterThan(AGING_TIERS[i - 1].durationMs);
    }
  });

  it("firstAgingTier is AGING_TIERS[0]", () => {
    expect(firstAgingTier()).toBe(AGING_TIERS[0]);
  });
});

describe("vatTierForElapsed", () => {
  it("is null before the first tier's duration elapses", () => {
    expect(vatTierForElapsed(0)).toBeNull();
    expect(vatTierForElapsed(AGING_TIERS[0].durationMs - 1)).toBeNull();
  });

  it("reaches each tier the instant its duration elapses, and stays there until the next", () => {
    expect(vatTierForElapsed(AGING_TIERS[0].durationMs)?.tier).toBe(1);
    expect(vatTierForElapsed(AGING_TIERS[1].durationMs - 1)?.tier).toBe(1);
    expect(vatTierForElapsed(AGING_TIERS[1].durationMs)?.tier).toBe(2);
    expect(vatTierForElapsed(AGING_TIERS[2].durationMs)?.tier).toBe(3);
  });

  it("never overflows past the final tier -- aged well past it still reads as tier 3", () => {
    expect(vatTierForElapsed(AGING_TIERS[2].durationMs * 100)?.tier).toBe(3);
  });
});

describe("nextAgingTier", () => {
  it("walks the ladder forward, and is null once it is exhausted", () => {
    expect(nextAgingTier(null)?.tier).toBe(1);
    expect(nextAgingTier(AGING_TIERS[0])?.tier).toBe(2);
    expect(nextAgingTier(AGING_TIERS[1])?.tier).toBe(3);
    expect(nextAgingTier(AGING_TIERS[2])).toBeNull();
  });
});

describe("msUntilAgingTier", () => {
  it("counts down to zero and clamps there, never negative", () => {
    const target = AGING_TIERS[1];
    expect(msUntilAgingTier(0, target)).toBe(target.durationMs);
    expect(msUntilAgingTier(target.durationMs, target)).toBe(0);
    expect(msUntilAgingTier(target.durationMs * 2, target)).toBe(0);
  });
});

describe("agedGoldValue", () => {
  it("scales the batch's base value by exactly the tier's multiplier", () => {
    expect(agedGoldValue(1000, AGING_TIERS[0])).toBe(2000);
    expect(agedGoldValue(1000, AGING_TIERS[1])).toBe(4000);
    expect(agedGoldValue(1000, AGING_TIERS[2])).toBe(8000);
  });

  it("rounds to the nearest Gold", () => {
    expect(agedGoldValue(333, AGING_TIERS[0])).toBe(Math.round(333 * 2));
  });
});

describe("baseGoldValueForSeal", () => {
  it("is VAT_INPUT_QUANTITY times what one Cheese costs in forgone Milk Gold", () => {
    const perUnit = recipeRawGoldValue("cheese");
    expect(perUnit).not.toBeNull();
    expect(baseGoldValueForSeal()).toBe(Math.round((perUnit as number) * VAT_INPUT_QUANTITY));
  });
});

describe("toVatContainer", () => {
  const machine = { id: "vat-1" };

  it("is empty with nothing collectible when no manifest is sealed", () => {
    const snap = toVatContainer(machine, null, new Date());
    expect(snap.status).toBe("empty");
    expect(snap.manifest).toBeNull();
    expect(snap.collectibleGoldValue).toBe(0);
    expect(snap.maxGoldValue).toBe(0);
  });

  it("is aging and uncollectible before the first tier clears", () => {
    const now = new Date("2026-09-06T12:00:00.000Z");
    const manifest: AgingManifest = {
      item: "cheese",
      quantity: VAT_INPUT_QUANTITY,
      baseGoldValue: 1000,
      sealedAt: now.toISOString(),
      readyAt: new Date(now.getTime() + AGING_TIERS[0].durationMs).toISOString(),
    };
    const snap = toVatContainer(machine, manifest, now);
    expect(snap.status).toBe("aging");
    expect(snap.currentTier).toBeNull();
    expect(snap.nextTier?.tier).toBe(1);
    expect(snap.collectibleGoldValue).toBe(0);
    // The ceiling value is always known, even while still aging -- it is what
    // the "wait and this is worth N" line in the UI reads off of.
    expect(snap.maxGoldValue).toBe(agedGoldValue(1000, AGING_TIERS[2]));
  });

  it("is collectible at exactly the value the reached tier pays", () => {
    const sealedAt = new Date("2026-09-06T12:00:00.000Z");
    const now = new Date(sealedAt.getTime() + AGING_TIERS[1].durationMs);
    const manifest: AgingManifest = {
      item: "cheese",
      quantity: VAT_INPUT_QUANTITY,
      baseGoldValue: 1000,
      sealedAt: sealedAt.toISOString(),
      readyAt: new Date(sealedAt.getTime() + AGING_TIERS[0].durationMs).toISOString(),
    };
    const snap = toVatContainer(machine, manifest, now);
    expect(snap.status).toBe("collectible");
    expect(snap.currentTier?.tier).toBe(2);
    expect(snap.nextTier?.tier).toBe(3);
    expect(snap.collectibleGoldValue).toBe(agedGoldValue(1000, AGING_TIERS[1]));
  });
});
