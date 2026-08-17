import "server-only";
import { achievementCountersForEvent } from "@/lib/achievements/events";
import type {
  AchievementCategory,
  AchievementDefinition,
  AchievementSourceKind,
  AchievementsPayload,
  AchievementView,
} from "@/lib/achievements/types";
import type { DomainEvent } from "@/lib/domain-events";
import { awardCosmetic } from "./cosmetics-store";
import { creditGoldByProfile } from "./profile-store";
import { getProgression } from "./progression-store";
import { getPlayerStanding, type PlayerStats } from "./stats-store";
import { adminClient } from "./supabase-admin";

/**
 * Achievements: permanent, one-time Gold and cosmetic rewards for lifetime
 * milestones -- hands played, hands won, net profit, biggest pot, chips won,
 * duels won, brain games completed, rank reached. Unlike missions, nothing
 * here has a period: a tier crossed stays crossed, and there is no reset.
 *
 * This module is the only thing that calls apply_achievement_counter and
 * grant_achievement_reward, the same "one funnel" shape lib/server/
 * mission-store.ts keeps for its own RPCs.
 */

// ---- catalog ----------------------------------------------------------
//
// Mirrors the seed insert in supabase/migrations/20260817120000_achievements.sql.
// Real Postgres reads its own achievement_definitions table; this is the
// memory-mode fallback, kept in step with the migration by hand -- the same
// duplication every memory-mode store here carries against its own table's
// defaults.

