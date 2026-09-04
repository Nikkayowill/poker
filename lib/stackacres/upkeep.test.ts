import { describe, expect, it } from "vitest";
import {
  STACKACRES_UPKEEP_BASE_FEE,
  STACKACRES_UPKEEP_EXPONENT,
  stackacresUpkeepCharge,
  stackacresUpkeepDue,
  stackacresUpkeepFee,
  upkeepState,
} from "./upkeep";
import { STACKACRES_GOLD_CEILING } from "./exchange";
import { STACKACRES_BASE_CAP, STACKACRES_MAX_EXTRA_CAP, STACKACRES_STOCK } from "./catalogue";

/** Every field and pen a maxed capacity ladder can hold at once. */
const MAXED_ESTATE = STACKACRES_STOCK.length * (STACKACRES_BASE_CAP + STACKACRES_MAX_EXTRA_CAP);

describe("stackacresUpkeepFee", () => {
  it("costs nothing to hold no land", () => {
    expect(stackacresUpkeepFee(0)).toBe(0);
    expect(stackacresUpkeepFee(-3)).toBe(0);
    expect(stackacresUpkeepFee(Number.NaN)).toBe(0);
  });

  /**
   * The whole design of the fee in one assertion. If this ever fails because
   * the exponent went to 1, the fee has become a flat per-unit rent and has
   * stopped being a sink for large estates, which is the only reason it exists.
   */
  it("grows FASTER than the land it is charged against", () => {
    const one = stackacresUpkeepFee(1);
    for (const units of [2, 4, 8, 16, 30]) {
      const perUnit = stackacresUpkeepFee(units) / units;
      expect(perUnit).toBeGreaterThan(one);
    }
    expect(STACKACRES_UPKEEP_EXPONENT).toBeGreaterThan(1);
  });

  it("is the base fee times units to the exponent, rounded", () => {
    expect(stackacresUpkeepFee(1)).toBe(STACKACRES_UPKEEP_BASE_FEE);
    expect(stackacresUpkeepFee(4)).toBe(Math.round(STACKACRES_UPKEEP_BASE_FEE * 8));
    expect(stackacresUpkeepFee(9)).toBe(Math.round(STACKACRES_UPKEEP_BASE_FEE * 27));
  });

  /**
   * Sized against the flat daily allowance rather than against any one tier.
   * A maxed estate should feel the fee and a starting farm should barely
   * notice it -- if either end of this band breaks, the base fee moved too far.
   */
  it("bites a maxed estate without swallowing it", () => {
    const maxed = stackacresUpkeepFee(MAXED_ESTATE);
    const share = maxed / STACKACRES_GOLD_CEILING;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.5);

    // Three units is where a farm starts, on the free base cap of one kind.
    const starting = stackacresUpkeepFee(3);
    expect(starting / STACKACRES_GOLD_CEILING).toBeLessThan(0.02);
  });
});

describe("stackacresUpkeepDue", () => {
  it("subtracts what today already paid", () => {
    const fee = stackacresUpkeepFee(6);
    expect(stackacresUpkeepDue(6, 0)).toBe(fee);
    expect(stackacresUpkeepDue(6, 50)).toBe(fee - 50);
    expect(stackacresUpkeepDue(6, fee)).toBe(0);
  });

  it("never goes negative when an estate shrinks after being billed", () => {
    // Billed for six pens this morning, retired four this afternoon. Holding
    // less later does not earn a refund, and a negative "due" one line on
    // would read as a credit.
    const billed = stackacresUpkeepFee(6);
    expect(stackacresUpkeepDue(2, billed)).toBe(0);
  });
});

describe("stackacresUpkeepCharge", () => {
  /**
   * The safety property. A harvest can be reduced to nothing by maintenance
   * and can never come out negative, which is what keeps the fee from being a
   * second path that debits the player's wallet.
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
    const stillOwed = due - first;
    expect(stackacresUpkeepCharge(5_000, stillOwed)).toBe(700);
  });
});

describe("upkeepState", () => {
  it("reports the estate, the day's fee and what is left of it", () => {
    const fee = stackacresUpkeepFee(5);
    expect(upkeepState(5, 100)).toEqual({ units: 5, fee, paidToday: 100, due: fee - 100 });
  });

  it("clamps a nonsense estate rather than rendering a negative one", () => {
    expect(upkeepState(-2, -9)).toEqual({ units: 0, fee: 0, paidToday: 0, due: 0 });
  });
});
