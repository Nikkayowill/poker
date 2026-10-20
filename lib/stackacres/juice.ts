/**
 * Juice & Feedback: configuration and pure math for StackAcres's tap-driven
 * impact effects -- the harvest pop, the crit flash, and the barn-absorb
 * flight.
 *
 * PHASER-FREE ON PURPOSE, the same rule ./crop-visuals.ts states at its own
 * top: vitest only reaches lib/ and app/, so every number and curve a test
 * can hold to its value lives here. The only caller,
 * components/arcade/stackacres/game-juice-manager.ts, owns none of these
 * decisions -- it plays them back through Phaser and nothing else.
 *
 * CROP ROSTER (2026-09-12): the 22 CraftPix crops this file used to style are
 * gone, replaced outright by the 16 Gr8FarmPack crops (see ./catalogue.ts's
 * header); livestock still pays eggs, wool and milk. This file styles every
 * real stock kind StackAcres pays out -- nothing here is dead config nothing
 * ever looks up.
 */

import { STACKACRES_STOCK, } from "./catalogue";

/* ------------------------------------------------------------------ */
/* Harvest pop: procedural shard styling per stock                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Crit flash                                                          */
/* ------------------------------------------------------------------ */

/**
 * "CRIT! x1.75", "CRIT! x2" -- never "CRIT! x1.750" or "CRIT! x2.00".
 *
 * `multiplier` is the harvest's TOTAL payout multiple, not
 * equipment.ts's own `critBonus` (what a crit adds ON TOP): callers pass
 * `1 + critBonus`, so the Iron Shovel's 0.75 bonus reads as "CRIT! x1.75"
 * and the Golden Spade's 1 reads as "CRIT! x2".
 */
export function critFlashLabel(multiplier: number): string {
  const safe = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const fixed = safe.toFixed(2).replace(/\.?0+$/, "");
  return `CRIT! x${fixed}`;
}

/**
 * Camera-shake intensity for a crit flash: MICRO on purpose. StackAcres often
 * runs in a tab next to a live poker table -- a shake big enough to read as
 * satisfying "juice" here would read as "the page glitched" there. Duration
 * is fixed (see the manager); only intensity rides the multiplier, and even
 * the richest crit live today (the Golden Spade's x2) stays under a third of
 * Phaser's own commonly-cited "noticeable" shake intensity (~0.01).
 */
const CRIT_SHAKE_BASE = 0.0012;
const CRIT_SHAKE_PER_BONUS = 0.0015;
/** The Golden Spade's own critBonus (1) is the richest crit in the game
 *  today; clamping the bonus this scales against means a future, richer
 *  rung cannot shake harder than "micro" without this file changing too. */
const CRIT_SHAKE_BONUS_CAP = 1;

export function critShakeIntensity(multiplier: number): number {
  const bonus = Math.min(CRIT_SHAKE_BONUS_CAP, Math.max(0, multiplier - 1));
  return CRIT_SHAKE_BASE + bonus * CRIT_SHAKE_PER_BONUS;
}

export const CRIT_SHAKE_DURATION_MS = 90;

/* ------------------------------------------------------------------ */
/* Gold count-up ticker                                                */
/* ------------------------------------------------------------------ */

/**
 * How long a payout takes to count up from nothing to its full figure.
 *
 * The one payout on this farm with NO world-space answer at all is a Town
 * Contract: it is settled from inside a modal, so `stackacres-farm.tsx`'s tap
 * anchor is null and `floatAt` never fires (see its call site, which says so).
 * All a delivery got was a line of text and a sound, which left the single
 * largest deliberate Gold event in StackAcres quieter than picking one carrot.
 *
 * 900ms is sized against the figure rather than picked round: contract rungs
 * pay in the thousands, and a ticker fast enough to be over before the eye
 * lands on it is a number that changed, not a number that was counted. It is
 * also comfortably shorter than the sheet's own closing note takes to read, so
 * nothing is left waiting on it.
 */
export const GOLD_TICKER_DURATION_MS = 900;

/**
 * The figure to show `t` of the way through the count-up.
 *
 * Ease-out cubic, so the ticker sprints through the leading digits and settles
 * on the last few -- a linear count reads as a progress bar wearing a number.
 * Floored, because Gold is counted in whole units everywhere else in the app,
 * and exact at `t >= 1`: the last frame has to land on the real payout rather
 * than one short of it, since this figure sits beside a balance the player can
 * go and check.
 */
export function goldTickerValue(total: number, t: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(t) || t >= 1) return Math.floor(total);
  if (t <= 0) return 0;
  const eased = 1 - Math.pow(1 - t, 3);
  return Math.floor(total * eased);
}

/* ------------------------------------------------------------------ */
/* Barn absorb                                                         */
/* ------------------------------------------------------------------ */

export interface Point {
  x: number;
  y: number;
}

export { STACKACRES_STOCK };
