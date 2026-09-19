/**
 * What the Workshop sheet (components/arcade/stackacres/WorkshopModal.tsx)
 * derives from the farm before it draws anything: whether the idle-worker
 * pass has anything to settle, and whether the signpost's entry deserves a
 * dot.
 *
 * Pure and clock-free, same posture as ./machines.ts:
 * every function takes `nowMs` rather than reading a clock, so the sheet's
 * own one-second tick and a vitest can feed it the same number. The server's
 * `ready_at` checks are the only authority; these only decide what to show
 * and when it is worth asking.
 */

import { isMachineDone, type MachineKind, type StackAcresMachineSnapshot } from "./machines";
import type { VatContainer } from "./aging";

/** The one machine of `kind` the player has placed, or null. The database's
 *  `homestead_machines_one_per_kind` index is what makes "the one" true. */
export function machineOfKind<T extends Pick<StackAcresMachineSnapshot, "kind">>(
  machines: readonly T[],
  kind: MachineKind,
): T | null {
  return machines.find((machine) => machine.kind === kind) ?? null;
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
 * Whether the idle-worker pass (`work`) would settle anything right now: a
 * finished run to collect. A startable Mill is deliberately NOT counted --
 * `work` would start it, but only a finished run changes the shelf on its
 * own, and that is the moment worth spending a request on. The sheet's own
 * Mill key covers starting one by hand.
 */
export function workDue(
  machines: readonly Pick<StackAcresMachineSnapshot, "status" | "readyAt">[],
  nowMs: number,
): boolean {
  return finishedMachineCount(machines, nowMs) > 0;
}

/**
 * Whether the signpost's Workshop entry should wear a dot: something in
 * there is waiting on the player. Presence, not a count, same convention
 * `contractPosted` and `blueprintInProgress` take.
 */
export function workshopAttention(input: {
  readonly machines: readonly Pick<StackAcresMachineSnapshot, "status" | "readyAt">[];
  readonly vat: Pick<VatContainer, "status"> | null;
  readonly nowMs: number;
}): boolean {
  if (workDue(input.machines, input.nowMs)) return true;
  return input.vat?.status === "collectible";
}
