import "server-only";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { ensureProfile } from "./profile-store";
import {
  isMachineItem,
  machineItemLabel,
  type MachineItemId,
} from "@/lib/stackacres/machine-items";
import {
  MYTHIC_BLUEPRINTS,
  isBlueprintId,
  nextUnlockLabel,
  overallProgressFraction,
  stageAt,
  totalStages,
  type BlueprintId,
  type ConstructionState,
} from "@/lib/stackacres/blueprints";
import {
  contributeToStackAcresBlueprintRow,
  readAllStackAcresBlueprints,
  readStackAcresBlueprint,
  startStackAcresBlueprint,
} from "./stackacres-blueprint-store";
import { readStackAcresInventory } from "./stackacres-store";
import { inventoryQuantity } from "@/lib/stackacres/inventory";
import type { NextResponse } from "next/server";

/**
 * Ray's Mythic Blueprints, the request layer. See lib/stackacres/blueprints.ts
 * for the schemas and lib/server/stackacres-blueprint-store.ts for the
 * persistence contract -- everything here is request validation, a friendly
 * pre-check ahead of the atomic write (the same shape
 * `fulfillStackAcresTownContract` follows: check first for a specific
 * message, then still trust the guarded write as the real race-safe
 * authority), and shaping the response.
 *
 * MOVES NO GOLD AT ALL. A blueprint spends processing-track inventory only
 * (see ./contracts.ts's sibling header on why that item space carries no
 * Gold value of its own) and pays nothing back -- there is no reservation
 * step here to mirror `fulfillStackAcresTownContract`'s, and there must
 * never be one added without going through the same
 * `reserveStackAcresExchange` ceiling every other Gold payer in this
 * feature respects.
 */

/** Refuses a Mythic Blueprint request in a way the player can act on. The
 *  round payload is the blueprint's own current state (not a unit snapshot
 *  list, unlike StackAcresRequestError) -- a stale client re-renders THIS
 *  structure's progress from truth, which is all a blueprint error ever
 *  needs to recover from. Deliberately its own class rather than reusing
 *  StackAcresRequestError, whose round type is baked to
 *  StackAcresUnitSnapshot[] -- see that class's own definition. */
export class BlueprintRequestError extends ArcadeRequestError<ConstructionState, never> {
  readonly name = "BlueprintRequestError";
}

export interface BlueprintStageView {
  index: number;
  label: string;
  spritePhase: string;
  requirements: { item: MachineItemId; label: string; required: number; contributed: number }[];
  satisfied: boolean;
}

export interface BlueprintView {
  id: BlueprintId;
  label: string;
  status: "not_started" | "in_progress" | "completed";
  currentStage: number;
  totalStages: number;
  overallProgress: number;
  /** null once completed -- there is no "current" requirement list left to
   *  show once every stage is behind the player. */
  stage: BlueprintStageView | null;
  /** What finishing the CURRENT stage unlocks; null at the final stage or
   *  once completed. Feeds the dashboard's "Active unlocks" line. */
  nextUnlock: string | null;
  completedAt: string | null;
}

function toStageView(state: ConstructionState): BlueprintStageView | null {
  const blueprint = MYTHIC_BLUEPRINTS[state.blueprintId];
  const stage = stageAt(blueprint, state.currentStage);
  if (!stage) return null;
  return {
    index: stage.index,
    label: stage.label,
    spritePhase: stage.spritePhase,
    requirements: stage.requirements.map((requirement) => ({
      item: requirement.item,
      label: machineItemLabel(requirement.item, requirement.quantity),
      required: requirement.quantity,
      contributed: Math.min(requirement.quantity, state.stageContributed[requirement.item] ?? 0),
    })),
    satisfied: stage.requirements.every(
      (requirement) => (state.stageContributed[requirement.item] ?? 0) >= requirement.quantity,
    ),
  };
}

