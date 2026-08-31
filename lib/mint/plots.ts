/**
 * Pure derivation from stored plot rows to what the treasury renders. Lives
 * in lib/ rather than beside the component for the usual reason: vitest only
 * reaches lib/ and app/, and the four-state derivation is exactly the logic
 * that wants tests (the Phaser layer is render-only and owns no rules).
 *
 * There is no clock here. Every function takes `now` explicitly; the client
 * calls this with its own clock for display, and the server's harvest guard
 * is the only authority on ripeness (a fast-forwarded phone clock renders a
 * gold tower it cannot cash).
 */

import {
  MINT_FREE_PLOTS,
  MINT_GRID_PLOTS,
  mintPlotPrice,
  type MintNodeType,
} from "./nodes";

/** One plot as a store row. See lib/server/mint-store.ts. */
export interface MintPlotRow {
  plotIndex: number;
  status: "empty" | "growing";
  nodeType: MintNodeType | null;
  stake: number | null;
  payout: number | null;
  plantedAt: string | null;
  maturesAt: string | null;
  version: number;
}

/**
 * What one tile renders as. `ripe` is `growing` whose timer has run out --
 * a client-side distinction only; the row itself stays `growing` until the
 * harvest write settles it.
 */
export type MintPlotState = "locked" | "empty" | "growing" | "ripe";

export interface MintPlotSnapshot {
  plotIndex: number;
  state: MintPlotState;
  nodeType: MintNodeType | null;
  stake: number | null;
  payout: number | null;
  plantedAt: string | null;
  maturesAt: string | null;
  /** 0..1 while growing; 1 once ripe; null otherwise. */
  growthPercent: number | null;
  /** What unlocking this locked plot costs. Null unless locked. */
  unlockPrice: number | null;
  /**
   * Plots unlock in order, so exactly one locked plot is buyable at a time
   * (the ladder prices assume it; skipping ahead would let a cheap tile go
   * unbought under a dearer one).
   */
  purchasable: boolean;
}

function growthPercent(plantedAt: string, maturesAt: string, now: Date): number {
  const planted = Date.parse(plantedAt);
  const matures = Date.parse(maturesAt);
  if (!Number.isFinite(planted) || !Number.isFinite(matures) || matures <= planted) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - planted) / (matures - planted)));
}

/** Whether a growing row's timer has run out, by the caller's clock. */
export function isMintPlotRipe(row: Pick<MintPlotRow, "status" | "maturesAt">, now: Date): boolean {
  if (row.status !== "growing" || !row.maturesAt) return false;
  const matures = Date.parse(row.maturesAt);
  return Number.isFinite(matures) && matures <= now.getTime();
}

/**
 * The full 16-tile view. Rows only exist for owned plots (and the free ones
 * only once first planted), so absence is meaningful: a missing row at a free
 * index is an empty plot, and a missing row above the free range is locked.
 */
export function toMintPlotSnapshots(rows: readonly MintPlotRow[], now: Date): MintPlotSnapshot[] {
  const byIndex = new Map(rows.map((row) => [row.plotIndex, row]));

  // The lowest locked index is the one buyable next; ownership is contiguous
  // because buyMintPlot only ever sells that plot.
  let nextPurchasable = 0;
  for (let index = MINT_FREE_PLOTS + 1; index <= MINT_GRID_PLOTS; index += 1) {
    if (!byIndex.has(index)) {
      nextPurchasable = index;
      break;
    }
  }

  const snapshots: MintPlotSnapshot[] = [];
  for (let index = 1; index <= MINT_GRID_PLOTS; index += 1) {
    const row = byIndex.get(index);
    if (!row) {
      const locked = index > MINT_FREE_PLOTS;
      snapshots.push({
        plotIndex: index,
        state: locked ? "locked" : "empty",
        nodeType: null,
        stake: null,
        payout: null,
        plantedAt: null,
        maturesAt: null,
        growthPercent: null,
        unlockPrice: locked ? mintPlotPrice(index) : null,
        purchasable: locked && index === nextPurchasable,
      });
      continue;
    }

    const growing = row.status === "growing" && row.plantedAt !== null && row.maturesAt !== null;
    const ripe = growing && isMintPlotRipe(row, now);
    snapshots.push({
      plotIndex: index,
      state: ripe ? "ripe" : growing ? "growing" : "empty",
      nodeType: growing ? row.nodeType : null,
      stake: growing ? row.stake : null,
      payout: growing ? row.payout : null,
      plantedAt: growing ? row.plantedAt : null,
      maturesAt: growing ? row.maturesAt : null,
      growthPercent: growing ? growthPercent(row.plantedAt as string, row.maturesAt as string, now) : null,
      unlockPrice: null,
      purchasable: false,
    });
  }
  return snapshots;
}
