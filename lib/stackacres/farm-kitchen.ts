/**
 * The Farm Kitchen (Chapter 6): a late investment that cooks one standing
 * order while the player is away.
 *
 * It earns one batch every FARM_KITCHEN_STEP_MS from `kitchenSince`, banks at
 * most FARM_KITCHEN_BANK of them, and each batch it cooks makes double the
 * recipe's output. Ingredients still come off the shelf, so an empty pantry
 * stops it. The doubling is where its 60,000 Gold comes back.
 *
 * Worked out from timestamps, never ticked. The server cooks only inside a
 * write (`workStackAcres`), never on a read.
 */

import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import type { MachineItemId, MachineProcessedItem } from "./machine-items";
import type { MachineKind } from "./machines";
import { RECIPE_CATALOGUE, RECIPE_IDS, type RecipeId } from "./recipes";

export const FARM_KITCHEN_STEP_MS = 30 * 60 * 1000;
/** Batches it can bank: eight hours away. */
export const FARM_KITCHEN_BANK = 16;
/** Each batch it cooks makes this many times the recipe's output. */
export const FARM_KITCHEN_YIELD = 2;

/** The machines whose recipes the Farm Kitchen can cook. */
const KITCHEN_KINDS: readonly MachineKind[] = ["oven", "stew_pot", "counter"];

/** Every recipe it can take as a standing order, in catalogue order. */
export const FARM_KITCHEN_RECIPES: readonly RecipeId[] = RECIPE_IDS.filter((id) =>
  KITCHEN_KINDS.includes(RECIPE_CATALOGUE[id].machine),
);

export function isFarmKitchenRecipe(value: string): value is RecipeId {
  return (FARM_KITCHEN_RECIPES as readonly string[]).includes(value);
}

/** The instant banking starts from: never more than a full bank ago. */
function bankStartMs(kitchenSince: string, nowMs: number): number {
  const since = Date.parse(kitchenSince);
  return Math.max(Number.isFinite(since) ? since : nowMs, nowMs - FARM_KITCHEN_BANK * FARM_KITCHEN_STEP_MS);
}

/** Batches banked by `now`, 0 before a standing order is set. */
export function farmKitchenBanked(kitchenSince: string | null, now: Date): number {
  if (!kitchenSince) return 0;
  const nowMs = now.getTime();
  const elapsed = Math.max(0, nowMs - bankStartMs(kitchenSince, nowMs));
  return Math.min(FARM_KITCHEN_BANK, Math.floor(elapsed / FARM_KITCHEN_STEP_MS));
}

/** Whole batches of `recipe` the shelf can pay for. */
export function batchesAffordable(inventory: StackAcresInventory, recipe: RecipeId): number {
  return Math.min(
    ...RECIPE_CATALOGUE[recipe].inputs.map((input) => Math.floor(inventoryQuantity(inventory, input.item) / input.quantity)),
  );
}

export interface FarmKitchenPlan {
  recipe: RecipeId;
  batches: number;
  inputs: { item: MachineItemId; quantity: number }[];
  output: { item: MachineProcessedItem; quantity: number };
  /** The new `kitchenSince`: spent batches come off, unspent ones stay banked. */
  nextSince: string;
}

/** What one pass cooks, or null when there is nothing to cook. */
export function planFarmKitchen(
  row: { standingRecipe: RecipeId | null; kitchenSince: string | null },
  inventory: StackAcresInventory,
  now: Date,
): FarmKitchenPlan | null {
  const recipe = row.standingRecipe;
  if (!recipe || !row.kitchenSince) return null;
  const batches = Math.min(farmKitchenBanked(row.kitchenSince, now), batchesAffordable(inventory, recipe));
  if (batches < 1) return null;
  const def = RECIPE_CATALOGUE[recipe];
  const start = bankStartMs(row.kitchenSince, now.getTime());
  return {
    recipe,
    batches,
    inputs: def.inputs.map((input) => ({ item: input.item, quantity: input.quantity * batches })),
    output: { item: def.output.item, quantity: def.output.quantity * FARM_KITCHEN_YIELD * batches },
    nextSince: new Date(start + batches * FARM_KITCHEN_STEP_MS).toISOString(),
  };
}