const DEFAULT_DEFINITIONS: AchievementDefinition[] = [
  { code: "hands_played_100", category: "hands_played", tier: 1, sourceKind: "stat", metric: "hands_played", threshold: 100, rewardGold: 300, rewardCosmeticId: null, title: "Ante Up", description: "Play 100 hands.", sortOrder: 11 },
  { code: "hands_played_1000", category: "hands_played", tier: 2, sourceKind: "stat", metric: "hands_played", threshold: 1000, rewardGold: 1500, rewardCosmeticId: "back-riverwood", title: "Regular", description: "Play 1,000 hands in this room.", sortOrder: 12 },
  { code: "hands_played_10000", category: "hands_played", tier: 3, sourceKind: "stat", metric: "hands_played", threshold: 10000, rewardGold: 15000, rewardCosmeticId: null, title: "Lifer", description: "Play 10,000 hands in this room.", sortOrder: 13 },

  { code: "hands_won_50", category: "hands_won", tier: 1, sourceKind: "stat", metric: "hands_won", threshold: 50, rewardGold: 300, rewardCosmeticId: null, title: "First Blood", description: "Win 50 hands.", sortOrder: 21 },
  { code: "hands_won_500", category: "hands_won", tier: 2, sourceKind: "stat", metric: "hands_won", threshold: 500, rewardGold: 1500, rewardCosmeticId: null, title: "Sharp", description: "Win 500 hands.", sortOrder: 22 },
  { code: "hands_won_5000", category: "hands_won", tier: 3, sourceKind: "stat", metric: "hands_won", threshold: 5000, rewardGold: 15000, rewardCosmeticId: null, title: "Grinder's Edge", description: "Win 5,000 hands.", sortOrder: 23 },

  { code: "net_profit_10k", category: "net_profit", tier: 1, sourceKind: "stat", metric: "net_profit", threshold: 10000, rewardGold: 500, rewardCosmeticId: null, title: "In The Black", description: "Reach 10,000 lifetime net profit.", sortOrder: 31 },
  { code: "net_profit_100k", category: "net_profit", tier: 2, sourceKind: "stat", metric: "net_profit", threshold: 100000, rewardGold: 3000, rewardCosmeticId: null, title: "Building A Bankroll", description: "Reach 100,000 lifetime net profit.", sortOrder: 32 },
  { code: "net_profit_1m", category: "net_profit", tier: 3, sourceKind: "stat", metric: "net_profit", threshold: 1000000, rewardGold: 25000, rewardCosmeticId: null, title: "High Roller", description: "Reach 1,000,000 lifetime net profit.", sortOrder: 33 },

  { code: "biggest_pot_10k", category: "biggest_pot_won", tier: 1, sourceKind: "stat", metric: "biggest_pot_won", threshold: 10000, rewardGold: 500, rewardCosmeticId: null, title: "Nice Pot", description: "Win a single pot of 10,000 chips or more.", sortOrder: 41 },
  // rewardCosmeticId was "avatar-housename" until the illustrated 2D avatar
  // roster it named was retired in favor of the seat-art-backed catalog --
  // Gold-only until a replacement cosmetic exists to name this tier after.
  { code: "biggest_pot_50k", category: "biggest_pot_won", tier: 2, sourceKind: "stat", metric: "biggest_pot_won", threshold: 50000, rewardGold: 3000, rewardCosmeticId: null, title: "House Name", description: "Win a single high-stakes pot of 50,000 chips or more.", sortOrder: 42 },
  { code: "biggest_pot_250k", category: "biggest_pot_won", tier: 3, sourceKind: "stat", metric: "biggest_pot_won", threshold: 250000, rewardGold: 25000, rewardCosmeticId: null, title: "The Big One", description: "Win a single pot of 250,000 chips or more.", sortOrder: 43 },

  { code: "chips_won_100k", category: "total_chips_won", tier: 1, sourceKind: "stat", metric: "total_chips_won", threshold: 100000, rewardGold: 300, rewardCosmeticId: null, title: "Getting Started", description: "Win 100,000 chips lifetime.", sortOrder: 51 },
  { code: "chips_won_1m", category: "total_chips_won", tier: 2, sourceKind: "stat", metric: "total_chips_won", threshold: 1000000, rewardGold: 1500, rewardCosmeticId: null, title: "Millionaire", description: "Win 1,000,000 chips lifetime.", sortOrder: 52 },
  { code: "chips_won_10m", category: "total_chips_won", tier: 3, sourceKind: "stat", metric: "total_chips_won", threshold: 10000000, rewardGold: 15000, rewardCosmeticId: null, title: "Empire", description: "Win 10,000,000 chips lifetime.", sortOrder: 53 },

  { code: "duels_won_10", category: "duels_won", tier: 1, sourceKind: "counter", metric: "duels_won", threshold: 10, rewardGold: 500, rewardCosmeticId: null, title: "Duelist", description: "Win 10 PvP duels.", sortOrder: 61 },
  { code: "duels_won_50", category: "duels_won", tier: 2, sourceKind: "counter", metric: "duels_won", threshold: 50, rewardGold: 2500, rewardCosmeticId: null, title: "Gunslinger", description: "Win 50 PvP duels.", sortOrder: 62 },
  { code: "duels_won_250", category: "duels_won", tier: 3, sourceKind: "counter", metric: "duels_won", threshold: 250, rewardGold: 20000, rewardCosmeticId: null, title: "Undefeated", description: "Win 250 PvP duels.", sortOrder: 63 },

  { code: "puzzles_completed_10", category: "puzzles_completed", tier: 1, sourceKind: "counter", metric: "puzzles_completed", threshold: 10, rewardGold: 300, rewardCosmeticId: null, title: "Warming Up", description: "Complete 10 brain games.", sortOrder: 71 },
  { code: "puzzles_completed_100", category: "puzzles_completed", tier: 2, sourceKind: "counter", metric: "puzzles_completed", threshold: 100, rewardGold: 1500, rewardCosmeticId: null, title: "Puzzle Regular", description: "Complete 100 brain games.", sortOrder: 72 },
  { code: "puzzles_completed_500", category: "puzzles_completed", tier: 3, sourceKind: "counter", metric: "puzzles_completed", threshold: 500, rewardGold: 12000, rewardCosmeticId: null, title: "Puzzle Master", description: "Complete 500 brain games.", sortOrder: 73 },

  { code: "level_10", category: "levels_gained", tier: 1, sourceKind: "live", metric: "profile_level", threshold: 10, rewardGold: 500, rewardCosmeticId: null, title: "On The Board", description: "Reach level 10.", sortOrder: 81 },
  { code: "level_25", category: "levels_gained", tier: 2, sourceKind: "live", metric: "profile_level", threshold: 25, rewardGold: 2500, rewardCosmeticId: null, title: "Made Man", description: "Reach level 25.", sortOrder: 82 },
  { code: "level_50", category: "levels_gained", tier: 3, sourceKind: "live", metric: "profile_level", threshold: 50, rewardGold: 20000, rewardCosmeticId: null, title: "Legend Of The Room", description: "Reach level 50.", sortOrder: 83 },
];

// ---- memory-mode mirror -------------------------------------------------
//
// Twin branches, same as every other store here. globalThis so the maps
// survive Next.js' dev-mode module reloads.

declare global {
  var __riverRoomAchievementCounters: Map<string, number> | undefined;
  var __riverRoomAchievementGrants: Map<string, string> | undefined;
}

const memoryCounters = globalThis.__riverRoomAchievementCounters ?? new Map<string, number>();
globalThis.__riverRoomAchievementCounters = memoryCounters;
const memoryGrants = globalThis.__riverRoomAchievementGrants ?? new Map<string, string>();
globalThis.__riverRoomAchievementGrants = memoryGrants;

/** Test-only reset. */
export function __resetAchievementMemory(): void {
  memoryCounters.clear();
  memoryGrants.clear();
}

function counterKey(profileId: string, metric: string): string {
  return `${profileId}:${metric}`;
}

