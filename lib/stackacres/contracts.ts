/**
 * Town Contracts: a premium door from a processed good back to Gold.
 *
 * ONE OPEN CONTRACT AT A TIME, deliberately. A board of several would let a
 * player bank up processed goods against whichever contract paid best,
 * which is a different game (arbitrage) from the one this is meant to be
 * (keep a machine fed, cash in what it makes). `homestead_contracts` mirrors
 * this in SQL with a partial unique index on `(profile_id) where status =
 * 'open'`, so the single-contract rule holds even against two racing tabs.
 *
 * NOT THE ONLY DOOR ANY MORE. `sellStackAcresItem` (lib/server/
 * stackacres-service.ts) can turn any inventory item into Gold at any time,
 * at that item's own (lower) sell price, to the townsperson who buys it.
 * A contract pays a small premium over that (see `CONTRACT_RUNGS`). Neither door is
 * capped any more (see lib/stackacres/exchange.ts's header for when and why
 * the flat daily ceiling this comment used to describe was removed).
 *
 * Town Influence (./town.ts) rides the same fulfillment, uncapped -- it is
 * progression, not currency, and spends nowhere, so it carries none of the
 * ceiling's risk.
 *
 * A CONTRACT IS ONLY EVER DRAWN FROM WHAT THE PLAYER CAN ACTUALLY MAKE, which
 * is why `drawContract` takes that set rather than reading the rungs
 * directly. With one open contract at a time and no way to cancel one, a
 * contract for a good this farm has no machine for is not a missed
 * opportunity -- it is a dead end that blocks every future contract too. That
 * was already reachable before the Dairy and the Loom existed (a player who
 * never placed a Mill could still be handed a Flour contract); three
 * processed goods make it the common case rather than the odd one.
 */

import { STACKACRES_STOCK, isLivestock, type StackAcresStock } from "./catalogue";
import { STACKACRES_YIELDS } from "./items";
import type { StackAcresInventory } from "./inventory";
import type { MachineProcessedItem } from "./machine-items";
import type { MachineKind } from "./machines";
import { RECIPE_CATALOGUE, recipesForMachine } from "./recipes";
import { isSeedUnlocked } from "./seed-unlocks";

export interface ContractDef {
  item: MachineProcessedItem;
  quantity: number;
  goldReward: number;
  influenceReward: number;
}

/**
 * The rungs a contract is drawn from.
 *
 * Every rung pays 1.25x what its goods' raw inputs sell for
 * (`recipeRawGoldValue`), pinned by a test in ./recipes.test.ts. That beats
 * selling the made good itself (at most 1.15x raw, ./machine-items.ts), so an
 * order is still worth filling, but only by a little: the farm's money is raw
 * goods sold in bulk in town, not orders (2026-10-02 economy rebase).
 *
 * No Cheese or Cloth orders. A rung for a good the Dairy or Loom makes would
 * pay hundreds per unit and turn the board back into the main income.
 *
 * The premium is uniform on purpose. A ladder where one good paid better per
 * unit of raw material would turn the single open contract into an arbitrage
 * puzzle -- reroll until the rich one comes up -- and there is no reroll, so
 * it would just be a bad draw the player is stuck with.
 */
export const CONTRACT_RUNGS: readonly ContractDef[] = [
  { item: "flour", quantity: 2, goldReward: 52, influenceReward: 10 },
  { item: "flour", quantity: 4, goldReward: 105, influenceReward: 25 },
  { item: "flour", quantity: 8, goldReward: 210, influenceReward: 60 },
  // Sauerkraut has no rung: three cabbages sell for 6 Gold, so a fair order
  // would pay almost nothing.
  { item: "sauce", quantity: 2, goldReward: 192, influenceReward: 10 },
  { item: "sauce", quantity: 4, goldReward: 385, influenceReward: 20 },
  { item: "salsa", quantity: 3, goldReward: 289, influenceReward: 15 },
  { item: "salsa", quantity: 6, goldReward: 578, influenceReward: 30 },
  { item: "pickles", quantity: 4, goldReward: 250, influenceReward: 10 },
  { item: "pickles", quantity: 8, goldReward: 500, influenceReward: 25 },
  // The Harvest Feast has no order: it is for eating and giving.
  { item: "bean_casserole", quantity: 2, goldReward: 248, influenceReward: 15 },
  { item: "bean_casserole", quantity: 4, goldReward: 495, influenceReward: 30 },
];

export interface StackAcresContractRow {
  id: string;
  item: MachineProcessedItem;
  quantity: number;
  goldReward: number;
  influenceReward: number;
  status: StackAcresContractStatus;
  createdAt: string;
}

/**
 * Three terminal states, not two.
 *
 * `passed` is the release valve on a board that is one slot wide and has no
 * cancel: a rung the farm can make but the player does not want would
 * otherwise sit there until it was filled. It is capped at one per UTC day
 * (`contractPassSpent` below), because an uncapped pass is a reroll button
 * and the single slot exists precisely to stop the board becoming an
 * arbitrage puzzle.
 */
