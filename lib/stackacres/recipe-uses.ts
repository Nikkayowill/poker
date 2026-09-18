/**
 * Small lookups over the recipe catalogue for the store and the kitchen:
 * which recipes (and which other farm uses) want an item, and what a recipe
 * is still missing.
 */

import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import { machineItemNoun, type MachineItemId } from "./machine-items";
import { RECIPE_CATALOGUE, RECIPE_IDS, type RecipeId } from "./recipes";
import { HEN_FEED_BONUS_EGGS, isHenFeedItem } from "./feeding";
import { FISHING_BAIT_ITEM } from "./fishing";

/** Every recipe that takes `item` as an input, in catalogue order. */
export function recipesUsing(item: MachineItemId): RecipeId[] {
  return RECIPE_IDS.filter((id) => RECIPE_CATALOGUE[id].inputs.some((input) => input.item === item));
}

/** Uses outside the recipe book, read off the hen feeding order and the
 *  fishing bait so the card can never disagree with what the farm does. */
export function otherUsesOf(item: MachineItemId): string[] {
  const uses: string[] = [];
  if (isHenFeedItem(item)) {
    const eggs = HEN_FEED_BONUS_EGGS[item];
    uses.push(eggs > 0 ? `Hen feed (+${eggs} egg${eggs === 1 ? "" : "s"})` : "Hen feed");
  }
  if (item === FISHING_BAIT_ITEM) uses.push("Fishing bait");
  return uses;
}

/** The seed card line, e.g. "For: Hearty Stew, Hen feed". Null when nothing
 *  uses it. */
export function wantedForLine(item: MachineItemId): string | null {
  const labels = [...recipesUsing(item).map((id) => RECIPE_CATALOGUE[id].label), ...otherUsesOf(item)];
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
