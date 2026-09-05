/**
 * Ray's Mythic Blueprints: multi-stage structures a player fills with
 * processing-track materials over several separate donation sessions, rather
 * than in one sitting.
 *
 * DELIBERATELY BUILT ON TOP OF THE EXISTING PROCESSING INVENTORY
 * (./machine-items.ts, ./inventory.ts), not a new item space. A blueprint
 * requirement is spent from the exact same Wheat/Flour/Milk/Fleece/Cheese/
 * Cloth a Mill, Dairy or Loom already produces -- the same "one item space,
 * one place quantities are written" posture ./contracts.ts's header states
 * for Town Contracts, which are this file's closest sibling. A blueprint is
 * the second door that consumes processing-track goods; unlike a contract it
 * never pays Gold back (see the module header on lib/server/
 * stackacres-blueprint-service.ts for why that keeps it outside the daily
 * Gold ceiling entirely).
 *
 * WHY STAGES INSTEAD OF ONE FLAT REQUIREMENT LIST. A single "hand over 40
 * Flour, 20 Cheese, 30 Cloth" bill is one donation dressed up as many line
 * items -- a player with a full inventory clears it in one tap and a
 * multi-stage structure never actually reads as being built over time. A
 * `StructuralStage` groups a subset of the total bill so completing one
 * (every item in it reaching its own requirement) is itself an event -- the
 * sprite changes, the next stage's own requirements are revealed -- rather
 * than the whole structure being all-or-nothing.
 *
 * PURE DATA AND PURE ARITHMETIC ONLY, same posture ./contracts.ts and
 * ./inventory.ts already hold: nothing here reads a clock, calls the
 * database, or imports from components/. The only two places a
 * `ConstructionState` is actually written are `contribute_to_stackacres_
 * blueprint` (supabase/migrations) and its memory-mode mirror in
 * lib/server/stackacres-blueprint-store.ts -- both duplicate the requirement
 * numbers below on purpose (a SQL function cannot import a TypeScript
 * module), pinned in sync by blueprints.test.ts's own parity test. See that
 * test before changing a single quantity here.
 */

import { isMachineItem, type MachineItemId } from "./machine-items";

/** One material line: `quantity` of `item`, spent from the player's own
 *  processing inventory (./inventory.ts). Never negative and never zero --
 *  a stage that does not actually ask for an item simply omits it. */
export interface BlueprintRequirement {
  readonly item: MachineItemId;
  readonly quantity: number;
}

/**
 * One donation milestone. `requirements` is a list rather than a
 * `Partial<Record<MachineItemId, number>>` map so the display order the
 * dashboard renders is exactly the order this file declares -- the same
 * reason ./contracts.ts's `CONTRACT_RUNGS` is an array, not a keyed lookup.
 *
 * `spritePhase` keys the canvas construction-phase painter
 * (components/arcade/stackacres/mythic-blueprint-art.ts) the same plain-
 * string, no-components/-import contract ./crop-visuals.ts's `CropArt`
 * follows: this file stays reachable from vitest, which only walks lib/ and
 * app/.
 */
export interface StructuralStage {
  readonly index: number;
  readonly label: string;
  readonly requirements: readonly BlueprintRequirement[];
  readonly spritePhase: string;
}

/** A fully-defined structure: an ordered ladder of stages, climbed strictly
 *  in order -- there is no "skip ahead by overpaying an earlier stage",
 *  since a contribution can only ever target the CURRENT stage
 *  (lib/server/stackacres-blueprint-store.ts). */
export interface BlueprintDef {
  readonly id: string;
  readonly label: string;
  readonly stages: readonly StructuralStage[];
}

export const MYTHIC_BLUEPRINT_IDS = ["mythic-ember-spire"] as const;
export type BlueprintId = (typeof MYTHIC_BLUEPRINT_IDS)[number];

export function isBlueprintId(value: string): value is BlueprintId {
  return (MYTHIC_BLUEPRINT_IDS as readonly string[]).includes(value);
}

/**
 * The one structure this ships with. Three stages, each a mix of a raw good
 * and the processed good one step up from it, so a stage cannot be cleared
 * by a single machine sitting idle -- the same "never asks for a good this
 * farm has no machine for" spirit ./contracts.ts's header states, applied
 * across a whole ladder rather than one rung.
 *
 * Quantities climb (30 -> 45 -> 60 total items) and shift toward the more
 * expensive processed goods as the structure rises, so the LAST stage is the
 * one that actually needs a Dairy and a Loom running, not just a Mill.
 */
export const MYTHIC_BLUEPRINTS: Readonly<Record<BlueprintId, BlueprintDef>> = {
  "mythic-ember-spire": {
    id: "mythic-ember-spire",
    label: "Mythic Ember Spire",
    stages: [
      {
        index: 0,
        label: "Foundation",
        requirements: [
          { item: "wheat", quantity: 20 },
          { item: "flour", quantity: 10 },
        ],
        spritePhase: "spire-foundation",
      },
      {
        index: 1,
        label: "Framework",
        requirements: [
          { item: "flour", quantity: 15 },
          { item: "cheese", quantity: 8 },
        ],
        spritePhase: "spire-framework",
      },
      {
        index: 2,
        label: "Spire Crown",
        requirements: [
          { item: "cheese", quantity: 6 },
          { item: "cloth", quantity: 10 },
        ],
        spritePhase: "spire-crown",
      },
    ],
  },
};

