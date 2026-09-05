import { describe, expect, it } from "vitest";
import { harvestTally, settleHarvest, type HarvestCandidate } from "./harvest";
import { STACKACRES_YIELDS, itemGoldValue, yieldValue } from "./items";
import { stackacresUpkeepFee } from "./upkeep";
import { STACKACRES_PRESTIGE_BASE_MULTIPLIER } from "./prestige";
import type { StackAcresStock } from "./catalogue";

let seq = 0;
function unit(stock: StackAcresStock, yieldQuantity?: number): HarvestCandidate {
  seq += 1;
  return {
    unitId: `u${seq}`,
    stock,
    yieldQuantity: yieldQuantity ?? STACKACRES_YIELDS[stock].quantity,
  };
}

/**
 * The one-step harvest. What used to take a barn, a shelf and a window is one
 * function, so this is where the arithmetic that used to be spread across
 * three services is actually pinned down.
 */
describe("settleHarvest", () => {
  it("values a single unit at its snapshotted yield times today's price", () => {
    const settled = settleHarvest([unit("cattle")]);
    expect(settled.gross).toBe(yieldValue("cattle"));
    expect(settled.net).toBe(settled.gross);
    expect(settled.bounty.kind).toBeNull();
    expect(settled.bonus).toBe(0);
    expect(settled.upkeepCharged).toBe(0);
  });

  /**
   * Rule 3. A unit stocked before a retune must pay what it agreed to, which
   * is why the QUANTITY comes off the row and only the per-item value is read
   * live.
   */
  it("uses the row's snapshotted quantity, not the catalogue's current one", () => {
    const stale = unit("hen", 99);
    expect(settleHarvest([stale]).gross).toBe(itemGoldValue("eggs") * 99);
  });

  it("sums a sweep and pays one number for it", () => {
    const settled = settleHarvest([unit("sprout"), unit("cattle")]);
    expect(settled.gross).toBe(yieldValue("sprout") + yieldValue("cattle"));
    expect(settled.lines).toHaveLength(2);
    expect(settled.lines.map((line) => line.item)).toEqual(["carrot", "milk"]);
  });

  it("applies Mono-cropping to the whole sweep", () => {
    const settled = settleHarvest([unit("hen"), unit("hen"), unit("hen")]);
    expect(settled.bounty.kind).toBe("mono_crop");
    expect(settled.gross).toBe(yieldValue("hen") * 3);
    expect(settled.net).toBe(Math.floor(settled.gross * 1.05));
    expect(settled.bonus).toBe(settled.net - settled.gross);
  });

  it("applies Crop Rotation to a balanced mix", () => {
    const settled = settleHarvest([unit("cash_crop"), unit("cattle")].concat([unit("sprout"), unit("hen")]));
    expect(settled.bounty.kind).toBe("crop_rotation");
    expect(settled.net).toBeGreaterThan(settled.gross);
  });

  /**
   * ORDER. The synergy multiplies the GROSS and maintenance comes out after,
   * so the same three cattle earn the same bonus on a day the fee is already
   * paid as on a day it is not.
   */
  it("multiplies the gross, then takes maintenance off the result", () => {
    const sweep = [unit("cattle"), unit("cattle"), unit("cattle")];
    const free = settleHarvest(sweep);
    const billed = settleHarvest(sweep, 500);
    expect(billed.bonus).toBe(free.bonus);
    expect(billed.upkeepCharged).toBe(500);
    expect(billed.net).toBe(free.net - 500);
  });

  /**
   * The safety property, restated where it actually lands: a harvest is never
   * negative, however large the estate's fee has grown.
   */
  it("never settles below zero, however big the fee", () => {
    const settled = settleHarvest([unit("sprout")], stackacresUpkeepFee(30));
    expect(settled.net).toBe(0);
    expect(settled.upkeepCharged).toBe(settled.gross);
    expect(settled.upkeepCharged).toBeLessThan(stackacresUpkeepFee(30));
  });

  it("settles an empty sweep at nothing rather than throwing", () => {
    const settled = settleHarvest([], 900);
    expect(settled).toMatchObject({ gross: 0, net: 0, bonus: 0, upkeepCharged: 0 });
    expect(settled.lines).toEqual([]);
  });

  /**
   * WHY `harvestStackAcres` CAPS ITS PAYOUT AT WHAT IT RESERVED, stated as the
   * counter-example rather than as a rule, because the intuitive rule is
   * false: a sweep that LOSES a unit can be worth MORE than the sweep that
   * contained it.
   *
   * Three cattle and one carrot is 5,316 and earns nothing -- one crop in four
   * is below the rotation floor. Drop the carrot and the same three cattle are
   * a Mono-crop: 5,280 at 1.05 is 5,544. Losing 36 Gold of carrot gained 228.
   *
   * That is not a bug in the bonuses; a set genuinely is a different thing
   * from its subsets. It is a bug waiting to happen in the SERVICE, which
   * reserves against the flat daily ceiling before it settles and re-prices
   * afterwards against whatever actually settled. This case is the only reason
   * that re-price is clamped, and this test is here so nobody removes the
   * clamp on the reasoning I started with.
   */
  it("can be worth MORE after a unit drops out, which is why the payout is capped", () => {
    const carrot = unit("sprout");
    const full = [unit("cattle"), unit("cattle"), unit("cattle"), carrot];
    const withoutCarrot = full.filter((candidate) => candidate !== carrot);

    expect(settleHarvest(full).bounty.kind).toBeNull();
    expect(settleHarvest(withoutCarrot).bounty.kind).toBe("mono_crop");
    expect(settleHarvest(withoutCarrot).net).toBeGreaterThan(settleHarvest(full).net);
  });
});

