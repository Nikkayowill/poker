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
 * Every item here, crafted or raw, sells at any time through
 * `sellStackAcresItem`, to the one townsperson who buys it
 * (./town-buyers.ts). A Town Board order (./contracts.ts) pays a little more
 * per unit for the goods it asks for.
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
 *  crafted, and each is a required building material
 *  (./machines.ts's `woodCost`/`stoneCost`) rather than something a recipe
 *  consumes. */
export const MACHINE_RAW_ITEMS = [...FISH_SPECIES, "meat", "pelt", "wood", "stone", "iron_ore"] as const;
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
  "metal",
] as const;

export type MachineRawItem = (typeof MACHINE_RAW_ITEMS)[number];

/**
 * A gathered material a purchase spends alongside its Gold.
 *
 * One shape for every buyer, and it lives here because this file owns the
 * item ids and imports nothing: a machine (./machines.ts) and a pen slot
 * (./catalogue.ts) cost the same kind of thing, and the service spends both
 * through one helper so they cannot drift.
 */
export interface MaterialCost {
  /** Metal is smelted rather than gathered, but it is still a material a
   *  building is paid for in. */
  readonly item: MachineRawItem | "metal";
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
 *  Sell action) -- existing narrower call sites (gifts) keep using `MACHINE_ITEM_IDS` itself, since raw crops and
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
   * A MADE GOOD SELLS FOR AT MOST 1.15x WHAT ITS INPUTS SELL FOR RAW
   * (recipeRawGoldValue in ./recipes.ts, pinned by a test), and never for
   * less. The farm's money is raw goods sold in bulk in town: grain, eggs,
   * cream and wool. Processing is a small convenience, not the income
   * (2026-10-02 economy rebase). A Town Board order still pays a little more
   * per unit than selling does (./contracts.ts).
   */
  sellPrice: number;
}

export const MACHINE_ITEM_CATALOGUE: Readonly<
  Record<MachineRawItem | MachineProcessedItem, MachineItemDef>
> = {
  // Common/uncommon/rare -- see ./fishing.ts's FISH_WEIGHTS for the odds.
  // Cut 5x on 2026-10-05: one instant Stew is ten casts, and at the old
  // prices that turned about 10 Gold of crops into about 720 Gold of fish.
  bluegill: { label: "Bluegill", plural: "Bluegill", icon: "ico-fish-bluegill", sellPrice: 3 },
  trout: { label: "Trout", plural: "Trout", icon: "ico-fish-trout", sellPrice: 9 },
  catfish: { label: "Catfish", plural: "Catfish", icon: "ico-fish-catfish", sellPrice: 26 },
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
  // Mined off the same boulders as Stone (./stone-nodes.ts) and smelted into
  // Metal at the Smelter. Priced under half a bar so smelting always beats
  // selling the ore.
  iron_ore: { label: "Iron Ore", plural: "Iron Ore", icon: "ico-iron-ore", sellPrice: 5 },
  // Smelted from Iron Ore. Its job is paying for the Far Field's buildings
  // (./empire-buildings.ts), so like Wood and Stone it sells for little: just
  // over the two ore it takes.
  metal: { label: "Metal", plural: "Metal", icon: "ico-metal", sellPrice: 11 },
  // Every price below is at most 1.15x what its inputs sell for raw (see the
  // `sellPrice` doc above). Ground from three Wheat at 7.
  flour: { label: "Flour", plural: "Flour", icon: "ico-flour", sellPrice: 24 },
  // Three Milk at 120.
  cheese: { label: "Cheese", plural: "Cheese", icon: "ico-cheese", sellPrice: 400 },
  // Four Fleeces at 40.
  cloth: { label: "Cloth", plural: "Cloth", icon: "ico-cloth", sellPrice: 170 },
  // Two Eggs, a Milk and a Flour: 168 raw.
  cake: { label: "Cake", plural: "Cakes", icon: "ico-cake", sellPrice: 190 },
  // The house kitchen's food is mainly for energy (./energy.ts), so it sells
  // for little more than what went in. No bread art yet: it borrows the wheat icon.
  bread: { label: "Bread", plural: "Bread", icon: "ico-wheat", sellPrice: 26 },
  // Borrows the potato icon.
  stew: { label: "Hearty Stew", plural: "Hearty Stew", icon: "ico-potato", sellPrice: 11 },
  // Borrows the lettuce icon.
  salad: { label: "Garden Salad", plural: "Garden Salads", icon: "ico-lettuce", sellPrice: 9 },
  // Ground from corn for cattle (./feeding.ts), four to a corn. Priced as
  // feed, not as a way to sell corn. Borrows the corn icon.
  cattle_feed: { label: "Cattle Feed", plural: "Cattle Feed", icon: "ico-corn", sellPrice: 8 },
  // None of these has its own art yet, so each borrows its main crop's icon.
  sauce: { label: "Tomato Sauce", plural: "Tomato Sauce", icon: "ico-tomato", sellPrice: 88 },
  salsa: { label: "Hot Salsa", plural: "Hot Salsa", icon: "ico-pepper", sellPrice: 88 },
  stuffed_peppers: { label: "Stuffed Peppers", plural: "Stuffed Peppers", icon: "ico-bell_pepper", sellPrice: 160 },
  pickles: { label: "Pickles", plural: "Pickles", icon: "ico-celery", sellPrice: 57 },
  sauerkraut: { label: "Sauerkraut", plural: "Sauerkraut", icon: "ico-cabbage", sellPrice: 6 },
  bean_casserole: { label: "Bean Casserole", plural: "Bean Casseroles", icon: "ico-green_bean", sellPrice: 113 },
  harvest_feast: { label: "Harvest Feast", plural: "Harvest Feasts", icon: "ico-eggplant", sellPrice: 193 },
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

/** A short player-facing hint for the shelf. Exact requirements still live in
 * the recipe and contract panels. */
export function machineItemPurpose(item: MachineItemId): string {
  if (item === "wood" || item === "stone") return "Building material — keep some for farm upgrades.";
  if (item === "bluegill" || item === "trout" || item === "catfish") return "Catch from the pond, then sell for Gold.";
  if (item === "meat" || item === "pelt") return "Exploration find. Sell it in town.";
  if (isMachineProcessedItem(item)) return "Use in recipes or town orders, or sell it in town.";
  return "Use in recipes, animal care, gifts, or town orders.";
}
