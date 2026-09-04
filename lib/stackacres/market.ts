/**
 * The Gold market: buying stock outright, permanently.
 *
 * WHY THIS EXISTS. Before it, Gold bought capacity and nothing else. A player
 * who arrived with a season of poker winnings could buy room for a herd and
 * then had to grind the cheapest tier to put anything in it, because every
 * animal and every crop was priced in the farm's own currency. The farm was
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
 * `stockZone`. It drifted, and nothing caught it because nothing checked the
 * two against each other. Deleted outright rather than fixed in place --
 * `stockZone`/`stocksInZone` in world.ts is the one mapping now.
 */

import { STACKACRES_CATALOGUE, type StackAcresStock } from "./catalogue";
import { yieldValue } from "./items";

/**
 * What buying a tier outright costs, as a multiple of one cycle's seed price.
 * THE ONE RULE, and the reason there is a rule rather than five hand-written
 * numbers.
 *
 * Kayo's call, and he is right: a price you cannot work out in your head is
 * not a price you can save toward, and saving toward a number is the whole
 * motivation. Earlier drafts scaled the price by how many you already owned,
 * which made "how much is a cow" un-answerable without knowing your own farm's
 * state -- exactly the anxiety the no-deadline design elsewhere in StackAcres
 * exists to avoid.
 *
 * So: one multiplier, applied to a number the player already sees on the shelf.
 * A Cattle Pen's seed is 1,200 Gold, so a Cattle Pen is 60,000 Gold, and it
 * stays 60,000 Gold whether it is your first or your fourth.
 *
 * WAS 100 x A SEED PRICE IN BUSHELS. Seed prices are Gold now and doubled in
 * the conversion, so this halved to 50 and **every outright price is
 * byte-identical to what it was**. That is deliberate: the single-currency
 * change was meant to remove a step, not to reprice the game.
 */
export const STACKACRES_SEED_MULTIPLE_TO_OWN = 50;

/**
 * What buying capacity costs, in Gold -- re-exported from catalogue.ts, which
 * owns it because this module reads that one and the reverse would be a
 * cycle. Kept visible here so every Gold price in StackAcres can be read off
 * a single file.
 */
export { STACKACRES_CAPACITY_PRICE, stackacresCapacityPrice } from "./catalogue";

/** What buying `stock` outright costs, in Gold. Pure function of the seed price. */
export function stackacresStockPrice(stock: StackAcresStock): number {
  return STACKACRES_CATALOGUE[stock].seedCost * STACKACRES_SEED_MULTIPLE_TO_OWN;
}

/**
 * What a Gold-bought unit returns in ONE cycle as a fraction of what it cost.
 * THE NUMBER THAT MUST STAY BELOW 1 on every tier.
 *
 * Note it deliberately measures one cycle against the whole purchase price.
 * Permanent stock keeps producing, so over a long enough life any tier repays
 * itself -- that is the point of buying it, and it is bounded by the daily
 * ceiling rather than by this. What this rules out is the sharp edge: a stock
 * that could be bought and immediately liquidated for more Gold than it cost,
 * which would be a faucet with no cooldown on it at all.
 *
 * It got simpler with the single currency: there is no rate to pass in any
 * more, because a cycle's yield is already denominated in the money that
 * bought the animal. `market.test.ts` holds the check on every tier, and it
 * now also holds it against the largest Bountiful Harvest multiplier a sweep
 * can earn -- a synergy must not be able to push a single cycle past its own
 * purchase price either.
 */
export function goldStockRoundTrip(stock: StackAcresStock, multiplier = 1): number {
  return (yieldValue(stock) * multiplier) / stackacresStockPrice(stock);
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
  /** Gold, one cycle, the path that already existed. */
  seedCost: number;
}

export function shelfItem(stock: StackAcresStock): StackAcresShelfItem {
  const def = STACKACRES_CATALOGUE[stock];
  return { stock, label: def.label, price: stackacresStockPrice(stock), seedCost: def.seedCost };
}
