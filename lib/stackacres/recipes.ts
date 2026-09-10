/**
 * What a machine actually makes: one or more raw items in, one processed
 * item out.
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
 *     database transaction and no queue row is ever written. The Dairy and
 *     the Loom are this.
 *
 * Instant is the default for anything added here from now on. StackAcres is
 * reached from a poker app's lobby, in the gaps between hands -- a player who
 * has to come back in twenty seconds to press a second button has usually sat
 * back down at a table instead. A timer earns its place only where the wait is
 * the point (a crop growing, an animal fattening); a conversion the player has
 * already paid for in raw materials is not that.
 *
 * `inputs` IS A LIST NOW, NOT ONE ITEM. Flour, Cheese and Cloth each still
 * take exactly one -- that never changes for them -- but Cake takes three
 * (eggs, milk, flour), which is the whole reason this widened from a single
 * `{item, quantity}` to `inputs: {item, quantity}[]`. `process_homestead_recipe_multi`
 * (the SQL side) debits every input under its own row lock in one
 * transaction before crediting the output, so a two-of-three shortfall never
 * leaves a half-spent Cake behind -- see that migration's own comment.
 *
 * WHAT THE ECONOMY REQUIRES OF A RECIPE: every raw item this file can ask for
 * has its own sell price now (./machine-items.ts's `machineItemSellPrice`),
 * so a recipe whose finished good cannot clear what its inputs would sell for
 * on their own is a sink dressed as a feature -- see `recipeRawGoldValue` and
 * the contract rungs in ./contracts.ts, which are priced off it and pinned by
 * a test.
 */

import { machineItemSellPrice, type MachineItemId, type MachineProcessedItem } from "./machine-items";
import type { MachineKind } from "./machines";
import { hasEnough, type StackAcresInventory } from "./inventory";

export const RECIPE_IDS = ["flour", "cheese", "cloth", "cake"] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

export function isRecipeId(value: string): value is RecipeId {
  return (RECIPE_IDS as readonly string[]).includes(value);
}

export interface RecipeInput {
  readonly item: MachineItemId;
  readonly quantity: number;
}

export interface RecipeDef {
  /** What the player is told they are making. */
  readonly label: string;
  /** The machine that runs it. A player with no idle machine of this kind
   *  cannot start it -- see `processRecipe`. */
  readonly machine: MachineKind;
  /** One entry for Flour/Cheese/Cloth; three for Cake. Never empty. */
  readonly inputs: readonly RecipeInput[];
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
    inputs: [{ item: "wheat", quantity: 3 }],
    output: { item: "flour", quantity: 1 },
    processingMs: 20 * 1000,
  },
  cheese: {
    label: "Cheese",
    machine: "dairy",
    inputs: [{ item: "milk", quantity: 3 }],
    output: { item: "cheese", quantity: 1 },
    processingMs: 0,
  },
  cloth: {
    label: "Cloth",
    machine: "loom",
    inputs: [{ item: "wool", quantity: 4 }],
    output: { item: "cloth", quantity: 1 },
    processingMs: 0,
  },
  // The multi-ingredient recipe: needs the Dairy's own milk plus eggs and
  // flour, so it runs on the Dairy rather than a new machine kind -- see
  // lib/stackacres/scope.ts's header for why the active scope this pass is
  // exactly {hen, wheat plot, cattle}, which is exactly what Cake eats.
  cake: {
    label: "Cake",
    machine: "dairy",
    inputs: [
      { item: "eggs", quantity: 2 },
      { item: "milk", quantity: 1 },
      { item: "flour", quantity: 1 },
    ],
    output: { item: "cake", quantity: 1 },
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

/** Whether the inventory holds enough of every input to start `recipe`. */
export function canStartRecipe(inventory: StackAcresInventory, recipe: RecipeId): boolean {
  return RECIPE_CATALOGUE[recipe].inputs.every((input) => hasEnough(inventory, input.item, input.quantity));
}

/**
 * What ONE unit of this recipe's output costs the player in forgone Sell
 * Gold -- the sum of what every input would have sold for on its own,
 * divided by how many units of output one batch makes.
 *
 * This is the number a contract rung has to clear, and the floor a Sell
 * price has to clear too (see ./machine-items.ts's own header). Making a
 * Dairy run Cheese instead of selling the milk raw is not free: that milk
 * would otherwise have sold for `machineItemSellPrice("milk")`, so a Cheese
 * price under this number is a strictly worse move than never building the
 * Dairy. ./contracts.ts prices every rung off this, and a test pins it.
 */
export function recipeRawGoldValue(recipe: RecipeId): number {
  const def = RECIPE_CATALOGUE[recipe];
  const perBatch = def.inputs.reduce(
    (total, input) => total + machineItemSellPrice(input.item) * input.quantity,
    0,
  );
  return perBatch / def.output.quantity;
}
