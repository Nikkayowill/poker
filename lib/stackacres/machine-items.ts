/**
 * The whole inventory item space: everything a harvest or a
 * machine can put in a player's shelf, and what each sells for.
 *
 * THIS USED TO BE A SEPARATE ITEM SPACE FROM ./items.ts, on purpose: harvest
 * used to pay Gold automatically, and an item sitting here never carried a
 * Gold value of its own. Harvest no longer pays Gold at all -- see
 * lib/server/stackacres-service.ts's `harvestStackAcres` -- so every
 * `StackAcresItem` (eggs, wool, milk, all 22 crops) IS an inventory item now,
 * and the two spaces are one. `StackAcresItem` stays the narrower type where
 * a module only ever deals with what a unit yields (./harvest.ts);
 * `MachineItemId` below is the wider one a recipe, the inventory itself, or
 * the Sell action needs.
 *
 * WHEAT IS A `StackAcresItem` NOW: one item, one id, the crop's own harvest
 * and what the Mill consumes. What is left in `MACHINE_RAW_ITEMS` is the
 * pond's three catchable fish (./fishing.ts), meat, pelt, wood and stone:
 * caught, hunted or chopped rather than grown or crafted, with nothing
 * consuming them either.
 *
 * The only door from a crafted good back to Gold used to be a fulfilled
 * Contract (./contracts.ts). That is still true for Flour/Cheese/Cloth, and
 * Contracts still pay a premium over the flat Sell price below for exactly
 * that reason -- but every item here, crafted or raw, can now also be sold
 * directly at any time through `sellStackAcresItem`, reserved against the
 * same daily ceiling a harvest used to be.
 */

import {
  STACKACRES_ITEMS,
  STACKACRES_ITEM_CATALOGUE,
  itemLabel,
  itemSellPrice as stackAcresItemSellPrice,
  isStackAcresItem,
  type StackAcresItem,
} from "./items";
import { FISH_SPECIES } from "./fishing";

/** Wheat, the pond's three catchable fish, and what a stalk in the Oak's
 *  brush brings back: nothing crafted, nothing harvested off a stocked unit
 *  either -- see this file's header. Meat and pelts join the fish for exactly
 *  the same reason they did, and like them nothing consumes either yet. Wood
 *  and Stone join the bucket the same way again: chopped/mined, not grown or
 *  crafted, and each is a required material on its own blueprints
 *  (./machines.ts's `woodCost`/`stoneCost`) rather than something a recipe
 *  consumes. */
export const MACHINE_RAW_ITEMS = [...FISH_SPECIES, "meat", "pelt", "wood", "stone"] as const;
export const MACHINE_PROCESSED_ITEMS = [
  "flour",
  "cheese",
  "cloth",
  "cake",
  "bread",
  "stew",
  "salad",
  "cattle_feed",
  "sauce",
  "salsa",
  "stuffed_peppers",
  "pickles",
  "sauerkraut",
  "bean_casserole",
  "harvest_feast",
] as const;

export type MachineRawItem = (typeof MACHINE_RAW_ITEMS)[number];

/**
 * A gathered material a purchase spends alongside its Gold.
 *
 * ONE SHAPE FOR EVERY BUYER, and it lives here because this file owns the
 * item ids and imports nothing: a machine (./machines.ts), a land clear
 * (./sectors.ts) and a pen slot (./catalogue.ts) all cost the same kind of
 * thing, and a second hand-written interface per buyer is how the three
 * would drift. `lib/server/stackacres-service.ts` spends all three through
 * one helper for the same reason.
 */
export interface MaterialCost {
  readonly item: MachineRawItem;
  readonly quantity: number;
}
export type MachineProcessedItem = (typeof MACHINE_PROCESSED_ITEMS)[number];

/** Every item that can sit in the shared inventory: what a unit yields, plus
 *  wheat, plus whatever a recipe makes. */
export type MachineItemId = StackAcresItem | MachineRawItem | MachineProcessedItem;

export const MACHINE_ITEM_IDS: readonly MachineItemId[] = [
  "wheat",
  ...MACHINE_RAW_ITEMS,
  ...MACHINE_PROCESSED_ITEMS,
];

/** Every `MachineItemId` there is: every `StackAcresItem` plus `MACHINE_ITEM_IDS`.
 *  For schema validation that has to accept the WHOLE inventory space (the
 *  Sell action) -- existing narrower call sites (gifts, blueprint
 *  contributions) keep using `MACHINE_ITEM_IDS` itself, since raw crops and
 *  eggs were never valid there. */