export type StackAcresContractStatus = "open" | "fulfilled" | "passed";

export function isStackAcresContractStatus(value: string): value is StackAcresContractStatus {
  return value === "open" || value === "fulfilled" || value === "passed";
}

/** One a day. Named rather than inlined so the rule reads the same in the
 *  service, the sheet and the tests. */
export const CONTRACT_PASSES_PER_DAY = 1;

/**
 * Whether today's pass is already gone.
 *
 * Takes the day strings rather than dates so the caller owns the clock, the
 * same posture every other timed rule in StackAcres takes. `lastPassDay` is
 * null for a player who has never passed one.
 */
export function contractPassSpent(lastPassDay: string | null, today: string): boolean {
  return lastPassDay !== null && lastPassDay === today;
}

/**
 * The goods this farm can really turn out right now: a machine for the recipe AND
 * every input within reach. A machine alone is not enough. A Dairy on a farm with no
 * cattle would be handed a Cheese order it can never fill, and with one open contract
 * and one pass a day that is a stuck board (see the header).
 *
 * An input is within reach when the farm already holds some, when it is the produce of
 * a crop whose seed Ray sells this farm (see ./seed-unlocks.ts), when a kind of
 * livestock the farm owns yields it, or when another recipe the farm can run makes it.
 * That last one is why this runs to a fixed point: Cake needs Flour, and Flour needs a Mill.
 */
export function contractableItems(farm: {
  machineKinds: readonly MachineKind[];
  ownedStocks: readonly StackAcresStock[];
  inventory: StackAcresInventory;
}): MachineProcessedItem[] {
  const reachable = new Set<string>();
  const built = new Set(farm.machineKinds);
  for (const stock of STACKACRES_STOCK) {
    if (!isLivestock(stock) && isSeedUnlocked(stock, built)) reachable.add(STACKACRES_YIELDS[stock].item);
  }
  for (const stock of farm.ownedStocks) if (isLivestock(stock)) reachable.add(STACKACRES_YIELDS[stock].item);
  for (const [item, quantity] of Object.entries(farm.inventory)) if ((quantity ?? 0) > 0) reachable.add(item);

  const recipes = [...new Set(farm.machineKinds)].flatMap((kind) => recipesForMachine(kind));
  const made = new Set<MachineProcessedItem>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of recipes) {
      const recipe = RECIPE_CATALOGUE[id];
      if (made.has(recipe.output.item)) continue;
      if (!recipe.inputs.every((input) => reachable.has(input.item))) continue;
      made.add(recipe.output.item);
      reachable.add(recipe.output.item);
      grew = true;
    }
  }
  return [...made];
}

/** A source of numbers in [0, 1). Injected so a test can make it boring --
 *  the same seam ./world.ts's `Random` is. */
export type Random = () => number;

/**
 * Draws one rung at random from the goods this farm can actually make.
 *
 * Null when `producible` is empty or names nothing any rung asks for -- the
 * caller answers that as "place a machine first" rather than posting a
 * contract nobody can ever close. See the header.
 *
 * Pure -- the server calls this with `Math.random` and stamps the result onto
 * a row exactly once, the same "rolled once, never re-derived on read" rule
 * ./catalogue.ts's muck chance follows.
 */
export function drawContract(
  producible: readonly MachineProcessedItem[],
  random: Random = Math.random,
): ContractDef | null {
  const eligible = CONTRACT_RUNGS.filter((rung) => producible.includes(rung.item));
  if (eligible.length === 0) return null;
  return eligible[Math.floor(random() * eligible.length)];
}

export function canFulfillContract(
  held: number,
  contract: Pick<StackAcresContractRow, "quantity" | "status">,
): boolean {
  return contract.status === "open" && held >= contract.quantity;
}

/**
 * How far along the board a rung is, as a 0..1 fraction, for a progress bar
 * to scale itself by.
 *
 * Clamped at both ends deliberately. A held count ABOVE the requirement is
 * still a full bar rather than an overflowing one -- surplus Flour is not
 * extra progress, it is just Flour -- and a `required` of zero reads as done
 * rather than dividing by nothing. Pure, so the bar and the button below it
 * cannot disagree about whether a rung is ready.
 */
export function contractProgress(held: number, required: number): number {
  if (required <= 0) return 1;
  return Math.min(1, Math.max(0, held / required));
}

/**
 * Whether `contract` is the board rung `def` -- what lets the town board draw
 * three rungs and mark the one actually posted.
 *
 * Matched on item AND quantity rather than on an id, because a rung in
 * CONTRACT_RUNGS has no id: the id is minted when the row is written, and the
 * board is drawn from the table. Two rungs asking for the same quantity of
 * the same item would be indistinguishable here, which is why the table has
 * none -- if one is ever added, give the rungs their own stable keys first.
 */
export function isPostedRung(contract: StackAcresContractRow | null, def: ContractDef): boolean {
  return contract !== null && contract.item === def.item && contract.quantity === def.quantity;
}
