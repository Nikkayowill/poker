import "server-only";
import { randomUUID } from "crypto";
import { ensureProfile, getPublicProfilesByIds } from "./profile-store";
import { adminClient } from "./supabase-admin";
import type { GameState } from "@/lib/game/types";

export interface PlayerStats {
  profileId: string;
  handsPlayed: number;
  handsWon: number;
  vpipHands: number;
  netProfit: number;
  biggestPotWon: number;
}

export interface LeaderboardEntry extends PlayerStats {
  rank: number;
  displayName: string;
  avatarUrl: string | null;
  accent: string;
}

export interface SeasonInfo {
  id: string;
  startsAt: string;
  endsAt: string;
}

export type LeaderboardScope = "lifetime" | "season";

const emptyStats = (profileId: string): PlayerStats => ({
  profileId,
  handsPlayed: 0,
  handsWon: 0,
  vpipHands: 0,
  netProfit: 0,
  biggestPotWon: 0,
});

// ---- memory-mode mirror --------------------------------------------------
//
// Same twin-branch shape as every other store here: a real deployment writes
// through the Supabase RPCs below, and local/dev/test runs against an
// in-process approximation so the app and its tests do not require a live
// project. globalThis, not module scope, so it survives Next.js's dev-mode
// module reloads the same way lib/server/game-store.ts's maps do.

interface MemorySeasonStats extends PlayerStats {
  seasonId: string;
}

declare global {
  var __riverRoomHandResults: Set<string> | undefined;
  var __riverRoomPlayerStats: Map<string, PlayerStats> | undefined;
  var __riverRoomSeasons: { id: string; startsAt: number; endsAt: number; archived: boolean }[] | undefined;
  var __riverRoomSeasonStats: Map<string, MemorySeasonStats> | undefined;
}

const handResultKeys = globalThis.__riverRoomHandResults ?? new Set<string>();
globalThis.__riverRoomHandResults = handResultKeys;

const memoryPlayerStats = globalThis.__riverRoomPlayerStats ?? new Map<string, PlayerStats>();
globalThis.__riverRoomPlayerStats = memoryPlayerStats;

const SEASON_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

const memorySeasons = globalThis.__riverRoomSeasons ?? [
  { id: randomUUID(), startsAt: Date.now(), endsAt: Date.now() + SEASON_LENGTH_MS, archived: false },
];
globalThis.__riverRoomSeasons = memorySeasons;

const memorySeasonStats = globalThis.__riverRoomSeasonStats ?? new Map<string, MemorySeasonStats>();
globalThis.__riverRoomSeasonStats = memorySeasonStats;

function memoryActiveSeason() {
  const now = Date.now();
  return memorySeasons.find((season) => !season.archived && now >= season.startsAt && now < season.endsAt) ?? null;
}

function seasonStatsKey(seasonId: string, profileId: string) {
  return `${seasonId}:${profileId}`;
}

// ---- recording ------------------------------------------------------------

interface HandOutcome {
  profileId: string;
  won: boolean;
  amountWon: number;
  netProfit: number;
  vpip: boolean;
}

/**
 * Records every human seat's result for a hand that has just finished.
 *
 * Idempotent per (game, hand, profile) at the database layer -- see the
 * record_hand_result migration -- so it is safe to call from more than one
 * code path without a shared "have I already recorded this" flag here. That
 * matters because a hand can complete via either a human's own action or a
 * server-timed bot/timeout resolution, and both call sites call this.
 *
 * Deliberately best-effort: a stats failure must never surface as a failed
 * poker action. Callers wrap this in a catch that only logs.
 */
