import { describe, expect, it } from "vitest";
import {
  BAIT_FISH_WEIGHTS,
  CAST_FISH_WEIGHTS,
  FISH_SPECIES,
  FISH_WEIGHTS,
  PERFECT_CAST,
  castTier,
  isFishSpecies,
  pickCaughtFish,
} from "./fishing";

describe("pickCaughtFish", () => {
  it("picks bluegill on a low roll, catfish on a high one", () => {
    expect(pickCaughtFish(() => 0, false, "mid")).toBe("bluegill");
    expect(pickCaughtFish(() => 0.999, false, "mid")).toBe("catfish");
  });

  it("always returns one of the three species, whatever the roll", () => {
    for (const roll of [0, 0.1, 0.3, 0.5, 0.6, 0.61, 0.9, 0.999999]) {
      expect(FISH_SPECIES).toContain(pickCaughtFish(() => roll, false, "mid"));
    }
  });
});

describe("radish bait", () => {
  it("shifts the odds to 30/45/25 from 60/30/10", () => {
    expect(FISH_WEIGHTS).toEqual({ bluegill: 60, trout: 30, catfish: 10 });
    expect(BAIT_FISH_WEIGHTS).toEqual({ bluegill: 30, trout: 45, catfish: 25 });
  });

  it("picks from the baited odds only when baited", () => {
    // A 0.5 roll is bluegill unbaited (under 60) and trout baited (30 to 75).
    expect(pickCaughtFish(() => 0.5, false, "mid")).toBe("bluegill");
    expect(pickCaughtFish(() => 0.5, true, "mid")).toBe("trout");
    // 0.8 is trout unbaited and catfish baited.
    expect(pickCaughtFish(() => 0.8, false, "mid")).toBe("trout");
    expect(pickCaughtFish(() => 0.8, true, "mid")).toBe("catfish");
    expect(pickCaughtFish(() => 0.29, true, "mid")).toBe("bluegill");
  });

  it("lands each fish at its baited rate over a fine sweep of rolls", () => {
    const counts = { bluegill: 0, trout: 0, catfish: 0 };
    for (let i = 0; i < 1000; i += 1) counts[pickCaughtFish(() => i / 1000, true, "mid")] += 1;
    expect(counts).toEqual({ bluegill: 300, trout: 450, catfish: 250 });
  });
});

describe("cast tiers", () => {
  it("sorts the power bar into short, mid, long and perfect", () => {
    expect(castTier(0)).toBe("short");
    expect(castTier(0.34)).toBe("short");
    expect(castTier(0.35)).toBe("mid");
    expect(castTier(0.74)).toBe("mid");
    expect(castTier(0.75)).toBe("long");
    expect(castTier(PERFECT_CAST - 0.001)).toBe("long");
    expect(castTier(PERFECT_CAST)).toBe("perfect");
    expect(castTier(1)).toBe("perfect");
  });

  it("keeps the odds fishing always had for a mid cast", () => {
    expect(CAST_FISH_WEIGHTS.mid).toEqual({ plain: FISH_WEIGHTS, bait: BAIT_FISH_WEIGHTS });
  });

  it("adds every tier's odds up to 100", () => {
    for (const tier of Object.values(CAST_FISH_WEIGHTS)) {
      for (const weights of [tier.plain, tier.bait]) {
        expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(100);
      }
    }
  });

  it("finds rarer fish the farther out the cast lands, baited or not", () => {
    const order = ["short", "mid", "long", "perfect"] as const;
    for (const kind of ["plain", "bait"] as const) {
      for (let i = 1; i < order.length; i++) {
        expect(CAST_FISH_WEIGHTS[order[i]][kind].catfish).toBeGreaterThan(CAST_FISH_WEIGHTS[order[i - 1]][kind].catfish);
        expect(CAST_FISH_WEIGHTS[order[i]][kind].bluegill).toBeLessThan(CAST_FISH_WEIGHTS[order[i - 1]][kind].bluegill);
      }
    }
  });

  it("picks from the tier's own odds", () => {
    // 0.9 is trout on a short plain cast (75 to 97) and catfish on a perfect one (80 to 100).
    expect(pickCaughtFish(() => 0.9, false, "short")).toBe("trout");
    expect(pickCaughtFish(() => 0.9, false, "perfect")).toBe("catfish");
  });
});

describe("isFishSpecies", () => {
  it("accepts every id in FISH_SPECIES and rejects anything else", () => {
    for (const species of FISH_SPECIES) expect(isFishSpecies(species)).toBe(true);
    expect(isFishSpecies("wheat")).toBe(false);
    expect(isFishSpecies("")).toBe(false);
  });
});
