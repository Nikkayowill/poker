/**
 * The Prestige Reset Valve: trade the whole farm for a permanent multiplier.
 *
 * WHY THIS EXISTS AS A PURE MODULE, mirroring lib/stackacres/harvest.ts's own
 * reasoning exactly: the eligibility check and the multiplier arithmetic have
 * to be testable without a database, and they have to be the SAME arithmetic
 * the SQL side runs, because `reset_stackacres_prestige` in
 * 20260905140000_stackacres_prestige_reset.sql cannot import this file. Both
 * sides are hand-kept in step -- the same discipline
 * homestead_units_enforce_stock_shape's yield ceilings already require -- and
 * `prestige.test.ts` pins the numbers here so a drift is a failing test, not
 * a silent split between what the server computes and what a person reading
 * this file would expect.
 *
 * WHAT THE MULTIPLIER IS BUILT FROM. `homestead_harvests.payout` is each
 * settled unit's own gross, written before the sweep's Bountiful Harvest
 * synergy and before Land Maintenance -- see the write site in
 * lib/server/stackacres-service.ts. Summed across a profile's whole history,
 * that is GROSS farm production, not net Gold ever credited. That choice is
 * deliberate: net credited Gold is capped at STACKACRES_GOLD_CEILING every
 * day (lib/stackacres/exchange.ts), so over enough days a huge farm and a
 * modest one converge toward the same lifetime net total -- a prestige score
 * built on that number would reward patience over scale. Gross is immune to
 * the daily ceiling and rewards the thing a prestige mechanic is supposed to
 * reward: how much farm was actually built before it was traded in.
 *
 * ORDER OF APPLICATION IN A HARVEST. `settleHarvest` in ./harvest.ts takes
 * this multiplier as a parameter (never reads it itself -- that function
 * stays a pure function of its own inputs, the same reason it takes
 * `upkeepDue` as a parameter rather than a profile id) and applies it to
 * GROSS, multiplicatively alongside the Bountiful Harvest synergy, BEFORE
 * Land Maintenance is netted out. That is not the only defensible ordering,
 * and it is the one this feature commits to for one reason: applying it
 * after upkeep would let a permanent, ever-growing account-wide multiplier
 * bypass the one sink every other Gold path in StackAcres is subject to.
 * Applying it to gross keeps the money-ordering invariant intact -- nothing
 * here opens a second, unmetered route to Gold.
 */

/**
 * Below this much gross earned SINCE THE LAST RESET, the valve refuses
 * outright. Sized against the flat daily allowance the same way
 * lib/stackacres/upkeep.ts sizes its own base fee: ten days of the flat
 * ceiling's worth of gross production is a real milestone on a farm that is
 * actually being played, not a same-session flip a player could reach by
 * harvesting once and immediately resetting.
 */
export const STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS = 150_000;

/**
 * The divisor inside the diminishing-returns curve (see
 * `computePrestigeGain` below). Chosen so the FIRST reset a player can
 * possibly perform -- exactly at the minimum threshold above -- buys a
 * modest, clearly sub-linear bump rather than a windfall:
 *
 *   150,000 gross (the minimum)     +0.4472x
 *   750,000 gross                   +1.0000x
 *   3,000,000 gross                 +2.0000x
 *   6,750,000 gross                 +3.0000x
 *
 * Doubling the gross behind a reset does not double what it buys -- the
 * curve is sqrt, not linear -- which is the whole point of a diminishing-
 * returns prestige mechanic: an idle farm run for a very long time between
 * resets is worth more than a short one, but never proportionally more.
 */
export const STACKACRES_PRESTIGE_GROSS_PER_POINT = 750_000;

/**
 * Hard ceiling on the multiplier itself, same posture as every other ceiling
 * in this economy (STACKACRES_GOLD_CEILING, the equipment ladder's crit
 * bonus, MONO_CROP_MAX_MULTIPLIER): a permanent account-wide reward still
 * has to have a top, or a farm played long enough eventually breaks every
 * other tuning number in the game. 5x a lifetime's worth of resets is
 * already a large, hard-earned number under the curve above -- reaching it
 * takes multiple resets at real scale, not one lucky run.
 */
export const STACKACRES_PRESTIGE_MULTIPLIER_CAP = 5;

/** The floor every profile starts at, and can never fall below. */
export const STACKACRES_PRESTIGE_BASE_MULTIPLIER = 1;

