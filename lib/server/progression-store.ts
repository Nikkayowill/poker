import "server-only";
import {
  goldForLevelUps,
  levelForXp,
  rankProgress,
  rewardsBetween,
  xpForWager,
  type LevelReward,
} from "@/lib/progression/rank";
import { liveStreak, streakAfterClaim, utcDayKey } from "@/lib/progression/streak";
import type { ProgressionSnapshot } from "@/lib/progression/types";
import type { PlayerProfile } from "@/lib/profile/types";
import { applyMissionEvent } from "./mission-store";
import { creditGold, creditGoldByProfile } from "./profile-store";
import { adminClient } from "./supabase-admin";

/**
 * Player progression: XP, rank, lifetime wagered, daily streak.
 *
 * The curve itself is not here. lib/progression/rank.ts owns it, is pure, and
 * is the only definition -- this module reads xp out of a row and asks that
 * module what it means. The table stores no level for the same reason (see the
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
 *     read-then-write, and a milestone landing while a cash-out credits the
 *     same wallet would drop one of them. That is the exact race credit_gold
 *     exists to close.
 */

// Re-exported so server callers keep importing the shape from the store; the
// definition lives in lib/progression/types.ts because the client needs it and
// this module is server-only. Same reasoning as friends-store.ts.
export type { ProgressionSnapshot };

export interface WagerAward {
  /** Every level crossed by this wager, in order. Empty when none were. */
  levelUps: LevelReward[];
  /** Gold actually credited for those level-ups. */
  goldAwarded: number;
  xpAwarded: number;
  progression: ProgressionSnapshot;
  /**
   * The wallet after a milestone was paid, or null when nothing was.
   *
   * Handed back rather than left for the caller to re-read: the caller is a
   * settle path that already holds a PlayerProfile it is about to serialise,
   * and a milestone credited but not reflected in that payload shows the
   * player a level-up and an unchanged balance in the same response.
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

function toSnapshot(row: ProgressionRow, now: Date): ProgressionSnapshot {
  return {
    ...rankProgress(row.xp),
    lifetimeWagered: row.lifetimeWagered,
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
  // No row is not an error: a player who has never wagered is level 1, which
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
  return toSnapshot(await readRow(profileId), now);
}

/**
 * Records Gold staked, and pays whatever levels that crossed.
 *
 * `token` is taken alongside `profileId` because the two identities do
 * different jobs here and neither substitutes for the other: progression is
 * keyed on the durable profile id, and the guarded credit is keyed on the
 * session token, which is what creditGold and the credit_gold RPC take.
 *
 * It is NULLABLE for the one caller that genuinely does not have it: a duel
 * stakes both players (lib/server/pvp-match-service.ts), and the request that
 * opens a match carries only the acceptor's cookie -- the challenger has no
 * session in scope. Null routes the milestone credit through
 * creditGoldByProfile instead, which is the same row-locked RPC keyed on the
 * id this function already has. Passing a token when you have one is still
 * preferred: it is the identity the rest of the wallet is keyed on.
 *
 * Never throws into its caller's request. A settled arcade round or a completed
 * poker hand must not become a failed request because the XP write failed --
 * the same contract onHandCompleted states for stats and archives. The award is
 * lost in that case, which is the right trade: a player would rather keep the
 * hand than keep the XP.
 */
export async function awardWager(
  profileId: string,
  token: string | null,
  goldStaked: number,
  now: Date = new Date(),
): Promise<WagerAward | null> {
  const xp = xpForWager(goldStaked);
  // A sub-threshold stake still counts toward lifetime volume, but there is
  // nothing to write and no level it could cross.
  if (xp <= 0) return null;

  try {
    const supabase = adminClient();
    let previousXp: number;
    let newXp: number;

    if (!supabase) {
      const current = memoryProgression.get(profileId) ?? EMPTY_ROW;
      previousXp = current.xp;
      newXp = current.xp + xp;
      memoryProgression.set(profileId, {
        ...current,
        xp: newXp,
        lifetimeWagered: current.lifetimeWagered + Math.floor(goldStaked),
      });
    } else {
      const { data, error } = await supabase
        .rpc("award_progression_xp", {
          p_profile_id: profileId,
          p_xp: xp,
          p_wagered: Math.floor(goldStaked),
        })
        .single();
      if (error) throw new Error(`Could not award XP: ${error.message}`);
      const result = data as { previous_xp: number; new_xp: number };
      previousXp = Number(result.previous_xp);
      newXp = Number(result.new_xp);
    }

    const levelUps = rewardsBetween(levelForXp(previousXp), levelForXp(newXp));
    // The "rank up" mission's only hook: awardWager is already the single
    // funnel every wager-driven level-up passes through (poker, blackjack,
    // tips, PvP accept), so this is where it's detected rather than at each
    // of those call sites again. applyMissionEvent never throws.
    void applyMissionEvent(profileId, { kind: "level_gained", levels: levelUps.length });
    const owed = goldForLevelUps(levelForXp(previousXp), levelForXp(newXp));
    let goldAwarded = 0;
    let profile: PlayerProfile | null = null;
    if (owed > 0) {
      // Rule 1: the XP write above already happened, so this pays at most once
      // per crossing. A failure here loses the milestone Gold rather than
      // risking paying it twice on a retry -- and unlike the XP, it is visible,
      // because the level-up still shows.
      //
      // Both branches are the same guarded RPC on the same row, differing only
      // in which unique column addresses it; see the token note in the header.
      profile = token === null
        ? await creditGoldByProfile(profileId, owed)
        : await creditGold(token, owed);
      goldAwarded = owed;
    }

    const row = await readRow(profileId);
    return { levelUps, goldAwarded, xpAwarded: xp, progression: toSnapshot(row, now), profile };
  } catch {
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
 * reverse order would have to read the streak, credit, then write -- and a
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
