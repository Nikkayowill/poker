import "server-only";
import { DailyPuzzleAlreadyStarted, createPuzzleRound } from "./daily-puzzle-store";
import { creditGoldByProfile } from "./profile-store";

/**
 * The per-game daily bonus: Gold for a brain game's first completion each
 * day, scaled by how well it was played.
 *
 * Replaces the flat "Complete one brain game" mission (300 Gold, once/day,
 * any ONE of the four games -- see supabase/migrations/
 * 20260821130000_ante_up_unify_brain_games.sql, which disables it). This pays
 * per game, per day, on top of a base amount that matches what the retired
 * mission used to pay for an average result.
 *
 * A LOST daily attempt still pays the floor amount (1.0x) -- confirmed with
 * the product owner: the old mission paid on any completion, win or lose, and
 * this keeps that. Only the multiplier on top is skill-scored.
 */
export const DAILY_BONUS_BASE = 300;

/**
 * Credits a daily bonus. Never throws -- by the time this runs the puzzle is
 * already durably saved (the version-guarded round update won that race), so
 * a credit failure must not turn a finished puzzle into an error response and
 * cost a player their result on top of their Gold. Same posture as
 * ante-up-service.ts's payOutWin.
 */
export async function creditDailyBonus(profileId: string, multiplier: number): Promise<void> {
  const payout = Math.round(DAILY_BONUS_BASE * multiplier);
  if (payout <= 0) return;
  try {
    await creditGoldByProfile(profileId, payout);
  } catch (error) {
    console.error("daily-puzzle-bonus.credit_failed", { profileId, payout, error });
  }
}

/**
 * Sudoku's daily bonus is claimed once per day TOTAL, not once per
 * difficulty -- the merged Ante Up floor names "Sudoku" as one row, even
 * though four separate `sudoku-{difficulty}` daily_puzzle_rounds exist
 * underneath it (see sudoku-service.ts's sudokuGameId).
 *
 * Reuses daily-puzzle-store.ts's own idempotency mechanism as the claim gate,
 * rather than a new table: a tiny marker round under a shared `sudoku-bonus`
 * game id, guarded by the same (profile, game, day) unique index every other
 * daily puzzle already relies on. Returns true the first time this is called
 * for a player on a given day (the caller should credit), false on every
 * later difficulty finished the same day (already claimed, skip).
 */
export async function claimSudokuDailyBonus(profileId: string, day: string): Promise<boolean> {
  try {
    await createPuzzleRound({ profileId, game: "sudoku-bonus", day, round: {}, complete: true });
    return true;
  } catch (error) {
    if (error instanceof DailyPuzzleAlreadyStarted) return false;
    throw error;
  }
}
