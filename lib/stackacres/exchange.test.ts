import { describe, expect, it } from "vitest";
import {
  STACKACRES_GOLD_CEILING,
  exchangeState,
  msUntilNextExchangeDay,
  stackacresExchangeDay,
} from "./exchange";
import { STACKACRES_YIELDS } from "./items";
import { settleHarvest } from "./harvest";
import {
  STACKACRES_BASE_CAP,
  STACKACRES_LIVESTOCK,
  STACKACRES_MAX_EXTRA_CAP,
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
    expect(STACKACRES_GOLD_CEILING).toBe(100_000);
  });

  it("stays inside what the farm can actually spend it on", () => {
    // The original bound here was "sits alongside the other faucets" -- daily
    // grant 2,500, rewarded ads 3,000 -- and it was the right test while the
    // farm had nothing to buy, because its output was pure addition to the
    // money supply. Now that Gold buys stock and capacity, the number that
    // keeps this honest is the SINK on the other side.
    //
    // Up to 2026-09-05 that sink was "less than the priciest single stock
    // (cattle)" -- true at a 50,000 ceiling, false at 100,000: cattle is
    // 60,000, so the 2026-09-10 raise (Kayo's call) deliberately lets a day's
    // allowance alone clear one Cattle Pen. That is an intended trade, not a
    // gap this test should hide. What still has to hold, and what this test
    // holds instead, is the sink against COSMETICS -- the reason the ceiling
    // was raised in the first place: even the new ceiling doesn't buy the
    // most expensive cosmetic in a single day, so the farm stays a net sink
    // for the thing players are actually saving toward.
    expect(STACKACRES_GOLD_CEILING).toBeGreaterThan(3_000);
    expect(STACKACRES_GOLD_CEILING).toBeLessThan(350_000);
  });

  /**
   * A harvest pays no Gold now; Sell is the door, and it reserves against
   * this ceiling. A maxed estate's whole sweep, sold at list price, still
   * sits under the ceiling, so the valve is the ceiling and not the yields.
   */
  it("is larger than a maxed estate's whole sweep sold at list price", () => {
    const perKind = STACKACRES_BASE_CAP + STACKACRES_MAX_EXTRA_CAP;
    const estate = [
      ...STACKACRES_LIVESTOCK.flatMap((stock) => Array.from({ length: perKind }, () => stock)),
      ...Array.from({ length: perKind }, () => "carrot" as const),
      ...Array.from({ length: perKind }, () => "corn" as const),
    ];
    const settled = settleHarvest(
      estate.map((stock, index) => ({
        unitId: `u${index}`,
        stock,
        yieldQuantity: STACKACRES_YIELDS[stock].quantity,
      })),
    );
    expect(settled.gross).toBeGreaterThan(0);
    expect(STACKACRES_GOLD_CEILING).toBeGreaterThan(settled.gross);
  });

  it("is what the client is told, whatever was sold", () => {
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
