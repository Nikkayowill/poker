import "server-only";
import { stakePressure } from "@/lib/arcade/stake-pressure";
import { rewardsBetween, tierForPoints, type TierReward } from "@/lib/progression/rank";
import { EMPTY_BAND, rankPointsFrom, withoutResult, type BandTotals, type EarningsByBand } from "@/lib/progression/solo-earnings";
import type { PlayerProfile } from "@/lib/profile/types";
import { checkAchievements } from "./achievement-store";
import { applyMissionEvent } from "./mission-store";
import { creditGold, creditGoldByProfile } from "./profile-store";
import { adminClient } from "./supabase-admin";

/**
 * Solo earnings: records every settled PVE and solo wager, and moves rank with it.
 *
 * Rank is the difficulty-weighted net of these wagers (lib/progression/
 * solo-earnings.ts), so a loss costs points and a win adds them. Two ordering
 * rules, restated here because breaking either is a silent money bug:
 *
 *  1. **Record, then pay.** The result is written (idempotently, keyed on the
 *     attempt) before any milestone is claimed, and the milestone mark is moved
 *     up before its Gold goes out. A retried settle records nothing and pays
 *     nothing. A failure between the mark and the credit loses that milestone's
 *     Gold rather than risking paying it twice.
 *  2. **Tier Gold pays once, ever.** Rank can fall, so the same tier can be
 *     reached again. max_level_rewarded holds the highest tier number paid (the
 *     column predates tiers), only moves up, and only tiers above it are paid.
 *
 * Never throws into its caller. The attempt is already settled and its payout
 * already credited when this runs; a failed write here costs that one result its
 * place in the tally, not the player their round.
 */

export interface SoloResultInput {
  /** The game id, e.g. "sudoku" or "word-stack". */
  game: string;
  /** Unique per settled attempt; the idempotency key. Build it from the attempt id, or the profile and day for a daily board. */
  correlationId: string;
  /** The stake. Zero (free play) is never recorded. */
  wager: number;
  /** What the settle paid back. Zero for a loss. */
  payout: number;
}

export interface SoloResultOutcome {
  /** Tiers newly reached, in order. Empty on a loss or when nothing new was crossed. */
  tierUps: TierReward[];
  /** Gold actually credited for those tiers. */
  goldAwarded: number;
  /** The wallet after a milestone was paid, or null when nothing was. */
  profile: PlayerProfile | null;
}

export interface SoloState {
  /** Points the player began the solo-earnings rank with; see the migration. */
  base: number;
  byBand: EarningsByBand;
}

interface MemoryEntry {
  base: number;
  maxLevelRewarded: number; // highest tier number paid
  byBand: Record<number, BandTotals>;
}

declare global {
  var __riverRoomSoloEarnings: Map<string, MemoryEntry> | undefined;
  var __riverRoomSoloEvents: Set<string> | undefined;
}

const memory = globalThis.__riverRoomSoloEarnings ?? new Map<string, MemoryEntry>();
globalThis.__riverRoomSoloEarnings = memory;
const memoryEvents = globalThis.__riverRoomSoloEvents ?? new Set<string>();
globalThis.__riverRoomSoloEvents = memoryEvents;

/** Test-only reset. */
export function __resetSoloEarningsMemory(): void {
  memory.clear();
  memoryEvents.clear();
}

function entryFor(profileId: string): MemoryEntry {
  const existing = memory.get(profileId);
  if (existing) return existing;
  const fresh: MemoryEntry = { base: 0, maxLevelRewarded: 1, byBand: {} };
  memory.set(profileId, fresh);
  return fresh;
}

/** The base points and per-band totals rank is derived from. Safe for a player with no play. */
export async function readSoloState(profileId: string): Promise<SoloState> {
  const supabase = adminClient();
  if (!supabase) {
    const entry = memory.get(profileId);
    return entry ? { base: entry.base, byBand: { ...entry.byBand } } : { base: 0, byBand: {} };
  }

  const [progression, bands] = await Promise.all([
    supabase.from("player_progression").select("rank_base_points").eq("profile_id", profileId).maybeSingle(),
    supabase.from("solo_earnings_by_band").select("band, wins, losses, staked, paid_out").eq("profile_id", profileId),
  ]);
  if (progression.error) throw new Error(`Could not load rank base: ${progression.error.message}`);
  if (bands.error) throw new Error(`Could not load solo earnings: ${bands.error.message}`);

  const byBand: Record<number, BandTotals> = {};
  for (const row of bands.data ?? []) {
    byBand[Number(row.band)] = {
      wins: Number(row.wins),
      losses: Number(row.losses),
      staked: Number(row.staked),
      paidOut: Number(row.paid_out),
    };
  }
  return { base: Number(progression.data?.rank_base_points ?? 0), byBand };
}

/** Rows fetched per page when reading a whole table; Supabase caps a single select near 1,000. */
const PAGE_SIZE = 1000;

/**
 * Solo state for many players at once, for the rank boards. Read-only.
 *
 * `profileIds` limits it to those players, each present even with no play.
 * Null reads everyone who has anything to rank: a solo result on record or a
 * carried-over base above zero.
 */
