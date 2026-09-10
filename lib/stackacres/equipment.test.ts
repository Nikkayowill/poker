import { describe, expect, it } from "vitest";
import {
  STACKACRES_STARTING_TIER,
  STACKACRES_TOOL_TIERS,
  STACKACRES_TOOL_TIER_DEFS,
  critBonusQuantity,
  isStackAcresToolTier,
  nextToolTier,
  rollHarvestCrit,
  stackacresToolTierDef,
  toStackAcresToolTier,
  toolTierRank,
  toolUpgradePrice,
  type StackAcresToolTier,
} from "./equipment";
import { STACKACRES_CAPACITY_PRICE } from "./catalogue";

describe("the ladder itself", () => {
  it("has nothing to do with cutting grass", () => {
    // The spades used to set the scythe's swathe, which is how the Golden
    // Spade ended up mowing the meadow. That lives in ./cutters.ts now.
    for (const tier of STACKACRES_TOOL_TIERS) {
      expect(Object.keys(STACKACRES_TOOL_TIER_DEFS[tier]), tier).not.toContain("reach");
    }
  });

  it("gives the starting rung away and charges for every other one", () => {
    expect(stackacresToolTierDef(STACKACRES_STARTING_TIER).price).toBeNull();
    for (const tier of STACKACRES_TOOL_TIERS) {
      if (tier === STACKACRES_STARTING_TIER) continue;
      expect(stackacresToolTierDef(tier).price, tier).toBeGreaterThan(0);
    }
  });

  it("gives the free rung no crit at all", () => {
    // The other half of "shipping this cannot change anything for a player who
    // buys nothing" -- see the ladder's own comment. A lucky harvest is what
    // the first purchase BUYS, not a rate it nudges.
    expect(STACKACRES_TOOL_TIER_DEFS[STACKACRES_STARTING_TIER].critChance).toBe(0);
    expect(rollHarvestCrit(STACKACRES_STARTING_TIER, () => 0)).toBe(false);
  });

  it("improves on every axis as it climbs, and never regresses on one", () => {
    // A rung that cost more and did one thing worse would be a trap, and a
    // trap is not something a player can be expected to read a table to spot.
    for (let i = 1; i < STACKACRES_TOOL_TIERS.length; i += 1) {
      const lower = STACKACRES_TOOL_TIER_DEFS[STACKACRES_TOOL_TIERS[i - 1]];
      const upper = STACKACRES_TOOL_TIER_DEFS[STACKACRES_TOOL_TIERS[i]];
      expect(upper.critChance, `${i}: critChance`).toBeGreaterThan(lower.critChance);
      expect(upper.critBonus, `${i}: critBonus`).toBeGreaterThanOrEqual(lower.critBonus);
      expect(upper.price ?? 0, `${i}: price`).toBeGreaterThan(lower.price ?? 0);
    }
  });

  it("keeps crit odds well under certain on every paid rung", () => {
    // A crit is a bonus, not a second yield table. Anything approaching 1
    // would make the ladder's top rung the only sensible way to farm.
    for (const tier of STACKACRES_TOOL_TIERS) {
      if (tier === STACKACRES_STARTING_TIER) continue;
      expect(STACKACRES_TOOL_TIER_DEFS[tier].critChance, tier).toBeGreaterThan(0);
      expect(STACKACRES_TOOL_TIER_DEFS[tier].critChance, tier).toBeLessThanOrEqual(0.35);
    }
  });

  it("prices the first paid rung above the dearest capacity slot", () => {
    // Where a tool belongs in the Gold ladder: a bigger commitment than one
    // more pen. The top rung is deliberately dearer than everything and is
    // not covered by this -- see the ladder's own doc comment.
    const dearestSlot = Math.max(...Object.values(STACKACRES_CAPACITY_PRICE));
    expect(STACKACRES_TOOL_TIER_DEFS["iron-shovel"].price).toBeGreaterThan(dearestSlot);
  });

  it("gives every rung its own sprite and a painter to fall back on", () => {
    const sprites = new Set<string>();
    for (const tier of STACKACRES_TOOL_TIERS) {
      const def = STACKACRES_TOOL_TIER_DEFS[tier];
      expect(def.sprite, tier).toMatch(/^\/stackacres\/sprites\/.+\.png$/);
      expect(def.icon.length, tier).toBeGreaterThan(0);
      sprites.add(def.sprite);
    }
    expect(sprites.size).toBe(STACKACRES_TOOL_TIERS.length);
  });
});