function toBlueprintView(state: ConstructionState): BlueprintView {
  const blueprint = MYTHIC_BLUEPRINTS[state.blueprintId];
  return {
    id: state.blueprintId,
    label: blueprint.label,
    status: state.status,
    currentStage: state.currentStage,
    totalStages: totalStages(blueprint),
    overallProgress: overallProgressFraction(blueprint, state),
    stage: state.status === "completed" ? null : toStageView(state),
    nextUnlock: state.status === "completed" ? null : nextUnlockLabel(blueprint, state.currentStage),
    completedAt: state.completedAt,
  };
}

/** Every blueprint, shaped for the dashboard -- what
 * lib/server/stackacres-service.ts's own `view()` would spread into
 * `StackAcresView.blueprints` if this feature were wired into that shared
 * poll (see this repo's `deploy-checklist` skill for that follow-up wiring
 * step; the route below already serves this same shape standalone). */
export async function blueprintsView(profileId: string): Promise<Record<BlueprintId, BlueprintView>> {
  const states = await readAllStackAcresBlueprints(profileId);
  const out = {} as Record<BlueprintId, BlueprintView>;
  for (const [id, state] of Object.entries(states) as [BlueprintId, ConstructionState][]) {
    out[id] = toBlueprintView(state);
  }
  return out;
}

function parseStructureId(value: unknown): BlueprintId {
  if (typeof value !== "string" || !isBlueprintId(value)) {
    throw new BlueprintRequestError("Not a real blueprint.", 400);
  }
  return value;
}

/**
 * Begins a player's copy of one blueprint. A second call once it is already
 * started (or finished) is not an error -- it simply reports the state that
 * is already there, the same "a repeat of an idempotent action is not a
 * fault" posture `requestStackAcresContract` takes for an already-open
 * contract.
 *
 * Takes `profileId` directly, the same reason `contributeToBlueprint` below
 * does: a caller that has already resolved a profile (the token wrapper
 * right after this one; eventually lib/server/stackacres-service.ts's own
 * `view()` composition) should never have to pay a second profile lookup to
 * perform one action -- see the memory note on the lobby poll's own
 * redundant-resolve fix for why that is worth avoiding deliberately, not
 * just when it happens to be convenient.
 */
export async function startBlueprintForProfile(profileId: string, structureId: string): Promise<BlueprintView> {
  const parsed = parseStructureId(structureId);
  await startStackAcresBlueprint(profileId, parsed);
  const state = await readStackAcresBlueprint(profileId, parsed);
  return toBlueprintView(state);
}

/** Session-cookie adapter, same shape as `contributeToBlueprintByToken`
 *  below. */
export async function startBlueprint(token: string, structureId: string): Promise<BlueprintView> {
  const profile = await ensureProfile(token);
  return startBlueprintForProfile(profile.id, structureId);
}

/**
 * Delivers `amount` of `itemId` toward `structureId`'s current stage.
 *
 * SEQUENTIAL VALIDATION, mirroring `contribute_to_stackacres_blueprint`'s
 * own step order exactly (see that function's comment in
 * supabase/migrations/20260905130000_stackacres_mythic_blueprints.sql) so a
 * caller gets the SAME specific, actionable message the database would
 * otherwise only report as an undifferentiated empty result:
 *
 *   1. `amount` must be a positive integer and `itemId` a real processing
 *      item -- request-shape validation, before any row is touched.
 *   2. The blueprint must exist and not already be completed.
 *   3. `itemId` must be asked for at the CURRENT stage.
 *   4. That requirement must not already be fully met.
 *   5. The player must hold enough `itemId` to cover what would be
 *      accepted (read here only for the friendly message; the atomic write
 *      below is what actually enforces it under a row lock, so a race that
 *      spends the material between this read and that write is still safe
 *      -- it just falls through to the generic "lost race" refusal, the
 *      same as `fulfillStackAcresTownContract`'s own pre-check does).
 *
 * The actual debit-and-credit happens in ONE atomic call
 * (`contributeToStackAcresBlueprintRow`), never as separate read-then-write
 * steps from here -- everything above is diagnosis, not enforcement.
 */
