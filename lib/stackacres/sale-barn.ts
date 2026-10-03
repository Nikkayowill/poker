/**
 * Hank's sale barn: where hogs and steers are bought young and sold fat.
 *
 * GOLD IN: a feeder pig or calf is the ordinary lease path (`stock`), so the
 * price leaves the wallet before the animal exists and comes back if it never
 * does. GOLD OUT: `ship-livestock` sells every ready animal by weight, one
 * credit for the whole load, netted for upkeep like any other sale.
 *
 * Pure: the server and the sheet both read it.
 */

import { BARN_CAPACITY_BONUS } from "./barn";
import {
  STACKACRES_CATALOGUE,
  capFor,
  STACKACRES_MARKET_ANIMALS,
  STACKACRES_MARKET_LIVESTOCK,
  isMarketLivestock,
  marketAnimalPrice,
  marketAnimalWeight,
  type StackAcresMarketLivestock,
  type StackAcresStock,
} from "./catalogue";

/** What a tap or a stray request to collect from a hog or steer is told. */
export const MARKET_ANIMAL_NOT_COLLECTED = "Hogs and steers aren't collected. Sell them to Hank at the sale barn.";

/** One animal on its way to market, and what it fetched. */
export interface ShippedAnimal {
  unitId: string;
  stock: StackAcresMarketLivestock;
  weight: number;
  gold: number;
}

/** What one trip to the sale barn sold. `gold` is the sticker total; `paid`
 *  is what reached the wallet after the day's upkeep was taken out. */
export interface StackAcresShipment {
  animals: ShippedAnimal[];
  gold: number;
  paid: number;
}

/** The fields weight is worked out from. */
export interface MarketAnimalRow {
  id: string;
  stock: StackAcresStock;
  yieldQuantity: number;
  feedBonus?: number;
}

/** A hog or steer's weight right now: its starting weight plus what feed put on, capped. */
export function marketWeightOf(unit: MarketAnimalRow & { stock: StackAcresMarketLivestock }): number {
  return marketAnimalWeight(unit.stock, unit.yieldQuantity, unit.feedBonus ?? 0);
}

/** The heaviest a hog or steer can get. */
export function maxMarketWeight(stock: StackAcresMarketLivestock): number {
  const def = STACKACRES_MARKET_ANIMALS[stock];
  return def.baseWeight + def.maxFeedWeight;
}

/** What one animal sells for, as a line on the shipment. Null for anything that is not a hog or steer. */
export function shippedLine(unit: MarketAnimalRow): ShippedAnimal | null {
  if (!isMarketLivestock(unit.stock)) return null;
  const stock = unit.stock;
  const weight = marketWeightOf({ ...unit, stock });
  return { unitId: unit.id, stock, weight, gold: marketAnimalPrice(stock, weight) };
}

/** The sticker total of a load. */
export function shipmentGold(lines: readonly ShippedAnimal[]): number {
  return lines.reduce((total, line) => total + line.gold, 0);
}

/** "Hog, 8 weight: 800 Gold". The line Hank reads back for each animal sold. */
export function shippedAnimalLabel(line: ShippedAnimal): string {
  return `${STACKACRES_CATALOGUE[line.stock].label}, weight ${line.weight}: ${line.gold.toLocaleString()} Gold`;
}

/** What Hank sells, in the order his sheet lists it. */
export interface FeederOffer {
  stock: StackAcresMarketLivestock;
  /** "Feeder Pig". */
  label: string;
  price: number;
  /** "Ready in 2 hours. Sells for 600 Gold, up to 1,000 Gold well fed." */
  blurb: string;
}

function hoursLabel(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export function feederOffers(): FeederOffer[] {
  return STACKACRES_MARKET_LIVESTOCK.map((stock) => {
    const def = STACKACRES_MARKET_ANIMALS[stock];
    const catalogue = STACKACRES_CATALOGUE[stock];
    const low = marketAnimalPrice(stock, def.baseWeight);
    const high = marketAnimalPrice(stock, maxMarketWeight(stock));
    const food = def.fattensOn.includes("corn") ? "corn or cattle feed" : "cattle feed";
    return {
      stock,
      label: def.feederLabel,
      price: catalogue.seedCost,
      blurb:
        `Ready to sell in ${hoursLabel(catalogue.durationMs)}. Worth ${low.toLocaleString()} Gold, ` +
        `up to ${high.toLocaleString()} if you feed it ${food}.`,
    };
  });
}

/** How many of one market animal the farm keeps, how many it may, and what is ready to go. */
export interface SaleBarnPen {
  stock: StackAcresMarketLivestock;
  owned: number;
  cap: number;
  /** Ready, home and fed: what `ship-livestock` would take right now. */
  ready: ShippedAnimal[];
}

/** The same cap the server checks: the free three, bought slots, and two more with a Barn. */
export function saleBarnPens(
  units: readonly (MarketAnimalRow & { state: string; away?: unknown })[],
  capacity: Readonly<Partial<Record<StackAcresStock, number>>>,
  hasBarn: boolean,
): SaleBarnPen[] {
  return STACKACRES_MARKET_LIVESTOCK.map((stock) => {
    const mine = units.filter((unit) => unit.stock === stock);
    const ready = mine
      .filter((unit) => unit.state === "ready" && !unit.away)
      .map(shippedLine)
      .filter((line): line is ShippedAnimal => line !== null);
    return {
      stock,
      owned: mine.length,
      cap: capFor(capacity[stock] ?? 0) + (hasBarn ? BARN_CAPACITY_BONUS : 0),
      ready,
    };
  });
}
