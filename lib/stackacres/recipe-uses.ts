/**
 * Small lookups over the recipe catalogue for the store and the kitchen:
 * which recipes want an item, and what a recipe is still missing.
 */

import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import { machineItemNoun, type MachineItemId } from "./machine-items";
import { RECIPE_CATALOGUE, RECIPE_IDS, type RecipeId } from "./recipes";

/** Every recipe that takes `item` as an input, in catalogue order. */
export function recipesUsing(item: MachineItemId): RecipeId[] {
  return RECIPE_IDS.filter((id) => RECIPE_CATALOGUE[id].inputs.some((input) => input.item === item));
}

/** The seed card line, e.g. "For: Hearty Stew". Null when no recipe uses it. */
export function wantedForLine(item: MachineItemId): string | null {
  const labels = recipesUsing(item).map((id) => RECIPE_CATALOGUE[id].label);
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
