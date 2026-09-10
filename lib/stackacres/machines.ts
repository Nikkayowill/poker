/**
 * Processing buildings: the Mill, the Dairy and the Loom.
 *
 * A machine is a PLACE A RECIPE CAN RUN, and nothing more. What it eats and
 * what it makes lives in ./recipes.ts, not here -- see that file's header for
 * why the recipe rather than the machine became the unit of configuration,
 * and for the instant-versus-queued split the two pacings sit on. A machine
 * contributes exactly three things: it costs Gold to place, it caps how much
 * processing can happen at once, and (for a queued recipe) its row is the
 * queue entry.
 *
 * It never touches Gold except at placement, which is a pure sink. Every
 * input and output is inventory (./inventory.ts). The only door from a
 * machine's output back to Gold is a fulfilled Contract (./contracts.ts).
 *
 * Same timer discipline as ./wheat-plot.ts and ./units.ts: `isMachineDone`/
 * `machineProgress` are pure functions of `now`, and the server's own
 * `ready_at` check inside the guarded settlement is the only authority --
 * see `startStackAcresMachine`/`collectStackAcresMachine` in
 * lib/server/stackacres-service.ts.
 */

import { canStartRecipe, recipesForMachine, type RecipeId } from "./recipes";
import type { StackAcresInventory } from "./inventory";

export const MACHINE_KINDS = ["mill", "dairy", "loom", "vat"] as const;
export type MachineKind = (typeof MACHINE_KINDS)[number];

export function isMachineKind(value: string): value is MachineKind {
  return (MACHINE_KINDS as readonly string[]).includes(value);
}

export interface MachineDef {
  label: string;
  /** Gold debited once, when the machine is placed. A sink, same category as
   *  `stackacresCapacityPrice` -- nothing here is ever sold back. */
  placeCost: number;
}

/**
 * Placement prices sit at roughly one batch of the raw material the machine
 * eats, so a machine pays for itself over a few runs rather than gating the
 * loop behind a grind. The Mill is the cheapest because wheat costs seed
 * rather than forgone harvest Gold; the Dairy is dearest because milk is the
 * most valuable thing on the farm to divert (see `recipeRawGoldValue`).
 */
export const MACHINE_CATALOGUE: Readonly<Record<MachineKind, MachineDef>> = {
  mill: { label: "Mill", placeCost: 200 },
  dairy: { label: "Dairy", placeCost: 700 },
  loom: { label: "Loom", placeCost: 350 },
  // Dearest of the four, and deliberately so: unlike the other three, the Vat
  // never touches Town Contracts at all -- it is a second, direct door back
  // to Gold (see lib/stackacres/aging.ts), and its placement price sits above
  // the Dairy for the same reason a Dairy sits above the Mill: it is the most
  // valuable thing on the floor to be locked out of using casually.
  vat: { label: "Fermenting Vat", placeCost: 1_200 },
};

/** Flat total, and deliberately equal to the number of kinds: with the
 *  database's own `homestead_machines_one_per_kind` unique index alongside it,
 *  the cap means "you may run the whole ladder, not two of anything". A
 *  second Dairy would double throughput without adding a decision. Kept in
 *  step by hand with `homestead_machines_enforce_cap`; see that trigger's own
 *  comment for why the duplication is accepted. Raised 3 -> 4 alongside the
 *  Vat (2026-09-06) for the same reason it was never raised for a fourth of
 *  an existing kind: it grew because the number of KINDS grew, not because
 *  any one kind needed more room. */
export const MACHINE_CAP = 4;

export type MachineStatus = "idle" | "working";

export interface StackAcresMachineRow {
  id: string;
  kind: MachineKind;
  status: MachineStatus;
  /** Set only while working; null while idle. */
  startedAt: string | null;
  readyAt: string | null;
  /**
   * The queue entry, set together with `startedAt`/`readyAt` and cleared
   * together with them. Snapshotted at start so a retune of RECIPE_CATALOGUE
   * cannot change what an already-running batch pays out -- the same rule
   * `StoredStackAcresUnit.yieldQuantity` follows for a stocked animal.
   */
  recipeId: RecipeId | null;
  /** How many units of the recipe's output this run will yield. Zero while
   *  idle. Snapshotted for the same reason as `recipeId`. */
  unitsProcessing: number;
  version: number;
}

/** Whether any recipe this machine kind runs could start right now. Does not
 *  check any machine's status -- callers only start an idle one, and this is
 *  also how the sidebar shows "waiting on Milk" for a Dairy that is idle for
 *  some other reason. `canStartRecipe` itself lives in ./recipes.ts, next to
 *  the catalogue it reads. */
export function canStartMachine(inventory: StackAcresInventory, kind: MachineKind): boolean {
  return recipesForMachine(kind).some((recipe) => canStartRecipe(inventory, recipe));
}

export function isMachineDone(
  row: Pick<StackAcresMachineRow, "status" | "readyAt">,
  now: Date,
): boolean {
  if (row.status !== "working" || !row.readyAt) return false;
  const ready = Date.parse(row.readyAt);
  return Number.isFinite(ready) && ready <= now.getTime();
}

/**
 * Whether a finished batch pays double, per the Synergy Tree's
 * `high_yield_processing` perk (see lib/stackacres/synergy-perks.ts, whose
 * own header named this exact function as the seam it was written for).
 *
 * Takes its own random source rather than reaching for `Math.random`, same
 * posture as equipment.ts's `rollHarvestCrit` and for the identical reason:
 * the ONE call site is inside `workStackAcres`, right after
 * `collectStackAcresMachine`'s guarded write has already landed, so the roll
 * can neither be re-rolled by a refetch nor read before the write it doubles
 * belongs to. `chance` is 0 for a player with no active perk, so this is a
 * no-op call rather than a branch the caller has to special-case.
 */
export function rollMillDoubleOutput(chance: number, random: () => number): boolean {
  return random() < chance;
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
  recipeId: RecipeId | null;
  unitsProcessing: number;
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
    recipeId: row.recipeId,
    unitsProcessing: row.unitsProcessing,
    done: isMachineDone(row, now),
    progress: machineProgress(row, now),
  };
}
