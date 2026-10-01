/**
 * Town Contracts: the town's order board.
 *
 * A BOARD OF SEVERAL ORDERS, not one. Up to `CONTRACT_BOARD_SIZE` are open at
 * once, every one of them can be delivered, and one can be pinned so the farm
 * HUD keeps it in view. The old one-slot board only ever asked for processed
 * goods; this one draws from everything the farm can actually turn out --
 * crops, eggs, wool and milk, machine goods, chopped Wood and mined Stone,
 * fish from the pond, and hybrids bred at the Crossbreeding Bed -- so the
 * board reads as a production plan, not a single errand.
 *
 * WHERE GOLD ENTERS AND LEAVES. An order pays `CONTRACT_PREMIUM` (1.3x) over
 * what its goods would fetch through Sell, plus Town Influence. That premium
 * is uniform across every item on purpose: with several orders open at once,
 * a ladder where one good paid better per unit of raw material would turn the
 * board into an arbitrage puzzle (bank goods against whichever pays best).
 * Flat 1.3x means an order is always a slightly better door than Sell and
 * never a wildly better one. Nothing here costs Gold: pinning, swapping and
 * asking for orders all move nothing.
 *
 * AN ORDER IS ONLY EVER DRAWN FROM WHAT THE FARM CAN REALLY MAKE. A crop
 * counts when its seed is on sale at Ray's (./seed-unlocks.ts) or some is
 * already on the shelf; produce when the animal is kept; a machine good when
 * the machine stands and every input is within reach; Wood, Stone and fish
 * when some has already been brought in (that is the proof the source is
 * open to this player); a hybrid only when one is already held, since a
 * cross is a rare roll and an order for one never bred could sit for weeks.
 * See `contractableItems`.
 *
 * ONE SWAP A DAY (`replaceContract`) is the release valve: an order the farm
 * can fill but does not want goes back and a fresh one is drawn. Uncapped
 * swaps would be a reroll button. The status value in the database stays
 * `passed`, which is what the one-slot board's pass wrote; the rule is the
 * same rule, the board is just wider.
 */

import {
  STACKACRES_CATALOGUE,
  STACKACRES_CROPS,
  isLivestock,
  isStackAcresCrop,
  type StackAcresStock,
} from "./catalogue";
import { CROSSBREED_ITEM_CATALOGUE, isCrossbreedItem, type CrossbreedItem } from "./crossbreed-items";
import { CROSSBREED_MATRIX } from "./crossbreeding";
import { STACKACRES_YIELDS, isStackAcresItem } from "./items";
import type { StackAcresInventory } from "./inventory";
import {
  MACHINE_ITEM_CATALOGUE,
  isMachineItem,
  isMachineProcessedItem,
  machineItemIcon,
  machineItemLabel,
  machineItemNoun,
  machineItemSellPrice,
  type MachineItemId,
} from "./machine-items";
import { MACHINE_CATALOGUE, type MachineKind } from "./machines";
import { RECIPE_CATALOGUE, recipeForOutput, recipesForMachine } from "./recipes";
import { isSeedUnlocked } from "./seed-unlocks";

/** Anything an order may ask for: the whole shared inventory plus hybrids. */
export type ContractItem = MachineItemId | CrossbreedItem;

export function isContractItem(value: string): value is ContractItem {
  return isMachineItem(value) || isCrossbreedItem(value);
}

export interface ContractRequirement {
  readonly item: ContractItem;
  readonly quantity: number;
}

export interface ContractDef {
  /** Stable identity for "is this order already on the board": the lines,
   *  sorted. Two orders asking for the same lines are the same order. */
  readonly key: string;
  readonly title: string;
  /** One or two lines, never empty. */
  readonly requirements: readonly ContractRequirement[];
  readonly goldReward: number;
  readonly influenceReward: number;
}

/** How many orders the board holds. */
export const CONTRACT_BOARD_SIZE = 4;

/** What an order pays over the plain Sell value of its goods. */
export const CONTRACT_PREMIUM = 1.3;

/** Longest an order may be. Two lines is enough to make a player plan
 *  across a field and a machine; three starts reading as a shopping list. */
export const CONTRACT_MAX_LINES = 2;

/** Odds a drawn order asks for a second item as well. */
const SECOND_LINE_CHANCE = 0.35;

/** Influence per Gold of reward, with a floor so a small early order still
 *  moves the ladder (./influence-tiers.ts) a little. */
const INFLUENCE_PER_GOLD = 1 / 28;
const INFLUENCE_FLOOR = 5;

export type StackAcresContractStatus = "open" | "fulfilled" | "passed";

export function isStackAcresContractStatus(value: string): value is StackAcresContractStatus {
  return value === "open" || value === "fulfilled" || value === "passed";
}

