import { describe, expect, it } from "vitest";
import { seededRandom } from "./world";
import type { StackAcresShopProgress } from "./shop-locks";
import {
  QUARRY_CATALOGUE,
  QUARRY_SPECIES,
  RIFLE_LEVEL,
  RIFLE_UNLOCK,
  bestWeapon,
  isHuntingWeapon,
  isQuarrySpecies,
  pickQuarry,
  rifleUnlocked,
} from "./hunting";

/** A farm holding exactly `flags` of the five milestone flags, built the way
 *  the real progress object is derived rather than by faking a level. */
function progressWith(flags: number): StackAcresShopProgress {
  return {
    cropFieldsUnlocked: flags >= 1,
    influence: flags >= 2 ? 1 : 0,
    greenhouseBuilt: flags >= 3,
    sectors: flags >= 4 ? ["wallow"] : [],
  };
}

describe("QUARRY_CATALOGUE", () => {
  it("covers every species the roll can return", () => {
    expect(Object.keys(QUARRY_CATALOGUE).sort()).toEqual([...QUARRY_SPECIES].sort());
  });

  it("never sends a player home from a finished stalk empty-handed", () => {
    for (const species of QUARRY_SPECIES) {
      expect(QUARRY_CATALOGUE[species].meat).toBeGreaterThanOrEqual(1);
      expect(QUARRY_CATALOGUE[species].pelt).toBeGreaterThanOrEqual(1);
    }
  });

  it("pays more as the quarry gets rarer", () => {
    const [common, fair, rare] = QUARRY_SPECIES.map((species) => QUARRY_CATALOGUE[species]);
    expect(common.meat).toBeLessThan(fair.meat);
    expect(fair.meat).toBeLessThan(rare.meat);
    expect(common.pelt).toBeLessThan(fair.pelt);
    expect(fair.pelt).toBeLessThanOrEqual(rare.pelt);
  });
});

describe("pickQuarry", () => {
  it("returns a real species for every roll in range", () => {
    const random = seededRandom(7);
    for (let i = 0; i < 500; i += 1) {
      expect(isQuarrySpecies(pickQuarry(random))).toBe(true);
    }
  });

  it("puts the common quarry at the bottom of the range and the rare at the top", () => {
    expect(pickQuarry(() => 0)).toBe("rabbit");
    expect(pickQuarry(() => 0.99)).toBe("boar");
  });

  it("lands roughly on the advertised weights over many rolls", () => {
    const random = seededRandom(11);
    const counts: Record<string, number> = { rabbit: 0, deer: 0, boar: 0 };
    const rolls = 20_000;
    for (let i = 0; i < rolls; i += 1) counts[pickQuarry(random)] += 1;
    expect(counts.rabbit / rolls).toBeCloseTo(0.55, 1);
    expect(counts.deer / rolls).toBeCloseTo(0.32, 1);
    expect(counts.boar / rolls).toBeCloseTo(0.13, 1);
  });

  it("replays exactly from a seed", () => {
    const first = Array.from({ length: 30 }, (_, i) => pickQuarry(seededRandom(i)));
    const again = Array.from({ length: 30 }, (_, i) => pickQuarry(seededRandom(i)));
    expect(again).toEqual(first);
  });
});

describe("the rifle's gate", () => {
  it("is the same milestone count the spec's Level 4 means", () => {
    expect(RIFLE_UNLOCK).toEqual({ kind: "milestone", count: RIFLE_LEVEL - 1 });
  });

  it("is shut on a fresh farm and open once three milestones are in", () => {
    expect(rifleUnlocked(progressWith(0))).toBe(false);
    expect(rifleUnlocked(progressWith(2))).toBe(false);
    expect(rifleUnlocked(progressWith(3))).toBe(true);
    expect(rifleUnlocked(progressWith(5))).toBe(true);
  });

  it("puts a bow in every hand that has not earned the rifle, and never nothing", () => {
    expect(bestWeapon(progressWith(0))).toBe("bow");
    expect(bestWeapon(progressWith(2))).toBe("bow");
    expect(bestWeapon(progressWith(3))).toBe("rifle");
    for (let flags = 0; flags <= 5; flags += 1) {
      expect(isHuntingWeapon(bestWeapon(progressWith(flags)))).toBe(true);
    }
  });
});
