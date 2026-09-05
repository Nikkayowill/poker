/**
 * Town Contracts: the only door from a processed good back to Gold.
 *
 * ONE OPEN CONTRACT AT A TIME, deliberately. A board of several would let a
 * player bank up processed goods against whichever contract paid best,
 * which is a different game (arbitrage) from the one this is meant to be
 * (keep a machine fed, cash in what it makes). `homestead_contracts` mirrors
 * this in SQL with a partial unique index on `(profile_id) where status =
 * 'open'`, so the single-contract rule holds even against two racing tabs.
 *
 * FULFILLING A CONTRACT PAYS GOLD THROUGH THE SAME FLAT DAILY CEILING A
 * HARVEST DOES (`STACKACRES_GOLD_CEILING`, ./exchange.ts) -- see
 * `fulfillStackAcresContract` in lib/server/stackacres-service.ts. This is
 * not incidental: a contract is a second way Gold enters the farm, and the
 * ceiling is the one invariant every path in is required to respect (see
 * ./catalogue.ts's own header on why that ceiling, not a second currency, is
 * what keeps this feature safe). A contract that paid outside it would be
 * exactly the shape of bug this file exists to avoid repeating.
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

import type { MachineProcessedItem } from "./machine-items";

export interface ContractDef {
  item: MachineProcessedItem;
  quantity: number;
  goldReward: number;
  influenceReward: number;
}

/**
 * The rungs a contract is drawn from.
 *
 * FLOUR is priced off seed: a Mill turns 3 Wheat (45 Gold of seed, at
 * WHEAT_SEED_COST) into 1 Flour, so a contract asking for a handful of Flour
 * has to clear what growing and milling it actually cost -- the same "never
 * pay less than a tier's net" sanity check ./items.ts's `netPerCycle` runs
 * for stock.
 *
 * CHEESE AND CLOTH are priced off something stricter, because their raw
 * materials are not seed but FORGONE HARVEST GOLD. Milk and wool have a price
 * on the Gold track (./items.ts); sending them to a Dairy or a Loom means the
 * harvest never paid for them. So each rung below pays 1.3x
 * `recipeRawGoldValue` -- a flat 30% premium for the round trip, pinned by a
 * test in ./recipes.test.ts. Anything at or under 1.0x would make the machine
 * a sink the player built with their own Gold, which is the shape of bug this
 * file's header exists to stop repeating.
 *
 * The premium is uniform on purpose. A ladder where one good paid better per
 * unit of raw material would turn the single open contract into an arbitrage
 * puzzle -- reroll until Cheese comes up -- and there is no reroll, so it
 * would just be a bad draw the player is stuck with.
 */
export const CONTRACT_RUNGS: readonly ContractDef[] = [
  { item: "flour", quantity: 2, goldReward: 140, influenceReward: 10 },
  { item: "flour", quantity: 4, goldReward: 300, influenceReward: 25 },
  { item: "flour", quantity: 8, goldReward: 640, influenceReward: 60 },
  { item: "cheese", quantity: 2, goldReward: 1_720, influenceReward: 60 },
  { item: "cheese", quantity: 4, goldReward: 3_430, influenceReward: 130 },
  { item: "cloth", quantity: 3, goldReward: 1_190, influenceReward: 40 },
  { item: "cloth", quantity: 6, goldReward: 2_370, influenceReward: 90 },
];

export interface StackAcresContractRow {
  id: string;
  item: MachineProcessedItem;
  quantity: number;
  goldReward: number;
  influenceReward: number;
  status: "open" | "fulfilled";
  createdAt: string;
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
