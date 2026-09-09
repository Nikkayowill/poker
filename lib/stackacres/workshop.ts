/**
 * What the Workshop sheet (components/arcade/stackacres/WorkshopModal.tsx)
 * derives from the farm before it draws anything: which animals could be
 * sent to the shelf, whether the idle-worker pass has anything to settle,
 * and whether the signpost's entry deserves a dot.
 *
 * Pure and clock-free, same posture as ./machines.ts and ./wheat-plot.ts:
 * every function takes `nowMs` rather than reading a clock, so the sheet's
 * own one-second tick and a vitest can feed it the same number. The server's
 * `ready_at` checks are the only authority; these only decide what to show
 * and when it is worth asking.
 */

import type { StackAcresStock } from "./catalogue";
import { STACKACRES_YIELDS } from "./items";
import { isMachineRawItem, type MachineRawItem } from "./machine-items";
import { isMachineDone, type MachineKind, type StackAcresMachineSnapshot } from "./machines";
import type { StackAcresUnitSnapshot } from "./units";
import { isWheatPlotReady, type StackAcresWheatPlotSnapshot } from "./wheat-plot";
import type { VatContainer } from "./aging";

/** One ready animal whose produce a machine takes, as the sheet lists it. */
export interface DivertableUnit {
  readonly unitId: string;
  readonly stock: StackAcresStock;
  readonly item: MachineRawItem;
  readonly quantity: number;
}

/**
 * Ready units whose yield is a machine input (milk, fleece). Hens lay eggs,
 * which no machine takes, so they never appear here; nor does any crop.
 * `yieldQuantity` is the snapshot the server took at stocking, which is
 * exactly what `divertStackAcresUnit` credits.
 */
export function divertableUnits(units: readonly StackAcresUnitSnapshot[]): DivertableUnit[] {
  const out: DivertableUnit[] = [];
  for (const unit of units) {
    if (unit.state !== "ready") continue;
    const produce = STACKACRES_YIELDS[unit.stock];
    if (!isMachineRawItem(produce.item)) continue;
    out.push({ unitId: unit.id, stock: unit.stock, item: produce.item, quantity: unit.yieldQuantity });
  }
  return out;
}

/** The one machine of `kind` the player has placed, or null. The database's
 *  `homestead_machines_one_per_kind` index is what makes "the one" true. */
export function machineOfKind<T extends Pick<StackAcresMachineSnapshot, "kind">>(
  machines: readonly T[],
  kind: MachineKind,
): T | null {
  return machines.find((machine) => machine.kind === kind) ?? null;
}

/** How many wheat plots have ripened by this clock. */
export function ripeWheatCount(plots: readonly StackAcresWheatPlotSnapshot[], nowMs: number): number {
  const now = new Date(nowMs);
  return plots.filter((plot) => isWheatPlotReady(plot, now)).length;
}

/** How many machine runs have finished by this clock. */
export function finishedMachineCount(
  machines: readonly Pick<StackAcresMachineSnapshot, "status" | "readyAt">[],
  nowMs: number,
): number {
  const now = new Date(nowMs);
  return machines.filter((machine) => isMachineDone(machine, now)).length;
}

/**
 * Whether the idle-worker pass (`work`) would settle anything right now:
 * a ripe plot to bring in, or a finished run to collect. A startable Mill
 * is deliberately NOT counted -- `work` would start it, but only after a
 * plot ripens or a run finishes does the shelf change on its own, and those
 * are the moments worth spending a request on. The sheet's own Mill key
 * covers starting one by hand.
 */
export function workDue(
  plots: readonly StackAcresWheatPlotSnapshot[],
  machines: readonly Pick<StackAcresMachineSnapshot, "status" | "readyAt">[],
  nowMs: number,
): boolean {
  return ripeWheatCount(plots, nowMs) > 0 || finishedMachineCount(machines, nowMs) > 0;
}

/**
 * Whether the signpost's Workshop entry should wear a dot: something in
 * there is waiting on the player. Presence, not a count, same convention
 * `contractPosted` and `blueprintInProgress` take.
 */
export function workshopAttention(input: {
  readonly plots: readonly StackAcresWheatPlotSnapshot[];
  readonly machines: readonly Pick<StackAcresMachineSnapshot, "status" | "readyAt">[];
  readonly vat: Pick<VatContainer, "status"> | null;
  readonly nowMs: number;
}): boolean {
  if (workDue(input.plots, input.machines, input.nowMs)) return true;
  return input.vat?.status === "collectible";
}