export interface StackAcresContractRow {
  id: string;
  title: string;
  requirements: readonly ContractRequirement[];
  goldReward: number;
  influenceReward: number;
  status: StackAcresContractStatus;
  /** At most one open order per farm is pinned. */
  pinned: boolean;
  createdAt: string;
}

/** One swap a day. Named so the service, the sheet and the tests read the
 *  same number. */
export const CONTRACT_REPLACEMENTS_PER_DAY = 1;

/** Whether today's swap is already gone. Takes day strings so the caller
 *  owns the clock. `lastDay` is null for a player who has never swapped. */
export function contractReplacementSpent(lastDay: string | null, today: string): boolean {
  return lastDay !== null && lastDay === today;
}

/* ------------------------------------------------------------------ */
/* Items: value, label, icon, source                                    */
/* ------------------------------------------------------------------ */

/**
 * Items the town never orders. Cattle Feed is feed, Metal and Iron Ore are
 * building materials for the Far Field, and Field Notes and Trail Photos are
 * a hunting keepsake rather than farm produce.
 */
export const CONTRACT_EXCLUDED_ITEMS: ReadonlySet<string> = new Set([
  "cattle_feed",
  "metal",
  "iron_ore",
  "meat",
  "pelt",
]);

/**
 * What a hybrid is worth to the town. Hybrids have no Sell price on purpose
 * (./crossbreed-items.ts): an order is their only door to Gold, so the value
 * lives here. Rarer crosses pay more.
 */
export const CROSSBREED_CONTRACT_VALUE: Readonly<Record<CrossbreedItem, number>> = {
  golden_maize: 400,
  candied_husk: 500,
  sunroot_egg: 700,
  marbled_down: 1_000,
  tallow_wool: 1_200,
  custard_curd: 1_400,
};

/** The Sell value of one unit, or the town's value for a hybrid. */
export function contractItemValue(item: ContractItem): number {
  if (isCrossbreedItem(item)) return CROSSBREED_CONTRACT_VALUE[item];
  return machineItemSellPrice(item);
}

export function contractItemLabel(item: ContractItem, quantity: number): string {
  if (isCrossbreedItem(item)) {
    const def = CROSSBREED_ITEM_CATALOGUE[item];
    return `${quantity.toLocaleString()} ${quantity === 1 ? def.label : def.plural}`;
  }
  return machineItemLabel(item, quantity);
}

export function contractItemNoun(item: ContractItem, quantity: number): string {
  if (isCrossbreedItem(item)) {
    const def = CROSSBREED_ITEM_CATALOGUE[item];
    return quantity === 1 ? def.label : def.plural;
  }
  return machineItemNoun(item, quantity);
}

/** Hybrids have no painter of their own yet, so each borrows one parent's. */
const CROSSBREED_CONTRACT_ICON: Readonly<Record<CrossbreedItem, string>> = {
  golden_maize: "ico-corn",
  candied_husk: "ico-carrot",
  sunroot_egg: "ico-egg",
  marbled_down: "ico-fleece",
  tallow_wool: "ico-fleece",
  custard_curd: "ico-milk",
};

export function contractItemIcon(item: ContractItem): string {
  if (isCrossbreedItem(item)) return CROSSBREED_CONTRACT_ICON[item];
  return machineItemIcon(item);
}

const PRODUCE_HINT: Readonly<Record<"eggs" | "wool" | "milk", string>> = {
  eggs: "Laid by your hens",
  wool: "Shorn from your sheep",
  milk: "Milked from your cattle",
};

const GATHER_HINT: Readonly<Record<string, string>> = {
  wood: "Chopped from the treeline",
  stone: "Mined from the boulders",
  bluegill: "Caught at the pond",
  trout: "Caught at the pond, more often with Radish bait",
  catfish: "Caught at the pond, more often with Radish bait",
};

/**
 * One line on where an item comes from, in the words the rest of the farm
 * uses. Built from the catalogues, never stored, so a retune cannot leave a
 * hint describing a recipe that no longer exists.
 */
export function contractSourceHint(item: ContractItem): string {
  if (isCrossbreedItem(item)) {
    const cross = CROSSBREED_MATRIX.find((entry) => entry.hybrid === item);
    if (!cross) throw new Error(`No cross breeds ${item}`);
    const a = STACKACRES_CATALOGUE[cross.a].label;
    const b = STACKACRES_CATALOGUE[cross.b].label;
    return `Bred at the Crossbreeding Bed: ${a} beside ${b}`;
  }
  if (isStackAcresCrop(item)) return `Grown in a bed from ${STACKACRES_CATALOGUE[item].label} seed`;
  if (item === "eggs" || item === "wool" || item === "milk") return PRODUCE_HINT[item];
  if (isMachineProcessedItem(item)) {
    const recipe = recipeForOutput(item);
    if (!recipe) throw new Error(`No recipe makes ${item}`);
    const def = RECIPE_CATALOGUE[recipe];
    const inputs = def.inputs.map((input) => contractItemLabel(input.item, input.quantity)).join(", ");
    return `Made at the ${MACHINE_CATALOGUE[def.machine].label} from ${inputs}`;
  }
  const hint = GATHER_HINT[item];
  if (!hint) throw new Error(`No source hint for ${item}`);
  return hint;
}

