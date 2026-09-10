/**
 * Active scope: what the shop and plant UI show while the gather-craft-sell
 * loop is being mastered at small scale.
 *
 * NOT A DATA MODEL CHANGE. `STACKACRES_CATALOGUE`/`STACKACRES_STOCK` stay
 * total maps over every crop and livestock kind that has ever existed -- this
 * is a read-side filter only, consulted by the shop/plant surfaces and
 * nowhere else. A `homestead_units` row of a hidden stock keeps working
 * through every existing code path (harvest, feed, water, muck) exactly as
 * before; it just cannot be bought again once retired from the shelf. That is
 * what lets scope shrink and grow later without a migration or a stranded
 * unit.
 *
 * Only livestock is scoped. The Wheat Plot (./wheat-plot.ts) is a separate,
 * already inventory-only system that was never gated by `STACKACRES_CROPS`
 * and needs no entry here; every one of the 22 `STACKACRES_CROPS` stays
 * hidden until scope widens again.
 */

import type { MachineKind } from "./machines";
import type { MachineItemId } from "./machine-items";
import { type StackAcresLivestock, type StackAcresStock, isStackAcresCrop } from "./catalogue";

/** Livestock kept on the shelf this pass. */
export const STACKACRES_ACTIVE_LIVESTOCK: readonly StackAcresLivestock[] = ["hen", "cattle"];

/** Inventory items the Workshop sheet's shelf shows -- exactly what the
 *  active scope's loop actually produces: Eggs (Hens), Milk (Cattle), Wheat
 *  and Flour (the Mill), Cake (the Dairy's second recipe). Wool/Cheese/Cloth
 *  stay held and sellable (nothing here changes what a player can DO with
 *  them) but are left off this display list, the same declutter the shop's
 *  own `isActiveStock` does for hidden crops. */
export const STACKACRES_WORKSHOP_SHELF_ITEMS: readonly MachineItemId[] = [
  "eggs",
  "milk",
  "wheat",
  "flour",
  "cake",
];

/** Machine kinds kept on the Workshop sheet this pass. Mill (flour) and Dairy
 *  (milk, and now Cake) are the two the active livestock/crop set feeds; Loom
 *  (wool) and the Fermenting Vat (aged cheese) stay built but collapsed,
 *  since Pig/wool is out of scope and nothing in scope ever makes Cheese to
 *  age. */
export const STACKACRES_ACTIVE_MACHINES: readonly MachineKind[] = ["mill", "dairy"];

/** Whether `stock` is buyable/plantable in this pass. */
export function isActiveStock(stock: StackAcresStock): boolean {
  if (isStackAcresCrop(stock)) return false;
  return (STACKACRES_ACTIVE_LIVESTOCK as readonly string[]).includes(stock);
}

/** Whether `kind`'s card stays expanded on the Workshop sheet. */
export function isActiveMachine(kind: MachineKind): boolean {
  return (STACKACRES_ACTIVE_MACHINES as readonly string[]).includes(kind);
}
