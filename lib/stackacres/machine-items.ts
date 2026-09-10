/**
 * The whole inventory item space: everything a harvest, a Wheat Plot or a
 * machine can put in a player's shelf, and what each sells for.
 *
 * THIS USED TO BE A SEPARATE ITEM SPACE FROM ./items.ts, on purpose: harvest
 * used to pay Gold automatically, and an item sitting here never carried a
 * Gold value of its own. Harvest no longer pays Gold at all -- see
 * lib/server/stackacres-service.ts's `harvestStackAcres` -- so every
 * `StackAcresItem` (eggs, wool, milk, all 22 crops) IS an inventory item now,
 * and the two spaces are one. `StackAcresItem` stays the narrower type where
 * a module only ever deals with what a unit yields (./harvest.ts,
 * ./museum.ts); `MachineItemId` below is the wider one a recipe, the
 * inventory itself, or the Sell action needs.
 *
 * WHEAT IS THE ONE ITEM THAT IS NEITHER. It is not a `StackAcresItem` (it is
 * grown on its own Wheat Plot table, not a stocked unit -- see
 * ./wheat-plot.ts's header for why that stayed a separate system) and it is
 * not a `MachineProcessedItem` (nothing makes it; the Mill consumes it).
 * `MACHINE_RAW_ITEMS` is exactly that one leftover id.
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

/** The one raw item that is neither a harvested `StackAcresItem` nor a
 *  crafted good -- see this file's header. */
export const MACHINE_RAW_ITEMS = ["wheat"] as const;
export const MACHINE_PROCESSED_ITEMS = ["flour", "cheese", "cloth", "cake"] as const;

export type MachineRawItem = (typeof MACHINE_RAW_ITEMS)[number];
export type MachineProcessedItem = (typeof MACHINE_PROCESSED_ITEMS)[number];

/** Every item that can sit in the shared inventory: what a unit yields, plus
 *  wheat, plus whatever a recipe makes. */
export type MachineItemId = StackAcresItem | MachineRawItem | MachineProcessedItem;

export const MACHINE_ITEM_IDS: readonly MachineItemId[] = [
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
  wheat: { label: "Wheat", plural: "Wheat", icon: "ico-wheat", sellPrice: 4 },
  flour: { label: "Flour", plural: "Flour", icon: "ico-flour", sellPrice: 40 },
  cheese: { label: "Cheese", plural: "Cheese", icon: "ico-cheese", sellPrice: 700 },
  cloth: { label: "Cloth", plural: "Cloth", icon: "ico-cloth", sellPrice: 320 },
  cake: { label: "Cake", plural: "Cakes", icon: "ico-cake", sellPrice: 400 },
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
export function machineItemLabel(item: MachineItemId, quantity: number): string {
  if (isStackAcresItem(item)) return itemLabel(item, quantity);
  const def = MACHINE_ITEM_CATALOGUE[item];
  return `${quantity.toLocaleString()} ${quantity === 1 ? def.label : def.plural}`;
}
