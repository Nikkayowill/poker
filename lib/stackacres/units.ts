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
  /**
   * Crops only. Null for livestock, which drink from their own trough.
   *
   * Null on a CROP is not "never watered" -- it is a row written before this
   * column existed, and it falls back to `startedAt` (sowing waters the
   * ground). Treating it as bone dry instead would freeze every crop already
   * in the field the moment this shipped.
   */
  lastWateredAt: string | null;
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
 * `ready` is `working` whose timer has run out, `hungry` is `working` past
 * its feed window, and `dry` is the crop track's mirror of `hungry` --
 * `working` past its watering window. All three are client-side
 * distinctions: the row itself stays `working` until a write settles it, so
 * none of them can be faked by a phone clock into paying anything.
 *
 * `hungry` and `dry` are mutually exclusive by construction rather than by a
 * tie-break: hunger is livestock-only and thirst is crop-only, and nothing
 * is both.
 */
export type StackAcresUnitState = "working" | "hungry" | "dry" | "ready" | "mucked";

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
  /** When this crop's soil next dries out. Null for livestock. */
  thirstyAt: string | null;
  /**
   * Whether this crop's soil is wet enough for it to be growing right now.
   * True for every unit that cannot go dry at all (livestock, and anything
   * mucked), so a caller reading this alone never has to special-case a kind
   * that has no soil.
   */
  isWatered: boolean;
  /** What clearing this unit costs. Null unless mucked. */
  muckFee: number | null;
  /** True when this unit was bought outright and re-sows itself. */
  permanent: boolean;
}

/**
 * How far through its cycle a unit is, as a fraction.
 *
 * `atMs` is the moment the clock is read at, which is NOT always "now": a dry
 * crop's clock stopped when its soil did, so the caller passes the moment it
 * went dry instead. Without that, a frozen crop's bar would keep creeping to
 * full and sit there looking finished while `isStackAcresUnitReady` refuses
 * it -- the exact "looks done, cannot be collected" state the growth-stage
 * comment in ./world.ts says to avoid.
 *
 * Known and deliberate: the fraction nudges UP across a tend, because
 * `startedAt` stays put while `readyAt` moves out by the neglected time, so
 * the denominator grows. What is actually preserved is the time REMAINING --
 * measured live, a crop with 7 minutes left before its soil dried has 7
 * minutes left after it is watered. Feeding has behaved this way since the
 * first migration and is not changed here; moving `startedAt` instead would
 * shift the growth-stage thresholds under every unit already in the ground.
 */
function progressOf(startedAt: string, readyAt: string, atMs: number): number {
  const started = Date.parse(startedAt);
  const ready = Date.parse(readyAt);
  if (!Number.isFinite(started) || !Number.isFinite(ready) || ready <= started) return 1;
  return Math.min(1, Math.max(0, (atMs - started) / (ready - started)));
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
 * When this row's crop next runs dry, or null if it never does.
 *
 * Falls back to `startedAt` when `lastWateredAt` is unset: sowing waters the
 * ground, and every crop row written before the column existed is one that
 * was watered when it went in. Livestock returns null -- an animal is tended
 * by feeding, and asking this of one is not a question with an answer.
 */
export function thirstyAtFor(
  row: Pick<StackAcresUnitRow, "stock" | "startedAt" | "lastWateredAt">,
): string | null {
  const def = STACKACRES_CATALOGUE[row.stock];
  if (def.thirstMs === null) return null;
  const watered = Date.parse(row.lastWateredAt ?? row.startedAt);
  if (!Number.isFinite(watered)) return null;
  return new Date(watered + def.thirstMs).toISOString();
}

/**
 * Whether a working crop's soil has run dry.
 *
 * `isStackAcresUnitHungry`'s shape on the other track, and checked in the
 * same place for the same reason: a dry crop's clock is frozen, so this has
 * to be answered before readiness or a neglected row would quietly finish its
 * cycle anyway.
 *
 * ONE DELIBERATE DIVERGENCE FROM HUNGER, and it is the important line here: a
 * crop that finished growing BEFORE its ground dried is never dry. Soil is
 * what a plant grows in, not what a harvest keeps in -- so once the timer has
 * run out the produce is made, and a drought afterwards is nothing to it.
 *
 * Without this a ripe, uncollected row goes dry and stops being collectable,
 * and watering it then pushes `readyAt` forward by the drought (see
 * `waterStackAcres`), UN-RIPENING a finished crop and charging the player
 * again for time they had already waited. Hunger genuinely does behave that
 * way -- a ready cow that goes hungry must be fed before it is milked -- and
 * it is defensible there, because a neglected animal stopping is the point.
 * It is not defensible for produce that is already grown.
 *
 * Compared against `thirstyAt` rather than `now` on purpose: whether the crop
 * beat the drought is a fact about the row, settled once, not something that
 * flips as the clock moves. It also cannot call `isStackAcresUnitReady`,
 * which calls this.
 */
export function isStackAcresUnitDry(
  row: Pick<StackAcresUnitRow, "status" | "stock" | "startedAt" | "readyAt" | "lastWateredAt">,
  now: Date,
): boolean {
  if (row.status !== "working" || isLivestock(row.stock)) return false;
  const thirstyAt = thirstyAtFor(row);
  if (!thirstyAt) return false;
  const driedAt = Date.parse(thirstyAt);
  if (driedAt > now.getTime()) return false;
  const ready = Date.parse(row.readyAt);
  return !(Number.isFinite(ready) && ready <= driedAt);
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
  row: Pick<
    StackAcresUnitRow,
    "status" | "stock" | "readyAt" | "startedAt" | "lastFedAt" | "lastWateredAt"
  >,
  now: Date,
): boolean {
  if (row.status !== "working") return false;
  // A hungry unit is frozen: it cannot become ready while it is waiting to be
  // fed, however long its own timestamp says it has been working. A dry crop
  // is frozen the same way, for the same reason -- one guard per track, and
  // no unit is ever subject to both.
  if (isStackAcresUnitHungry(row, now)) return false;
  // Only ever true for a crop that ran dry mid-cycle -- one that beat the
  // drought to its own finish line stays collectable. See its own comment.
  if (isStackAcresUnitDry(row, now)) return false;
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
        thirstyAt: null,
        isWatered: true,
        muckFee: row.muckFee,
        permanent: row.permanent,
      };
    }

    const hungry = isStackAcresUnitHungry(row, now);
    const dry = isStackAcresUnitDry(row, now);
    const ready = isStackAcresUnitReady(row, now);
    const thirstyAt = thirstyAtFor(row);
    // A dry crop's clock stopped the moment its soil did, so its bar is read
    // at THAT moment rather than at `now`. Everything else is read live.
    const readAtMs = dry && thirstyAt ? Date.parse(thirstyAt) : now.getTime();
    return {
      id: row.id,
      state: ready ? "ready" : hungry ? "hungry" : dry ? "dry" : "working",
      stock: row.stock,
      stake: row.stake,
      yieldQuantity: row.yieldQuantity,
      startedAt: row.startedAt,
      readyAt: row.readyAt,
      progress: progressOf(row.startedAt, row.readyAt, readAtMs),
      hungryAt: hungryAtFor(row),
      thirstyAt,
      isWatered: !dry,
      muckFee: null,
      permanent: row.permanent,
    };
  });
}
