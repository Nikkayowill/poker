/**
 * What the farmhand should be doing, and why -- the priority call, kept
 * entirely separate from the state machine that carries it out
 * (./farmhand-machine.ts).
 *
 * ONE OPEN CONTRACT IS THE WHOLE DEMAND SIGNAL. ./contracts.ts allows exactly
 * one open contract per player and the database holds that with a partial
 * unique index, so "what does the town want" is a single row, not a board to
 * search. That is what makes this file arithmetic rather than a planner: the
 * chain from a ripe plot to a paid contract is fixed (wheat -> Mill -> flour
 * -> contract), so the only real question is HOW MUCH WHEAT is still missing,
 * and everything else falls out of it.
 *
 * PURE, AND DECIDES NOTHING ABOUT MONEY. Nothing here spends, credits, or
 * settles; it reads snapshots the server already sent and names a job. The
 * server remains the only authority on whether a plot was actually ripe when
 * it was cut -- see `workStackAcres`, whose own `ready_at` check inside the
 * guarded write is what a fast-forwarded phone clock cannot get past. A plan
 * built on a wrong local clock costs a wasted walk and nothing else, which is
 * the property that lets this run on the client at all.
 */

import type { StackAcresContractRow } from "./contracts";
import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import { MACHINE_CATALOGUE, type StackAcresMachineSnapshot } from "./machines";
import type { MachineItemId } from "./machine-items";
import { tileOf, type TileCoord } from "./farmhand-path";
import type { StackAcresWheatPlotSnapshot } from "./wheat-plot";
import { WHEAT_YIELD_QUANTITY } from "./wheat-plot";
import { wheatPlotSpot, type WorldPoint } from "./world";

/* ------------------------------------------------------------------ */
/* What the town is still short of                                     */
/* ------------------------------------------------------------------ */

/**
 * How much raw wheat still has to be cut for the open contract to be
 * fulfillable, counting everything already in hand or in the mill.
 *
 * Zero has two quite different meanings and the caller must not care which:
 * there is no open contract, or there is one and nothing more needs growing
 * for it. Both mean "cutting more wheat does not advance the contract", which
 * is the only question this answers.
 *
 * Deliberately counts a WORKING machine's batch as already spent. Its input
 * left the inventory when it started (rule 1 in
 * lib/server/stackacres-service.ts: the input leaves inventory first), so the
 * flour it is about to make is real, and a plan that ignored it would send
 * him to cut a second batch of wheat for flour that is twenty seconds away.
 */
export function wheatStillNeeded(
  contract: StackAcresContractRow | null,
  inventory: StackAcresInventory,
  machines: readonly Pick<StackAcresMachineSnapshot, "kind" | "status">[],
): number {
  if (!contract || contract.status !== "open") return 0;

  const held = inventoryQuantity(inventory, contract.item);
  // Flour already coming off a running mill, counted as good as held.
  const inFlight = machines.reduce((total, machine) => {
    if (machine.status !== "working") return total;
    const def = MACHINE_CATALOGUE[machine.kind];
    return def.output.item === contract.item ? total + def.output.quantity : total;
  }, 0);

  const short = contract.quantity - held - inFlight;
  if (short <= 0) return 0;

  // Which machine turns raw wheat into this contract's item. Only the Mill
  // does today; looked up rather than assumed so a second machine kind does
  // not silently keep planning against the Mill's own ratio.
  const line = machineFor(contract.item);
  if (!line) return 0;

  // Batches are indivisible: two thirds of a mill run makes no flour at all,
  // so a shortfall of one flour still costs a whole batch of wheat.
  const batches = Math.ceil(short / line.output.quantity);
  const rawWanted = batches * line.input.quantity;
  const rawHeld = inventoryQuantity(inventory, line.input.item);
  return Math.max(0, rawWanted - rawHeld);
}

/** The machine that produces `item`, or null when nothing here makes it. */
function machineFor(item: MachineItemId) {
  for (const kind of Object.keys(MACHINE_CATALOGUE) as (keyof typeof MACHINE_CATALOGUE)[]) {
    const def = MACHINE_CATALOGUE[kind];
    if (def.output.item === item) return def;
  }
  return null;
}

/** How many ripe plots it would take to cover `wheatStillNeeded`. Rounded UP
 *  and floored at one whenever anything at all is short, so a shortfall
 *  smaller than a single plot's yield still counts as one plot's worth of
 *  work rather than none. */
export function plotsWorthCutting(needed: number): number {
  if (needed <= 0) return 0;
  return Math.max(1, Math.ceil(needed / WHEAT_YIELD_QUANTITY));
}

/* ------------------------------------------------------------------ */
/* The job                                                             */
/* ------------------------------------------------------------------ */

/**
 * One thing to walk to and do. A TILE, not a screen point and not even a
 * world point on its own -- see ./farmhand-path.ts's header for why the tile
 * grid is the targeting space. `at` rides alongside as the exact spot within
 * that tile, because a plot's own hashed position is finer than a 16-unit
 * cell and snapping him to the tile centre would stand him a few units off
 * the crop he is supposed to be cutting.
 */
