import "server-only";
import { missionSignalsForEvent, type MissionEvent } from "@/lib/missions/events";
import { utcDayKey, utcWeekKey } from "@/lib/missions/period";
import type { MissionCadence, MissionDefinition, MissionsPayload, MissionView } from "@/lib/missions/types";
import { creditGoldByProfile } from "./profile-store";
import { adminClient } from "./supabase-admin";
import { createTtlCache } from "./ttl-cache";

/**
 * Missions: daily and weekly objectives, auto-credited the instant they
 * complete. There is no claim step, unlike the daily Gold grant. A player
 * has already done the work (played the hand, won the duel) by the time a
 * mission completes, and gating a reward they already earned behind a second
 * tap would add friction the feature exists to remove. See the migration
 * (20260814120000_missions.sql) for the reward ledger's idempotency
 * guarantee, which is what makes auto-crediting safe against a retry.
 *
 * This module is the only thing that calls apply_mission_progress and
 * grant_mission_reward, the same "one funnel" shape lib/server/
 * progression-store.ts keeps for award_progression_xp.
 */

// ---- catalog ----------------------------------------------------------
//
// Mirrors the seed insert in supabase/migrations/20260814120000_missions.sql.
// Real Postgres reads its own mission_definitions table, which is what makes
// the catalog admin-tunable without a deploy; this is the memory-mode
// fallback and what tests seed against, kept in step with the migration by
// hand, the same duplication every memory-mode store here carries against
// its own table's defaults.

// Reward amounts bumped roughly 3x in supabase/migrations/
// 20260820130000_mission_achievement_reward_bumps.sql, for play-driven Gold
// income specifically, so an active player can climb the stakes ladder
// without ever buying Gold. Keep this array's numbers matching that
// migration's UPDATE statements exactly.
//
// `daily_brain_game` (300 Gold, once/day across any one puzzle) was retired
// in supabase/migrations/20260821130000_ante_up_unify_brain_games.sql,
// replaced by a per-game skill-scored daily bonus. See
// lib/server/daily-puzzle-bonus.ts. Left out of this array entirely rather
// than kept-but-disabled: this array is the memory-mode/test mirror of the
// live catalog, which already excludes it via `enabled = false`.
const DEFAULT_DEFINITIONS: MissionDefinition[] = [
  { code: "daily_play_hands", cadence: "daily", metric: "poker_hands_played", target: 5, rewardGold: 450, dedupeDaily: false, title: "Play five poker hands", description: "Sit in and see five hands to showdown or fold.", sortOrder: 10 },
  { code: "daily_win_duels", cadence: "daily", metric: "duels_won", target: 3, rewardGold: 450, dedupeDaily: false, title: "Win three duels", description: "Win three PvP duels — any game.", sortOrder: 20 },
  { code: "daily_multiplayer", cadence: "daily", metric: "multiplayer_hands_played", target: 1, rewardGold: 450, dedupeDaily: false, title: "Play with real players", description: "Play a poker hand at a table with another real player.", sortOrder: 40 },
  { code: "weekly_win_duels", cadence: "weekly", metric: "duels_won", target: 10, rewardGold: 3000, dedupeDaily: false, title: "Win ten duels", description: "Win ten PvP duels this week.", sortOrder: 10 },
  { code: "weekly_active_days", cadence: "weekly", metric: "active_day", target: 5, rewardGold: 3600, dedupeDaily: true, title: "Show up five days", description: "Play something on five separate days this week.", sortOrder: 20 },
  { code: "weekly_cross_category", cadence: "weekly", metric: "games_played_any", target: 20, rewardGold: 4500, dedupeDaily: false, title: "Play twenty games", description: "Complete twenty games across poker, duels and brain games.", sortOrder: 30 },
  { code: "weekly_level_up", cadence: "weekly", metric: "levels_gained", target: 1, rewardGold: 2400, dedupeDaily: false, title: "Rank up", description: "Gain a rank level this week.", sortOrder: 40 },
];

// ---- memory-mode mirror -------------------------------------------------
//
// Twin branches, same as every other store here. globalThis so the maps
// survive Next.js' dev-mode module reloads.

interface ProgressRow {
  progress: number;
  lastProgressDay: string | null;
  completedAt: string | null;
}

declare global {
  var __riverRoomMissionProgress: Map<string, ProgressRow> | undefined;
  var __riverRoomMissionGrants: Set<string> | undefined;
}

