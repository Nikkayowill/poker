import "server-only";
import { rankProgress, xpForWager, type TierReward } from "@/lib/progression/rank";
import { rankPointsFrom, summarizeSoloEarnings } from "@/lib/progression/solo-earnings";
import { liveStreak, streakAfterClaim, utcDayKey } from "@/lib/progression/streak";
import type { ProgressionSnapshot } from "@/lib/progression/types";
import type { PlayerProfile } from "@/lib/profile/types";
import { readSoloState, type SoloState } from "./solo-earnings-store";
import { adminClient } from "./supabase-admin";

/**
 * Player progression: rank, lifetime wagered, daily streak.
 *
 * Rank is no longer XP from staking. It is the difficulty-weighted net of solo
 * wagers, kept by lib/server/solo-earnings-store.ts and turned into a tier by
 * lib/progression/rank.ts. This store still counts XP and lifetime
 * wagered for every wager, PVP included, but nothing here pays tier rewards or
 * moves rank from them; the tier Gold comes from the solo store.
 *
 * The curve itself is not here. lib/progression/rank.ts owns it, is pure, and
 * is the only definition; this module reads xp out of a row and asks that
 * module what it means. The table stores no tier for the same reason (see the
 * migration's header).
 *
 * Two ordering rules, restated here rather than referenced, because breaking
 * either is a silent money bug and the next reader should not have to open
 * another file to learn why the sequence is what it is:
 *
 *  1. **XP is awarded before its reward is paid.** award_progression_xp is a
 *     locked read-modify-write returning the xp on both sides, so it is the
 *     only thing that can answer "did this award cross a level" exactly once.
 *     Paying first and recording second would pay a milestone again on every
 *     retry.
 *  2. **The Gold goes out through creditGold, never adjustGold.** creditGold is
 *     the guarded credit_gold RPC (20260804160000); adjustGold is still a plain
 *     read-then-write, and a tier reward landing while a cash-out credits the
 *     same wallet would drop one of them. That is the exact race credit_gold
 *     exists to close.
 */

// Re-exported so server callers keep importing the shape from the store; the
// definition lives in lib/progression/types.ts because the client needs it and
// this module is server-only. Same reasoning as friends-store.ts.
export type { ProgressionSnapshot };

export interface WagerAward {
  /** Every tier reached by this wager, in order. Always empty here; see recordSoloResult. */
  tierUps: TierReward[];
  /** Gold actually credited for those tiers. */
  goldAwarded: number;
  xpAwarded: number;
  progression: ProgressionSnapshot;
  /**
   * The wallet after a tier reward was paid, or null when nothing was.
   *
   * Handed back rather than left for the caller to re-read: the caller is a
   * settle path that already holds a PlayerProfile it is about to serialise,
   * and a tier reward credited but not reflected in that payload shows the
   * player a tier-up and an unchanged balance in the same response.
   */
  profile: PlayerProfile | null;
}

interface ProgressionRow {
  xp: number;
  lifetimeWagered: number;
  streak: number;
  lastClaimDay: string | null;
}

const EMPTY_ROW: ProgressionRow = { xp: 0, lifetimeWagered: 0, streak: 0, lastClaimDay: null };

// ---- memory-mode mirror ----------------------------------------------------
//
// Twin branches, same as every other store here. globalThis so the map survives
// Next.js' dev-mode module reloads.

declare global {
  var __riverRoomProgression: Map<string, ProgressionRow> | undefined;
}

const memoryProgression = globalThis.__riverRoomProgression ?? new Map<string, ProgressionRow>();
globalThis.__riverRoomProgression = memoryProgression;

/** Test-only reset. */
export function __resetProgressionMemory(): void {
  memoryProgression.clear();
}

function toSnapshot(row: ProgressionRow, solo: SoloState, now: Date): ProgressionSnapshot {
  return {
    ...rankProgress(rankPointsFrom(solo.base, solo.byBand)),
    lifetimeWagered: row.lifetimeWagered,
    soloEarnings: summarizeSoloEarnings(solo.byBand),
    // Read through liveStreak rather than straight off the row: a stored 9 is
    // not a nine-day streak if the last claim was a week ago, and the readout
    // must not promise a multiplier the next claim will not pay.
    streak: liveStreak(row.lastClaimDay, row.streak, utcDayKey(now)),
    lastClaimDay: row.lastClaimDay,
  };
}

