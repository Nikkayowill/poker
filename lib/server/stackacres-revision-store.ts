import "server-only";
import { adminClient } from "./supabase-admin";

/**
 * A per-profile "how fresh is this" counter for the StackAcres action route.
 *
 * WHY THIS EXISTS. Every action's response is a full farm view, built from a
 * live re-read of the DB at the moment that one request finishes (`view()`
 * in stackacres-service.ts). Two actions in flight at once for the same
 * profile -- water a crop, feed a hen -- race each other's reads
 * independently, so their responses can reach the client in an order that
 * does not match which one actually finished last. The client used to trust
 * whichever response landed most recently and simply overwrite its whole
 * unit list with it, so a stale response could revert a unit a different,
 * later-finishing action had already corrected -- a visible flash back to
 * the old state until the real answer caught up a moment later.
 *
 * This is that fix's other half: `bumpStackAcresRevision` hands out a
 * strictly increasing number once per completed action, and every response
 * (success or refusal) carries the current one. stackacres-farm.tsx's
 * `applyResponse` then drops any response whose number is not higher than
 * the one already on screen, so out-of-order arrival can no longer clobber
 * newer state -- see that function's own header.
 *
 * The number itself means nothing beyond "higher is fresher" -- it is not a
 * count of anything, not a row version, and not tied to any one unit. A
 * refusal that mutated nothing still reports the current value (a plain
 * read); only a genuinely completed action bumps it.
 */

declare global {
  var __riverRoomStackAcresRevisions: Map<string, number> | undefined;
}

const memoryRevisions = globalThis.__riverRoomStackAcresRevisions ?? new Map<string, number>();
globalThis.__riverRoomStackAcresRevisions = memoryRevisions;

/** Test seam only: the memory branch is process-global. */
export function __resetStackAcresRevisionsForTest(): void {
  memoryRevisions.clear();
}

/** The current revision, unchanged. Used to stamp a response (a refusal, a
 *  plain read, a replay/in-flight answer) that did not itself just complete
 *  a fresh mutation. */
export async function readStackAcresRevision(profileId: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) return memoryRevisions.get(profileId) ?? 0;

  const { data, error } = await supabase
    .from("homestead_action_revisions")
    .select("rev")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the farm's revision: ${error.message}`);
  return (data as { rev: number } | null)?.rev ?? 0;
}

/**
 * Advances the counter by one and returns the new value. Called exactly
 * once per action that actually ran (see `runStackAcresAction`), after its
 * own write has landed -- never for a refusal, a replay, or an answer to an
 * in-flight twin, since none of those changed anything this profile did not
 * already have credit for.
 *
 * One atomic round trip (`bump_homestead_action_revision`, an upsert-under-
 * conflict RPC): a plain read-then-write from here would race itself the
 * same way the bug this exists to fix does.
 */
export async function bumpStackAcresRevision(profileId: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) {
    const next = (memoryRevisions.get(profileId) ?? 0) + 1;
    memoryRevisions.set(profileId, next);
    return next;
  }

  const { data, error } = await supabase.rpc("bump_homestead_action_revision", {
    p_profile_id: profileId,
  });
  if (error) throw new Error(`Could not bump the farm's revision: ${error.message}`);
  return data as number;
}