export async function recordHandStats(state: GameState): Promise<void> {
  const outcomes: HandOutcome[] = [];

  for (const seat of state.seats) {
    // Only seats actually dealt into this hand, and only real players --
    // bots have no profile to credit, and holeCards is empty for anyone who
    // was not in the hand (busted before it started, or seated after).
    if (!seat.isHuman || !seat.ownerToken || seat.holeCards.length === 0) continue;
    const winner = state.winners.find((candidate) => candidate.seatId === seat.id);
    const profile = await ensureProfile(seat.ownerToken);
    outcomes.push({
      profileId: profile.id,
      won: Boolean(winner),
      amountWon: winner?.amount ?? 0,
      netProfit: (winner?.amount ?? 0) - seat.committed,
      vpip: seat.vpip,
    });
  }

  if (outcomes.length === 0) return;

  const supabase = adminClient();
  if (!supabase) {
    for (const outcome of outcomes) {
      const key = `${state.id}:${state.handNumber}:${outcome.profileId}`;
      if (handResultKeys.has(key)) continue;
      handResultKeys.add(key);

      const current = memoryPlayerStats.get(outcome.profileId) ?? emptyStats(outcome.profileId);
      memoryPlayerStats.set(outcome.profileId, {
        ...current,
        handsPlayed: current.handsPlayed + 1,
        handsWon: current.handsWon + (outcome.won ? 1 : 0),
        vpipHands: current.vpipHands + (outcome.vpip ? 1 : 0),
        netProfit: current.netProfit + outcome.netProfit,
        biggestPotWon: Math.max(current.biggestPotWon, outcome.amountWon),
      });

      const season = memoryActiveSeason();
      if (season) {
        const sKey = seasonStatsKey(season.id, outcome.profileId);
        const currentSeason = memorySeasonStats.get(sKey) ?? { ...emptyStats(outcome.profileId), seasonId: season.id };
        memorySeasonStats.set(sKey, {
          ...currentSeason,
          handsPlayed: currentSeason.handsPlayed + 1,
          handsWon: currentSeason.handsWon + (outcome.won ? 1 : 0),
          vpipHands: currentSeason.vpipHands + (outcome.vpip ? 1 : 0),
          netProfit: currentSeason.netProfit + outcome.netProfit,
          biggestPotWon: Math.max(currentSeason.biggestPotWon, outcome.amountWon),
        });
      }
    }
    return;
  }

  for (const outcome of outcomes) {
    const { error } = await supabase.rpc("record_hand_result", {
      p_game_id: state.id,
      p_hand_number: state.handNumber,
      p_profile_id: outcome.profileId,
      p_won: outcome.won,
      p_amount_won: outcome.amountWon,
      p_net_profit: outcome.netProfit,
      p_vpip: outcome.vpip,
    });
    if (error) throw new Error(`Could not record hand result: ${error.message}`);
  }
}

// ---- reading ---------------------------------------------------------------

