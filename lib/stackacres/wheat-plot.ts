/**
 * Wheat: the one raw crop grown for a Mill rather than for Gold.
 *
 * A DELIBERATELY SEPARATE ROW FROM `StackAcresUnitRow` (./units.ts), not an
 * extension of it. `harvestStackAcres` sweeps every ready `homestead_units`
 * row into a single Gold payout with no per-row opt-out -- see
 * ./machine-items.ts's header. A wheat plot must never be reachable from
 * that sweep, so it lives in its own table (`homestead_wheat_plots`) with its
 * own ready/collect pair that credits inventory, never Gold.
 *
 * Otherwise this is the plainest possible timer: no hunger, no thirst, no
 * muck, no permanence -- a wheat plot is sown, it ripens, it is collected,
 * and the row is gone. `isWheatPlotReady`/`wheatPlotProgress` are pure
 * functions of `now`, same discipline as every other clock in StackAcres:
 * the server's own `ready_at` check inside the guarded collect is the only
 * authority, so a fast-forwarded phone clock cannot cash anything early.
 */

export const WHEAT_SEED_COST = 15;
export const WHEAT_DURATION_MS = 10 * 60 * 1000;
export const WHEAT_YIELD_QUANTITY = 4;

/** Flat, not a purchasable ladder like `STACKACRES_CAPACITY_PRICE` -- three
 *  wheat plots is enough to keep one Mill fed (a Mill wants 3 Wheat per run;
 *  see ./machines.ts) without a second Gold sink to design and tune before
 *  there is any player feedback on whether the loop even wants one. */
export const WHEAT_PLOT_CAP = 3;

export interface StackAcresWheatPlotRow {
  id: string;
  startedAt: string;
  readyAt: string;
  version: number;
}

export function isWheatPlotReady(row: Pick<StackAcresWheatPlotRow, "readyAt">, now: Date): boolean {
  const ready = Date.parse(row.readyAt);
  return Number.isFinite(ready) && ready <= now.getTime();
}

/** 0..1. Never frozen the way a hungry or dry unit's progress can be --
 *  wheat has nothing to tend, so its clock never stops. */
export function wheatPlotProgress(
  row: Pick<StackAcresWheatPlotRow, "startedAt" | "readyAt">,
  now: Date,
): number {
  const started = Date.parse(row.startedAt);
  const ready = Date.parse(row.readyAt);
  if (!Number.isFinite(started) || !Number.isFinite(ready) || ready <= started) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - started) / (ready - started)));
}

/** What one wheat plot renders as. Pure derivation from the row, same
 *  posture as ./units.ts's `toStackAcresUnitSnapshots` -- the client's own
 *  clock is decoration; the server's `ready_at` check inside the guarded
 *  collect is the only authority. */
export interface StackAcresWheatPlotSnapshot {
  id: string;
  startedAt: string;
  readyAt: string;
  ready: boolean;
  progress: number;
}

export function toWheatPlotSnapshot(
  row: StackAcresWheatPlotRow,
  now: Date,
): StackAcresWheatPlotSnapshot {
  return {
    id: row.id,
    startedAt: row.startedAt,
    readyAt: row.readyAt,
    ready: isWheatPlotReady(row, now),
    progress: wheatPlotProgress(row, now),
  };
}
