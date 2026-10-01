import "server-only";

import {
  DEFAULT_FARM_VISIBILITY,
  SHOWCASE_REACTION_IDS,
  emptyReactionCounts,
  isFarmVisibility,
  isShowcaseReaction,
  type FarmVisibility,
  type ShowcaseReactionCounts,
  type ShowcaseReactionId,
} from "@/lib/stackacres/showcase";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for Visitor Mode: the one setting, and the compliments left on
 * a farm (`homestead_farm_showcase` / `homestead_farm_reactions`,
 * 20261001180253_stackacres_farm_showcase.sql).
 *
 * Nothing in here is version-guarded and nothing needs to be. The setting is
 * a last-write-wins single value the owner alone can change, and a reaction
 * is an insert whose primary key is the once-only rule -- two taps racing
 * both try the same row and the second is a no-op, which is the answer either
 * order wanted.
 *
 * NO ROW MEANS PRIVATE. Every farm that exists before this table does loads
 * that way, so shipping it makes nobody's farm visible to anybody.
 */

declare global {
  var __riverRoomStackAcresShowcase: Map<string, FarmVisibility> | undefined;
  var __riverRoomStackAcresFarmReactions: Set<string> | undefined;
}

const memoryVisibility = globalThis.__riverRoomStackAcresShowcase ?? new Map<string, FarmVisibility>();
globalThis.__riverRoomStackAcresShowcase = memoryVisibility;

/** `farm:viewer:reaction`, which is the table's primary key spelled as a string. */
const memoryReactions = globalThis.__riverRoomStackAcresFarmReactions ?? new Set<string>();
globalThis.__riverRoomStackAcresFarmReactions = memoryReactions;

export function __resetStackAcresShowcaseForTest(): void {
  memoryVisibility.clear();
  memoryReactions.clear();
}

function reactionKey(farmProfileId: string, viewerProfileId: string, reaction: ShowcaseReactionId): string {
  return `${farmProfileId}:${viewerProfileId}:${reaction}`;
}

/** An unknown stored value reads as private rather than throwing: a setting
 *  nobody can parse must fail closed, not fail loud. */
function visibilityFromRow(row: { visibility?: unknown } | null): FarmVisibility {
  if (!row || !isFarmVisibility(row.visibility)) return DEFAULT_FARM_VISIBILITY;
  return row.visibility;
}

export async function readFarmVisibility(profileId: string): Promise<FarmVisibility> {
  const supabase = adminClient();
  if (!supabase) return memoryVisibility.get(profileId) ?? DEFAULT_FARM_VISIBILITY;

  const { data, error } = await supabase
    .from("homestead_farm_showcase")
    .select("visibility")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your farm's visitor setting: ${error.message}`);
  return visibilityFromRow(data as { visibility?: unknown } | null);
}

export async function writeFarmVisibility(profileId: string, visibility: FarmVisibility): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryVisibility.set(profileId, visibility);
    return;
  }

  const { error } = await supabase
    .from("homestead_farm_showcase")
    .upsert(
      { profile_id: profileId, visibility, updated_at: new Date().toISOString() },
      { onConflict: "profile_id" },
    );
  if (error) throw new Error(`Could not save your farm's visitor setting: ${error.message}`);
}

export async function countFarmReactions(farmProfileId: string): Promise<ShowcaseReactionCounts> {
  const counts = { ...emptyReactionCounts() };
  const supabase = adminClient();
  if (!supabase) {
    for (const key of memoryReactions) {
      const [farm, , reaction] = key.split(":");
      if (farm !== farmProfileId || !isShowcaseReaction(reaction)) continue;
      counts[reaction] += 1;
    }
    return counts;
  }

  const { data, error } = await supabase
    .from("homestead_farm_reactions")
    .select("reaction")
    .eq("farm_profile_id", farmProfileId);
  if (error) throw new Error(`Could not read that farm's reactions: ${error.message}`);
  for (const row of (data ?? []) as { reaction?: unknown }[]) {
    if (isShowcaseReaction(row.reaction)) counts[row.reaction] += 1;
  }
  return counts;
}

/** Which of the three this viewer has already left on this farm. */
export async function listViewerReactions(
  farmProfileId: string,
  viewerProfileId: string,
): Promise<ShowcaseReactionId[]> {
  const supabase = adminClient();
  if (!supabase) {
    return SHOWCASE_REACTION_IDS.filter((reaction) =>
      memoryReactions.has(reactionKey(farmProfileId, viewerProfileId, reaction)),
    );
  }

  const { data, error } = await supabase
    .from("homestead_farm_reactions")
    .select("reaction")
    .eq("farm_profile_id", farmProfileId)
    .eq("viewer_profile_id", viewerProfileId);
  if (error) throw new Error(`Could not read your reactions: ${error.message}`);
  const found = new Set((data ?? []).map((row) => String((row as { reaction?: unknown }).reaction)));
  return SHOWCASE_REACTION_IDS.filter((reaction) => found.has(reaction));
}

/**
 * Leaves one reaction. True when this call is the one that recorded it,
 * false when the viewer had already left it.
 *
 * `ignoreDuplicates` rather than a read-then-insert: the primary key is the
 * once-only rule (see the migration), so the second of two racing taps comes
 * back as nothing inserted instead of as an error, which is exactly the
 * answer to report.
 */
export async function insertFarmReaction(
  farmProfileId: string,
  viewerProfileId: string,
  reaction: ShowcaseReactionId,
): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const key = reactionKey(farmProfileId, viewerProfileId, reaction);
    if (memoryReactions.has(key)) return false;
    memoryReactions.add(key);
    return true;
  }

  const { data, error } = await supabase
    .from("homestead_farm_reactions")
    .upsert(
      { farm_profile_id: farmProfileId, viewer_profile_id: viewerProfileId, reaction },
      { onConflict: "farm_profile_id,viewer_profile_id,reaction", ignoreDuplicates: true },
    )
    .select("reaction");
  if (error) throw new Error(`Could not record that reaction: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}