/** How much of `item` a stage still needs, from a contributed map that may
 *  not carry that key yet -- the same "missing means zero" contract
 *  ./inventory.ts's `inventoryQuantity` follows. Null when the stage does
 *  not ask for `item` at all, so a caller can tell "asks for none of this"
 *  apart from "asks for some, already met". */
export function stageRequirement(
  stage: StructuralStage,
  item: MachineItemId,
): number | null {
  const line = stage.requirements.find((requirement) => requirement.item === item);
  return line ? line.quantity : null;
}

export function stageRemaining(
  stage: StructuralStage,
  contributed: Partial<Record<MachineItemId, number>>,
  item: MachineItemId,
): number {
  const required = stageRequirement(stage, item);
  if (required === null) return 0;
  return Math.max(0, required - (contributed[item] ?? 0));
}

/** Whether every requirement in `stage` has been met. A stage with zero
 *  requirements (never actually authored below, but not assumed away) reads
 *  as satisfied -- the same "required of zero is done, not a divide by
 *  nothing" posture ./contracts.ts's `contractProgress` takes. */
export function isStageSatisfied(
  stage: StructuralStage,
  contributed: Partial<Record<MachineItemId, number>>,
): boolean {
  return stage.requirements.every(
    (requirement) => (contributed[requirement.item] ?? 0) >= requirement.quantity,
  );
}

/** A stage's own progress as a 0..1 fraction across ALL of its requirements
 *  combined (total contributed / total required), clamped exactly like
 *  ./contracts.ts's `contractProgress` -- surplus on one item is not extra
 *  progress toward another. */
export function stageProgressFraction(
  stage: StructuralStage,
  contributed: Partial<Record<MachineItemId, number>>,
): number {
  const totalRequired = stage.requirements.reduce((sum, r) => sum + r.quantity, 0);
  if (totalRequired <= 0) return 1;
  const totalHeld = stage.requirements.reduce(
    (sum, r) => sum + Math.min(r.quantity, contributed[r.item] ?? 0),
    0,
  );
  return Math.min(1, Math.max(0, totalHeld / totalRequired));
}

export function totalStages(blueprint: BlueprintDef): number {
  return blueprint.stages.length;
}

export function isFinalStageIndex(blueprint: BlueprintDef, stageIndex: number): boolean {
  return stageIndex >= blueprint.stages.length - 1;
}

/** The stage a `currentStage` index names, or null past the end of the
 *  ladder -- reached once a blueprint is `completed`, at which point there
 *  is no "current" stage left to render requirements for. */
export function stageAt(blueprint: BlueprintDef, stageIndex: number): StructuralStage | null {
  return blueprint.stages[stageIndex] ?? null;
}

/** What completing the CURRENT stage unlocks: the next stage's label, or
 *  null when the current stage is the last one (completing it finishes the
 *  structure instead of revealing another). Drives the dashboard's "Active
 *  unlocks" line. */
export function nextUnlockLabel(blueprint: BlueprintDef, currentStage: number): string | null {
  return blueprint.stages[currentStage + 1]?.label ?? null;
}

/** One player's progress through one blueprint. `stageContributed` holds
 *  ONLY the current stage's counters -- a finished stage's numbers are
 *  history, not state a dashboard needs to keep rendering, the same way
 *  ./contracts.ts drops a fulfilled contract's row from view rather than
 *  keeping every past one around. */
export interface ConstructionState {
  readonly blueprintId: BlueprintId;
  readonly status: "not_started" | "in_progress" | "completed";
  readonly currentStage: number;
  readonly stageContributed: Partial<Record<MachineItemId, number>>;
  readonly completedAt: string | null;
}

export function notStartedConstructionState(blueprintId: BlueprintId): ConstructionState {
  return {
    blueprintId,
    status: "not_started",
    currentStage: 0,
    stageContributed: {},
    completedAt: null,
  };
}

/** Overall structure progress, 0..1, across every stage -- a weighted sum
 *  rather than `currentStage / totalStages`, so a stage half full of a
 *  4-line requirement list is not invisible next to a 1-line stage that
 *  just finished. Completed stages before `currentStage` count as fully
 *  satisfied (1.0 each), since their own counters are no longer carried in
 *  `state.stageContributed` -- see the interface's own note. */
export function overallProgressFraction(blueprint: BlueprintDef, state: ConstructionState): number {
  if (state.status === "completed") return 1;
  if (state.status === "not_started") return 0;
  const stage = stageAt(blueprint, state.currentStage);
  const currentFraction = stage ? stageProgressFraction(stage, state.stageContributed) : 0;
  return (state.currentStage + currentFraction) / totalStages(blueprint);
}

export function isValidBlueprintItem(item: string): item is MachineItemId {
  return isMachineItem(item);
}
