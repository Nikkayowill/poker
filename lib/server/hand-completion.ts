import "server-only";
import { checkAvatarUnlocks } from "./avatar-unlocks";
import { archiveCompletedHand } from "./hand-archive-store";
import { recordHandStats } from "./stats-store";
import type { GameState } from "@/lib/game/types";

/**
 * The single thing that happens after a hand finishes, whichever path closed
 * it.
 *
 * A hand can end two ways: a human's own action (the last call on the river,
 * handled in app/api/games/[id]/actions/route.ts) or a server-timed bot
 * action / expired clock (handled in lib/server/game-store.ts). Both used to
 * call recordHandStats directly, and the two call sites drifted -- only the
 * server-timed one went on to check avatar unlocks, so a player who ended
 * their own hand had their unlocks evaluated late, whenever some later hand
 * happened to end on a bot or a timeout instead. Routing both paths through
 * here is what keeps that from happening again.
 *
 * Callers invoke this only for the transition into `complete`, and only when
 * the game write they made actually won -- recording a hand whose state was
 * never persisted would credit a result nobody can see.
 *
 * Best-effort by contract: a hand's bookkeeping failing must never turn a
 * completed poker action into a failed request, so callers `void` this and
 * catch. Siblings are isolated from each other -- one failing does not skip
 * the others -- and every failure is collected and rethrown together so the
 * caller's log still sees it.
 */
export async function onHandCompleted(state: GameState): Promise<void> {
  const failures: unknown[] = [];

  // The archive is a true sibling of the stats write, not a step after it:
  // it reads the completed state directly and shares nothing with the stats
  // path, so a stats failure must still leave the hand reviewable and an
  // archive failure must still leave the hand counted. Both are idempotent
  // per (game, hand), so a retry of either is a no-op.
  try {
    await archiveCompletedHand(state);
  } catch (error) {
    failures.push(error);
  }

  // Stats next, and unlocks strictly after them -- not merely for ordering's
  // sake: unlock thresholds are read back out of the lifetime stats this
  // call writes, so an unlock checked first would test the pre-hand totals.
  let touchedProfileIds: string[] = [];
  try {
    touchedProfileIds = await recordHandStats(state);
  } catch (error) {
    failures.push(error);
  }

  if (touchedProfileIds.length > 0) {
    try {
      await checkAvatarUnlocks(touchedProfileIds);
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Could not complete hand bookkeeping");
  }
}
