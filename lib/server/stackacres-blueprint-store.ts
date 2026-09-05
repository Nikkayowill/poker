import "server-only";
import type { MachineItemId } from "@/lib/stackacres/machine-items";
import { isMachineItem } from "@/lib/stackacres/machine-items";
import {
  MYTHIC_BLUEPRINTS,
  MYTHIC_BLUEPRINT_IDS,
  isStageSatisfied,
  notStartedConstructionState,
  stageAt,
  stageRequirement,
  type BlueprintId,
  type ConstructionState,
  type StructuralStage,
} from "@/lib/stackacres/blueprints";
import { adminClient } from "./supabase-admin";
import { adjustStackAcresInventory } from "./stackacres-store";

/**
 * Persistence for Ray's Mythic Blueprints. Twin-branch, same shape every
 * other StackAcres store in this feature uses (Supabase when configured, an
 * in-process Map otherwise) -- see lib/server/stackacres-store.ts's own
 * header for the convention this follows.
 *
 * KEPT AS ITS OWN FILE rather than appended to stackacres-store.ts. That
 * file is already the single persistence module for every other StackAcres
 * subsystem, and normally a new subsystem would land inside it -- this one
 * is split out because it is a self-contained deliverable (schemas, store,
 * service, migration and dashboard all reviewed together) and because doing
 * so needs no access to that file's private module state: the one thing
 * this store touches outside its own tables is inventory, and that already
 * has a public, exported door (`adjustStackAcresInventory`,
 * `readStackAcresInventory`) rather than a private Map this file would
 * otherwise have to reach into.
 *
 * THE WRITE THAT MATTERS is `contributeToStackAcresBlueprintRow`: a single
 * call that validates the item against the structure's CURRENT stage,
 * clamps the accepted amount to what that stage still needs, debits
 * inventory, credits the stage's progress counter, and advances the stage
 * (or completes the structure) -- all as one atomic unit in the Supabase
 * branch (see `contribute_to_stackacres_blueprint` in
 * supabase/migrations/20260905130000_stackacres_mythic_blueprints.sql for
 * the row-locking detail) and as one non-yielding sequence of steps in the
 * memory branch, in the same order, for the same reason
 * `processStackAcresRecipe`'s memory branch gives: memory mode has no
 * transaction, but it also has no concurrency between two `await`-free
 * lines, so replicating the SQL function's own step order is what keeps the
 * two branches behaviourally identical. Returns null on ANY refusal --
 * never started, already completed, wrong material for the current stage,
 * that material already fully supplied, or not enough of it on hand -- and
 * null must never be treated as a successful contribution, the same
 * contract every other guarded write in this feature carries.
 */

interface StoredBlueprintHeader {
  currentStage: number;
  status: "in_progress" | "completed";
  completedAt: string | null;
}

export interface BlueprintContributionOutcome {
  stageIndex: number;
  item: MachineItemId;
  /** How much was actually taken from inventory -- at most `amount` passed
   *  in, clamped down whenever the stage needed less than that. */
  accepted: number;
  /** The stage+item counter's new total, after this contribution. */
  contributed: number;
  required: number;
  stageComplete: boolean;
  /** The stage the blueprint is on AFTER this call -- equal to `stageIndex`
   *  unless `stageComplete` advanced it. */
  newStage: number;
  blueprintComplete: boolean;
}

declare global {
  var __riverRoomStackAcresBlueprints: Map<string, StoredBlueprintHeader> | undefined;
  var __riverRoomStackAcresBlueprintProgress: Map<string, number> | undefined;
}

const memoryBlueprints: Map<string, StoredBlueprintHeader> =
  globalThis.__riverRoomStackAcresBlueprints ?? new Map();
globalThis.__riverRoomStackAcresBlueprints = memoryBlueprints;

const memoryBlueprintProgress: Map<string, number> =
  globalThis.__riverRoomStackAcresBlueprintProgress ?? new Map();
globalThis.__riverRoomStackAcresBlueprintProgress = memoryBlueprintProgress;

/** Test seam only, mirroring stackacres-store.ts's own
 *  `__resetStackAcresForTest` -- these two Maps live in a separate module
 *  from that reset function and are not touched by it, so any test that
 *  contributes to or starts a blueprint needs this called in its own
 *  `beforeEach` too, or state leaks across test cases in the same file. */
export function __resetStackAcresBlueprintsForTest(): void {
  memoryBlueprints.clear();
  memoryBlueprintProgress.clear();
}

function headerKey(profileId: string, structureId: BlueprintId): string {
  return `${profileId}:${structureId}`;
}

function progressKey(
  profileId: string,
  structureId: BlueprintId,
  stageIndex: number,
  item: MachineItemId,
): string {
  return `${profileId}:${structureId}:${stageIndex}:${item}`;
}

