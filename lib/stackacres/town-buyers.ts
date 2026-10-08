/**
 * Who in town buys what. The barn no longer buys anything.
 *
 * Three of the City's standing townsfolk (art/stackacres-td/areas/rig/city.py) stand in for the places a
 * Midwest farm sold through: Dale down by the quay is the grain elevator, Iris outside the grocery is the
 * general store, and Hank on the market square is the sale barn. Real buildings come with a later redraw of
 * the City; for now the person is the place.
 *
 * Every item has exactly one buyer, or none (`ITEM_BUYER` below is a full Record, so a new item will not
 * compile until someone decides who takes it). The `sell` action names its buyer and the server refuses an
 * item that buyer does not take, so selling means walking to the right person.
 *
 * NOBODY BUYS STONE, IRON ORE OR METAL. The Crop Fields' boulders are the only Stone and Ore a farm will
 * ever have and they never grow back, and the acres, the Feed Silo, the Smelter and the Far Field are all
 * built out of them. A farm that sold its Stone could never build those, so it is kept for building
 * instead. Their sell prices in ./machine-items.ts still price the recipes that use them.
 */

import type { MachineItemId } from "./machine-items";

export const TOWN_BUYER_IDS = ["grain-elevator", "general-store", "sale-barn"] as const;
export type TownBuyerId = (typeof TOWN_BUYER_IDS)[number];

export interface TownBuyerDef {
  /** The City NPC who does the buying. */
  readonly npc: string;
  readonly name: string;
  /** "the grain elevator". Lower case, for the middle of a sentence. */
  readonly place: string;
  /** The sheet's title. */
  readonly title: string;
  /** What they say when the sheet opens. */
  readonly greeting: string;
  /** What they buy, for a line like "Dale buys grain." */
  readonly buys: string;
}

export const TOWN_BUYERS: Readonly<Record<TownBuyerId, TownBuyerDef>> = {
  "grain-elevator": {
    npc: "dale",
    name: "Dale",
    place: "the grain elevator",
    title: "Grain Elevator",
    greeting: "I buy grain by the load. Wheat, corn, flour and feed.",
    buys: "grain",
  },
  "general-store": {
    npc: "iris",
    name: "Iris",
    place: "the general store",
    title: "General Store",
    greeting: "Eggs, milk, wool and garden crops. I'll take what the house makes too.",
    buys: "eggs, milk and garden goods",
  },
  "sale-barn": {
    npc: "hank",
    name: "Hank",
    place: "the sale barn",
    title: "Sale Barn",
    greeting: "I sell feeder pigs and calves. Raise them fat and I'll buy them back by weight.",
    buys: "hogs and steers",
  },
};

const GRAIN: TownBuyerId = "grain-elevator";
const STORE: TownBuyerId = "general-store";

/** The one buyer for each item, or null for what the farm builds with. The sale barn takes no item: it
 *  buys whole animals, through `ship-livestock` (./sale-barn.ts), not anything off the shelf. */
const ITEM_BUYER: Readonly<Record<MachineItemId, TownBuyerId | null>> = {
  // Grain and what the feed grinder makes from it.
  wheat: GRAIN,
  corn: GRAIN,
  flour: GRAIN,
  cattle_feed: GRAIN,
  // Egg, cream and wool money.
  eggs: STORE,
  milk: STORE,
  wool: STORE,
  // The kitchen garden.
  lettuce: STORE,
  spinach: STORE,
  radish: STORE,
  onion: STORE,
  carrot: STORE,
  potato: STORE,
  cabbage: STORE,
  broccoli: STORE,
  pepper: STORE,
  bell_pepper: STORE,
  celery: STORE,
  green_bean: STORE,
  tomato: STORE,
  eggplant: STORE,
  // What the house and the workshop make.
  cheese: STORE,
  cloth: STORE,
  cake: STORE,
  bread: STORE,
  stew: STORE,
  salad: STORE,
  sauce: STORE,
  salsa: STORE,
  stuffed_peppers: STORE,
  pickles: STORE,
  sauerkraut: STORE,
  bean_casserole: STORE,
  harvest_feast: STORE,
  // What the pond and the woods give.
  bluegill: STORE,
  trout: STORE,
  catfish: STORE,
  meat: STORE,
  pelt: STORE,
  wood: STORE,
  // What the boulders give, and the bars smelted from it: kept for building.
  stone: null,
  iron_ore: null,
  metal: null,
};

export function isTownBuyer(value: string): value is TownBuyerId {
  return (TOWN_BUYER_IDS as readonly string[]).includes(value);
}

/** Who buys `item`, or null when nobody in town does. */
export function townBuyerFor(item: MachineItemId): TownBuyerId | null {
  return ITEM_BUYER[item];
}

/** Whether `buyer` takes `item`. */
export function buyerTakes(buyer: TownBuyerId, item: MachineItemId): boolean {
  return ITEM_BUYER[item] === buyer;
}

/** Everything `buyer` takes, in catalogue order. */
export function itemsBoughtBy(buyer: TownBuyerId): MachineItemId[] {
  return (Object.keys(ITEM_BUYER) as MachineItemId[]).filter((item) => ITEM_BUYER[item] === buyer);
}

/** The buyer a City NPC stands in for, or null for anyone else. */
export function townBuyerOfNpc(name: string): TownBuyerId | null {
  return TOWN_BUYER_IDS.find((id) => TOWN_BUYERS[id].npc === name) ?? null;
}

/** "Dale buys this at the grain elevator.", or what to do with something nobody buys. */
export function whoBuysLine(item: MachineItemId): string {
  const buyer = townBuyerFor(item);
  if (buyer === null) return "Nobody in town buys this. Keep it for building.";
  return `${TOWN_BUYERS[buyer].name} buys this at ${TOWN_BUYERS[buyer].place} in town.`;
}