export async function contributeToBlueprint(
  profileId: string,
  structureId: string,
  itemId: string,
  amount: number,
): Promise<BlueprintView> {
  // Step 1: request shape.
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new BlueprintRequestError("That is not a real amount to contribute.", 400);
  }
  if (!isMachineItem(itemId)) {
    throw new BlueprintRequestError("That is not a real material.", 400);
  }
  const parsedStructure = parseStructureId(structureId);
  const item: MachineItemId = itemId;

  // Step 2.
  const before = await readStackAcresBlueprint(profileId, parsedStructure);
  if (before.status === "not_started") {
    throw new BlueprintRequestError("You have not started that blueprint yet.", 404, {
      round: before,
    });
  }
  if (before.status === "completed") {
    throw new BlueprintRequestError("That blueprint is already finished.", 409, { round: before });
  }

  // Step 3.
  const blueprint = MYTHIC_BLUEPRINTS[parsedStructure];
  const stage = stageAt(blueprint, before.currentStage);
  if (!stage) {
    // Defensive: current_stage has drifted past this catalogue's own ladder
    // (see stackacres-blueprint-store.ts's identical note on this branch).
    // There is genuinely nothing left to contribute toward.
    throw new BlueprintRequestError("That blueprint has nothing left to build.", 409, {
      round: before,
    });
  }
  const requirementLine = stage.requirements.find((requirement) => requirement.item === item);
  if (!requirementLine) {
    throw new BlueprintRequestError(
      `${stage.label} does not need ${machineItemLabel(item, amount)}.`,
      409,
      { round: before },
    );
  }

  // Step 4.
  const alreadyContributed = before.stageContributed[item] ?? 0;
  const remaining = requirementLine.quantity - alreadyContributed;
  if (remaining <= 0) {
    throw new BlueprintRequestError(
      `${stage.label} already has enough ${machineItemLabel(requirementLine.item, requirementLine.quantity)}.`,
      409,
      { round: before },
    );
  }

  // Step 5 (pre-check only -- see this function's own header).
  const wouldAccept = Math.min(amount, remaining);
  const inventory = await readStackAcresInventory(profileId);
  if (inventoryQuantity(inventory, item) < wouldAccept) {
    throw new BlueprintRequestError(
      `This needs ${machineItemLabel(item, wouldAccept)} you do not have yet.`,
      409,
      { round: before },
    );
  }

  // The atomic write. A null here means a concurrent contribution (from
  // this player's own other tab, most likely) already changed the picture
  // between the reads above and now -- the same "lost race" bucket every
  // other guarded write in this feature falls into.
  const outcome = await contributeToStackAcresBlueprintRow(profileId, parsedStructure, item, amount);
  if (outcome === null) {
    const after = await readStackAcresBlueprint(profileId, parsedStructure);
    throw new BlueprintRequestError("That contribution missed -- try again.", 409, { round: after });
  }

  const after = await readStackAcresBlueprint(profileId, parsedStructure);
  return toBlueprintView(after);
}

/**
 * Session-cookie adapter for the action route, which (like every other
 * StackAcres action) carries a `token`, not a bare `profileId`. Thin on
 * purpose: `contributeToBlueprint` itself takes `profileId` directly so it
 * can be called from anywhere a profile is already resolved (an admin tool,
 * a future server-to-server caller) without dragging a session token along
 * for the ride -- this is the one place that resolves a token into that id.
 */
export async function contributeToBlueprintByToken(
  token: string,
  structureId: string,
  itemId: string,
  amount: number,
): Promise<BlueprintView> {
  const profile = await ensureProfile(token);
  return contributeToBlueprint(profile.id, structureId, itemId, amount);
}

/** Maps a thrown error to the response the blueprint routes send. */
export function toBlueprintErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That could not be built.");
}
