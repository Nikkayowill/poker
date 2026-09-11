import { describe, expect, it } from "vitest";
import { FISH_SPECIES, isFishSpecies, pickCaughtFish } from "./fishing";

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

describe("isFishSpecies", () => {
  it("accepts every id in FISH_SPECIES and rejects anything else", () => {
    for (const species of FISH_SPECIES) expect(isFishSpecies(species)).toBe(true);
    expect(isFishSpecies("wheat")).toBe(false);
    expect(isFishSpecies("")).toBe(false);
  });
});
