import type { DomainEvent } from "@/lib/domain-events";

/**
 * The event-to-achievement-counter fan-out.
 *
 * Only two of DomainEvent's four kinds produce a signal here. poker_hand_played
 * and level_gained achievements are checked by re-reading player_stats / the
 * live progression level directly (see lib/server/achievement-store.ts's
 * checkAchievements) rather than by counting events -- those numbers already
 * exist as a stored, monotonic source of truth, so counting them a second
 * time here would just be a second place for the two counts to drift.
 * duels_won and puzzles_completed have no such stored number yet, which is
 * exactly why they need an event-driven counter at all.
 *
 * Pure and closed-form, same reasoning as lib/missions/events.ts.
 */
export interface AchievementCounterSignal {
  metric: string;
  delta: number;
}

export function achievementCountersForEvent(event: DomainEvent): AchievementCounterSignal[] {
  switch (event.kind) {
    case "duel_won":
      return [{ metric: "duels_won", delta: 1 }];
    case "cribbage_won":
      return [{ metric: "cribbage_hands_won", delta: 1 }];
    case "puzzle_completed":
      return [{ metric: "puzzles_completed", delta: 1 }];
    case "poker_hand_played":
    case "level_gained":
      return [];
  }
}
