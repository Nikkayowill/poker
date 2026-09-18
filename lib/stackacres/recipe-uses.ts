/**
 * Small lookups over the recipe catalogue for the store and the kitchen:
 * which recipes (and which other farm uses) want an item, and what a recipe
 * is still missing.
 */

import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import { machineItemNoun, type MachineItemId } from "./machine-items";
import { RECIPE_CATALOGUE, RECIPE_IDS, type RecipeId } from "./recipes";
import { SHELF_FEED_ORDERS, isHenFeedItem, servingBonusEggs } from "./feeding";
import { FISHING_BAIT_ITEM } from "./fishing";
import { MACHINE_CATALOGUE } from "./machines";

/** Every recipe that takes `item` as an input, in catalogue order. */
export function recipesUsing(item: MachineItemId): RecipeId[] {
  return RECIPE_IDS.filter((id) => RECIPE_CATALOGUE[id].inputs.some((input) => input.item === item));
}

/** The animal whose shelf feed order holds `item`, as the card names it. */
function feedNounFor(item: MachineItemId): string | null {
  for (const { order, noun } of Object.values(SHELF_FEED_ORDERS)) {
    if ((order as readonly string[]).includes(item)) return noun;
  }
  return null;
}

/** How the card names a recipe: its label, or for a recipe that makes animal
 *  feed, the feed and where it is made, e.g. "Cattle feed (at the Mill)". */
function recipeUseLabel(recipe: RecipeId): string {
  const def = RECIPE_CATALOGUE[recipe];
  const noun = feedNounFor(def.output.item);
  return noun ? `${noun} feed (at the ${MACHINE_CATALOGUE[def.machine].label})` : def.label;
}

/** Uses outside the recipe book, read off the feeding orders and the fishing
 *  bait so the card can never disagree with what the farm does. */
export function otherUsesOf(item: MachineItemId): string[] {
  const uses: string[] = [];
  const noun = feedNounFor(item);
  if (noun) {
    const eggs = isHenFeedItem(item) ? servingBonusEggs(item) : 0;
    uses.push(eggs > 0 ? `${noun} feed (+${eggs} egg${eggs === 1 ? "" : "s"})` : `${noun} feed`);
  }
  if (item === FISHING_BAIT_ITEM) uses.push("Fishing bait");
  return uses;
}

/** The seed card line, e.g. "For: Hearty Stew, Hen feed". Null when nothing
 *  uses it. */
export function wantedForLine(item: MachineItemId): string | null {
  const labels = [...recipesUsing(item).map(recipeUseLabel), ...otherUsesOf(item)];
  return labels.length > 0 ? `For: ${labels.join(", ")}` : null;
}

export interface RecipeIngredient {
  item: MachineItemId;
  need: number;
  have: number;
  /** How many more are needed, 0 when there are enough. */
  missing: number;
}

/** Each input of `recipe` with what the player holds of it. */
export function recipeIngredients(recipe: RecipeId, inventory: StackAcresInventory): RecipeIngredient[] {
  return RECIPE_CATALOGUE[recipe].inputs.map((input) => {
    const have = inventoryQuantity(inventory, input.item);
    return { item: input.item, need: input.quantity, have, missing: Math.max(0, input.quantity - have) };
  });
}

/** "Need 1 more Onion", or null when there is enough. */
export function missingLine(ingredient: RecipeIngredient): string | null {
  if (ingredient.missing === 0) return null;
  return `Need ${ingredient.missing} more ${machineItemNoun(ingredient.item, ingredient.missing)}`;
}