export const ALL_MACHINE_ITEM_IDS: readonly MachineItemId[] = [
  ...STACKACRES_ITEMS,
  ...MACHINE_ITEM_IDS,
];

export function isMachineRawItem(value: string): value is MachineRawItem {
  return (MACHINE_RAW_ITEMS as readonly string[]).includes(value);
}

export function isMachineProcessedItem(value: string): value is MachineProcessedItem {
  return (MACHINE_PROCESSED_ITEMS as readonly string[]).includes(value);
}

/** Whether `value` is any inventory item at all: a harvested StackAcresItem,
 *  wheat, or a crafted good. */
export function isMachineItem(value: string): value is MachineItemId {
  return isStackAcresItem(value) || isMachineRawItem(value) || isMachineProcessedItem(value);
}

export interface MachineItemDef {
  label: string;
  plural: string;
  /** Name of a vector painter in stackacres-art.ts, same convention as
   *  StackAcresItemDef.icon in ./items.ts -- kept a plain string so this file
   *  stays free of a components/ import. */
  icon: string;
  /**
   * What one sells for, in Gold, through the Sell action.
   *
   * PRICED BELOW WHAT A CONTRACT PAYS, DELIBERATELY, for every crafted good a
   * contract can also ask for (Flour/Cheese/Cloth) -- see ./contracts.ts's
   * `CONTRACT_RUNGS`, still the better outlet. Wheat is priced low enough
   * that milling it into Flour and selling THAT stays strictly better per
   * unit of wheat than selling it raw, so Sell never undercuts the Mill loop:
   *
   *   Wheat alone:        4 Gold/unit.
   *   Flour (3 Wheat -> 1 Flour, sells 40): ~13.3 Gold-equivalent/wheat.
   *
   * Cheese and Cloth sit above what selling their raw milk/wool would fetch
   * (recipeRawGoldValue in ./recipes.ts), so crafting is never a strict loss
   * against just selling the raw material, and below their contract rate, so
   * a contract is still the better trade when one is open. Cake has no
   * contract at all -- Sell is its only door to Gold -- so it is priced at
   * roughly 1.3x its own forgone raw value (2 Eggs + 1 Milk + 1 Flour), the
   * same premium a contract rung pays.
   */
  sellPrice: number;
}

export const MACHINE_ITEM_CATALOGUE: Readonly<
  Record<MachineRawItem | MachineProcessedItem, MachineItemDef>
