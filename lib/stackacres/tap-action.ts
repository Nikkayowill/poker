/**
 * What a tap on the map itself does.
 *
 * The map used to be a picture. Travelling to a district opened the sidebar,
 * and every action a unit afforded was a row in it -- tap the district, wait
 * for the panel, find the row, press Collect. This module is the middle of
 * the shorter loop that replaced it: a finger lands on a hen, the hen is
 * collected, and nothing opens.
 *
 * It decides nothing new. `unitRowAction` in ./district-panel.ts is still the
 * one place that says what a unit affords, and this only re-frames that
 * answer for a surface with no room for a disabled button and a title
 * attribute: a tap either sends something, or it floats a line of text saying
 * why it did not. Same posture as the sidebar's own -- good enough to decide
 * what to send, never a promise; the server still refuses a stale or racing
 * action and its refusal carries the true list back.
 *
 * Kept out of the scene on purpose. stackacres-scene.ts paints and reports
 * where a finger landed; it has never known what a unit costs or yields and
 * this does not start telling it.
 */

import { unitRowAction } from "./district-panel";
import { STACKACRES_ITEM_CATALOGUE, itemLabel, type StackAcresItem } from "./items";
import type { StackAcresUnitSnapshot } from "./units";

/** What a tap on a unit resolves to. `refused` never reaches the network. */
export type StackAcresTapAction =
  | { kind: "collect"; unitId: string }
  | { kind: "feed"; unitId: string }
  | { kind: "clear"; unitId: string }
  /** Nothing to send, and the line of text to float where the finger landed. */
  | { kind: "refused"; reason: string };

/** "12m", "3h 20m", "any moment" -- how long until a working unit is ready.
 *  Shared with the sidebar's own rows so the two never word it differently. */
export function timeLeftLabel(readyAtIso: string, nowMs: number): string {
  const ms = Date.parse(readyAtIso) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return "any moment";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * The one thing tapping this unit does right now.
 *
 * A working unit is the interesting case: the sidebar leaves its row with no
 * button at all, which is fine in a list that already prints the countdown
 * beside it. On the map there is no countdown -- so a tap floats one rather
 * than doing nothing, because a target that sometimes silently ignores you
 * reads as broken rather than as not-ready.
 */
export function tapActionFor(
  unit: StackAcresUnitSnapshot,
  context: { feed: number; bushels: number; nowMs: number },
): StackAcresTapAction {
  const action = unitRowAction(unit, { feed: context.feed, bushels: context.bushels });
  switch (action.kind) {
    case "collect":
      return { kind: "collect", unitId: unit.id };
    case "feed":
      return action.disabled
        ? { kind: "refused", reason: action.reason ?? "Not now." }
        : { kind: "feed", unitId: unit.id };
    case "clear":
      return action.disabled
        ? { kind: "refused", reason: action.reason ?? "Not now." }
        : { kind: "clear", unitId: unit.id };
    // Retiring is deliberately not a tap. It refunds nothing, so it stays two
    // deliberate presses behind the sidebar's own confirmation rather than
    // riding on a finger that landed on an animal.
    case "retire":
    case "none":
      return { kind: "refused", reason: `Ready in ${timeLeftLabel(unit.readyAt, context.nowMs)}` };
  }
}

/** What floats up out of a unit that just paid out: "+4 Eggs", and the name of
 *  the painter to draw beside it (a `PainterName`, kept a plain string for the
 *  same reason StackAcresItemDef.icon is -- this file stays free of a
 *  components/ import). */
export function collectFloat(
  item: StackAcresItem,
  quantity: number,
): { text: string; icon: string } {
  return { text: `+${itemLabel(item, quantity)}`, icon: STACKACRES_ITEM_CATALOGUE[item].icon };
}
