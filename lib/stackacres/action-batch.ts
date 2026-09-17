/**
 * Coalescing rapid tool taps into the multi-unit requests the route already
 * takes.
 *
 * WHY. Tapping a crop fires one POST per tap, and a farm action is an
 * expensive request (one fan-out per call; see lib/server/
 * stackacres-service.ts). The top-down farmer walks between targets, so a
 * player queues up taps faster than he arrives: five ready crops is five
 * requests. Worse, `intentOf` in ./farm-actions.ts keys a `collect` with
 * `unitIds` on the bare action name, so the SECOND harvest tap inside the
 * first one's round trip is currently dropped by the in-flight duplicate
 * guard -- the player taps a ready crop and nothing happens.
 *
 * Both the route and ./optimistic-actions.ts already speak the plural:
 * `collect` takes `unitIds` (1..64) and `water` takes an anchor `unitId`
 * plus an optional `unitIds` block (2..64), which is what the water can's
 * group drop and the Harvest Cascade already send. So batching needs no new
 * action, no new server contract and no new prediction path -- it builds the
 * same request a group gesture builds, from taps that arrived separately.
 *
 * LEADING EDGE, TRAILING BATCH. The first tap goes out on its own, right
 * away: a lone tap must not pay 200ms for a batch it is not part of, and
 * this screen's whole feel rests on the optimistic patch landing in the same
 * frame as the press. Taps that arrive while that one is in the air join a
 * trailing batch, flushed once as a single plural request when the window
 * closes. One isolated tap behaves exactly as it does today; a burst of
 * eight becomes two requests instead of eight.
 *
 * Pure: no timers, no fetch, no React. The caller owns the clock (it passes
 * `nowMs`) and owns the one `setTimeout` that closes a window -- see
 * `stackacres-farm.tsx`'s `tapBatched`.
 */

import type { Action } from "./farm-actions";

/**
 * How long a window stays open after its leading tap. 200ms is roughly the
 * round trip on a good connection, so the window closes about when the lead
 * tap's answer lands -- long enough to catch a burst, short enough that the
 * batch is never visibly late.
 */
export const ACTION_BATCH_WINDOW_MS = 200;

/** Ceiling on one batched request, matching the `unitIds` bound the route
 *  validates (`.max(64)`). A burst past it flushes early rather than
 *  building a body the server would reject. */
export const ACTION_BATCH_MAX_UNITS = 64;

/** The two actions that have a plural form to batch into. Feeding is per pen
 *  already (`feed-pen`), and everything else is either a one-off or moves
 *  Gold, which is not something to quietly group. */
export const BATCHABLE_ACTIONS = ["water", "collect"] as const;

export type BatchableAction = (typeof BATCHABLE_ACTIONS)[number];

export interface ActionBatchWindow {
  readonly kind: BatchableAction;
  /** When the window opened. It closes `ACTION_BATCH_WINDOW_MS` after this. */
  readonly openedAtMs: number;
  /** Units already dispatched inside this window -- the leading tap, usually
   *  just the one. Held so a repeat press on one is recognised as the same
   *  gesture rather than batched again. */
  readonly sent: readonly string[];
  /** Taps waiting for the flush, in tap order, deduped. */
  readonly queued: readonly string[];
}

export interface CoalescedTap {
  /**
   * The batch the expiring window had waiting, if this tap arrived after its
   * window closed. Returned rather than dropped so a caller whose timer
   * never fired (a backgrounded tab throttles `setTimeout`) still sends
   * those taps instead of losing them.
   */
  readonly flush: Action | null;
  /** The request to send now: the leading tap of a fresh window, or null
   *  when this tap joined an open one. */
  readonly send: Action | null;
  readonly window: ActionBatchWindow;
  /** The queue hit `ACTION_BATCH_MAX_UNITS`; flush without waiting for the
   *  window to close. */
  readonly full: boolean;
}

/** Whether a window opened at `openedAtMs` is still taking taps. */
export function isBatchWindowOpen(window: ActionBatchWindow, nowMs: number): boolean {
  return nowMs - window.openedAtMs < ACTION_BATCH_WINDOW_MS;
}

/** How long until a window closes; 0 once it has. */
export function batchWindowRemainingMs(window: ActionBatchWindow, nowMs: number): number {
  return Math.max(0, window.openedAtMs + ACTION_BATCH_WINDOW_MS - nowMs);
}

/**
 * The plural request for a set of units, or null for an empty set.
 *
 * `water` names an anchor plus the block, exactly as the can's own group
 * drop does, and drops `unitIds` for a single unit because the route only
 * accepts that array at two or more. `collect` is plural at any size.
 */
export function actionForUnits(kind: BatchableAction, unitIds: readonly string[]): Action | null {
  if (unitIds.length === 0) return null;
  if (kind === "collect") return { action: "collect", unitIds: [...unitIds] };
  return unitIds.length > 1
    ? { action: "water", unitId: unitIds[0], unitIds: [...unitIds] }
    : { action: "water", unitId: unitIds[0] };
}

/** The request a window's trailing batch became, or null if nothing queued
 *  behind the leading tap. */
export function drainActionBatch(window: ActionBatchWindow): Action | null {
  return actionForUnits(window.kind, window.queued);
}

/**
 * A window holding units that still need sending -- what a caller re-arms
 * with when a flush cannot go out yet because an identical intent is still in
 * the air. Nothing is dropped; the same ids wait out one more window.
 */
export function reopenActionBatch(
  kind: BatchableAction,
  unitIds: readonly string[],
  nowMs: number,
): ActionBatchWindow {
  return { kind, openedAtMs: nowMs, sent: [], queued: [...unitIds] };
}

/**
 * One tap, folded into whatever window this action kind already has.
 *
 * A tap at a unit already in the window (sent or queued) is the same gesture
 * pressed twice, so it sends nothing and changes nothing.
 *
 * `intentBusy` is the caller's answer to "is a request with this body's own
 * intent already in the air?" -- true, and the leading tap is queued instead
 * of sent, because `intentOf` collapses every `collect` onto one intent and
 * the in-flight guard would otherwise refuse this press outright. That is the
 * silent dropped harvest tap this module exists to end.
 */
export function coalesceActionTap(
  window: ActionBatchWindow | null,
  kind: BatchableAction,
  unitId: string,
  nowMs: number,
  intentBusy = false,
): CoalescedTap {
  if (window === null || window.kind !== kind || !isBatchWindowOpen(window, nowMs)) {
    const stale = window !== null && window.kind === kind ? drainActionBatch(window) : null;
    const lead = intentBusy ? null : actionForUnits(kind, [unitId]);
    return {
      flush: stale,
      send: lead,
      window: {
        kind,
        openedAtMs: nowMs,
        sent: lead ? [unitId] : [],
        queued: lead ? [] : [unitId],
      },
      full: false,
    };
  }

  if (window.sent.includes(unitId) || window.queued.includes(unitId)) {
    return { flush: null, send: null, window, full: false };
  }

  const queued = [...window.queued, unitId];
  return {
    flush: null,
    send: null,
    window: { ...window, queued },
    full: queued.length >= ACTION_BATCH_MAX_UNITS,
  };
}
