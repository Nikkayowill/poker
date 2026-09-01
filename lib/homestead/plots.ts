/**
 * Pure derivation from stored plot rows to what the Homestead renders. Lives
 * in lib/ rather than beside the component for the usual reason: vitest only
 * reaches lib/ and app/, and the state derivation is exactly the logic that
 * wants tests (the Phaser layer is render-only and owns no rules).
 *
 * There is no clock here. Every function takes `now` explicitly; the client
 * calls this with its own clock for display, and the server's collect guard is
 * the only authority on readiness (a fast-forwarded phone clock renders a gold
 * rim it cannot cash).
 *
 * The one piece of state that is NOT derived is muck. Every other state here
 * falls out of timestamps, which is why the Homestead needs no background
 * jobs; a 20% dice roll cannot work that way, because it would land
 * differently on every refetch and let a player reroll it by pulling to
 * refresh. It is rolled once by the server inside the guarded settlement write
 * and stored on the row.
 */

import {
  HOMESTEAD_CATALOGUE,
  HOMESTEAD_FREE_PLOTS,
  HOMESTEAD_GRID_PLOTS,
  homesteadPlotPrice,
  isLivestock,
  type HomesteadStock,
} from "./catalogue";

/** One plot as a store row. See lib/server/homestead-store.ts. */
export interface HomesteadPlotRow {
  plotIndex: number;
  status: "empty" | "working" | "mucked";
  stock: HomesteadStock | null;
  stake: number | null;
  payout: number | null;
  startedAt: string | null;
  /** Excludes time spent hungry: feeding pushes this forward. */
  readyAt: string | null;
  /** Livestock only. Null for crops, which do not eat. */
  lastFedAt: string | null;
  /** What clearing this plot costs while it is mucked. */
  muckFee: number | null;
  version: number;
}

/**
 * What one tile renders as.
 *
 * `ready` is `working` whose timer has run out, and `hungry` is `working` past
 * its feed window. Both are client-side distinctions: the row itself stays
 * `working` until a write settles it, so neither can be faked by a phone
 * clock into paying anything.
 */
export type HomesteadPlotState =
  | "locked"
  | "empty"
  | "working"
  | "hungry"
  | "ready"
  | "mucked";

export interface HomesteadPlotSnapshot {
  plotIndex: number;
  state: HomesteadPlotState;
  stock: HomesteadStock | null;
  stake: number | null;
  payout: number | null;
  startedAt: string | null;
  readyAt: string | null;
  /** 0..1 while working; 1 once ready; null otherwise. */
  progress: number | null;
  /** When this animal next needs feeding. Null for crops and idle plots. */
  hungryAt: string | null;
  /** What clearing this plot costs. Null unless mucked. */
  muckFee: number | null;
  /** What unlocking this locked plot costs. Null unless locked. */
  unlockPrice: number | null;
  /**
   * Plots unlock in order, so exactly one locked plot is buyable at a time
   * (the ladder prices assume it; skipping ahead would let a cheap tile go
   * unbought under a dearer one).
   */
  purchasable: boolean;
}

function progressOf(startedAt: string, readyAt: string, now: Date): number {
  const started = Date.parse(startedAt);
  const ready = Date.parse(readyAt);
  if (!Number.isFinite(started) || !Number.isFinite(ready) || ready <= started) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - started) / (ready - started)));
}

/** When this row's animal goes hungry, or null if it never does. */
export function hungryAtFor(row: Pick<HomesteadPlotRow, "stock" | "lastFedAt">): string | null {
  if (!row.stock || !row.lastFedAt) return null;
  const def = HOMESTEAD_CATALOGUE[row.stock];
  if (def.hungerMs === null) return null;
  const fed = Date.parse(row.lastFedAt);
  if (!Number.isFinite(fed)) return null;
  return new Date(fed + def.hungerMs).toISOString();
}

