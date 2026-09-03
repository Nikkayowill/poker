import { describe, expect, it } from "vitest";
import {
  STACKACRES_GOLD_CEILING,
  STACKACRES_GOLD_PER_BUSHEL,
  STACKACRES_MAX_EXCHANGE_BUSHELS,
  bushelsWithinAllowance,
  exchangeState,
  goldForBushels,
  stackacresExchangeDay,
  msUntilNextExchangeDay,
} from "./exchange";

/**
 * The exchange window's arithmetic. Most of what matters about this feature is
 * enforced in the service and the RPC, but two properties are decided here and
 * are worth pinning: the ceiling is a CONSTANT, and the day boundary is UTC.
 */

describe("the daily ceiling", () => {
  it("is a flat number, not a function of anything", () => {
    // Deliberately a type-level assertion as much as a value one. If this ever
    // has to become `ceilingFor(profile)` or `ceilingFor(plotsOwned)`, that is
    // the change that turns the StackAcres back into a scaling faucet, and it
    // should have to delete this test to happen.
    expect(typeof STACKACRES_GOLD_CEILING).toBe("number");
    expect(STACKACRES_GOLD_CEILING).toBe(5_000);
  });

  it("sits alongside the faucets that already exist, not above them", () => {
    // Daily grant 1,000 x 2.5 streak = 2,500; rewarded ads 500 x 6 = 3,000.
    // The farm is allowed to be the biggest of the three and nothing like the
    // ~7,500/day the uncapped Gold StackAcres paid.
    expect(STACKACRES_GOLD_CEILING).toBeGreaterThan(3_000);
    expect(STACKACRES_GOLD_CEILING).toBeLessThan(7_500);
  });

  it("bounds a request at exactly one day's worth of Bushels", () => {
    expect(goldForBushels(STACKACRES_MAX_EXCHANGE_BUSHELS)).toBeGreaterThanOrEqual(
      STACKACRES_GOLD_CEILING,
    );
    expect(goldForBushels(STACKACRES_MAX_EXCHANGE_BUSHELS - 1)).toBeLessThan(
      STACKACRES_GOLD_CEILING,
    );
  });
});

describe("the rate", () => {
  it("pays the same for the first Bushel as for the last", () => {
    // No volume bonus, ever. A rate that improves with size is a ceiling that
    // scales with size wearing a different hat.
    expect(goldForBushels(1)).toBe(STACKACRES_GOLD_PER_BUSHEL);
    expect(goldForBushels(1_000)).toBe(1_000 * STACKACRES_GOLD_PER_BUSHEL);
  });

  it("rounds an allowance DOWN, so a Bushel never buys nothing", () => {
    expect(bushelsWithinAllowance(STACKACRES_GOLD_PER_BUSHEL * 3)).toBe(3);
    expect(bushelsWithinAllowance(STACKACRES_GOLD_PER_BUSHEL * 3 - 1)).toBe(2);
    expect(bushelsWithinAllowance(0)).toBe(0);
    expect(bushelsWithinAllowance(-50)).toBe(0);
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
  it("reports what is left, and what that is worth in Bushels", () => {
    const state = exchangeState(1_000, new Date("2026-09-01T12:00:00.000Z"));
    expect(state.ceiling).toBe(STACKACRES_GOLD_CEILING);
    expect(state.usedToday).toBe(1_000);
    expect(state.remaining).toBe(STACKACRES_GOLD_CEILING - 1_000);
    expect(state.maxBushels).toBe(bushelsWithinAllowance(STACKACRES_GOLD_CEILING - 1_000));
    expect(state.resetsAt).toBe("2026-09-02T00:00:00.000Z");
  });

  it("never reports a negative allowance, whatever the stored total says", () => {
    // Cannot happen through the RPC, but a client that renders a negative
    // width or an "exchange -40 Bushels" button on bad data is worse than one
    // that shows a closed window.
    const state = exchangeState(STACKACRES_GOLD_CEILING + 900, new Date());
    expect(state.remaining).toBe(0);
    expect(state.maxBushels).toBe(0);
  });
});