describe("nextToolTier and toolUpgradePrice", () => {
  it("walks the ladder in order and stops at the top", () => {
    let tier: StackAcresToolTier | null = STACKACRES_STARTING_TIER;
    const walked: StackAcresToolTier[] = [];
    while (tier) {
      walked.push(tier);
      tier = nextToolTier(tier);
    }
    expect(walked).toEqual([...STACKACRES_TOOL_TIERS]);
  });

  it("has nothing left to sell at the top rung", () => {
    const top = STACKACRES_TOOL_TIERS[STACKACRES_TOOL_TIERS.length - 1];
    expect(nextToolTier(top)).toBeNull();
    expect(toolUpgradePrice(top)).toBeNull();
  });

  it("quotes the next rung's own listed price, not a difference", () => {
    expect(toolUpgradePrice("trowel")).toBe(STACKACRES_TOOL_TIER_DEFS["iron-shovel"].price);
    expect(toolUpgradePrice("iron-shovel")).toBe(STACKACRES_TOOL_TIER_DEFS["golden-spade"].price);
  });

  it("ranks the rungs from the free one upward", () => {
    expect(toolTierRank(STACKACRES_STARTING_TIER)).toBe(0);
    expect(toolTierRank("golden-spade")).toBe(STACKACRES_TOOL_TIERS.length - 1);
  });
});

describe("toStackAcresToolTier", () => {
  it("reads every real rung back unchanged", () => {
    for (const tier of STACKACRES_TOOL_TIERS) expect(toStackAcresToolTier(tier)).toBe(tier);
  });

  it("degrades anything else to the starting rung rather than throwing", () => {
    // A row written before this feature existed has no tier at all, and a row
    // written by a future build must not 500 the farm's own load.
    for (const junk of [null, undefined, "", "diamond-spade", 3, {}, []]) {
      expect(toStackAcresToolTier(junk), String(junk)).toBe(STACKACRES_STARTING_TIER);
    }
  });

  it("agrees with isStackAcresToolTier", () => {
    expect(isStackAcresToolTier("golden-spade")).toBe(true);
    expect(isStackAcresToolTier("golden spade")).toBe(false);
    expect(isStackAcresToolTier(null)).toBe(false);
  });
});

describe("rollHarvestCrit", () => {
  it("crits exactly when the roll lands under the rung's own chance", () => {
    for (const tier of STACKACRES_TOOL_TIERS) {
      const chance = STACKACRES_TOOL_TIER_DEFS[tier].critChance;
      if (chance === 0) continue; // the free rung never crits; asserted above
      expect(rollHarvestCrit(tier, () => chance - 1e-9), tier).toBe(true);
      expect(rollHarvestCrit(tier, () => chance), tier).toBe(false);
      expect(rollHarvestCrit(tier, () => 0.999), tier).toBe(false);
    }
  });

  it("draws exactly once per call", () => {
    // The one call site is inside the server's guarded settlement write. A
    // second draw there would be a second chance at the same harvest.
    let draws = 0;
    rollHarvestCrit("golden-spade", () => {
      draws += 1;
      return 0.5;
    });
    expect(draws).toBe(1);
  });
});

describe("critBonusQuantity", () => {
  it("adds more units the further up the ladder, for the same line", () => {
    const bonus = STACKACRES_TOOL_TIERS.map((t) => critBonusQuantity(8, t));
    for (let i = 1; i < bonus.length; i += 1) {
      expect(bonus[i], STACKACRES_TOOL_TIERS[i]).toBeGreaterThanOrEqual(bonus[i - 1]);
    }
    expect(bonus[bonus.length - 1]).toBeGreaterThan(bonus[0]);
  });

  it("doubles the line at the top rung", () => {
    expect(critBonusQuantity(8, "golden-spade")).toBe(8);
  });

  it("only ever adds whole units", () => {
    for (const tier of STACKACRES_TOOL_TIERS) {
      for (const value of [1, 3, 7, 9, 13, 111]) {
        expect(Number.isInteger(critBonusQuantity(value, tier)), `${tier}/${value}`).toBe(true);
      }
    }
  });

  it("adds nothing to a line with nothing in it", () => {
    for (const tier of STACKACRES_TOOL_TIERS) {
      expect(critBonusQuantity(0, tier), tier).toBe(0);
      expect(critBonusQuantity(-100, tier), tier).toBe(0);
      expect(critBonusQuantity(Number.NaN, tier), tier).toBe(0);
    }
  });

  it("never adds more than the line itself at any rung", () => {
    for (const tier of STACKACRES_TOOL_TIERS) {
      expect(critBonusQuantity(1_000, tier), tier).toBeLessThanOrEqual(1_000);
    }
  });

  it("takes a forged bonus over the tier's own", () => {
    expect(critBonusQuantity(10, "iron-shovel", 1.5)).toBe(15);
  });
});