/**
 * The Prestige Reset Valve's permanent multiplier. Applied alongside the
 * synergy, before upkeep -- see harvest.ts's own header for why that
 * ordering, not any other, is the one that keeps the daily ceiling and the
 * upkeep sink meaningful for a boosted profile too.
 */
describe("settleHarvest with a prestige multiplier", () => {
  it("defaults to the base multiplier (no effect) when none is passed, matching every pre-valve call site", () => {
    const sweep = [unit("cattle")];
    expect(settleHarvest(sweep).prestigeMultiplier).toBe(STACKACRES_PRESTIGE_BASE_MULTIPLIER);
    expect(settleHarvest(sweep).prestigeBonus).toBe(0);
    expect(settleHarvest(sweep, 0, STACKACRES_PRESTIGE_BASE_MULTIPLIER)).toEqual(settleHarvest(sweep));
  });

  it("multiplies the already-synergized gross, not the raw gross", () => {
    const sweep = [unit("hen"), unit("hen"), unit("hen")]; // mono-crop, 1.05x
    const base = settleHarvest(sweep); // upkeepDue 0, so base.net === floor(gross * 1.05)
    const boosted = settleHarvest(sweep, 0, 2);
    expect(boosted.gross).toBe(base.gross);
    expect(boosted.net).toBe(Math.floor(base.net * 2));
    expect(boosted.prestigeBonus).toBe(Math.floor(base.net * 2) - base.net);
  });

  it("still lets Land Maintenance net out of the boosted amount, never bypassing the sink", () => {
    const sweep = [unit("cattle"), unit("cattle"), unit("cattle")];
    const bonused = settleHarvest(sweep).net; // upkeepDue 0, so net === the synergized amount
    const boosted = settleHarvest(sweep, 500, 2);
    expect(boosted.upkeepCharged).toBe(500);
    expect(boosted.net).toBe(Math.floor(bonused * 2) - 500);
  });

  it("never records the multiplier onto the per-line ledger gross, so the prestige feed cannot compound itself", () => {
    const sweep = [unit("cattle")];
    const boosted = settleHarvest(sweep, 0, 3);
    expect(boosted.gross).toBe(yieldValue("cattle"));
    expect(boosted.lines[0].gold).toBe(yieldValue("cattle"));
  });

  it("refuses to ever pay out less than the unboosted amount, even given a corrupt sub-1 multiplier", () => {
    const sweep = [unit("cattle")];
    const base = settleHarvest(sweep);
    const corrupted = settleHarvest(sweep, 0, 0.1);
    expect(corrupted.net).toBe(base.net);
    expect(corrupted.prestigeMultiplier).toBe(STACKACRES_PRESTIGE_BASE_MULTIPLIER);
  });

  it("floors the boosted amount rather than inventing a fractional Gold piece", () => {
    const sweep = [unit("sprout")];
    const boosted = settleHarvest(sweep, 0, 1.3333);
    expect(Number.isInteger(boosted.net)).toBe(true);
  });
});

describe("harvestTally", () => {
  it("sums a sweep per item, so five hen coops read as one line", () => {
    const settled = settleHarvest([unit("hen"), unit("hen"), unit("sprout")]);
    expect(harvestTally(settled)).toEqual([
      { item: "eggs", quantity: STACKACRES_YIELDS.hen.quantity * 2 },
      { item: "carrot", quantity: STACKACRES_YIELDS.sprout.quantity },
    ]);
  });
});