/* ------------------------------------------------------------------ */
/* Reachability                                                         */
/* ------------------------------------------------------------------ */

export interface ContractFarm {
  readonly machineKinds: readonly MachineKind[];
  readonly ownedStocks: readonly StackAcresStock[];
  readonly inventory: StackAcresInventory;
  readonly hybrids: Partial<Record<CrossbreedItem, number>>;
}

/**
 * Everything this farm can really turn out right now, in a stable order.
 * See the header for what "really" means per item kind. Machine goods run
 * to a fixed point, since Cake needs Flour and Flour needs a Mill.
 */
export function contractableItems(farm: ContractFarm): ContractItem[] {
  const built = new Set(farm.machineKinds);
  const reachable = new Set<string>();

  for (const crop of STACKACRES_CROPS) {
    if (isSeedUnlocked(crop, built)) reachable.add(STACKACRES_YIELDS[crop].item);
  }
  for (const stock of farm.ownedStocks) {
    if (isLivestock(stock)) reachable.add(STACKACRES_YIELDS[stock].item);
  }
  for (const [item, quantity] of Object.entries(farm.inventory)) {
    if ((quantity ?? 0) > 0 && isMachineItem(item)) reachable.add(item);
  }
  for (const [item, quantity] of Object.entries(farm.hybrids)) {
    if ((quantity ?? 0) > 0 && isCrossbreedItem(item)) reachable.add(item);
  }

  const recipes = [...built].flatMap((kind) => recipesForMachine(kind));
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of recipes) {
      const recipe = RECIPE_CATALOGUE[id];
      if (reachable.has(recipe.output.item)) continue;
      if (!recipe.inputs.every((input) => reachable.has(input.item))) continue;
      reachable.add(recipe.output.item);
      grew = true;
    }
  }

  return ORDERABLE_ITEMS.filter((item) => reachable.has(item));
}

/** Every item the town might ever ask for, in catalogue order. */
const ORDERABLE_ITEMS: readonly ContractItem[] = [
  ...(Object.keys(STACKACRES_YIELDS) as StackAcresStock[]).map((stock) => STACKACRES_YIELDS[stock].item),
  ...(Object.keys(MACHINE_ITEM_CATALOGUE) as (keyof typeof MACHINE_ITEM_CATALOGUE)[]),
  ...(Object.keys(CROSSBREED_CONTRACT_VALUE) as CrossbreedItem[]),
].filter((item, index, all) => all.indexOf(item) === index && !CONTRACT_EXCLUDED_ITEMS.has(item));

/* ------------------------------------------------------------------ */
/* Drawing                                                              */
/* ------------------------------------------------------------------ */

/**
 * How much of an item one order asks for: a small ladder per item, sized so
 * a step is a session's work rather than a season's. Tier-1 crops ripen in
 * seconds and sell for 2, so their ladder is long; a hybrid is one rare
 * thing, so its ladder is 1.
 */
export function contractQuantityLadder(item: ContractItem): readonly number[] {
  if (isCrossbreedItem(item)) return [1];
  if (isStackAcresCrop(item)) {
    if (item === "wheat") return [8, 16];
    const value = machineItemSellPrice(item);
    if (value <= 2) return [6, 12, 20];
    if (value <= 25) return [4, 8];
    return [3, 6];
  }
  if (isStackAcresItem(item)) return item === "eggs" ? [4, 8] : [3, 6];
  switch (item) {
    case "flour":
      return [2, 4, 8];
    case "cheese":
      return [2, 4];
    case "cloth":
      return [3, 6];
    case "salsa":
      return [3, 6];
    case "pickles":
      return [4, 8];
    case "wood":
      return [20, 40];
    case "stone":
      return [15, 30];
    case "bluegill":
      return [5, 10];
    case "trout":
      return [3, 6];
    case "catfish":
      return [2, 4];
    default:
      return [2, 4];
  }
}

/** A source of numbers in [0, 1). Injected so a test can make it boring. */
export type Random = () => number;

export function contractKey(requirements: readonly ContractRequirement[]): string {
  return [...requirements]
    .map((line) => `${line.item}:${line.quantity}`)
    .sort()
    .join("|");
}

/** Sums the Sell value of every line, before the premium. */
export function contractRawValue(requirements: readonly ContractRequirement[]): number {
  return requirements.reduce((total, line) => total + contractItemValue(line.item) * line.quantity, 0);
}

