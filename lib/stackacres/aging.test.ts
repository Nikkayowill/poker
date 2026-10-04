import { describe, expect, it } from "vitest";
import {
  AGING_TIERS,
  CELLAR_AGING_TIERS,
  agedGoldValue,
  firstAgingTier,
  msUntilAgingTier,
  nextAgingTier,
  toVatContainer,
  vatTierForElapsed,
} from "./aging";

describe("AGING_TIERS", () => {
  it("is three rungs of 1.5x/2x/3x, the same ladder as the Cellar", () => {
    expect(AGING_TIERS.map((t) => t.multiplier)).toEqual([1.5, 2, 3]);
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
    expect(agedGoldValue(1000, AGING_TIERS[0])).toBe(1500);
    expect(agedGoldValue(1000, AGING_TIERS[1])).toBe(2000);
    expect(agedGoldValue(1000, AGING_TIERS[2])).toBe(3000);
  });

  it("rounds to the nearest Gold", () => {
    expect(agedGoldValue(333, AGING_TIERS[0])).toBe(Math.round(333 * 1.5));
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

});

describe("the Preserves Cellar ladder", () => {
  const hour = 60 * 60 * 1000;

  it("ages over hours, not minutes, and even the first tier beats selling now", () => {
    expect(vatTierForElapsed(hour - 1, CELLAR_AGING_TIERS)).toBeNull();
    expect(vatTierForElapsed(hour, CELLAR_AGING_TIERS)?.label).toBe("Aged");
    expect(vatTierForElapsed(4 * hour, CELLAR_AGING_TIERS)?.label).toBe("Well-Aged");
    expect(vatTierForElapsed(48 * hour, CELLAR_AGING_TIERS)?.label).toBe("Cellar-Aged");
    expect(CELLAR_AGING_TIERS[0].multiplier).toBeGreaterThan(1);
  });

  it("shows the cellar's own ladder in its container", () => {
    const manifest = {
      item: "pickles" as const,
      quantity: 12,
      baseGoldValue: 720,
      sealedAt: new Date(0).toISOString(),
      readyAt: new Date(hour).toISOString(),
    };
    const container = toVatContainer({ id: "m" }, manifest, new Date(4 * hour), CELLAR_AGING_TIERS);
    expect(container.status).toBe("collectible");
    expect(container.collectibleGoldValue).toBe(1_440);
    expect(container.nextTier?.label).toBe("Cellar-Aged");
    expect(container.maxGoldValue).toBe(2_160);
  });
});
