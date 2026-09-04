import { describe, expect, it } from "vitest";
import {
  STACKACRES_GOLD_CEILING,
  exchangeState,
  msUntilNextExchangeDay,
  stackacresExchangeDay,
} from "./exchange";
import { stackacresStockPrice } from "./market";
import { MONO_CROP_MAX_MULTIPLIER } from "./bounty";
import { STACKACRES_YIELDS } from "./items";
import { settleHarvest } from "./harvest";
import {
  STACKACRES_BASE_CAP,
  STACKACRES_MAX_EXTRA_CAP,
  STACKACRES_STOCK,
} from "./catalogue";

/**
 * The daily allowance's arithmetic.
 *
 * The shopfront this module used to have -- a rate, a Bushel balance, a choice
 * of how much to send -- went with the currency it traded. The valve behind it
 * did not, and it is the whole subject here. Most of the enforcement lives in
 * the service and the RPC, but two properties are decided in this file and are
 * worth pinning: the ceiling is a CONSTANT, and the day boundary is UTC.
 */

describe("the daily ceiling", () => {
  it("is a flat number, not a function of anything", () => {
    // Deliberately a type-level assertion as much as a value one. If this ever
    // has to become `ceilingFor(profile)` or `ceilingFor(unitsOwned)`, that is
    // the change that turns StackAcres back into a scaling faucet, and it
    // should have to delete this test to happen.
    expect(typeof STACKACRES_GOLD_CEILING).toBe("number");
    expect(STACKACRES_GOLD_CEILING).toBe(15_000);
  });

  it("stays inside what the farm can actually spend it on", () => {
    // The original bound here was "sits alongside the other faucets" -- daily
    // grant 2,500, rewarded ads 3,000 -- and it was the right test while the
    // farm had nothing to buy, because its output was pure addition to the
    // money supply. Now that Gold buys stock and capacity, the number that
    // keeps this honest is the SINK on the other side: a single day's ceiling
    // must stay well under what a Cattle Pen costs, or the farm pays for its
    // own upgrades in a day and stops being a sink at all.
    expect(STACKACRES_GOLD_CEILING).toBeGreaterThan(3_000);
    expect(STACKACRES_GOLD_CEILING * 3).toBeLessThan(stackacresStockPrice("cattle"));
  });

  /**
   * THE PROPERTY THE WHOLE SINGLE-CURRENCY REWRITE HAD TO PRESERVE. A harvest
   * pays Gold directly now, and a Bountiful Harvest multiplies what it pays --
   * so the question a reviewer will ask is whether a synergy widened the
   * faucet. It cannot: the multiplier lands on a sweep's value, and the sweep
   * is still paid through this ceiling. A maxed estate bringing in everything
   * at once, at the best multiplier in the game, is worth more than one day's
   * allowance, which means the allowance is what binds rather than the yield.
   */
  it("binds a maxed estate bringing everything in at once", () => {
    const perKind = STACKACRES_BASE_CAP + STACKACRES_MAX_EXTRA_CAP;
    const estate = STACKACRES_STOCK.flatMap((stock) =>
      Array.from({ length: perKind }, () => stock),
    );
    const settled = settleHarvest(
      estate.map((stock, index) => ({
        unitId: `u${index}`,
        stock,
        yieldQuantity: STACKACRES_YIELDS[stock].quantity,
      })),
    );
    // Bonus included, and before any maintenance is taken off -- the harshest
    // reading of the sweep, which is the one that has to still be capped.
    expect(settled.bounty.kind).toBe("crop_rotation");
    expect(settled.net).toBeGreaterThan(STACKACRES_GOLD_CEILING);
  });

  it("is not something the best synergy can widen", () => {
    // The multiplier lands on a sweep's value; the sweep is then paid THROUGH
    // this ceiling. So the largest number a bonus can produce is irrelevant to
    // how much leaves the farm, and the only thing worth asserting is that the
    // ceiling is not built from it.
    expect(MONO_CROP_MAX_MULTIPLIER).toBeGreaterThan(1);
    expect(STACKACRES_GOLD_CEILING % MONO_CROP_MAX_MULTIPLIER).not.toBe(0);
    expect(exchangeState(0, new Date()).ceiling).toBe(STACKACRES_GOLD_CEILING);
  });
});

describe("the day boundary", () => {
  it("is UTC, matching the daily grant rather than the device", () => {
    expect(stackacresExchangeDay(new Date("2026-09-01T00:00:00.000Z"))).toBe("2026-09-01");
    expect(stackacresExchangeDay(new Date("2026-09-01T23:59:59.999Z"))).toBe("2026-09-01");
    expect(stackacresExchangeDay(new Date("2026-09-02T00:00:00.000Z"))).toBe("2026-09-02");
  });

  it("counts down to the next UTC midnight", () => {
    expect(msUntilNextExchangeDay(new Date("2026-09-01T23:00:00.000Z"))).toBe(60 * 60 * 1000);
    expect(msUntilNextExchangeDay(new Date("2026-09-01T00:00:00.000Z"))).toBe(24 * 60 * 60 * 1000);
  });
});

describe("what the client is told", () => {
  it("reports the flat ceiling and what is left of it", () => {
    const state = exchangeState(1_000, new Date("2026-09-01T12:00:00.000Z"));
    expect(state.ceiling).toBe(STACKACRES_GOLD_CEILING);
    expect(state.usedToday).toBe(1_000);
    expect(state.remaining).toBe(STACKACRES_GOLD_CEILING - 1_000);
    expect(state.resetsAt).toBe("2026-09-02T00:00:00.000Z");
  });

  it("clamps a day that somehow reads over the ceiling", () => {
    // Belt and braces against a stale or corrupted total. A negative remaining
    // would render as a bar past its own width, which is worse than a full one.
    const state = exchangeState(STACKACRES_GOLD_CEILING + 900, new Date());
    expect(state.remaining).toBe(0);
    expect(state.usedToday).toBe(STACKACRES_GOLD_CEILING);
  });

  it("treats a negative total as an untouched day", () => {
    const state = exchangeState(-500, new Date());
    expect(state.usedToday).toBe(0);
    expect(state.remaining).toBe(STACKACRES_GOLD_CEILING);
  });
});