/** Every required item's current counter at one stage, for the memory
 *  branch -- a missing Map entry reads as 0, the same "missing means zero"
 *  contract the Supabase branch gets for free from a missing row. */
function memoryStageContributed(
  profileId: string,
  structureId: BlueprintId,
  stageIndex: number,
  stage: StructuralStage,
): Partial<Record<MachineItemId, number>> {
  const out: Partial<Record<MachineItemId, number>> = {};
  for (const requirement of stage.requirements) {
    const value = memoryBlueprintProgress.get(
      progressKey(profileId, structureId, stageIndex, requirement.item),
    );
    if (value !== undefined) out[requirement.item] = value;
  }
  return out;
}

/**
 * One player's progress on one blueprint. `not_started` when no row (or Map
 * entry) exists yet -- there is deliberately no "not_started" row written
 * anywhere, the same way a missing homestead_tool row means the starting
 * Trowel rather than a zero-tier row.
 */
export async function readStackAcresBlueprint(
  profileId: string,
  structureId: BlueprintId,
): Promise<ConstructionState> {
  const blueprint = MYTHIC_BLUEPRINTS[structureId];
  const supabase = adminClient();

  if (!supabase) {
    const header = memoryBlueprints.get(headerKey(profileId, structureId));
    if (!header) return notStartedConstructionState(structureId);
    if (header.status === "completed") {
      return {
        blueprintId: structureId,
        status: "completed",
        currentStage: header.currentStage,
        stageContributed: {},
        completedAt: header.completedAt,
      };
    }
    const stage = stageAt(blueprint, header.currentStage);
    return {
      blueprintId: structureId,
      status: "in_progress",
      currentStage: header.currentStage,
      // `stage` is only null here if a stored current_stage has drifted
      // past the ladder this catalogue defines today (e.g. a shortened
      // ladder shipped after this row was written) -- map that edge case to
      // "nothing left to show progress for" rather than throwing, the same
      // fail-open posture the yield-ceiling trigger takes for stock it does
      // not recognise.
      stageContributed: stage ? memoryStageContributed(profileId, structureId, header.currentStage, stage) : {},
      completedAt: null,
    };
  }

  const { data: headerRow, error: headerError } = await supabase
    .from("stackacres_blueprints")
    .select("current_stage, status, completed_at")
    .eq("profile_id", profileId)
    .eq("structure_id", structureId)
    .maybeSingle();
  if (headerError) throw new Error(`Could not read that blueprint: ${headerError.message}`);
  if (!headerRow) return notStartedConstructionState(structureId);

  const row = headerRow as { current_stage: number | string; status: string; completed_at: string | null };
  const currentStage = Number(row.current_stage);
  const status: "in_progress" | "completed" = row.status === "completed" ? "completed" : "in_progress";

  if (status === "completed") {
    return { blueprintId: structureId, status, currentStage, stageContributed: {}, completedAt: row.completed_at };
  }

  const { data: progressRows, error: progressError } = await supabase
    .from("stackacres_blueprint_progress")
    .select("item, contributed")
    .eq("profile_id", profileId)
    .eq("structure_id", structureId)
    .eq("stage_index", currentStage);
  if (progressError) throw new Error(`Could not read that blueprint's progress: ${progressError.message}`);

  const stageContributed: Partial<Record<MachineItemId, number>> = {};
  for (const progressRow of (progressRows ?? []) as { item: string; contributed: number | string }[]) {
    if (isMachineItem(progressRow.item)) stageContributed[progressRow.item] = Number(progressRow.contributed);
  }

  return { blueprintId: structureId, status: "in_progress", currentStage, stageContributed, completedAt: null };
}

/** Every blueprint's state, for the dashboard's own view -- see
 *  stackacres-blueprint-service.ts's `blueprintsView`. Reads run in
 *  parallel; MYTHIC_BLUEPRINT_IDS is small and fixed-length so this stays
 *  cheap even as the catalogue grows. */
