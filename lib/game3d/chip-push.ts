/**
 * What a chip movement FEELS like, keyed to what the player actually did.
 *
 * The room has one motion primitive (sampleChipPush in chip-trajectory.ts)
 * and this file is the table of styles fed to it. A call and a three-bet
 * move the same discs across the same cloth; what separates them is
 * cadence and force, so that is what varies here — how far apart the chips
 * leave, how hard they arrive — rather than the path shape, which is the
 * dealer's push in every case.
 *
 * `pushKindFromAction` reads the server-authored label on `SeatModel.
 * lastAction`, which is the only signal the snapshot carries about *how*
 * a bet was made: the delta in `streetBet` says a bet happened and how big
 * it was, never whether it was a call or a raise. The labels are written in
 * lib/game/engine.ts ("Call · 200", "Raise to · 600", "Big blind · 100",
 * "All-in · 4300"), which is why the match is on the part before the
 * separator — the amount after it is already known from the delta.
 *
 * Pure data and string handling, no three.js, so `npm test` reaches it.
 */

import type { PushStyle } from "./chip-trajectory";

/**
 * Every kind of chip movement the felt shows. The first five are a seat
 * committing chips; `sweep` is the dealer pulling standing bets into the
 * pot when a street turns, `award` is the dealer pushing the pot to a
 * winner.
 */
export type PushKind = "blind" | "call" | "bet" | "raise" | "all-in" | "sweep" | "award";

/**
 * The domino cadence, bounded. Every style's stagger lives in this band:
 * under ~70 ms consecutive chips read as one clump leaving together (the
 * spray this replaced), over ~90 ms the sequence reads as separate events
 * rather than one push. A test pins every entry inside it, so a later
 * tuning pass cannot quietly step outside the range the effect depends on.
 */
export const MIN_PUSH_STAGGER_MS = 70;
export const MAX_PUSH_STAGGER_MS = 90;

export const PUSH_STYLES: Record<PushKind, PushStyle> = {
  // Posted, not chosen: the mechanical one. Barely any tilt.
  blind: { travelMs: 340, staggerMs: 70, arcHeight: 0.04, settleMs: 200, tiltRad: 0.05 },
  // Matching someone else's number — even, unemphatic, the slowest cadence.
  call: { travelMs: 330, staggerMs: 72, arcHeight: 0.05, settleMs: 200, tiltRad: 0.06 },
  // Opening a street: deliberate, a little more air under each chip.
  bet: { travelMs: 300, staggerMs: 80, arcHeight: 0.07, settleMs: 220, tiltRad: 0.09 },
  // A raise is a statement. Widest gap between chips, hardest landing.
  raise: { travelMs: 270, staggerMs: 88, arcHeight: 0.09, settleMs: 240, tiltRad: 0.12 },
  // Everything, at once: the cadence tightens back to the floor because a
  // shove goes in as one motion, but each chip lands hardest of all.
  "all-in": { travelMs: 250, staggerMs: 70, arcHeight: 0.1, settleMs: 260, tiltRad: 0.14 },
  // The dealer's own hands: chips dragged low across the felt, not tossed.
  sweep: { travelMs: 320, staggerMs: 70, arcHeight: 0.03, settleMs: 180, tiltRad: 0.05 },
  // Pushing a pot out to a winner — unhurried and flat, the opposite of the
  // funnel that used to fire it out in every direction at once.
  award: { travelMs: 340, staggerMs: 75, arcHeight: 0.045, settleMs: 200, tiltRad: 0.06 },
};

export function pushStyleFor(kind: PushKind): PushStyle {
  return PUSH_STYLES[kind];
}

/**
 * Classify a seat's server-authored action label. Only labels that actually
 * move chips can reach here — the caller has already seen a positive
 * `streetBet` delta — so "Fold" and "Check" have no entry, and an
 * unrecognised label falls back to `bet` rather than throwing: a chip
 * movement whose label the engine renamed must still be choreographed, and
 * `bet` is the neutral middle of the range.
 */
export function pushKindFromAction(lastAction: string | null): PushKind {
  if (!lastAction) return "bet";
  // "Raise to · 600" -> "raise to". The amount after the separator is
  // already known from the streetBet delta; only the verb is wanted. The
  // trailing digits are stripped as well as split off, because the scene
  // is also driven by the scripted demo (components/game3d/demo/), which
  // writes "raise 30" with no separator — a classifier that only knew the
  // engine's exact punctuation would silently flatten the demo's whole
  // range to one cadence, which is the one place a human ever watches this
  // choreography back to back.
  const verb = lastAction
    .split("·")[0]
    .replace(/[\s\d]+$/, "")
    .trim()
    .toLowerCase();
  if (verb === "small blind" || verb === "big blind") return "blind";
  if (verb === "call") return "call";
  if (verb === "bet") return "bet";
  if (verb === "raise to" || verb === "raise") return "raise";
  if (verb === "all-in") return "all-in";
  return "bet";
}
