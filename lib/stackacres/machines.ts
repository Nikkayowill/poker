/**
 * Processing buildings: a Mill and, in shape only for now, the rest of the
 * ladder it will grow into.
 *
 * A machine eats a fixed batch of a raw item, runs a delta-time-safe
 * countdown, and produces a fixed batch of a processed item -- see
 * `MachineDef`. It never touches Gold directly; every input and output here
 * is inventory (./inventory.ts). The only door from a machine's output back
 * to Gold is a fulfilled Contract (./contracts.ts).
 *
 * Same timer discipline as ./wheat-plot.ts and ./units.ts: `isMachineDone`/
 * `machineProgress` are pure functions of `now`, and the server's own
 * `ready_at` check inside the guarded settlement is the only authority --
 * see `startStackAcresMachine`/`collectStackAcresMachine` in
 * lib/server/stackacres-service.ts.
 */

import type { MachineProcessedItem, MachineRawItem } from "./machine-items";
import { hasEnough, type StackAcresInventory } from "./inventory";

export const MACHINE_KINDS = ["mill"] as const;
export type MachineKind = (typeof MACHINE_KINDS)[number];

export function isMachineKind(value: string): value is MachineKind {
  return (MACHINE_KINDS as readonly string[]).includes(value);
}

export interface MachineDef {
  label: string;
  /** Gold debited once, when the machine is placed. A sink, same category as
   *  `stackacresCapacityPrice` -- nothing here is ever sold back. */
  placeCost: number;
  input: { item: MachineRawItem; quantity: number };
  output: { item: MachineProcessedItem; quantity: number };
  /** How long one batch takes to process, once started. */
  processingMs: number;
}

export const MACHINE_CATALOGUE: Readonly<Record<MachineKind, MachineDef>> = {
  mill: {
    label: "Mill",
    placeCost: 200,
    input: { item: "wheat", quantity: 3 },
    output: { item: "flour", quantity: 1 },
    processingMs: 20 * 1000,
  },
};

/** Flat, same reasoning as `WHEAT_PLOT_CAP` -- one Mill is the whole loop
 *  today; a second machine kind gets its own cap when it exists rather than
 *  sharing this one. */
export const MACHINE_CAP = 2;

export type MachineStatus = "idle" | "working";

export interface StackAcresMachineRow {
  id: string;
  kind: MachineKind;
  status: MachineStatus;
  /** Set only while working; null while idle. */
  startedAt: string | null;
  readyAt: string | null;
  version: number;
}

/** Whether the inventory holds enough of this machine kind's input to start
 *  a run.
 *  Does not check the machine's own status -- callers only start an idle
 *  one, and this is also how the sidebar shows "waiting on Wheat" for a Mill
 *  that already has enough sitting idle for another reason. */
export function canStartMachine(inventory: StackAcresInventory, kind: MachineKind): boolean {
  const def = MACHINE_CATALOGUE[kind];
  return hasEnough(inventory, def.input.item, def.input.quantity);
}

export function isMachineDone(
  row: Pick<StackAcresMachineRow, "status" | "readyAt">,
  now: Date,
): boolean {
  if (row.status !== "working" || !row.readyAt) return false;
  const ready = Date.parse(row.readyAt);
  return Number.isFinite(ready) && ready <= now.getTime();
}

/** 0..1 while working; null while idle -- there is no run in progress to
 *  show a bar for. */
export function machineProgress(
  row: Pick<StackAcresMachineRow, "status" | "startedAt" | "readyAt">,
  now: Date,
): number | null {
  if (row.status !== "working" || !row.startedAt || !row.readyAt) return null;
  const started = Date.parse(row.startedAt);
  const ready = Date.parse(row.readyAt);
  if (!Number.isFinite(started) || !Number.isFinite(ready) || ready <= started) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - started) / (ready - started)));
}

/** What one machine renders as. Pure derivation, same posture as
 *  ./wheat-plot.ts's own snapshot -- `canStart` is deliberately not here,
 *  since it needs the player's inventory, which is a second row this
 *  function is not handed; the caller (lib/server/stackacres-service.ts)
 *  merges `canStartMachine(inventory, kind)` in alongside this. */
export interface StackAcresMachineSnapshot {
  id: string;
  kind: MachineKind;
  status: MachineStatus;
  startedAt: string | null;
  readyAt: string | null;
  done: boolean;
  progress: number | null;
}

export function toMachineSnapshot(row: StackAcresMachineRow, now: Date): StackAcresMachineSnapshot {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    startedAt: row.startedAt,
    readyAt: row.readyAt,
    done: isMachineDone(row, now),
    progress: machineProgress(row, now),
  };
}
