import "server-only";
import { advanceAnteUpAttempt, type StoredAnteUpAttempt } from "./ante-up-store";
import { recordSoloResult } from "./solo-earnings-store";

/**
 * The version-guarded advance every attempt-based solo game uses, plus the
 * moment a wager reaches its final state, so the earnings tally sees every win
 * and every loss (a wrong move, a timeout, a resign) and not only the wins that
 * go through a game's payout.
 *
 * advanceAnteUpAttempt returns null on a lost race, so only the one caller that
 * actually wrote the settled state records it. The attempt id is the
 * idempotency key, so even a replayed request counts once.
 *
 * `payoutOf` is the game's own payout for the state it just settled on, zero
 * for a loss. It is computed here from the settled state, not read back from a
 * credit, so a failed credit does not hide a win from the tally; the credit
 * failure is logged where it happens.
 */
export function soloAdvance<TState extends { status: string; wager: number }>(payoutOf: (state: TState) => number) {
  return async function advance(
    current: StoredAnteUpAttempt<TState>,
    next: TState,
  ): Promise<StoredAnteUpAttempt<TState> | null> {
    const stored = await advanceAnteUpAttempt(current, next);
    if (stored && next.status !== "active" && next.wager > 0) {
      await recordSoloResult(current.profileId, null, {
        game: current.game,
        correlationId: `solo:${current.id}`,
        wager: next.wager,
        payout: payoutOf(next),
      });
    }
    return stored;
  };
}