export async function getActiveSeason(): Promise<SeasonInfo | null> {
  const supabase = adminClient();
  if (!supabase) {
    const season = memoryActiveSeason();
    return season ? { id: season.id, startsAt: new Date(season.startsAt).toISOString(), endsAt: new Date(season.endsAt).toISOString() } : null;
  }
  const { data, error } = await supabase
    .from("seasons")
    .select("id, starts_at, ends_at")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Could not load the active season: ${error.message}`);
  return data ? { id: String(data.id), startsAt: String(data.starts_at), endsAt: String(data.ends_at) } : null;
}

async function decorate(rows: PlayerStats[]): Promise<LeaderboardEntry[]> {
  const profiles = await getPublicProfilesByIds(rows.map((row) => row.profileId));
  return rows.map((row, index) => {
    const profile = profiles.get(row.profileId);
    return {
      ...row,
      rank: index + 1,
      displayName: profile?.displayName ?? "Player",
      avatarUrl: profile?.avatarUrl ?? null,
      accent: profile?.accent ?? "#e7c66a",
    };
  });
}

export async function getLeaderboard(scope: LeaderboardScope, limit = 10): Promise<LeaderboardEntry[]> {
  const supabase = adminClient();
  if (!supabase) {
    if (scope === "lifetime") {
      const rows = [...memoryPlayerStats.values()].sort((a, b) => b.netProfit - a.netProfit).slice(0, limit);
      return decorate(rows);
    }
    const season = memoryActiveSeason();
    if (!season) return [];
    const rows = [...memorySeasonStats.values()]
      .filter((row) => row.seasonId === season.id)
      .sort((a, b) => b.netProfit - a.netProfit)
      .slice(0, limit)
      .map((row): PlayerStats => ({
        profileId: row.profileId,
        handsPlayed: row.handsPlayed,
        handsWon: row.handsWon,
        vpipHands: row.vpipHands,
        netProfit: row.netProfit,
        biggestPotWon: row.biggestPotWon,
      }));
    return decorate(rows);
  }

  if (scope === "lifetime") {
    const { data, error } = await supabase
      .from("player_stats")
      .select("*")
      .order("net_profit", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Could not load the leaderboard: ${error.message}`);
    return decorate((data ?? []).map(rowToPlayerStats));
  }

  const season = await getActiveSeason();
  if (!season) return [];
  const { data, error } = await supabase
    .from("season_stats")
    .select("*")
    .eq("season_id", season.id)
    .order("net_profit", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load the season leaderboard: ${error.message}`);
  return decorate((data ?? []).map(rowToPlayerStats));
}

function rowToPlayerStats(row: Record<string, unknown>): PlayerStats {
  return {
    profileId: String(row.profile_id),
    handsPlayed: Number(row.hands_played),
    handsWon: Number(row.hands_won),
    vpipHands: Number(row.vpip_hands ?? 0),
    netProfit: Number(row.net_profit),
    biggestPotWon: Number(row.biggest_pot_won),
  };
}

/**
 * A profile's own stats and rank, even when they are well outside the top of
 * the board -- "you are #482" is still worth showing on their own profile.
 */
export async function getPlayerStanding(
  profileId: string,
  scope: LeaderboardScope,
): Promise<{ stats: PlayerStats; rank: number | null } | null> {
  const supabase = adminClient();
  if (!supabase) {
    const stats = scope === "lifetime"
      ? memoryPlayerStats.get(profileId)
      : (() => {
        const season = memoryActiveSeason();
        return season ? memorySeasonStats.get(seasonStatsKey(season.id, profileId)) : undefined;
      })();
    if (!stats) return null;
    const all = scope === "lifetime"
      ? [...memoryPlayerStats.values()]
      : [...memorySeasonStats.values()].filter((row) => row.seasonId === memoryActiveSeason()?.id);
    const rank = 1 + all.filter((row) => row.netProfit > stats.netProfit).length;
    return { stats, rank };
  }

  const table = scope === "lifetime" ? "player_stats" : "season_stats";
  const filter = scope === "lifetime"
    ? supabase.from(table).select("*").eq("profile_id", profileId)
    : null;

  if (scope === "lifetime") {
    const { data, error } = await filter!.maybeSingle();
    if (error) throw new Error(`Could not load player stats: ${error.message}`);
    if (!data) return null;
    const stats = rowToPlayerStats(data);
    const { count, error: rankError } = await supabase
      .from("player_stats")
      .select("profile_id", { count: "exact", head: true })
      .gt("net_profit", stats.netProfit);
    if (rankError) throw new Error(`Could not compute rank: ${rankError.message}`);
    return { stats, rank: (count ?? 0) + 1 };
  }

  const season = await getActiveSeason();
  if (!season) return null;
  const { data, error } = await supabase
    .from("season_stats")
    .select("*")
    .eq("season_id", season.id)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not load season stats: ${error.message}`);
  if (!data) return null;
  const stats = rowToPlayerStats(data);
  const { count, error: rankError } = await supabase
    .from("season_stats")
    .select("profile_id", { count: "exact", head: true })
    .eq("season_id", season.id)
    .gt("net_profit", stats.netProfit);
  if (rankError) throw new Error(`Could not compute season rank: ${rankError.message}`);
  return { stats, rank: (count ?? 0) + 1 };
}

/**
 * Closes the active season if its 30-day window has passed and opens the
 * next one, archiving the top 10 with a permanent badge on the way. Meant to
 * be called on a schedule (see app/api/cron/rollover-season); safe to call
 * more often than that, since it is a no-op whenever nothing is due.
 */
export async function rolloverSeasonIfDue(): Promise<string | null> {
  const supabase = adminClient();
  if (!supabase) {
    const due = memorySeasons.find((season) => !season.archived && Date.now() >= season.endsAt);
    if (!due) return null;
    const rows = [...memorySeasonStats.values()]
      .filter((row) => row.seasonId === due.id)
      .sort((a, b) => b.netProfit - a.netProfit)
      .slice(0, 10);
    // Memory mode has no profile_badges table to mirror; the archive itself
    // (visible via a future season-results read, once one exists) is enough
    // for local/dev parity. What matters here is the rollover mechanics: the
    // season closes and exactly one new one opens.
    void rows;
    due.archived = true;
    memorySeasons.push({ id: randomUUID(), startsAt: due.endsAt, endsAt: due.endsAt + SEASON_LENGTH_MS, archived: false });
    return due.id;
  }
  const { data, error } = await supabase.rpc("rollover_season");
  if (error) throw new Error(`Could not roll over the season: ${error.message}`);
  return (data as string | null) ?? null;
}
