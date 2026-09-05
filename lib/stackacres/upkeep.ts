/**
 * Land Maintenance: what holding cleared ground costs, per UTC day, in Gold.
 *
 * WHAT THIS REPLACED. The sectors pass shipped this as a Bushel fee living in
 * ./sectors.ts, with a comment arguing that Gold would be "the first thing in
 * this subsystem that takes real value out of a player's balance on a timer".
 * That objection was right about the danger and is answered by the shape here
 * rather than by the currency: **the fee is netted out of what a harvest pays
 * and clamped at it** (`stackacresUpkeepCharge`), so it can leave a harvest
 * worth nothing and can never reach the balance. Nothing is taken on a timer;
 * nothing is taken from a farm that is not being harvested. That keeps the
 * Gold-path asymmetry in stackacres-service.ts intact -- one credit, and this
 * only makes it smaller.
 *
 * WHAT IT KEPT from that pass, because both were better than what I had:
 *
 *   * **The charge base is SLOTS ON CLEARED GROUND** (`unlockedPlotCount`),
 *     not units owned. Charging for what is standing would let a player clear
 *     every district and pay nothing for the empty room, which is exactly the
 *     ratchet the fee exists to prevent.
 *   * **The first three plots are free** -- the Farmstead's own Hen Coop
 *     slots. A farm that has cleared nothing and bought nothing never sees a
 *     bill, so the first charge is always the first thing a player chose to
 *     take on.
 *
 * WHY IT SCALES SUPERLINEARLY. Yield grows linearly with plots owned, so a
 * linear fee would be a fixed percentage and would never bind. `n^1.5` grows
 * faster than the income it is charged against, which is the point: negligible
 * on a small farm, the dominant term on a maxed estate. A big farm still earns
 * more than a small one; it just keeps less of each additional plot.
 *
 * Assessed lazily, once per UTC day, on that day's harvests. There is no cron
 * behind this and deliberately isn't one -- the same reasoning that keeps
 * every other piece of StackAcres a pure function of timestamps. The day's
 * paid total lives in one row per (profile, day), in `homestead_upkeep`.
 */

import { stackacresExchangeDay } from "./exchange";

/**
 * Plots that are free of the fee: the Farmstead's own three Hen Coop slots,
 * exactly. Carried over from the Bushel version unchanged.
 */
export const STACKACRES_UPKEEP_FREE_PLOTS = 3;

/**
 * Gold per day for the first chargeable plot, and the base the curve is built
 * on. Sized against the flat daily allowance rather than against any one tier.
 */
export const STACKACRES_UPKEEP_BASE_FEE = 25;

/**
 * The exponent, and the thing to leave alone. At 1.0 this is a flat per-plot
 * rent and stops being a sink for large estates at all; much above 1.5 the
 * maxed estate stops being worth building rather than merely stopping being
 * free.
 *
 * THE ARITHMETIC, written down rather than left to be rediscovered:
 *
 *   4 plots  (one past the free base)             25 Gold a day
 *   15 plots (all four sectors, nothing bought)   1,039
 *   21 plots                                      1,909
 *   30 plots (every sector, every slot bought)    3,507
 *
 * Against a flat daily allowance of 50,000 Gold, the top of the ladder costs a
 * real, visible slice of a big farm's day and nothing a small one would
 * notice. That is the point: owning everything should be a commitment rather
 * than a one-way ratchet, not unaffordable. `upkeep.test.ts` pins the SHAPE
 * (rising, superlinear, zero at the free base, inside a sane band of the
 * allowance) rather than the exact figures, so a deliberate retune moves
 * cleanly and an accidental sign flip does not.
 */
export const STACKACRES_UPKEEP_EXPONENT = 1.5;

/** The day's land maintenance, in Gold, for a farm of this many plots. */
export function stackacresUpkeepFee(plots: number): number {
  if (!Number.isFinite(plots)) return 0;
  const chargeable = Math.floor(plots) - STACKACRES_UPKEEP_FREE_PLOTS;
  if (chargeable <= 0) return 0;
  return Math.round(STACKACRES_UPKEEP_BASE_FEE * chargeable ** STACKACRES_UPKEEP_EXPONENT);
}

/**
 * What is still owed today, given what has already been taken.
 *
 * `paidToday` can exceed today's fee when a player retires stock or the bill
 * is otherwise re-read smaller -- the fee is read from what is held right now,
 * and holding less later does not earn a refund. Clamped at zero rather than
 * going negative, because a negative "due" would read as a credit one line on.
 */
export function stackacresUpkeepDue(plots: number, paidToday: number): number {
  return Math.max(0, stackacresUpkeepFee(plots) - Math.max(0, paidToday));
}

/**
 * What a harvest worth `harvestGold` actually pays toward a `due` fee.
 *
 * CLAMPED AT THE HARVEST, and that clamp is the safety property: a harvest can
 * be reduced to nothing by maintenance but can never come out negative, so
 * this function can never turn a collection into a debit. The unpaid remainder
 * is not carried as debt -- the next harvest of the same day re-reads the same
 * still-unpaid `due` and takes what it can.
 */
export function stackacresUpkeepCharge(harvestGold: number, due: number): number {
  return Math.max(0, Math.min(Math.max(0, due), Math.max(0, harvestGold)));
}

/**
 * The day an upkeep charge belongs to. The same UTC boundary as the daily
 * allowance and the daily grant -- one midnight for the whole app, so a player
 * never has to learn a second one.
 */
export const stackacresUpkeepDay = stackacresExchangeDay;

/** Today's land bill, as the client renders it. */
export interface StackAcresUpkeepState {
  /** Slots on cleared ground. What the fee is charged on. */
  plots: number;
  /** Gold owed for the current UTC day. */
  fee: number;
  /** Gold already taken for the current UTC day. */
  paidToday: number;
  /** What the next harvest will be docked, at most. */
  due: number;
}

export function upkeepState(plots: number, paidToday: number): StackAcresUpkeepState {
  const fee = stackacresUpkeepFee(plots);
  const paid = Math.max(0, Math.min(paidToday, fee));
  return { plots: Math.max(0, Math.floor(plots)), fee, paidToday: paid, due: fee - paid };
}