/**
 * Whether a working row is past its feed window. A hungry plot's clock is
 * frozen -- readAt is only pushed forward when it is actually fed -- so this
 * has to be checked before readiness, or a starving animal would quietly
 * finish its cycle anyway.
 */
export function isHomesteadPlotHungry(
  row: Pick<HomesteadPlotRow, "status" | "stock" | "lastFedAt">,
  now: Date,
): boolean {
  if (row.status !== "working" || !row.stock || !isLivestock(row.stock)) return false;
  const hungryAt = hungryAtFor(row);
  if (!hungryAt) return false;
  return Date.parse(hungryAt) <= now.getTime();
}

/** Whether a working row's timer has run out, by the caller's clock. */
export function isHomesteadPlotReady(
  row: Pick<HomesteadPlotRow, "status" | "stock" | "readyAt" | "lastFedAt">,
  now: Date,
): boolean {
  if (row.status !== "working" || !row.readyAt) return false;
  // A hungry plot is frozen: it cannot become ready while it is waiting to be
  // fed, however long its own timestamp says it has been working.
  if (isHomesteadPlotHungry({ ...row, status: "working" }, now)) return false;
  const ready = Date.parse(row.readyAt);
  return Number.isFinite(ready) && ready <= now.getTime();
}

/**
 * The full 16-tile view. Rows only exist for owned plots (and the free ones
 * only once first used), so absence is meaningful: a missing row at a free
 * index is an empty plot, and a missing row above the free range is locked.
 */
export function toHomesteadPlotSnapshots(
  rows: readonly HomesteadPlotRow[],
  now: Date,
): HomesteadPlotSnapshot[] {
  const byIndex = new Map(rows.map((row) => [row.plotIndex, row]));

  // The lowest locked index is the one buyable next; ownership is contiguous
  // because buyHomesteadPlot only ever sells that plot.
  let nextPurchasable = 0;
  for (let index = HOMESTEAD_FREE_PLOTS + 1; index <= HOMESTEAD_GRID_PLOTS; index += 1) {
    if (!byIndex.has(index)) {
      nextPurchasable = index;
      break;
    }
  }

  const idle = (index: number): HomesteadPlotSnapshot => {
    const locked = index > HOMESTEAD_FREE_PLOTS;
    return {
      plotIndex: index,
      state: locked ? "locked" : "empty",
      stock: null,
      stake: null,
      payout: null,
      startedAt: null,
      readyAt: null,
      progress: null,
      hungryAt: null,
      muckFee: null,
      unlockPrice: locked ? homesteadPlotPrice(index) : null,
      purchasable: locked && index === nextPurchasable,
    };
  };

  const snapshots: HomesteadPlotSnapshot[] = [];
  for (let index = 1; index <= HOMESTEAD_GRID_PLOTS; index += 1) {
    const row = byIndex.get(index);
    if (!row) {
      snapshots.push(idle(index));
      continue;
    }

    if (row.status === "mucked") {
      snapshots.push({
        ...idle(index),
        state: "mucked",
        unlockPrice: null,
        purchasable: false,
        muckFee: row.muckFee,
      });
      continue;
    }

    const working =
      row.status === "working" && row.stock !== null && row.startedAt !== null && row.readyAt !== null;
    if (!working) {
      snapshots.push({ ...idle(index), state: "empty", unlockPrice: null, purchasable: false });
      continue;
    }

    const hungry = isHomesteadPlotHungry(row, now);
    const ready = isHomesteadPlotReady(row, now);
    snapshots.push({
      plotIndex: index,
      state: ready ? "ready" : hungry ? "hungry" : "working",
      stock: row.stock,
      stake: row.stake,
      payout: row.payout,
      startedAt: row.startedAt,
      readyAt: row.readyAt,
      progress: progressOf(row.startedAt as string, row.readyAt as string, now),
      hungryAt: hungryAtFor(row),
      muckFee: null,
      unlockPrice: null,
      purchasable: false,
    });
  }
  return snapshots;
}
