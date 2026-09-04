/**
 * The Gold market: the second place Gold enters StackAcres, and the first
 * place it buys something that is not capacity.
 *
 * WHY THIS EXISTS. Before this, Gold bought acreage and nothing else. A player
 * who arrived with a season of poker winnings could buy an empty field and
 * then had to grind Sprout Rows at 8 Bushels a cycle to put anything on it,
 * because every animal and every crop was priced in Bushels only. The farm was
 * the one place in the app where winning at the tables bought you nothing.
 *
 * WHAT IT DOES NOT DO, and the thing to check in review: it does not move
 * `STACKACRES_GOLD_CEILING`. The farm's maximum Gold OUTPUT is still a flat
 * daily amount per player, mirrored as a hard ceiling inside
 * `reserve_homestead_exchange`. This file only adds ways for Gold to go IN.
 * Every price here is a sink; there is no code path in this module that pays
 * anybody anything. That asymmetry is the entire safety argument, and it
 * survives any mistuning of the numbers below.
 *
 * The honest consequence, stated plainly because it is the real one: buying
 * permanent stock makes the EXISTING daily ceiling reliably reachable where
 * before it took constant attention. Nobody extracts more than they could
 * yesterday; they just stop having to work for it. If that volume is ever a
 * problem, the conversation is about the ceiling, not about this file.
 *
 * WHERE THINGS ARE SOLD used to be its own mapping here (`STACKACRES_STALLS`)
 * -- a second, hand-written zone-to-stock table alongside world.ts's
 * `stockZone`. It drifted: it predated the pen-zoning pass and still had
 * cattle sold at the Long Meadow and crops at Ox Fields, the opposite of
 * where the actual pens stood, and nothing caught it because nothing checked
 * the two against each other. Deleted outright rather than fixed in place --
 * `stockZone`/`stocksInZone` in world.ts is the one mapping now.
 */

import { STACKACRES_CATALOGUE, type StackAcresStock } from "./catalogue";

/**
 * Gold per Bushel of a stock's seed price. THE ONE RULE, and the reason there
 * is a rule rather than five hand-written numbers.
 *
 * Kayo's call, and he is right: a price you cannot work out in your head is
 * not a price you can save toward, and saving toward a number is the whole
 * motivation. Earlier drafts of this scaled the price by how many you already
 * owned, which made "how much is a cow" un-answerable without knowing your own
 * farm's state -- exactly the anxiety the no-deadline design elsewhere in
 * StackAcres exists to avoid.
 *
 * So: one multiplier, applied to a number the player already sees on the
 * supply store shelf. A Cattle Pen's seed is 600 Bushels, so a Cattle Pen is
 * 60,000 Gold, and it stays 60,000 Gold whether it is your first or your
 * fourth.
 *
 * SAFETY. The exchange window pays 2 Gold per Bushel, so at 100 this is 50x
 * the rate Bushels leave at. `goldStockRoundTrip` below states the check that
 * matters and `market.test.ts` holds it: no stock can ever be bought with Gold
 * and sold back through the window for a profit, on any tier, ever.
 */
export const STACKACRES_GOLD_PER_SEED_BUSHEL = 100;

/**
 * What buying capacity costs, in Gold -- re-exported from catalogue.ts, which
 * owns it because this module reads that one and the reverse would be a
 * cycle. Kept visible here so every Gold price in StackAcres can be read off
 * a single file.
 */
export { STACKACRES_CAPACITY_PRICE, stackacresCapacityPrice } from "./catalogue";

/** What buying `stock` outright costs, in Gold. Pure function of the seed price. */
export function stackacresStockPrice(stock: StackAcresStock): number {
  return STACKACRES_CATALOGUE[stock].seedCost * STACKACRES_GOLD_PER_SEED_BUSHEL;
}

/**
 * What a Gold-bought unit returns per cycle if every Bushel of it were taken
 * straight back out through the exchange window, as a fraction of what it
 * cost. THE NUMBER THAT MUST STAY BELOW 1 on every tier.
 *
 * Note this deliberately measures ONE cycle against the whole purchase price.
 * Permanent stock keeps producing, so over a long enough life any tier repays
 * itself -- that is the point of buying it, and it is bounded by the daily
 * ceiling rather than by this. What this rules out is the sharp edge: a stock
 * that could be bought and immediately liquidated for more Gold than it cost,
 * which would be a faucet with no cooldown on it at all.
 *
 * Takes the exchange rate as an argument rather than importing it, so that
 * `exchange.ts` stays the only file that owns that number.
 */
export function goldStockRoundTrip(
  stock: StackAcresStock,
  grossBushelsPerCycle: number,
  goldPerBushel: number,
): number {
  return (grossBushelsPerCycle * goldPerBushel) / stackacresStockPrice(stock);
}

/**
 * What retiring permanent stock refunds: NOTHING, stated as a function so the
 * decision is somewhere rather than implied by an absent branch.
 *
 * A refund would make owning stock a place to park Gold and take it back out,
 * and "take it back out" is the one shape this whole subsystem is built to
 * not have. Retiring exists so a player is never trapped by a full cap, not
 * as a way to undo a purchase -- the UI has to say so before it asks.
 */
export const STACKACRES_RETIRE_REFUND = 0;

/** Everything the district's buy section shows for one stock kind. */
export interface StackAcresShelfItem {
  stock: StackAcresStock;
  label: string;
  /** Gold, outright, permanent. */
  price: number;
  /** Bushels, one cycle, the path that already existed. */
  seedCost: number;
}

export function shelfItem(stock: StackAcresStock): StackAcresShelfItem {
  const def = STACKACRES_CATALOGUE[stock];
  return { stock, label: def.label, price: stackacresStockPrice(stock), seedCost: def.seedCost };
}
