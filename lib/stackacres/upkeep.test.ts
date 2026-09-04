import { describe, expect, it } from "vitest";
import {
  STACKACRES_UPKEEP_BASE_FEE,
  STACKACRES_UPKEEP_EXPONENT,
  STACKACRES_UPKEEP_FREE_PLOTS,
  stackacresUpkeepCharge,
  stackacresUpkeepDue,
  stackacresUpkeepFee,
  upkeepState,
} from "./upkeep";
import { STACKACRES_GOLD_CEILING } from "./exchange";
import { STACKACRES_BASE_CAP, STACKACRES_MAX_EXTRA_CAP, STACKACRES_STOCK } from "./catalogue";

/**
 * Land Maintenance. Most of these came over from sectors.test.ts with the fee
 * itself when the farm went single-currency, and they deliberately pin the
 * SHAPE -- zero at the free base, rising, superlinear, inside a sane band of
 * the daily allowance -- rather than the exact figures, so a deliberate retune
 * moves cleanly and an accidental sign flip does not.
 */

/** Every plot the game can ever bill for: every kind, every capacity slot. */
const MAX_PLOTS = STACKACRES_STOCK.length * (STACKACRES_BASE_CAP + STACKACRES_MAX_EXTRA_CAP);

describe("stackacresUpkeepFee", () => {
  it("charges nothing up to and including the free base", () => {
    for (let plots = 0; plots <= STACKACRES_UPKEEP_FREE_PLOTS; plots += 1) {
      expect(stackacresUpkeepFee(plots)).toBe(0);
    }
    expect(stackacresUpkeepFee(-3)).toBe(0);
    expect(stackacresUpkeepFee(Number.NaN)).toBe(0);
  });

  it("charges the base fee for the first plot past it", () => {
    expect(stackacresUpkeepFee(STACKACRES_UPKEEP_FREE_PLOTS + 1)).toBe(
      STACKACRES_UPKEEP_BASE_FEE,
    );
  });

  it("rises with every plot after that, and never falls", () => {
    let previous = 0;
    for (let plots = STACKACRES_UPKEEP_FREE_PLOTS + 1; plots <= MAX_PLOTS; plots += 1) {
      const fee = stackacresUpkeepFee(plots);
      expect(fee).toBeGreaterThan(previous);
      expect(Number.isInteger(fee)).toBe(true);
      previous = fee;
    }
  });

  /**
   * The whole design of the fee in one assertion. If this ever fails because
   * the exponent went to 1, the fee has become a flat per-plot rent and has
   * stopped being a sink for large estates, which is the only reason it exists.
   */
  it("grows FASTER than the land it is charged against", () => {
    const step = (plots: number) => stackacresUpkeepFee(plots) - stackacresUpkeepFee(plots - 1);
    expect(step(MAX_PLOTS)).toBeGreaterThan(step(STACKACRES_UPKEEP_FREE_PLOTS + 2));
    expect(STACKACRES_UPKEEP_EXPONENT).toBeGreaterThan(1);
  });

  /**
   * Sized against the flat daily allowance rather than against any one tier: a
   * maxed estate should feel the fee and a starting farm should never see it.
   * If either end of this band breaks, the base fee moved too far.
   */
  it("bites a maxed estate without swallowing it", () => {
    const share = stackacresUpkeepFee(MAX_PLOTS) / STACKACRES_GOLD_CEILING;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.4);
  });
});

describe("stackacresUpkeepDue", () => {
  it("subtracts what today already paid", () => {
    const fee = stackacresUpkeepFee(8);
    expect(stackacresUpkeepDue(8, 0)).toBe(fee);
    expect(stackacresUpkeepDue(8, 50)).toBe(fee - 50);
    expect(stackacresUpkeepDue(8, fee)).toBe(0);
  });

  it("never goes negative when an estate shrinks after being billed", () => {
    // Billed for eight plots this morning, retired down to four this
    // afternoon. Holding less later does not earn a refund, and a negative
    // "due" would read as a credit one line on.
    expect(stackacresUpkeepDue(4, stackacresUpkeepFee(8))).toBe(0);
  });
});

describe("stackacresUpkeepCharge", () => {
  /**
   * THE SAFETY PROPERTY. A harvest can be reduced to nothing by maintenance
   * and can never come out negative, which is what keeps this fee from being a
   * second path that debits the player's wallet -- and what answers the
   * objection the Bushel version of this fee was written around.
   */
  it("never takes more than the harvest is worth", () => {
    expect(stackacresUpkeepCharge(100, 900)).toBe(100);
    expect(stackacresUpkeepCharge(0, 900)).toBe(0);
    expect(stackacresUpkeepCharge(900, 100)).toBe(100);
  });

  it("takes nothing when nothing is due, and nothing on a worthless harvest", () => {
    expect(stackacresUpkeepCharge(900, 0)).toBe(0);
    expect(stackacresUpkeepCharge(900, -50)).toBe(0);
    expect(stackacresUpkeepCharge(-50, 900)).toBe(0);
  });

  it("leaves the unpaid remainder for the next harvest of the same day", () => {
    const due = 1_000;
    const first = stackacresUpkeepCharge(300, due);
    expect(first).toBe(300);
    // The day's `due` is recomputed from what has been paid, so the shortfall
    // is simply still owed rather than tracked as debt.
    expect(stackacresUpkeepCharge(5_000, due - first)).toBe(700);
  });
});

describe("upkeepState", () => {
  it("reports the estate, the day's fee and what is left of it", () => {
    const fee = stackacresUpkeepFee(9);
    expect(upkeepState(9, 100)).toEqual({ plots: 9, fee, paidToday: 100, due: fee - 100 });
  });

  it("reads settled at the free base, whatever has been paid", () => {
    expect(upkeepState(STACKACRES_UPKEEP_FREE_PLOTS, 0)).toMatchObject({ fee: 0, due: 0 });
  });

  it("clamps a total that somehow reads over the bill", () => {
    const state = upkeepState(5, 999_999);
    expect(state.due).toBe(0);
    expect(state.paidToday).toBe(state.fee);
  });

  it("clamps a nonsense estate rather than rendering a negative one", () => {
    expect(upkeepState(-2, -9)).toEqual({ plots: 0, fee: 0, paidToday: 0, due: 0 });
  });
});
