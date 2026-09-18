import { describe, expect, it } from "vitest";
import { BAIT_FISH_WEIGHTS, FISH_SPECIES, FISH_WEIGHTS, isFishSpecies, pickCaughtFish } from "./fishing";

describe("pickCaughtFish", () => {
  it("picks bluegill on a low roll, catfish on a high one", () => {
    expect(pickCaughtFish(() => 0)).toBe("bluegill");
    expect(pickCaughtFish(() => 0.999)).toBe("catfish");
  });

  it("always returns one of the three species, whatever the roll", () => {
    for (const roll of [0, 0.1, 0.3, 0.5, 0.6, 0.61, 0.9, 0.999999]) {
      expect(FISH_SPECIES).toContain(pickCaughtFish(() => roll));
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
    expect(pickCaughtFish(() => 0.5)).toBe("bluegill");
    expect(pickCaughtFish(() => 0.5, true)).toBe("trout");
    // 0.8 is trout unbaited and catfish baited.
    expect(pickCaughtFish(() => 0.8)).toBe("trout");
    expect(pickCaughtFish(() => 0.8, true)).toBe("catfish");
    expect(pickCaughtFish(() => 0.29, true)).toBe("bluegill");
  });

  it("lands each fish at its baited rate over a fine sweep of rolls", () => {
    const counts = { bluegill: 0, trout: 0, catfish: 0 };
    for (let i = 0; i < 1000; i += 1) counts[pickCaughtFish(() => i / 1000, true)] += 1;
    expect(counts).toEqual({ bluegill: 300, trout: 450, catfish: 250 });
  });
});

describe("isFishSpecies", () => {
  it("accepts every id in FISH_SPECIES and rejects anything else", () => {
    for (const species of FISH_SPECIES) expect(isFishSpecies(species)).toBe(true);
    expect(isFishSpecies("wheat")).toBe(false);
    expect(isFishSpecies("")).toBe(false);
  });
});