function grantKey(profileId: string, code: string): string {
  return `${profileId}:${code}`;
}

// ---- catalog reads --------------------------------------------------------

let cachedCatalog: { at: number; rows: AchievementDefinition[] } | null = null;
const CATALOG_CACHE_MS = 2 * 60 * 1000;

async function loadCatalog(now: number): Promise<AchievementDefinition[]> {
  if (cachedCatalog && now - cachedCatalog.at < CATALOG_CACHE_MS) return cachedCatalog.rows;

  const supabase = adminClient();
  if (!supabase) {
    cachedCatalog = { at: now, rows: DEFAULT_DEFINITIONS };
    return DEFAULT_DEFINITIONS;
  }

  const { data, error } = await supabase
    .from("achievement_definitions")
    .select("code, category, tier, source_kind, metric, threshold, reward_gold, reward_cosmetic_id, title, description, sort_order")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Could not load achievements: ${error.message}`);

  const rows: AchievementDefinition[] = (data ?? []).map((row) => ({
    code: row.code as string,
    category: row.category as AchievementCategory,
    tier: Number(row.tier) as 1 | 2 | 3,
    sourceKind: row.source_kind as AchievementSourceKind,
    metric: row.metric as string,
    threshold: Number(row.threshold),
    rewardGold: Number(row.reward_gold),
    rewardCosmeticId: (row.reward_cosmetic_id as string | null) ?? null,
    title: row.title as string,
    description: row.description as string,
    sortOrder: Number(row.sort_order),
  }));

  cachedCatalog = { at: now, rows };
  return rows;
}

// ---- per-player reads -----------------------------------------------------

/** Every achievement this profile has already been granted, code -> awardedAt ISO. */
async function grantedCodes(profileId: string): Promise<Map<string, string>> {
  const supabase = adminClient();
  if (!supabase) {
    const result = new Map<string, string>();
    for (const [key, awardedAt] of memoryGrants) {
      if (key.startsWith(`${profileId}:`)) result.set(key.slice(profileId.length + 1), awardedAt);
    }
    return result;
  }

  const { data, error } = await supabase
    .from("achievement_grants")
    .select("achievement_code, awarded_at")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not load your achievements: ${error.message}`);
  return new Map((data ?? []).map((row) => [String(row.achievement_code), String(row.awarded_at)]));
}

/** Lifetime counter values for exactly the metrics asked for. */
async function readCounters(profileId: string, metrics: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (metrics.length === 0) return result;

  const supabase = adminClient();
  if (!supabase) {
    for (const metric of metrics) {
      const value = memoryCounters.get(counterKey(profileId, metric));
      if (value !== undefined) result.set(metric, value);
    }
    return result;
  }

  const { data, error } = await supabase
    .from("player_lifetime_counters")
    .select("metric, count")
    .eq("profile_id", profileId)
    .in("metric", metrics);
  if (error) throw new Error(`Could not load your achievement progress: ${error.message}`);
  for (const row of data ?? []) result.set(String(row.metric), Number(row.count));
  return result;
}

/** What this profile currently stands at against one definition's metric. */
function currentValueFor(
  definition: AchievementDefinition,
  standing: { stats: PlayerStats } | null,
  level: number | null,
  counters: Map<string, number>,
): number {
  if (definition.sourceKind === "stat") {
    if (!standing) return 0;
    switch (definition.metric) {
      case "hands_played": return standing.stats.handsPlayed;
      case "hands_won": return standing.stats.handsWon;
      case "net_profit": return standing.stats.netProfit;
      case "biggest_pot_won": return standing.stats.biggestPotWon;
      case "total_chips_won": return standing.stats.totalChipsWon;
      default: return 0;
    }
  }
  if (definition.sourceKind === "live") return level ?? 0;
  return counters.get(definition.metric) ?? 0;
}

/** Batches the three possible data sources a catalog subset can need. */
async function readSources(
  profileId: string,
  definitions: AchievementDefinition[],
): Promise<{ standing: { stats: PlayerStats } | null; level: number | null; counters: Map<string, number> }> {
  const needsStat = definitions.some((definition) => definition.sourceKind === "stat");
  const needsLive = definitions.some((definition) => definition.sourceKind === "live");
  const counterMetrics = [...new Set(
    definitions.filter((definition) => definition.sourceKind === "counter").map((definition) => definition.metric),
  )];

  const [standing, level, counters] = await Promise.all([
    needsStat ? getPlayerStanding(profileId, "lifetime") : Promise.resolve(null),
    needsLive ? getProgression(profileId).then((progression) => progression.level) : Promise.resolve(null),
    readCounters(profileId, counterMetrics),
  ]);

  return { standing, level, counters };
}