export async function listSoloStates(profileIds: string[] | null): Promise<Map<string, SoloState>> {
  const states = new Map<string, { base: number; byBand: Record<number, BandTotals> }>();
  const stateFor = (id: string) => {
    const existing = states.get(id);
    if (existing) return existing;
    const fresh = { base: 0, byBand: {} as Record<number, BandTotals> };
    states.set(id, fresh);
    return fresh;
  };
  if (profileIds) for (const id of profileIds) stateFor(id);
  const wanted = profileIds ? new Set(profileIds) : null;

  const supabase = adminClient();
  if (!supabase) {
    for (const [id, entry] of memory) {
      if (wanted && !wanted.has(id)) continue;
      const state = stateFor(id);
      state.base = entry.base;
      state.byBand = { ...entry.byBand };
    }
    return states;
  }

  if (wanted && wanted.size === 0) return states;

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("solo_earnings_by_band")
      .select("profile_id, band, wins, losses, staked, paid_out")
      .order("profile_id")
      .order("band")
      .range(from, from + PAGE_SIZE - 1);
    if (profileIds) query = query.in("profile_id", profileIds);
    const { data, error } = await query;
    if (error) throw new Error(`Could not load solo earnings: ${error.message}`);
    for (const row of data ?? []) {
      stateFor(String(row.profile_id)).byBand[Number(row.band)] = {
        wins: Number(row.wins),
        losses: Number(row.losses),
        staked: Number(row.staked),
        paidOut: Number(row.paid_out),
      };
    }
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("player_progression")
      .select("profile_id, rank_base_points")
      .order("profile_id")
      .range(from, from + PAGE_SIZE - 1);
    query = profileIds ? query.in("profile_id", profileIds) : query.gt("rank_base_points", 0);
    const { data, error } = await query;
    if (error) throw new Error(`Could not load rank base: ${error.message}`);
    for (const row of data ?? []) stateFor(String(row.profile_id)).base = Number(row.rank_base_points);
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return states;
}

/** Writes the event and bumps its band. Returns false for an event already recorded. */
async function insertEvent(profileId: string, input: SoloResultInput, band: number): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    if (memoryEvents.has(input.correlationId)) return false;
    memoryEvents.add(input.correlationId);
    const entry = entryFor(profileId);
    const current = entry.byBand[band] ?? EMPTY_BAND;
    const won = input.payout > 0;
    entry.byBand[band] = {
      wins: current.wins + (won ? 1 : 0),
      losses: current.losses + (won ? 0 : 1),
      staked: current.staked + input.wager,
      paidOut: current.paidOut + input.payout,
    };
    return true;
  }

  const { data, error } = await supabase
    .rpc("record_solo_result", {
      p_profile_id: profileId,
      p_correlation_id: input.correlationId,
      p_game: input.game,
      p_band: band,
      p_wager: Math.floor(input.wager),
      p_payout: Math.floor(input.payout),
    })
    .single();
  if (error) throw new Error(`Could not record solo result: ${error.message}`);
  return Boolean((data as { recorded: boolean }).recorded);
}

/** Moves the rewarded mark up to tier number `tier` and returns where it was. */
async function claimMilestones(profileId: string, tier: number): Promise<number> {
  const supabase = adminClient();
  if (!supabase) {
    const entry = entryFor(profileId);
    const previous = entry.maxLevelRewarded;
    if (tier > previous) entry.maxLevelRewarded = tier;
    return previous;
  }
  const { data, error } = await supabase.rpc("claim_rank_milestones", { p_profile_id: profileId, p_level: tier }).single();
  if (error) throw new Error(`Could not claim rank milestones: ${error.message}`);
  return Number((data as { previous_level: number }).previous_level);
}

/**
 * Records one settled solo wager and pays any tier it newly reached.
 *
 * `token` is the caller's session token when it has one, else null and the
 * credit goes through the by-profile RPC; same split awardWager made.
 * Returns null for free play, a duplicate settle, or a failure.
 */
export async function recordSoloResult(
  profileId: string,
  token: string | null,
  input: SoloResultInput,
): Promise<SoloResultOutcome | null> {
  if (!Number.isFinite(input.wager) || input.wager <= 0) return null;
  const payout = Number.isFinite(input.payout) && input.payout > 0 ? input.payout : 0;

  try {
    const band = stakePressure(input.wager);
    const recorded = await insertEvent(profileId, { ...input, payout }, band);
    if (!recorded) return null;

    const state = await readSoloState(profileId);
    const points = rankPointsFrom(state.base, state.byBand);
    const pointsBefore = rankPointsFrom(state.base, withoutResult(state.byBand, band, input.wager, payout));
    if (points > pointsBefore) await applyMissionEvent(profileId, { kind: "rank_points_gained", points: points - pointsBefore });

    const tier = tierForPoints(points).number;
    const previousTier = await claimMilestones(profileId, tier);
    const tierUps = rewardsBetween(previousTier, tier);
    if (tierUps.length === 0) return { tierUps: [], goldAwarded: 0, profile: null };

    try {
      await checkAchievements([profileId]);
    } catch (error) {
      console.error("achievements.tier_check_failed", { profileId, error });
    }

    const owed = tierUps.reduce((sum, reward) => sum + reward.gold, 0);
    let profile: PlayerProfile | null = null;
    if (owed > 0) {
      profile = token === null ? await creditGoldByProfile(profileId, owed) : await creditGold(token, owed);
    }
    return { tierUps, goldAwarded: owed, profile };
  } catch (error) {
    console.error("solo-earnings.record_failed", { profileId, game: input.game, error });
    return null;
  }
}
