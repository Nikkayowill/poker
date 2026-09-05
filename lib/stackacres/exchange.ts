/**
 * The daily allowance: the valve every Gold the farm pays out passes through.
 *
 * THIS FILE USED TO BE A SHOPFRONT AS WELL AS A VALVE. There was an exchange
 * window -- a place in the supply store where Bushels were traded for Gold at
 * a rate, under a daily ceiling. The window is gone with the currency it
 * traded: a harvest is valued and paid in Gold in one step now. **The ceiling
 * is not gone, and was never the part that was in the player's way.**
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD, unchanged and still the thing to
 * defend in review: **the farm's maximum Gold output is a flat daily constant
 * per player.** Not a percentage of what is held, not scaled by how much land
 * is owned, not scaled by a Bountiful Harvest multiplier, not scaled by
 * anything at all. Skill decides how fast the day's bucket fills; it never
 * decides how big the bucket is. If a change makes `STACKACRES_GOLD_CEILING`
 * depend on anything about the player, that is the bug -- it is what keeps
 * this feature in the same category as the daily grant and the rewarded-ad
 * faucet rather than the category Ante Up was in when it printed money.
 *
 * WHY THE SYNERGIES AND THE SINGLE-STEP HARVEST DO NOT ENDANGER IT. Bountiful
 * Harvest (./bounty.ts) raises what a sweep is worth, and Land Maintenance
 * (./upkeep.ts) lowers it, and both land BEFORE the number reaches this
 * ceiling. A bonus therefore makes a good day arrive sooner and cannot make
 * the day bigger. That is exactly the argument market.ts already makes about
 * permanent stock, and it survives any mistuning of either.
 *
 * THE MODULE KEEPS ITS NAME, and the table behind it keeps `homestead_`, for
 * the reason CLAUDE.md gives for `river_*`: they are compatibility IDs. The
 * ledger row is still "Gold this player has taken out of the farm today"; only
 * the thing that fills it changed.
 */

/**
 * Gold a single player may take out of the farm in one UTC day.
 *
 * FLAT, and that is the property worth defending -- not the number. It does
 * not scale with land owned, stock owned, Gold held, harvest size, or which
 * synergy a sweep earned.
 *
 * Raised 5,000 -> 15,000 on 2026-09-03 (Kayo's call), then 15,000 -> 50,000 on
 * 2026-09-05 (Kayo's call) to let cosmetics be affordable. The original 5,000 was
 * sized purely against the other faucets -- the daily grant at 1,000 x up to a
 * 2.5 streak multiplier, rewarded ads at 500 x 6 = 3,000, the backstop at 1,000
 * per 12h -- because at the time the farm had nothing to spend Gold ON and its
 * output was pure addition to the money supply. That changed: a Cattle Pen is
 * 60,000 Gold and a maxed capacity ladder is far more, so the farm is a net SINK
 * for anyone building one. Cosmetics are expensive, so a higher ceiling lets
 * players yield enough to afford them within a reasonable play session.
 *
 * IT SURVIVED THE SINGLE-CURRENCY CHANGE UNTOUCHED, on purpose. Every Bushel
 * price in the farm was multiplied by 2 -- the exact rate this window used to
 * pay -- so the Gold a day's play can produce is the same number it was when
 * that Gold had to be exchanged for. Land Maintenance is new pressure DOWNWARD
 * on that number, never upward.
 *
 * The honest arithmetic, stated plainly so nobody has to rederive it: up to
 * ~18.3M a year for somebody who maxes it every single day. What bounds the
 * damage is that it is still FLAT and still per-player -- a thousand players
 * cannot each take more than one can, and no amount of farm makes any one of
 * them take more than another.
 *
 * MIRRORED IN SQL. `reserve_homestead_exchange` carries its own copy as a hard
 * ceiling, so this constant can only ever tighten the limit, never raise it --
 * raising the farm's Gold faucet takes a deliberate migration. Keep the two in
 * step; the SQL one is the authority.
 */
export const STACKACRES_GOLD_CEILING = 50_000;

/**
 * The day a moment belongs to, as `YYYY-MM-DD` in UTC. Matches the daily Gold
 * grant and the Ante Up daily gates: one boundary for the whole app, so a
 * player never has to learn a second midnight. Land Maintenance shares it --
 * see ./upkeep.ts, which re-exports this rather than defining a second one.
 */
export function stackacresExchangeDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Milliseconds until the allowance refills. Drives the "come back" line. */
export function msUntilNextExchangeDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/** Today's allowance, as the client renders it. */
export interface StackAcresExchangeState {
  /** The flat daily constant. Never varies per player. */
  ceiling: number;
  /** Gold already taken out of the farm today. */
  usedToday: number;
  /** Gold still available today. */
  remaining: number;
  /** When the allowance refills, ISO. */
  resetsAt: string;
}

export function exchangeState(usedToday: number, now: Date): StackAcresExchangeState {
  const used = Math.min(Math.max(0, usedToday), STACKACRES_GOLD_CEILING);
  return {
    ceiling: STACKACRES_GOLD_CEILING,
    usedToday: used,
    remaining: STACKACRES_GOLD_CEILING - used,
    resetsAt: new Date(now.getTime() + msUntilNextExchangeDay(now)).toISOString(),
  };
}