function contractTitle(requirements: readonly ContractRequirement[]): string {
  if (requirements.length === 1) {
    const [line] = requirements;
    return `${contractItemLabel(line.item, line.quantity)} for the town`;
  }
  const nouns = requirements.map((line) => contractItemNoun(line.item, line.quantity));
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]} for the market`;
}

/** Prices a set of lines into an order. Pure: the same lines always price
 *  the same, which is what lets a test pin the premium. */
export function buildContract(requirements: readonly ContractRequirement[]): ContractDef {
  if (requirements.length === 0 || requirements.length > CONTRACT_MAX_LINES) {
    throw new Error(`An order has 1 to ${CONTRACT_MAX_LINES} lines, not ${requirements.length}`);
  }
  for (const line of requirements) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`An order line needs a positive whole quantity, not ${line.quantity}`);
    }
  }
  const goldReward = Math.round(contractRawValue(requirements) * CONTRACT_PREMIUM);
  const influenceReward = Math.max(INFLUENCE_FLOOR, Math.round(goldReward * INFLUENCE_PER_GOLD));
  return {
    key: contractKey(requirements),
    title: contractTitle(requirements),
    requirements: [...requirements],
    goldReward,
    influenceReward,
  };
}

function pick<T>(list: readonly T[], random: Random): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/**
 * Draws one order the farm can fill and the board does not already carry.
 *
 * Null when nothing is reachable, or when every order it can think of is
 * already posted (`taken`). The caller answers null as "nothing to post",
 * never by inventing an order nobody can close. Pure: the server calls this
 * with `Math.random` and stamps the result onto a row exactly once.
 */
export function drawContract(
  reachable: readonly ContractItem[],
  taken: readonly string[] = [],
  random: Random = Math.random,
): ContractDef | null {
  if (reachable.length === 0) return null;
  const posted = new Set(taken);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const first = pick(reachable, random);
    const lines: ContractRequirement[] = [{ item: first, quantity: pick(contractQuantityLadder(first), random) }];
    if (reachable.length > 1 && random() < SECOND_LINE_CHANCE) {
      const others = reachable.filter((item) => item !== first);
      const second = pick(others, random);
      lines.push({ item: second, quantity: contractQuantityLadder(second)[0] });
    }
    const def = buildContract(lines);
    if (!posted.has(def.key)) return def;
  }
  return null;
}

/**
 * Fills the board up to `CONTRACT_BOARD_SIZE`, one distinct order per empty
 * slot. Returns only the new orders. Stops early once `drawContract` runs
 * out of distinct orders, which on a farm that can only grow lettuce is
 * three orders, not four repeats.
 */
export function drawBoard(
  reachable: readonly ContractItem[],
  open: readonly string[],
  random: Random = Math.random,
): ContractDef[] {
  const taken = [...open];
  const drawn: ContractDef[] = [];
  while (taken.length < CONTRACT_BOARD_SIZE) {
    const def = drawContract(reachable, taken, random);
    if (!def) break;
    taken.push(def.key);
    drawn.push(def);
  }
  return drawn;
}

/* ------------------------------------------------------------------ */
/* Reading the board                                                    */
/* ------------------------------------------------------------------ */

/** Whether every line is on the shelf and the order is still open. `held`
 *  answers for any item, hybrids included. */
export function canFulfillContract(
  held: (item: ContractItem) => number,
  contract: Pick<StackAcresContractRow, "requirements" | "status">,
): boolean {
  return contract.status === "open" && contract.requirements.every((line) => held(line.item) >= line.quantity);
}

/**
 * How far along an order line is, as a 0..1 fraction for a progress bar.
 * Clamped at both ends: a surplus is a full bar, not an overflowing one, and
 * a requirement of zero reads as done rather than dividing by nothing.
 */
export function contractProgress(held: number, required: number): number {
  if (required <= 0) return 1;
  return Math.min(1, Math.max(0, held / required));
}

/** The pinned order, or null. The board holds at most one. */
export function pinnedContract<T extends Pick<StackAcresContractRow, "pinned" | "status">>(board: readonly T[]): T | null {
  return board.find((contract) => contract.status === "open" && contract.pinned) ?? null;
}

/** Whether `value` parses as the requirement lines a row stores. Used at the
 *  database edge, where a row that does not parse is a broken row, not a
 *  default. */
export function parseContractRequirements(value: unknown): ContractRequirement[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CONTRACT_MAX_LINES) {
    throw new Error("A contract row's requirements are not a short list");
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("A contract line is not an object");
    const { item, quantity } = entry as { item?: unknown; quantity?: unknown };
    if (typeof item !== "string" || !isContractItem(item)) throw new Error(`Unknown contract item ${String(item)}`);
    const count = Number(quantity);
    if (!Number.isInteger(count) || count <= 0) throw new Error(`Bad contract quantity ${String(quantity)}`);
    return { item, quantity: count };
  });
}
