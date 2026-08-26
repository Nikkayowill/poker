import "server-only";
import { creditGoldByProfile } from "./profile-store";

/**
 * The per-game daily bonus: Gold for a brain game's free-play completion each
 * day, scaled by how well it was played.
 *
 * Replaces the flat "Complete one brain game" mission (300 Gold, once/day,
 * any one of the four games; see supabase/migrations/
 * 20260821130000_ante_up_unify_brain_games.sql, which disables it). This pays
 * per game, per day, on top of a base amount matching what the retired
 * mission paid for an average result.
 *
 * A lost daily attempt still pays the floor amount (1.0x), matching the old
 * mission's behavior of paying on any completion, win or lose. Only the
 * multiplier on top is skill-scored.
 *
 * This only covers Word Stack and Connections, the two games with a real
 * once-a-day identity (a shared daily word/puzzle). Sudoku and Memory Match
 * pay entirely through their own wager mechanic, with no separate daily
 * bonus.
 *
 * A wager replaces this bonus rather than stacking with it; see
 * word-stack-service.ts/connections-service.ts, both of which only call
 * `creditDailyBonus` on the free (wager === 0) path.
 */
export const DAILY_BONUS_BASE = 300;

/**
 * Credits a daily bonus. Never throws: by the time this runs the puzzle is
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