> = {
  // Common/uncommon/rare, same feel as the Vat's aging tiers -- see
  // ./fishing.ts's FISH_WEIGHTS for the odds these prices are tuned against.
  bluegill: { label: "Bluegill", plural: "Bluegill", icon: "ico-fish-bluegill", sellPrice: 15 },
  trout: { label: "Trout", plural: "Trout", icon: "ico-fish-trout", sellPrice: 45 },
  catfish: { label: "Catfish", plural: "Catfish", icon: "ico-fish-catfish", sellPrice: 130 },
  // A logged sighting yields both at once (see ./hunting.ts's
  // QUARRY_CATALOGUE), so these are priced as a PAIR, not one at a time: a
  // Rabbit is 29 Gold, a Deer 67, a Boar 105. Against the fishing ladder's
  // own weights that makes an average stalk worth about half again an
  // average cast -- it takes several times longer, and unlike a cast it can
  // be lost outright. Trail Photos carry the higher price of the two: Field
  // Notes are the volume good, a Trail Photo is the one worth the walk.
  //
  // item_id stays "meat"/"pelt" (see ./hunting.ts's own header): this file's
  // reskin from the earlier hunting frame only ever changed the label a
  // player reads, never the key already written into production
  // `homestead_inventory` rows.
  meat: { label: "Field Notes", plural: "Field Notes", icon: "ico-fieldnotes", sellPrice: 9 },
  pelt: { label: "Trail Photo", plural: "Trail Photos", icon: "ico-trailphoto", sellPrice: 20 },
  // Chopped off the Homestead's own treeline (./wood.ts). Priced low and
  // deliberately: Wood's real job is being spent on machine placement
  // (./machines.ts's `MachineDef.woodCost`), not being sold -- a Sell price
  // this low means selling surplus Wood is never a better trade than banking
  // it for the next machine, the same "the material use is the important
  // door" posture this feature's own design brief states.
  wood: { label: "Wood", plural: "Wood", icon: "ico-wood", sellPrice: 3 },
  // Mined off a Mine boulder (./stone-nodes.ts). Priced low like Wood, on
  // purpose: Stone's real job is being spent on the Preserves Cellar and Feed
  // Silo (./machines.ts), and a cheap sell keeps building always the better
  // trade than cashing it in raw.
  stone: { label: "Stone", plural: "Stone", icon: "ico-stone", sellPrice: 6 },
  flour: { label: "Flour", plural: "Flour", icon: "ico-flour", sellPrice: 40 },
  cheese: { label: "Cheese", plural: "Cheese", icon: "ico-cheese", sellPrice: 700 },
  cloth: { label: "Cloth", plural: "Cloth", icon: "ico-cloth", sellPrice: 320 },
  cake: { label: "Cake", plural: "Cakes", icon: "ico-cake", sellPrice: 400 },
  // Above Flour's 40, so baking a Flour always beats selling it. There is no
  // bread art yet, so it borrows the wheat icon.
  bread: { label: "Bread", plural: "Bread", icon: "ico-wheat", sellPrice: 55 },
  // Above the 10 Gold its five crops sell for raw. No stew art yet, so it
  // borrows the potato icon.
  stew: { label: "Hearty Stew", plural: "Hearty Stew", icon: "ico-potato", sellPrice: 30 },
  // Above the 8 Gold its four greens sell for raw. Borrows the lettuce icon.
  salad: { label: "Garden Salad", plural: "Garden Salads", icon: "ico-lettuce", sellPrice: 12 },
  // Milled from corn for cattle (./feeding.ts). Priced as feed, not as a way
  // to sell corn: two corn sell for more raw. Borrows the corn icon.
  cattle_feed: { label: "Cattle Feed", plural: "Cattle Feed", icon: "ico-corn", sellPrice: 12 },
  // Chapter 5's town kitchen. Sauce, Salsa and Pickles have town orders, so
  // they sell for a little over their raw crops and under what an order pays
  // per jar (./contracts.ts). Sauerkraut and Stuffed Peppers have no order,
  // so like Stew they carry a bigger markup. None has its own art yet, so
  // each borrows its main crop's icon.
  sauce: { label: "Tomato Sauce", plural: "Tomato Sauce", icon: "ico-tomato", sellPrice: 90 },
  salsa: { label: "Hot Salsa", plural: "Hot Salsa", icon: "ico-pepper", sellPrice: 90 },
  stuffed_peppers: { label: "Stuffed Peppers", plural: "Stuffed Peppers", icon: "ico-bell_pepper", sellPrice: 180 },
  pickles: { label: "Pickles", plural: "Pickles", icon: "ico-celery", sellPrice: 60 },
  sauerkraut: { label: "Sauerkraut", plural: "Sauerkraut", icon: "ico-cabbage", sellPrice: 15 },
  // Chapter 6's feasts. Casserole has a town order, so it sells just under
  // what the order pays per dish. The Feast has none; it is the meal to eat
  // or give, priced like the other order-free meals.
  bean_casserole: { label: "Bean Casserole", plural: "Bean Casseroles", icon: "ico-green_bean", sellPrice: 135 },
  harvest_feast: { label: "Harvest Feast", plural: "Harvest Feasts", icon: "ico-eggplant", sellPrice: 260 },
};

/** What one of `item` sells for, whatever space it started in. */
export function machineItemSellPrice(item: MachineItemId): number {
  if (isStackAcresItem(item)) return stackAcresItemSellPrice(item);
  return MACHINE_ITEM_CATALOGUE[item].sellPrice;
}

/** The painter name for `item`, whatever space it started in -- the same
 *  delegation `machineItemLabel` takes for a StackAcresItem. */
export function machineItemIcon(item: MachineItemId): string {
  if (isStackAcresItem(item)) return STACKACRES_ITEM_CATALOGUE[item].icon;
  return MACHINE_ITEM_CATALOGUE[item].icon;
}

/** "3 Wheat", "1 Flour" -- delegates to items.ts's own `itemLabel` for
 *  whatever `item` is a StackAcresItem, so there is exactly one place either
 *  pluralisation rule is written. */
/** Just the noun, singular or plural for `quantity`: "Onion", "Carrots". */
export function machineItemNoun(item: MachineItemId, quantity: number): string {
  const def = isStackAcresItem(item) ? STACKACRES_ITEM_CATALOGUE[item] : MACHINE_ITEM_CATALOGUE[item];
  return quantity === 1 ? def.label : def.plural;
}

export function machineItemLabel(item: MachineItemId, quantity: number): string {
  if (isStackAcresItem(item)) return itemLabel(item, quantity);
  const def = MACHINE_ITEM_CATALOGUE[item];
  return `${quantity.toLocaleString()} ${quantity === 1 ? def.label : def.plural}`;
}