const memoryProgress = globalThis.__riverRoomMissionProgress ?? new Map<string, ProgressRow>();
globalThis.__riverRoomMissionProgress = memoryProgress;
const memoryGrants = globalThis.__riverRoomMissionGrants ?? new Set<string>();
globalThis.__riverRoomMissionGrants = memoryGrants;

/** Test-only reset. */
export function __resetMissionMemory(): void {
  memoryProgress.clear();
  memoryGrants.clear();
}

function progressKey(profileId: string, code: string, period: string): string {
  return `${profileId}:${code}:${period}`;
}

// ---- catalog reads --------------------------------------------------------
//
// Cached briefly in-process: ~8 rows, re-read on every mission event
// otherwise, and the catalog changes by migration/admin action, not by the
// second.

const CATALOG_CACHE_MS = 2 * 60 * 1000;
const catalogCache = createTtlCache<MissionDefinition[]>(CATALOG_CACHE_MS);

async function loadCatalog(now: number): Promise<MissionDefinition[]> {
  const cached = catalogCache.read(now);
  if (cached) return cached;

  const supabase = adminClient();
  if (!supabase) {
    catalogCache.write(DEFAULT_DEFINITIONS, now);
    return DEFAULT_DEFINITIONS;
  }

  const { data, error } = await supabase
    .from("mission_definitions")
    .select("code, cadence, metric, target, reward_gold, dedupe_daily, title, description, sort_order, starts_at, ends_at")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Could not load missions: ${error.message}`);

  const nowIso = new Date(now).toISOString();
  const rows: MissionDefinition[] = (data ?? [])
    .filter((row) => (!row.starts_at || row.starts_at <= nowIso) && (!row.ends_at || row.ends_at >= nowIso))
    .map((row) => ({
      code: row.code as string,
      cadence: row.cadence as MissionCadence,
      metric: row.metric as string,
      target: Number(row.target),
      rewardGold: Number(row.reward_gold),
      dedupeDaily: Boolean(row.dedupe_daily),
      title: row.title as string,
      description: row.description as string,
      sortOrder: Number(row.sort_order),
    }));

  catalogCache.write(rows, now);
  return rows;
}

function periodStartFor(cadence: MissionCadence, now: Date): string {
  return cadence === "daily" ? utcDayKey(now) : utcWeekKey(now);
}

/** ISO instant a period ends, for the "resets in..." readout. */
function periodEndFor(cadence: MissionCadence, periodStart: string): string {
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() + (cadence === "daily" ? 1 : 7));
  return start.toISOString();
}

// ---- progress reads ---------------------------------------------------

async function readProgressRows(
  profileId: string,
  codes: string[],
  period: string,
): Promise<Map<string, { progress: number; completedAt: string | null }>> {
  const result = new Map<string, { progress: number; completedAt: string | null }>();
  if (codes.length === 0) return result;

  const supabase = adminClient();
  if (!supabase) {
    for (const code of codes) {
      const row = memoryProgress.get(progressKey(profileId, code, period));
      if (row) result.set(code, { progress: row.progress, completedAt: row.completedAt });
    }
    return result;
  }

  const { data, error } = await supabase
    .from("player_mission_progress")
    .select("mission_code, progress, completed_at")
    .eq("profile_id", profileId)
    .eq("period_start", period)
    .in("mission_code", codes);
  if (error) throw new Error(`Could not load mission progress: ${error.message}`);
  for (const row of data ?? []) {
    result.set(row.mission_code as string, {
      progress: Number(row.progress),
      completedAt: row.completed_at as string | null,
    });
  }
  return result;
}

/** Where the player stands on every active mission, split by cadence. */
export async function getMissionsView(profileId: string, now: Date = new Date()): Promise<MissionsPayload> {
  const catalog = await loadCatalog(now.getTime());
  const dailyDefs = catalog.filter((definition) => definition.cadence === "daily");
  const weeklyDefs = catalog.filter((definition) => definition.cadence === "weekly");
  const dailyPeriod = utcDayKey(now);
  const weeklyPeriod = utcWeekKey(now);

  const [dailyRows, weeklyRows] = await Promise.all([
    readProgressRows(profileId, dailyDefs.map((definition) => definition.code), dailyPeriod),
    readProgressRows(profileId, weeklyDefs.map((definition) => definition.code), weeklyPeriod),
  ]);

  const toView = (
    definition: MissionDefinition,
    period: string,
    rows: Map<string, { progress: number; completedAt: string | null }>,
  ): MissionView => {
    const row = rows.get(definition.code) ?? { progress: 0, completedAt: null };
    return {
      code: definition.code,
      cadence: definition.cadence,
      title: definition.title,
      description: definition.description,
      progress: row.progress,
      target: definition.target,
      rewardGold: definition.rewardGold,
      completed: row.completedAt !== null,
      periodEnd: periodEndFor(definition.cadence, period),
    };
  };

  return {
    daily: dailyDefs.map((definition) => toView(definition, dailyPeriod, dailyRows)),
    weekly: weeklyDefs.map((definition) => toView(definition, weeklyPeriod, weeklyRows)),
  };
}

// ---- writes -------------------------------------------------------------

async function applyOne(
  profileId: string,
  definition: MissionDefinition,
  delta: number,
  now: Date,
): Promise<{ newlyCompleted: boolean }> {
  const period = periodStartFor(definition.cadence, now);
  const eventDay = utcDayKey(now);

  const supabase = adminClient();
  if (!supabase) {
    const key = progressKey(profileId, definition.code, period);
    const current = memoryProgress.get(key) ?? { progress: 0, lastProgressDay: null, completedAt: null };
    if (current.completedAt) return { newlyCompleted: false };
    if (definition.dedupeDaily && current.lastProgressDay === eventDay) return { newlyCompleted: false };
    const next = Math.min(definition.target, current.progress + delta);
    const completed = next >= definition.target;
    memoryProgress.set(key, {
      progress: next,
      lastProgressDay: definition.dedupeDaily ? eventDay : current.lastProgressDay,
      completedAt: completed ? now.toISOString() : current.completedAt,
    });
    return { newlyCompleted: completed };
  }

  const { data, error } = await supabase
    .rpc("apply_mission_progress", {
      p_profile_id: profileId,
      p_mission_code: definition.code,
      p_period_start: period,
      p_delta: delta,
      p_event_day: eventDay,
    })
    // maybeSingle, not single: the RPC does a bare `return;` (zero rows) when
    // the mission is unknown, disabled, or outside its active window, a
    // no-op rather than an error. .single() would throw on that zero-row
    // case, turning a mission the catalog cache hasn't caught up on yet into
    // a swallowed error instead of the silent no-op it's meant to be.
    .maybeSingle();
  if (error) throw new Error(`Could not update mission progress: ${error.message}`);
  const result = data as { newly_completed: boolean } | null;
  return { newlyCompleted: Boolean(result?.newly_completed) };
}

async function grantOne(profileId: string, definition: MissionDefinition, now: Date): Promise<void> {
  const period = periodStartFor(definition.cadence, now);

  const supabase = adminClient();
  if (!supabase) {
    const key = `mission:${definition.code}:${profileId}:${period}`;
    if (memoryGrants.has(key)) return;
    // Mark granted only after the credit succeeds; marking it first and
    // crediting second would lose the reward for good if creditGoldByProfile
    // throws, since a retry would then see the key already claimed.
    await creditGoldByProfile(profileId, definition.rewardGold);
    memoryGrants.add(key);
    return;
  }

  const { error } = await supabase.rpc("grant_mission_reward", {
    p_profile_id: profileId,
    p_mission_code: definition.code,
    p_period_start: period,
    p_gold_amount: definition.rewardGold,
  });
  if (error) throw new Error(`Could not grant mission reward: ${error.message}`);
}

/**
 * Applies one domain event to every matching mission, crediting Gold the
 * moment any of them completes.
 *
 * Never throws, the same contract awardWager keeps: a mission bug must not
 * turn a completed hand, duel or puzzle into a failed request. The reward is
 * lost in that case, which is the same trade-off awardWager makes: a player
 * would rather keep the result than keep the mission credit.
 */
export async function applyMissionEvent(
  profileId: string,
  event: MissionEvent,
  now: Date = new Date(),
): Promise<void> {
  try {
    const signals = missionSignalsForEvent(event);
    if (signals.length === 0) return;

    const catalog = await loadCatalog(now.getTime());
    await Promise.all(
      signals.flatMap((signal) =>
        catalog
          .filter((definition) => definition.metric === signal.metric)
          .map(async (definition) => {
            const result = await applyOne(profileId, definition, signal.delta, now);
            if (result.newlyCompleted) await grantOne(profileId, definition, now);
          }),
      ),
    );
  } catch (error) {
    console.error("missions.apply_event_failed", { profileId, event, error });
  }
}
