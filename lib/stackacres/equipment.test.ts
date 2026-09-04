import { describe, expect, it } from "vitest";
import {
  STACKACRES_STARTING_TIER,
  STACKACRES_TOOL_TIERS,
  STACKACRES_TOOL_TIER_DEFS,
  critGoldFor,
  isStackAcresToolTier,
  nextToolTier,
  rollHarvestCrit,
  scytheReachFor,
  stackacresToolTierDef,
  strokesToClearWidth,
  toStackAcresToolTier,
  toolTierRank,
  toolUpgradePrice,
  type StackAcresToolTier,
} from "./equipment";
import { SCYTHE_REACH } from "./zones";
import { STACKACRES_CAPACITY_PRICE } from "./catalogue";

describe("the ladder itself", () => {
  it("starts where the game already plays", () => {
    // THE regression guard on this whole feature. If the starting rung's
    // reach ever drifts from SCYTHE_REACH, shipping the equipment shop is a
    // silent nerf to every player who never buys anything.
    expect(scytheReachFor(STACKACRES_STARTING_TIER)).toBe(SCYTHE_REACH);
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
      expect(upper.reach, `${i}: reach`).toBeGreaterThan(lower.reach);
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

describe("strokesToClearWidth", () => {
  it("takes strictly fewer passes as the ladder climbs", () => {
    // The ladder's first effect, stated as TAPS -- which is what the player
    // actually experiences when clearing an overgrown Long Meadow.
    const band = 400;
    const passes = STACKACRES_TOOL_TIERS.map((t) => strokesToClearWidth(band, t));
    for (let i = 1; i < passes.length; i += 1) {
      expect(passes[i], STACKACRES_TOOL_TIERS[i]).toBeLessThan(passes[i - 1]);
    }
  });

  it("halves the passes between the free rung and the top one", () => {
    // What the Golden Spade's own shelf copy promises ("clears the meadow in
    // half the passes"). Held here so a retune of `reach` cannot quietly make
    // the store lie.
    const band = 1_000;
    const trowel = strokesToClearWidth(band, "trowel");
    const spade = strokesToClearWidth(band, "golden-spade");
    expect(spade).toBeLessThanOrEqual(Math.ceil(trowel / 2));
  });

  it("gives the Iron Shovel half again the swathe, as its row claims", () => {
    expect(scytheReachFor("iron-shovel")).toBeCloseTo(scytheReachFor("trowel") * 1.5, 6);
  });

  it("rounds up -- a band two and a half passes wide takes three", () => {
    const reach = scytheReachFor("trowel");
    expect(strokesToClearWidth(reach * 2 * 2.5, "trowel")).toBe(3);
    expect(strokesToClearWidth(reach * 2, "trowel")).toBe(1);
  });

  it("asks for no passes over no ground", () => {
    expect(strokesToClearWidth(0, "trowel")).toBe(0);
    expect(strokesToClearWidth(-40, "trowel")).toBe(0);
    expect(strokesToClearWidth(Number.NaN, "trowel")).toBe(0);
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

describe("critGoldFor", () => {
  it("pays more the further up the ladder, for the same harvest", () => {
    const paid = STACKACRES_TOOL_TIERS.map((t) => critGoldFor(400, t));
    for (let i = 1; i < paid.length; i += 1) {
      expect(paid[i], STACKACRES_TOOL_TIERS[i]).toBeGreaterThanOrEqual(paid[i - 1]);
    }
    expect(paid[paid.length - 1]).toBeGreaterThan(paid[0]);
  });

  it("doubles the harvest at the top rung", () => {
    expect(critGoldFor(440, "golden-spade")).toBe(440);
  });

  it("only ever pays whole Gold", () => {
    for (const tier of STACKACRES_TOOL_TIERS) {
      for (const value of [1, 3, 7, 9, 13, 111]) {
        expect(Number.isInteger(critGoldFor(value, tier)), `${tier}/${value}`).toBe(true);
      }
    }
  });

  it("never pays anything on a harvest worth nothing", () => {
    // A sweep fully eaten by Land Maintenance crits for nothing: the crit
    // multiplies a harvest, and doubling zero is not a reward.
    for (const tier of STACKACRES_TOOL_TIERS) {
      expect(critGoldFor(0, tier), tier).toBe(0);
      expect(critGoldFor(-100, tier), tier).toBe(0);
      expect(critGoldFor(Number.NaN, tier), tier).toBe(0);
    }
  });

  it("can never ask for more than the harvest itself at any rung", () => {
    // What makes the optimistic reservation safe to size off the top rung:
    // no rung's crit exceeds 1x, so `net + critGoldFor(net)` is at most
    // double, and the ceiling still bounds it.
    for (const tier of STACKACRES_TOOL_TIERS) {
      expect(critGoldFor(1_000, tier), tier).toBeLessThanOrEqual(1_000);
    }
  });
});
