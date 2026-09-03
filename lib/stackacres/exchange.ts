/**
 * The exchange window: the one place Gold ever leaves the StackAcres.
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD, and the thing to defend in review:
 * **the farm's maximum Gold output is a flat daily constant per player.** Not a
 * percentage of what you hold, not scaled by how much land you own, not scaled
 * by how well you traded. Skill decides how fast you fill the day's bucket; it
 * never decides how big the bucket is. If a change makes `STACKACRES_GOLD_CEILING`
 * depend on anything at all, that is the bug -- it is what keeps this feature in
 * the same category as the daily grant and the rewarded-ad faucet rather than
 * the category Ante Up was in when it printed money.
 *
 * That is also why the ceiling is denominated in GOLD rather than in Bushels.
 * A Bushel ceiling would move with the rate, and phase 4's market is going to
 * move Bushel prices around a lot; the number that must not move is the one
 * measured in real money.
 *
 * The rate is read at the moment of exchange and never snapshotted. Unlike a
 * planted plot -- where the yield is agreed up front and rule 3 protects it
 * from a retune -- an exchange is instantaneous, so there is no in-flight
 * agreement to protect.
 */

/**
 * Gold a single player may take out of the farm in one UTC day.
 *
 * Sized against the faucets that already exist rather than against what the
 * farm can produce, because that is the comparison that matters: the daily
 * grant is 1,000 x up to a 2.5 streak multiplier, rewarded ads are 500 x 6 =
 * 3,000, and the backstop is 1,000 per 12h. 5,000 sits alongside those, and
 * below the ~7,500/day the pre-Bushels StackAcres paid out with no cap at all.
 *
 * MIRRORED IN SQL. `reserve_homestead_exchange` carries its own copy as a hard
 * ceiling, so this constant can only ever tighten the limit, never raise it --
 * raising the farm's Gold faucet takes a deliberate migration. Keep the two in
 * step; the SQL one is the authority.
 */
export const STACKACRES_GOLD_CEILING = 5_000;

/**
 * Gold per Bushel at the window.
 *
 * The rate matters far less than the ceiling, because the ceiling binds: a
 * generous rate just means a player reaches the day's limit sooner and banks
 * the rest of their Bushels for tomorrow. It is tuned so that an engaged day
 * (three pens and three fields, collected and sold) lands near the cap while
 * only a grinder is actually bound by it.
 */
export const STACKACRES_GOLD_PER_BUSHEL = 2;

/**
 * The most Bushels that could ever be exchanged in one day, at the current
 * rate. Bounds the request schema, so the route's ceiling moves with a retune
 * instead of going stale as a literal.
 */
export const STACKACRES_MAX_EXCHANGE_BUSHELS = Math.ceil(
  STACKACRES_GOLD_CEILING / STACKACRES_GOLD_PER_BUSHEL,
);

/** What exchanging `bushels` pays, in Gold. */
export function goldForBushels(bushels: number): number {
  return bushels * STACKACRES_GOLD_PER_BUSHEL;
}

/**
 * The most Bushels worth exchanging against a remaining Gold allowance --
 * rounded DOWN, so a player can never spend a Bushel that buys nothing. With
 * 3 Gold left and a rate of 2, one Bushel is the answer, not two.
 */
export function bushelsWithinAllowance(remainingGold: number): number {
  return Math.max(0, Math.floor(remainingGold / STACKACRES_GOLD_PER_BUSHEL));
}

/**
 * The day a moment belongs to, as `YYYY-MM-DD` in UTC. Matches the daily Gold
 * grant and the Ante Up daily gates: one boundary for the whole app, so a
 * player never has to learn a second midnight.
 */
export function stackacresExchangeDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Milliseconds until the window reopens. Drives the "come back" line. */
export function msUntilNextExchangeDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/** Today's window, as the client renders it. */
export interface StackAcresExchangeState {
  /** Gold per Bushel right now. */
  rate: number;
  /** The flat daily constant. Never varies per player. */
  ceiling: number;
  /** Gold already taken out of the farm today. */
  usedToday: number;
  /** Gold still available today. */
  remaining: number;
  /** Bushels that remaining Gold is worth, floored. */
  maxBushels: number;
  /** When the window reopens, ISO. */
  resetsAt: string;
}

export function exchangeState(usedToday: number, now: Date): StackAcresExchangeState {
  const used = Math.min(Math.max(0, usedToday), STACKACRES_GOLD_CEILING);
  const remaining = STACKACRES_GOLD_CEILING - used;
  return {
    rate: STACKACRES_GOLD_PER_BUSHEL,
    ceiling: STACKACRES_GOLD_CEILING,
    usedToday: used,
    remaining,
    maxBushels: bushelsWithinAllowance(remaining),
    resetsAt: new Date(now.getTime() + msUntilNextExchangeDay(now)).toISOString(),
  };
}
