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
 */

import type { MachineProcessedItem } from "./machine-items";

export interface ContractDef {
  item: MachineProcessedItem;
  quantity: number;
  goldReward: number;
  influenceReward: number;
}

/**
 * The rungs a contract is drawn from. Priced so a Mill's own economics stay
 * honest: a Mill turns 3 Wheat (45 Gold of seed, at WHEAT_SEED_COST) into 1
 * Flour every 20 seconds, so a contract asking for a handful of Flour has to
 * clear what growing and milling it actually cost, the same "never pay less
 * than a tier's net" sanity check ./items.ts's `netPerCycle` runs for stock.
 */
const CONTRACT_RUNGS: readonly ContractDef[] = [
  { item: "flour", quantity: 2, goldReward: 140, influenceReward: 10 },
  { item: "flour", quantity: 4, goldReward: 300, influenceReward: 25 },
  { item: "flour", quantity: 8, goldReward: 640, influenceReward: 60 },
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

/** Draws one rung at random. Pure -- the server calls this with `Math.random`
 *  and stamps the result onto a row exactly once, the same "rolled once,
 *  never re-derived on read" rule ./catalogue.ts's muck chance follows. */
export function drawContract(random: Random = Math.random): ContractDef {
  return CONTRACT_RUNGS[Math.floor(random() * CONTRACT_RUNGS.length)];
}

export function canFulfillContract(
  held: number,
  contract: Pick<StackAcresContractRow, "quantity" | "status">,
): boolean {
  return contract.status === "open" && held >= contract.quantity;
}
