/**
 * The achievements wire contract, shared rather than server-only.
 *
 * lib/server/achievement-store.ts carries `import "server-only"`, so the
 * rewards card and the achievements page cannot import its shapes from there
 * without risking the service-role client in the browser bundle. Same split
 * as lib/missions/types.ts.
 */

export type AchievementCategory =
  | "hands_played"
  | "hands_won"
  | "net_profit"
  | "biggest_pot_won"
  | "total_chips_won"
  | "duels_won"
  | "puzzles_completed"
  | "levels_gained";

/**
 * 'stat' reads player_stats, 'counter' reads player_lifetime_counters, 'live'
 * reads the current progression level. See the migration
 * (20260817120000_achievements.sql) for the full reasoning per kind.
 */
export type AchievementSourceKind = "stat" | "counter" | "live";

/** A row out of the achievement_definitions catalog. */
export interface AchievementDefinition {
  code: string;
  category: AchievementCategory;
  tier: 1 | 2 | 3;
  sourceKind: AchievementSourceKind;
  /** What lib/achievements/events.ts's signals key on, for 'counter' rows. */
  metric: string;
  threshold: number;
  rewardGold: number;
  /** A lib/cosmetics/catalog.ts id, or null when the reward is Gold only. */
  rewardCosmeticId: string | null;
  title: string;
  description: string;
  sortOrder: number;
}

/** One achievement, from one player's point of view. Permanent -- unlike a
 * mission, nothing here ever resets, so a crossed tier stays unlocked. */
export interface AchievementView {
  code: string;
  category: AchievementCategory;
  tier: 1 | 2 | 3;
  title: string;
  description: string;
  /** Clamped to [0, threshold] for display, even locked. */
  progress: number;
  threshold: number;
  rewardGold: number;
  rewardCosmeticId: string | null;
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface AchievementsPayload {
  achievements: AchievementView[];
  unlockedCount: number;
  totalCount: number;
}

/** Category labels, shared between the API shaping and the UI grouping. */
export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  hands_played: "Hands played",
  hands_won: "Hands won",
  net_profit: "Net profit",
  biggest_pot_won: "Biggest pot",
  total_chips_won: "Chips won",
  duels_won: "Duels won",
  puzzles_completed: "Brain games",
  levels_gained: "Rank",
};