export type FarmhandJob =
  | { kind: "harvest"; plotId: string; tile: TileCoord; at: WorldPoint }
  | { kind: "deliver"; contractId: string; tile: TileCoord; at: WorldPoint };

/**
 * Where fulfilled goods are handed over: beside the crates on the road's
 * north rim, between the hay and the well.
 *
 * Hand-placed against ./props.ts's own list, and BESIDE the crates rather
 * than between them -- the pair sits at (200, 26) and (211, 24), and standing
 * on top of either would hide it behind a forty-unit man, the same mistake
 * `FARMHAND_STANDOFF` exists to have already learned once. He stands east of
 * both, on the verge where a cart would pull up.
 *
 * The constraints a future move has to keep: clear of `BARN_FOOTPRINT`
 * (x 71..145), east of the silo (143..165) and the hay (166..188), OFF the
 * road (its polyline runs along y 46 at 20 wide, so its body plus
 * `PATH_CLEARANCE` reaches y 30 -- standing in the road is what the first cut
 * of this did), west of the well at (238, 30), and inside `FARM_ZONE`.
 * farmhand-plan.test.ts holds them.
 *
 * NOT the mailbox at (36, 404), which is the other honest reading of "goods
 * go to town": it is 265 units from his post, thirteen seconds of walking
 * each way at `FARMHAND_SPEED`, for an errand the player is watching.
 */
export const CONTRACT_DROP: WorldPoint = { x: 220, y: 26 };

export interface FarmhandPlanInput {
  contract: StackAcresContractRow | null;
  inventory: StackAcresInventory;
  machines: readonly Pick<StackAcresMachineSnapshot, "kind" | "status">[];
  wheatPlots: readonly StackAcresWheatPlotSnapshot[];
  /** Plots already cut this session whose refetch has not landed yet. See
   *  `FarmhandStateMachine`'s own optimistic set -- a plot the server still
   *  reports as ripe must not be planned twice while its `work` call is in
   *  the air. */
  claimed?: ReadonlySet<string>;
}

/**
 * The next job, or null for "stand at your post".
 *
 * THE ORDER IS THE DESIGN:
 *
 *   1. Deliver, when the contract can actually be fulfilled. A fulfillable
 *      contract is Gold sitting on the table under the daily ceiling, and
 *      every minute it sits there is a minute of that ceiling unspent.
 *   2. Cut a plot the contract is waiting on. This is the "actively needed"
 *      rule: with a contract open and short, ripe wheat is the bottleneck.
 *   3. Cut any ripe plot. A ripe plot blocks its own ground -- `WHEAT_PLOT_CAP`
 *      is 3 and the row survives until it is collected -- so leaving one
 *      standing because no contract wants it costs a third of the field. This
 *      rung is what makes him useful before the player has ever requested a
 *      contract.
 *
 * Ties inside a rung go to the plot that ripened FIRST, not the nearest one.
 * Nearest looks smarter and is worse: it starves a far plot for as long as
 * anything closer keeps ripening, and the field is small enough that the walk
 * saved is under a second.
 */
export function planFarmhandWork(input: FarmhandPlanInput): FarmhandJob | null {
  const { contract, inventory, wheatPlots, claimed } = input;

  // 1. A contract that can be paid now.
  if (contract && contract.status === "open") {
    if (inventoryQuantity(inventory, contract.item) >= contract.quantity) {
      return {
        kind: "deliver",
        contractId: contract.id,
        tile: tileOf(CONTRACT_DROP),
        at: CONTRACT_DROP,
      };
    }
  }

  const ripe = wheatPlots
    .filter((plot) => plot.ready && !claimed?.has(plot.id))
    // `readyAt` is an ISO string the server stamped; a plot with an
    // unparseable one sorts last rather than poisoning the comparison.
    .sort((a, b) => readyMs(a) - readyMs(b));
  if (ripe.length === 0) return null;

  // 2 and 3 pick the same plot -- the oldest ripe one -- so they collapse
  // into one branch here. `contractWantsWheat` is how a caller asks WHICH of
  // the two rungs this is, for a HUD line; nothing downstream treats them
  // differently yet. The day a second crop feeds a second contract line,
  // "which plot" stops being "the oldest one" and this splits back apart.
  const plot = ripe[0];
  const at = wheatPlotSpot(plot.id);
  return { kind: "harvest", plotId: plot.id, tile: tileOf(at), at };
}

function readyMs(plot: StackAcresWheatPlotSnapshot): number {
  const ms = Date.parse(plot.readyAt);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** Whether cutting more wheat right now advances the open contract. Exported
 *  for the HUD's own "the farmhand is working the contract" line, and for
 *  tests -- `planFarmhandWork` deliberately does not gate on it (rung 3). */
export function contractWantsWheat(input: FarmhandPlanInput): boolean {
  return wheatStillNeeded(input.contract, input.inventory, input.machines) > 0;
}