async function readRow(profileId: string): Promise<ProgressionRow> {
  const supabase = adminClient();
  if (!supabase) return memoryProgression.get(profileId) ?? EMPTY_ROW;

  const { data, error } = await supabase
    .from("player_progression")
    .select("xp, lifetime_wagered, streak, last_claim_day")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not load progression: ${error.message}`);
  // No row is not an error: a player who has never wagered is Bronze, which
  // rankProgress(0) renders from nothing at all.
  if (!data) return EMPTY_ROW;
  return {
    xp: Number(data.xp),
    lifetimeWagered: Number(data.lifetime_wagered),
    streak: Number(data.streak),
    lastClaimDay: data.last_claim_day ? String(data.last_claim_day) : null,
  };
}

/** Where this player stands. Safe to call for someone with no row. */
export async function getProgression(
  profileId: string,
  now: Date = new Date(),
): Promise<ProgressionSnapshot> {
  const [row, solo] = await Promise.all([readRow(profileId), readSoloState(profileId)]);
  return toSnapshot(row, solo, now);
}

/**
 * Records Gold staked, for lifetime volume and the legacy XP count.
 *
 * It no longer moves rank or pays tier rewards: rank is the net of solo
 * wagers now, which recordSoloResult owns. The return shape is kept so the
 * settle paths that read `progression` off it keep working, with `tierUps`
 * always empty and no Gold awarded.
 *
 * `token` is kept in the signature for the same reason; nothing here credits.
 *
 * Never throws into its caller. A settled arcade round or a completed poker
 * hand must not become a failed request because the XP write failed, the same
 * contract onHandCompleted states for stats and archives.
 */
export async function awardWager(
  profileId: string,
  _token: string | null,
  goldStaked: number,
  now: Date = new Date(),
): Promise<WagerAward | null> {
  const xp = xpForWager(goldStaked);
  // A sub-threshold stake still counts toward lifetime volume, but there is
  // nothing to write.
  if (xp <= 0) return null;

  try {
    const supabase = adminClient();
    if (!supabase) {
      const current = memoryProgression.get(profileId) ?? EMPTY_ROW;
      memoryProgression.set(profileId, {
        ...current,
        xp: current.xp + xp,
        lifetimeWagered: current.lifetimeWagered + Math.floor(goldStaked),
      });
    } else {
      const { error } = await supabase.rpc("award_progression_xp", {
        p_profile_id: profileId,
        p_xp: xp,
        p_wagered: Math.floor(goldStaked),
      });
      if (error) throw new Error(`Could not award XP: ${error.message}`);
    }

    const [row, solo] = await Promise.all([readRow(profileId), readSoloState(profileId)]);
    return { tierUps: [], goldAwarded: 0, xpAwarded: xp, progression: toSnapshot(row, solo, now), profile: null };
  } catch (error) {
    console.error("progression.award_wager_failed", { profileId, goldStaked, error });
    return null;
  }
}

/**
 * Moves the daily-claim streak on, idempotently for the day.
 *
 * Called *before* the credit is attempted, which is safe precisely because
 * streakAfterClaim returns the streak unchanged when today has already been
 * recorded: the claim's own UTC-day guard inside claim_daily_gold is what
 * decides whether Gold moves, and both are keyed on the same day boundary. The
 * reverse order would have to read the streak, credit, then write, and a
 * process that died in the middle would pay the multiplier without recording
 * the day that earned it.
 */
export async function recordDailyClaim(profileId: string, now: Date = new Date()): Promise<number> {
  const today = utcDayKey(now);
  const current = await readRow(profileId);
  const streak = streakAfterClaim(current.lastClaimDay, current.streak, today);
  if (current.lastClaimDay === today && current.streak === streak) return streak;

  const supabase = adminClient();
  if (!supabase) {
    memoryProgression.set(profileId, { ...current, streak, lastClaimDay: today });
    return streak;
  }

  const { error } = await supabase
    .from("player_progression")
    .upsert(
      { profile_id: profileId, streak, last_claim_day: today, updated_at: now.toISOString() },
      { onConflict: "profile_id" },
    );
  if (error) throw new Error(`Could not record your streak: ${error.message}`);
  return streak;
}
