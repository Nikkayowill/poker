/**
 * Pure derivation from stored unit rows to what StackAcres renders. Lives in
 * lib/ rather than beside the component for the usual reason: vitest only
 * reaches lib/ and app/, and the state derivation is exactly the logic that
 * wants tests (the sidebar and scene are render-only and own no rules).
 *
 * There is no clock here. Every function takes `now` explicitly; the client
 * calls this with its own clock for display, and the server's collect guard
 * is the only authority on readiness (a fast-forwarded phone clock renders a
 * gold rim it cannot cash).
 *
 * The one piece of state that is NOT derived is muck. Every other state here
 * falls out of timestamps, which is why StackAcres needs no background jobs;
 * a 20% dice roll cannot work that way, because it would land differently on
 * every refetch and let a player reroll it by pulling to refresh. It is
 * rolled once by the server inside the guarded settlement write and stored on
 * the row.
 *
 * Successor to ./plots.ts: a unit has no plot underneath it, so there is no
 * `locked`/`empty`/`purchasable`/`unlockPrice` here at all -- a unit only
 * exists once bought, and buying one is a straight `stock`/`buy-stock`
 * request, not "unlock a tile, then plant it".
 */

import { STACKACRES_CATALOGUE, isLivestock, type StackAcresStock } from "./catalogue";

/** One owned unit as a store row. See lib/server/stackacres-store.ts. */
export interface StackAcresUnitRow {
  id: string;
  status: "working" | "mucked";
  stock: StackAcresStock;
  /** Seed cost in Bushels, snapshotted at stocking. */
  stake: number;
  /** Units of produce this will yield, snapshotted at stocking. */
  yieldQuantity: number;
  startedAt: string;
  /** Excludes time spent hungry: feeding pushes this forward. */
  readyAt: string;
  /** Livestock only. Null for crops, which do not eat. */
  lastFedAt: string | null;
  /** What clearing this unit costs while it is mucked. Null unless mucked. */
  muckFee: number | null;
  /**
   * True when this unit was bought outright with Gold. A permanent unit
   * restarts its own cycle at collection instead of being removed, and never
   * mucks -- see `collectStackAcres` in stackacres-service.ts. False for
   * anything sown with Bushels, which is consumed by its own harvest exactly
   * as before.
   */
  permanent: boolean;
  version: number;
}

/**
 * What one unit renders as.
 *
 * `ready` is `working` whose timer has run out, and `hungry` is `working`
 * past its feed window. Both are client-side distinctions: the row itself
 * stays `working` until a write settles it, so neither can be faked by a
 * phone clock into paying anything.
 */
export type StackAcresUnitState = "working" | "hungry" | "ready" | "mucked";

export interface StackAcresUnitSnapshot {
  id: string;
  state: StackAcresUnitState;
  stock: StackAcresStock;
  /** Seed cost in Bushels. */
  stake: number;
  /** Units of produce this will yield. */
  yieldQuantity: number;
  startedAt: string;
  readyAt: string;
  /** 0..1 while working; 1 once ready; null while mucked. */
  progress: number | null;
  /** When this animal next needs feeding. Null for crops. */
  hungryAt: string | null;
  /** What clearing this unit costs. Null unless mucked. */
  muckFee: number | null;
  /** True when this unit was bought outright and re-sows itself. */
  permanent: boolean;
}

function progressOf(startedAt: string, readyAt: string, now: Date): number {
  const started = Date.parse(startedAt);
  const ready = Date.parse(readyAt);
  if (!Number.isFinite(started) || !Number.isFinite(ready) || ready <= started) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - started) / (ready - started)));
}

/** When this row's animal goes hungry, or null if it never does. */
export function hungryAtFor(row: Pick<StackAcresUnitRow, "stock" | "lastFedAt">): string | null {
  const def = STACKACRES_CATALOGUE[row.stock];
  if (def.hungerMs === null || !row.lastFedAt) return null;
  const fed = Date.parse(row.lastFedAt);
  if (!Number.isFinite(fed)) return null;
  return new Date(fed + def.hungerMs).toISOString();
}

/**
 * Whether a working row is past its feed window. A hungry unit's clock is
 * frozen -- readyAt is only pushed forward when it is actually fed -- so this
 * has to be checked before readiness, or a starving animal would quietly
 * finish its cycle anyway.
 */
export function isStackAcresUnitHungry(
  row: Pick<StackAcresUnitRow, "status" | "stock" | "lastFedAt">,
  now: Date,
): boolean {
  if (row.status !== "working" || !isLivestock(row.stock)) return false;
  const hungryAt = hungryAtFor(row);
  if (!hungryAt) return false;
  return Date.parse(hungryAt) <= now.getTime();
}

/** Whether a working row's timer has run out, by the caller's clock. */
export function isStackAcresUnitReady(
  row: Pick<StackAcresUnitRow, "status" | "stock" | "readyAt" | "lastFedAt">,
  now: Date,
): boolean {
  if (row.status !== "working") return false;
  // A hungry unit is frozen: it cannot become ready while it is waiting to be
  // fed, however long its own timestamp says it has been working.
  if (isStackAcresUnitHungry(row, now)) return false;
  const ready = Date.parse(row.readyAt);
  return Number.isFinite(ready) && ready <= now.getTime();
}

/** Every owned unit, as the client renders it. */
export function toStackAcresUnitSnapshots(
  rows: readonly StackAcresUnitRow[],
  now: Date,
): StackAcresUnitSnapshot[] {
  return rows.map((row) => {
    if (row.status === "mucked") {
      return {
        id: row.id,
        state: "mucked",
        stock: row.stock,
        stake: row.stake,
        yieldQuantity: row.yieldQuantity,
        startedAt: row.startedAt,
        readyAt: row.readyAt,
        progress: null,
        hungryAt: null,
        muckFee: row.muckFee,
        permanent: row.permanent,
      };
    }

    const hungry = isStackAcresUnitHungry(row, now);
    const ready = isStackAcresUnitReady(row, now);
    return {
      id: row.id,
      state: ready ? "ready" : hungry ? "hungry" : "working",
      stock: row.stock,
      stake: row.stake,
      yieldQuantity: row.yieldQuantity,
      startedAt: row.startedAt,
      readyAt: row.readyAt,
      progress: progressOf(row.startedAt, row.readyAt, now),
      hungryAt: hungryAtFor(row),
      muckFee: null,
      permanent: row.permanent,
    };
  });
}
