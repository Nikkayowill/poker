/**
 * The client half of an instant tap: show the conversion immediately, put it
 * back if the server refuses.
 *
 * WHY THIS EXISTS AT ALL. `processRecipe` is instant on the server -- one
 * transaction, no queue row -- but it is still a network round trip, and a
 * Dairy button that does nothing for 200ms is the exact "laggy and glitchy"
 * complaint the direct-tap pass fixed everywhere else on this farm. So the
 * tap updates the local inventory with the same arithmetic the server will
 * run, and the response either confirms it or hands back the authoritative
 * inventory.
 *
 * WHAT THIS IS NOT: authority. The optimistic subtraction is decoration. The
 * server's own `process_homestead_recipe` does the sufficiency check under a
 * row lock, and a client that thinks it has enough milk is simply wrong when
 * that check says otherwise -- see lib/server/stackacres-store.ts. Nothing
 * here is ever the reason a write is allowed.
 *
 * WHEN TO ROLL BACK, AND WHEN NOT TO. `rollback()` restores the exact
 * pre-tap snapshot, and that is ONLY correct for a refusal -- a 409 saying
 * the inventory check failed, which means nothing moved. An ambiguous
 * failure (a dropped connection, a timeout) is NOT a refusal: the transaction
 * may well have committed, and restoring the snapshot would then show the
 * player milk they no longer have. Refetch the view instead. `processRecipe`
 * answers a refusal with a specific status so the caller can tell the two
 * apart rather than guessing.
 */

import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import { RECIPE_CATALOGUE, type RecipeId } from "./recipes";

export interface OptimisticRecipeApplied {
  ok: true;
  /** The inventory to render while the request is in flight. */
  next: StackAcresInventory;
  /** Restores the pre-tap snapshot. Safe to call more than once, and safe to
   *  ignore -- it mutates nothing on its own. */
  rollback: () => StackAcresInventory;
}

export interface OptimisticRecipeRefused {
  ok: false;
  /** How many more of the input the player needs. Always positive. */
  shortfall: number;
}

export type OptimisticRecipeResult = OptimisticRecipeApplied | OptimisticRecipeRefused;

/**
 * Runs one batch of `recipe` against a local inventory.
 *
 * Refuses locally when the player plainly does not have enough, so an
 * obviously-doomed tap never becomes a request -- the server would refuse it
 * anyway, and this keeps the button honest. A local pass is not a promise:
 * the server checks again, under a lock.
 */
export function applyRecipeOptimistically(
  inventory: StackAcresInventory,
  recipe: RecipeId,
): OptimisticRecipeResult {
  const def = RECIPE_CATALOGUE[recipe];
  const held = inventoryQuantity(inventory, def.input.item);
  if (held < def.input.quantity) {
    return { ok: false, shortfall: def.input.quantity - held };
  }

  // Captured by value, not by reference: the caller's own state object may be
  // replaced between the tap and the refusal, and rollback has to restore
  // what was on screen when the tap happened.
  const snapshot: StackAcresInventory = { ...inventory };
  const next: StackAcresInventory = {
    ...inventory,
    [def.input.item]: held - def.input.quantity,
    [def.output.item]:
      inventoryQuantity(inventory, def.output.item) + def.output.quantity,
  };

  return { ok: true, next, rollback: () => ({ ...snapshot }) };
}