export async function readAllStackAcresBlueprints(
  profileId: string,
): Promise<Record<BlueprintId, ConstructionState>> {
  const entries = await Promise.all(
    MYTHIC_BLUEPRINT_IDS.map(
      async (id) => [id, await readStackAcresBlueprint(profileId, id)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<BlueprintId, ConstructionState>;
}

/**
 * Begins one player's copy of one blueprint at stage 0. Idempotent by
 * primary key (Supabase) / Map key (memory) -- returns false, never an
 * error, when it was already started (or already finished), so a doubled
 * "start building" tap can never reset progress back to stage 0.
 */
export async function startStackAcresBlueprint(
  profileId: string,
  structureId: BlueprintId,
): Promise<boolean> {
  const supabase = adminClient();

  if (!supabase) {
    const key = headerKey(profileId, structureId);
    if (memoryBlueprints.has(key)) return false;
    memoryBlueprints.set(key, { currentStage: 0, status: "in_progress", completedAt: null });
    return true;
  }

  const { data, error } = await supabase.rpc("start_stackacres_blueprint", {
    p_profile_id: profileId,
    p_structure_id: structureId,
  });
  if (error) throw new Error(`Could not start that blueprint: ${error.message}`);
  return Boolean(data);
}

/**
 * See this file's own header for the full sequential-validation contract.
 * `amount` must be positive -- this is a delivery, not a general setter, the
 * same restriction `addToInventory` places on its own `quantity` parameter.
 */
export async function contributeToStackAcresBlueprintRow(
  profileId: string,
  structureId: BlueprintId,
  item: MachineItemId,
  amount: number,
): Promise<BlueprintContributionOutcome | null> {
  if (amount <= 0) {
    throw new Error("contributeToStackAcresBlueprintRow needs a positive amount");
  }

  const supabase = adminClient();

  if (!supabase) {
    const key = headerKey(profileId, structureId);
    const header = memoryBlueprints.get(key);
    if (!header) return null; // never started
    if (header.status === "completed") return null; // terminal

    const blueprint = MYTHIC_BLUEPRINTS[structureId];
    const stage = stageAt(blueprint, header.currentStage);
    if (!stage) return null; // drifted past a shortened ladder -- see readStackAcresBlueprint's own note

    const required = stageRequirement(stage, item);
    if (required === null) return null; // wrong material for the current stage

    const key2 = progressKey(profileId, structureId, header.currentStage, item);
    const contributed = memoryBlueprintProgress.get(key2) ?? 0;
    const remaining = required - contributed;
    if (remaining <= 0) return null; // already fully supplied

    const accepted = Math.min(amount, remaining);

    // The atomic debit, reusing the exported adjuster rather than reaching
    // into stackacres-store.ts's own private inventory Map -- see this
    // file's header on why that is the intended seam. Nothing has yielded
    // between the reads above and this call, so memory mode's own
    // "no transaction, but also no concurrency" invariant still holds.
    const afterDebit = await adjustStackAcresInventory(profileId, item, -accepted);
    if (afterDebit === null) return null; // not enough on hand

    const newContributed = contributed + accepted;
    memoryBlueprintProgress.set(key2, newContributed);

    const stageContributed = memoryStageContributed(profileId, structureId, header.currentStage, stage);
    stageContributed[item] = newContributed;
    const stageComplete = isStageSatisfied(stage, stageContributed);

    let newStage = header.currentStage;
    let blueprintComplete = false;
    if (stageComplete) {
      const next = stageAt(blueprint, header.currentStage + 1);
      if (next) {
        newStage = header.currentStage + 1;
        memoryBlueprints.set(key, { ...header, currentStage: newStage });
      } else {
        blueprintComplete = true;
        memoryBlueprints.set(key, {
          ...header,
          status: "completed",
          completedAt: new Date().toISOString(),
        });
      }
    }

    return {
      stageIndex: header.currentStage,
      item,
      accepted,
      contributed: newContributed,
      required,
      stageComplete,
      newStage,
      blueprintComplete,
    };
  }

  const { data, error } = await supabase.rpc("contribute_to_stackacres_blueprint", {
    p_profile_id: profileId,
    p_structure_id: structureId,
    p_item: item,
    p_amount: amount,
  });
  if (error) throw new Error(`Could not deliver that material: ${error.message}`);

  const rows = (data ?? []) as {
    stage_index: number | string;
    item: string;
    accepted: number | string;
    contributed: number | string;
    required: number | string;
    stage_complete: boolean;
    new_stage: number | string;
    blueprint_complete: boolean;
  }[];
  if (rows.length === 0) return null;

  const row = rows[0];
  if (!isMachineItem(row.item)) {
    // Defensive: the RPC only ever echoes back the p_item it was called
    // with, and that has already been through isMachineItem before this
    // call is made (see contributeToBlueprint in
    // stackacres-blueprint-service.ts) -- this branch maps a corrupted
    // response to the same "refused" null every other guard here returns,
    // rather than handing the caller a value typed as MachineItemId that
    // is not actually one.
    return null;
  }

  return {
    stageIndex: Number(row.stage_index),
    item: row.item,
    accepted: Number(row.accepted),
    contributed: Number(row.contributed),
    required: Number(row.required),
    stageComplete: row.stage_complete,
    newStage: Number(row.new_stage),
    blueprintComplete: row.blueprint_complete,
  };
}
