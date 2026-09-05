/**
 * What a machine actually makes: one raw item in, one processed item out.
 *
 * THE RECIPE, NOT THE MACHINE, IS THE UNIT OF CONFIGURATION. A Mill used to
 * carry its own `input`/`output`/`processingMs` inline (./machines.ts), which
 * worked while there was exactly one machine running exactly one thing. It
 * stops working the moment a run has to be recorded -- a working machine row
 * has to say WHICH recipe it is running and how many units it will yield, or
 * a retune landing mid-run pays out something the player never started. Same
 * rule `StoredWordStackRound.wagerLadder` and `AnteUpMemoryAttempt.maxTurns`
 * already state: what a settlement pays is snapshotted when the run starts,
 * never re-read from this module at the end.
 *
 * TWO PACINGS, and the split is deliberate rather than cosmetic:
 *
 *   - `processingMs > 0` is a QUEUED run. The input leaves inventory, the
 *     machine row holds `recipe_id`/`units_processing` for the duration, and
 *     `workStackAcres` collects it once `ready_at` passes. The Mill is this.
 *   - `processingMs === 0` is an INSTANT TAP. Input and output move in one
 *     database transaction (`process_homestead_recipe`) and no queue row is
 *     ever written. The Dairy and the Loom are this.
 *
 * Instant is the default for anything added here from now on. StackAcres is
 * reached from a poker app's lobby, in the gaps between hands -- a player who
 * has to come back in twenty seconds to press a second button has usually sat
 * back down at a table instead. A timer earns its place only where the wait is
 * the point (a crop growing, an animal fattening); a conversion the player has
 * already paid for in raw materials is not that.
 *
 * WHAT THE ECONOMY REQUIRES OF A RECIPE: milk and wool have a Gold price on
 * the harvest track (./items.ts), so diverting them into a machine COSTS that
 * Gold. A recipe whose finished goods cannot clear what the raw materials
 * would have fetched is a sink dressed as a feature -- see
 * `recipeRawGoldValue` and the contract rungs in ./contracts.ts, which are
 * priced off it and pinned by a test. Wheat has no Gold price at all (it is
 * processing-track only), so `recipeRawGoldValue` returns null for Flour and
 * that rung is judged on seed cost instead.
 */

import { isStackAcresItem, itemGoldValue } from "./items";
import type { MachineKind } from "./machines";
import type { MachineProcessedItem, MachineRawItem } from "./machine-items";

export const RECIPE_IDS = ["flour", "cheese", "cloth"] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

export function isRecipeId(value: string): value is RecipeId {
  return (RECIPE_IDS as readonly string[]).includes(value);
}

export interface RecipeDef {
  /** What the player is told they are making. */
  readonly label: string;
  /** The machine that runs it. A player with no idle machine of this kind
   *  cannot start it -- see `processRecipe`. */
  readonly machine: MachineKind;
  readonly input: { readonly item: MachineRawItem; readonly quantity: number };
  readonly output: { readonly item: MachineProcessedItem; readonly quantity: number };
  /**
   * How long one batch takes once started. ZERO MEANS INSTANT, and is not the
   * same as "very fast": an instant recipe never writes a queue row at all,
   * so there is nothing to collect and nothing to lose if the tab closes.
   */
  readonly processingMs: number;
}

export const RECIPE_CATALOGUE: Readonly<Record<RecipeId, RecipeDef>> = {
  flour: {
    label: "Flour",
    machine: "mill",
    input: { item: "wheat", quantity: 3 },
    output: { item: "flour", quantity: 1 },
    processingMs: 20 * 1000,
  },
  cheese: {
    label: "Cheese",
    machine: "dairy",
    input: { item: "milk", quantity: 3 },
    output: { item: "cheese", quantity: 1 },
    processingMs: 0,
  },
  cloth: {
    label: "Cloth",
    machine: "loom",
    input: { item: "wool", quantity: 4 },
    output: { item: "cloth", quantity: 1 },
    processingMs: 0,
  },
};

/** Whether this recipe settles in one transaction rather than through a
 *  queued machine run. The one branch `processRecipe` switches on. */
export function isInstantRecipe(recipe: RecipeId): boolean {
  return RECIPE_CATALOGUE[recipe].processingMs === 0;
}

/** Every recipe a machine of `kind` can run, in catalogue order. Derived
 *  rather than listed on the machine so the two can never disagree. */
export function recipesForMachine(kind: MachineKind): readonly RecipeId[] {
  return RECIPE_IDS.filter((id) => RECIPE_CATALOGUE[id].machine === kind);
}

/** The recipe that produces `item`, or null. One producer per good today; a
 *  second one would make this ambiguous and needs a real choice in the UI
 *  before it is added. */
export function recipeForOutput(item: MachineProcessedItem): RecipeId | null {
  return RECIPE_IDS.find((id) => RECIPE_CATALOGUE[id].output.item === item) ?? null;
}

/**
 * What ONE unit of this recipe's output costs the player in forgone harvest
 * Gold, or null when the input has no Gold-track price (wheat).
 *
 * This is the number a contract rung has to clear. Diverting a cow's milk
 * into a Dairy is not free: that milk would otherwise have been paid out at
 * `itemGoldValue` by the harvest itself, so a Cheese contract paying less
 * than the milk was worth is a strictly worse move than never building the
 * Dairy. ./contracts.ts prices every rung off this, and a test pins it.
 */
export function recipeRawGoldValue(recipe: RecipeId): number | null {
  const def = RECIPE_CATALOGUE[recipe];
  if (!isStackAcresItem(def.input.item)) return null;
  const perBatch = itemGoldValue(def.input.item) * def.input.quantity;
  return perBatch / def.output.quantity;
}
