/**
 * What the dock shows, and which of it can act right now.
 *
 * The dock used to draw all six tools all the time and leave the player to
 * work out which one the thing under their finger would answer to. That is
 * the same problem ./tools.ts's own header describes from the other side: a
 * bare tap became a minefield once pens sat close together, so PR #448 made
 * a unit action require the matching tool. It fixed the misfires and left a
 * guessing game -- six keys, and no clue which one this cow wants.
 *
 * So the dock follows the selection instead. Tap a cow and the dock is the
 * three things you can do to a cow; tap a bed and it is the four a bed
 * affords; tap nothing and it is the tools you drag across open ground.
 * `live` is the second half of that: a tool the selection affords RIGHT NOW
 * is lit, and one that belongs to the selection but has nothing to do is
 * shown dim rather than dropped. A hungry cow keeps Water and Harvest in
 * place, greyed, so the row does not reshuffle under the thumb every time
 * an animal changes state.
 *
 * Nothing here is authoritative, the same posture ./district-panel.ts takes:
 * this is good enough to light a key with. The server still refuses a stale
 * action and its refusal carries the truth back.
 */

import type { StackAcresUnitState } from "./units";
import type { StackAcresTool } from "./tools";

/** What the player last tapped, as much of it as the dock needs. */
export type StackAcresDockSelection =
  /** Nothing selected: the resting state a session opens in. */
  | { kind: "none" }
  /**
   * A square of a district's own ground. `hasBed` is whether soil is already
   * tilled there, which is what decides if a crop has anywhere to stand (see
   * lib/stackacres/soil.ts) and therefore whether Water and Harvest are
   * worth offering at all.
   */
  | { kind: "ground"; hasBed: boolean }
  /** One owned unit: an animal, or a crop standing in a bed. */
  | { kind: "unit"; state: StackAcresUnitState };

/** One key on the dock. */
export interface StackAcresDockEntry {
  tool: StackAcresTool;
  /** Whether this tool can act on the current selection right now. A dim key
   *  is still pressable -- holding a tool arms its drag, which works on
   *  whatever the stroke crosses, not on what happens to be selected. */
  live: boolean;
}

/** The tools you drag across open ground, and the dock's resting row. */
const GROUND_TOOLS = ["scythe", "pipe", "soil"] as const satisfies readonly StackAcresTool[];

/** What a square of ground offers once it is the selection. Soil and Pipe
 *  shape the square itself; Water and Harvest only mean anything once
 *  something is standing on it, which is what `hasBed` decides. */
const GROUND_SELECTED_TOOLS = ["soil", "pipe", "water", "harvest"] as const satisfies readonly StackAcresTool[];

/** The three a unit can ever answer to. Order is fixed rather than sorted by
 *  which one is live: a key that moves position between taps is a key the
 *  thumb has to look for every time. */
const UNIT_TOOLS = ["feed", "water", "harvest"] as const satisfies readonly StackAcresTool[];

/**
 * Which single tool a unit in this state affords, or null while it is just
 * growing. Deliberately the same mapping `unitRowAction` in
 * ./district-panel.ts makes and the same one the scene's own
 * `unitTapEligible` tests, written here in tool terms so the dock, the
 * sidebar and the canvas can never disagree about what a cow wants.
 */
export function unitToolFor(state: StackAcresUnitState): StackAcresTool | null {
  switch (state) {
    case "dry":
      return "water";
    case "hungry":
      return "feed";
    case "ready":
    case "mucked":
      return "harvest";
    case "working":
      return null;
  }
}

/** The dock's keys, left to right, for what is selected. */
export function dockEntriesFor(selection: StackAcresDockSelection): readonly StackAcresDockEntry[] {
  switch (selection.kind) {
    case "none":
      // Nothing is selected, so nothing can be "afforded" -- but every one of
      // these drags across open ground on its own, which is exactly what the
      // resting dock is for. All three stay lit.
      return GROUND_TOOLS.map((tool) => ({ tool, live: true }));
    case "ground":
      return GROUND_SELECTED_TOOLS.map((tool) => ({
        tool,
        live: tool === "soil" || tool === "pipe" ? true : selection.hasBed,
      }));
    case "unit": {
      const afforded = unitToolFor(selection.state);
      return UNIT_TOOLS.map((tool) => ({ tool, live: tool === afforded }));
    }
  }
}
