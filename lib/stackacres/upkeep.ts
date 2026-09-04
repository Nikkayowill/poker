/**
 * Land Maintenance: what holding the land costs, per UTC day.
 *
 * WHY IT SCALES SUPERLINEARLY. Yield grows linearly with units owned -- six
 * Cattle Pens make six times what one makes -- so a linear upkeep would be a
 * fixed percentage and would never bind. `units ^ 1.5` grows faster than the
 * income it is charged against, which is the whole point: the fee is
 * negligible on a small farm and becomes the dominant term on a maxed estate.
 * A big farm still earns more than a small one; it just keeps less of each
 * additional unit.
 *
 * WHAT IT IS NOT. This is not a way for the farm to reach into a player's
 * balance. The fee is netted out of a harvest and clamped at that harvest's
 * value -- see `stackacresUpkeepCharge` -- so a farm left alone accrues
 * nothing, and a player who never harvests is never billed. It removes Gold
 * the farm would otherwise have created, which is a sink in the only sense
 * that matters to the money supply, without adding a path that debits the
 * wallet. That keeps the Gold-path asymmetry in stackacres-service.ts intact:
 * one credit, and this makes it smaller.
 *
 * ASSESSED LAZILY, once per UTC day, on the harvests of that day. There is no
 * cron behind this and there deliberately isn't one -- the same reasoning that
 * keeps every other piece of StackAcres a pure function of timestamps. The
 * day's paid total lives in one row per (profile, day), the same shape the
 * daily Gold allowance uses.
 */

import { stackacresExchangeDay } from "./exchange";

/**
 * Gold per day for a single owned unit, and the base the curve is built on.
 *
 * Sized against the flat daily allowance rather than against any one tier: a
 * maxed estate is 30 units (five kinds at the capacity ladder's ceiling of 6),
 * so 25 * 30^1.5 is about 4,100 Gold a day -- a bit over a quarter of the
 * 15,000 a farm may send out. Three units, which is where a farm starts, costs
 * about 130. That spread is the feature.
 */
export const STACKACRES_UPKEEP_BASE_FEE = 25;

/**
 * The exponent, and the thing to leave alone. At 1.0 this is a flat per-unit
 * rent and stops being a sink for large estates at all; much above 1.5 the
 * maxed estate stops being worth building rather than merely stopping being
 * free. There is a test asserting the fee's share of a maxed estate's
 * allowance stays inside a sane band.
 */
export const STACKACRES_UPKEEP_EXPONENT = 1.5;

/** What holding `ownedUnits` fields and pens costs for one UTC day, in Gold. */
export function stackacresUpkeepFee(ownedUnits: number): number {
  if (!Number.isFinite(ownedUnits) || ownedUnits <= 0) return 0;
  return Math.round(STACKACRES_UPKEEP_BASE_FEE * ownedUnits ** STACKACRES_UPKEEP_EXPONENT);
}

/**
 * What is still owed today, given what has already been taken.
 *
 * `paidToday` can exceed today's fee when a player retires stock after being
 * billed -- the fee is read from what is held right now, and holding less
 * later does not earn a refund. Clamped at zero rather than going negative,
 * because a negative "due" would read as a credit one line further on.
 */
export function stackacresUpkeepDue(ownedUnits: number, paidToday: number): number {
  return Math.max(0, stackacresUpkeepFee(ownedUnits) - Math.max(0, paidToday));
}

/**
 * What a harvest worth `harvestGold` actually pays toward a `due` fee.
 *
 * CLAMPED AT THE HARVEST, and that clamp is the safety property: a harvest can
 * be reduced to nothing by upkeep but can never come out negative, so this
 * function can never turn a collection into a debit. The unpaid remainder is
 * simply not collected -- it is not carried as debt, and the next harvest of
 * the same day sees the same still-unpaid `due` and takes what it can.
 */
export function stackacresUpkeepCharge(harvestGold: number, due: number): number {
  return Math.max(0, Math.min(Math.max(0, due), Math.max(0, harvestGold)));
}

/**
 * The day an upkeep charge belongs to. The same UTC boundary as the daily Gold
 * allowance and the daily grant -- one midnight for the whole app, so a player
 * never has to learn a second one.
 */
export const stackacresUpkeepDay = stackacresExchangeDay;

/** Today's maintenance, as the farm screen renders it. */
export interface StackAcresUpkeepState {
  /** Fields and pens the fee was assessed on. */
  units: number;
  /** What a full day costs at that size. */
  fee: number;
  /** Gold already taken toward it today. */
  paidToday: number;
  /** What the next harvest will be docked, at most. */
  due: number;
}

export function upkeepState(ownedUnits: number, paidToday: number): StackAcresUpkeepState {
  const fee = stackacresUpkeepFee(ownedUnits);
  return {
    units: Math.max(0, ownedUnits),
    fee,
    paidToday: Math.max(0, paidToday),
    due: stackacresUpkeepDue(ownedUnits, paidToday),
  };
}