/** Where the player stands on every achievement, unlocked or not. */
export async function getAchievementsView(profileId: string, now: Date = new Date()): Promise<AchievementsPayload> {
  const catalog = await loadCatalog(now.getTime());
  const [granted, sources] = await Promise.all([grantedCodes(profileId), readSources(profileId, catalog)]);

  const achievements: AchievementView[] = catalog.map((definition) => {
    const current = currentValueFor(definition, sources.standing, sources.level, sources.counters);
    const unlockedAt = granted.get(definition.code) ?? null;
    return {
      code: definition.code,
      category: definition.category,
      tier: definition.tier,
      title: definition.title,
      description: definition.description,
      progress: Math.max(0, Math.min(current, definition.threshold)),
      threshold: definition.threshold,
      rewardGold: definition.rewardGold,
      rewardCosmeticId: definition.rewardCosmeticId,
      unlocked: unlockedAt !== null,
      unlockedAt,
    };
  });

  return {
    achievements,
    unlockedCount: achievements.filter((achievement) => achievement.unlocked).length,
    totalCount: achievements.length,
  };
}

// ---- writes -------------------------------------------------------------

async function bumpCounter(profileId: string, metric: string, delta: number): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const key = counterKey(profileId, metric);
    memoryCounters.set(key, (memoryCounters.get(key) ?? 0) + delta);
    return;
  }

  const { error } = await supabase.rpc("apply_achievement_counter", {
    p_profile_id: profileId,
    p_metric: metric,
    p_delta: delta,
  });
  if (error) throw new Error(`Could not update achievement progress: ${error.message}`);
}

async function grantOne(profileId: string, definition: AchievementDefinition, now: Date): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const key = grantKey(profileId, definition.code);
    if (memoryGrants.has(key)) return;
    // Side effects first, mark granted only after they succeed -- marking it
    // first and crediting/awarding second would lose the reward for good if
    // either throws, since a retry would then see the key already claimed.
    if (definition.rewardCosmeticId) await awardCosmetic(profileId, definition.rewardCosmeticId);
    if (definition.rewardGold > 0) await creditGoldByProfile(profileId, definition.rewardGold);
    memoryGrants.set(key, now.toISOString());
    return;
  }

  const { error } = await supabase.rpc("grant_achievement_reward", {
    p_profile_id: profileId,
    p_achievement_code: definition.code,
    p_gold_amount: definition.rewardGold,
    p_cosmetic_id: definition.rewardCosmeticId,
  });
  if (error) throw new Error(`Could not grant achievement reward: ${error.message}`);
}

/**
 * Grants any achievement in the catalog these profiles have just crossed the
 * threshold for. Mirrors lib/server/avatar-unlocks.ts's checkAvatarUnlocks
 * exactly: no internal try/catch, callers isolate it the same way
 * hand-completion.ts isolates checkAvatarUnlocks -- an achievement bug must
 * never surface as a broken poker action, duel or puzzle.
 */
export async function checkAchievements(profileIds: string[], now: Date = new Date()): Promise<void> {
  const catalog = await loadCatalog(now.getTime());
  if (catalog.length === 0) return;

  for (const profileId of profileIds) {
    const granted = await grantedCodes(profileId);
    const remaining = catalog.filter((definition) => !granted.has(definition.code));
    if (remaining.length === 0) continue;

    const sources = await readSources(profileId, remaining);
    for (const definition of remaining) {
      const current = currentValueFor(definition, sources.standing, sources.level, sources.counters);
      if (current >= definition.threshold) await grantOne(profileId, definition, now);
    }
  }
}

/**
 * Applies one domain event to the lifetime counters it feeds, then checks
 * whether any achievement on those counters just unlocked.
 *
 * Never throws, the same contract applyMissionEvent keeps: a duel win or a
 * completed puzzle must not become a failed request because an achievement
 * bug got in the way. The reward is lost in that case, which is the same
 * trade-off applyMissionEvent makes.
 *
 * Only wired at the duel_won and puzzle_completed call sites --
 * poker_hand_played and level_gained achievements are stat/live-sourced, so
 * their call sites (hand-completion.ts, progression-store.ts) call
 * checkAchievements directly instead, and achievementCountersForEvent
 * returns no signal for those two kinds here.
 */
export async function applyAchievementEvent(
  profileId: string,
  event: DomainEvent,
  now: Date = new Date(),
): Promise<void> {
  try {
    const signals = achievementCountersForEvent(event);
    if (signals.length === 0) return;

    await Promise.all(signals.map((signal) => bumpCounter(profileId, signal.metric, signal.delta)));
    await checkAchievements([profileId], now);
  } catch (error) {
    console.error("achievements.apply_event_failed", { profileId, event, error });
  }
}