/**
 * Multipliers are built from a square root of a division, which in binary
 * floating point lands on values like 1.9999999999999998. Rounded to four
 * places so the number that reaches a test, a database column and a piece of
 * UI copy is the one a person would actually write down -- the identical
 * rounding lib/stackacres/bounty.ts's own `round4` exists for, kept as a
 * separate small function here rather than imported: that one is not
 * exported, and duplicating four lines is cheaper than widening bounty.ts's
 * surface for a helper with no domain connection to synergies.
 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** What one profile's prestige state looks like, whether freshly bootstrapped or read from a row. */
export interface StackAcresPrestigeState {
  /** How many times the valve has been pulled. 0 for a profile that never has. */
  prestigeCount: number;
  /** The live harvest multiplier. Always >= STACKACRES_PRESTIGE_BASE_MULTIPLIER. */
  multiplier: number;
  /** The lifetime gross figure `eligibleGross` below is computed against, as of the last reset. */
  lifetimeGrossAtReset: number;
}

/** A profile that has never reset: no row exists yet, and none of this has happened. */
export const STACKACRES_PRESTIGE_DEFAULT_STATE: StackAcresPrestigeState = {
  prestigeCount: 0,
  multiplier: STACKACRES_PRESTIGE_BASE_MULTIPLIER,
  lifetimeGrossAtReset: 0,
};

/** Why a reset attempt did or did not go through. */
export type StackAcresPrestigeReason = "reset" | "not_enough_lifetime_gross";

export interface StackAcresPrestigeGain {
  eligible: boolean;
  reason: StackAcresPrestigeReason;
  /** Gross earned since the last reset. Reported even on a refusal, so the UI can say how much further there is to go. */
  eligibleGross: number;
  /** What this reset would add to the multiplier. Zero when not eligible. */
  gainedMultiplier: number;
  /** current.multiplier + gainedMultiplier, capped. Equal to current.multiplier when not eligible. */
  nextMultiplier: number;
}

/**
 * What resetting NOW would do, given a profile's current state and the
 * lifetime gross StackAcres has on record for it (the caller's own
 * `sum(homestead_harvests.payout)` read -- this function takes it as a
 * plain number rather than reaching for a database, the same reason
 * `settleHarvest` takes `upkeepDue` rather than a profile id).
 *
 * PURE AND DETERMINISTIC: the same two inputs always produce the same
 * output, which is what lets this be pinned by a test and lets the SQL
 * function mirror it by hand with confidence there is one true answer to
 * check against.
 */
export function computePrestigeGain(
  current: StackAcresPrestigeState,
  totalLifetimeGross: number,
): StackAcresPrestigeGain {
  const eligibleGross = Math.max(0, Math.floor(totalLifetimeGross) - current.lifetimeGrossAtReset);

  if (eligibleGross < STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS) {
    return {
      eligible: false,
      reason: "not_enough_lifetime_gross",
      eligibleGross,
      gainedMultiplier: 0,
      nextMultiplier: current.multiplier,
    };
  }

  const gainedMultiplier = round4(Math.sqrt(eligibleGross / STACKACRES_PRESTIGE_GROSS_PER_POINT));
  const nextMultiplier = round4(
    Math.min(STACKACRES_PRESTIGE_MULTIPLIER_CAP, current.multiplier + gainedMultiplier),
  );

  return { eligible: true, reason: "reset", eligibleGross, gainedMultiplier, nextMultiplier };
}

/**
 * How much further a profile has to go before the valve will accept a reset,
 * for the UI to render as a progress bar. Zero once eligible.
 */
export function prestigeGoldRemaining(current: StackAcresPrestigeState, totalLifetimeGross: number): number {
  const eligibleGross = Math.max(0, Math.floor(totalLifetimeGross) - current.lifetimeGrossAtReset);
  return Math.max(0, STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS - eligibleGross);
}

/**
 * The client-safe shapes below live here, not in lib/server/stackacres-
 * service.ts, for the same reason StackAcresContractRow lives in
 * lib/stackacres/contracts.ts rather than the service: that module is
 * `import "server-only"`, and a client component (the confirmation modal)
 * has to import a type describing what it renders without pulling a
 * server-only module into the browser bundle. The service imports these
 * back from here for its own StackAcresView/action-result shapes, so there
 * is exactly one definition either side reads.
 */

/** What the farm view always carries about one profile's prestige standing. */
export interface StackAcresPrestigeView {
  prestigeCount: number;
  multiplier: number;
  /** Gross production still needed before the next reset is possible. Zero once eligible. */
  goldToNextPrestige: number;
}

/** What one successful reset just bought, for the confirmation the client renders. */
export interface StackAcresPrestigeResetResult {
  prestigeCount: number;
  multiplier: number;
  /** What THIS reset added. multiplier - gainedMultiplier is what the player held a moment before. */
  gainedMultiplier: number;
}
