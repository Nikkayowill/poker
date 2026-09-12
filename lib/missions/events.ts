/**
 * The event-to-mission fan-out.
 *
 * Pure and closed-form, same reasoning as lib/progression/rank.ts: nothing
 * here reads a clock, a database or the mission catalog, so the whole mapping
 * is reachable from `npm test`. This is what keeps mission hooks from
 * becoming N ad-hoc calls scattered through the game/duel/puzzle services --
 * every hook site emits exactly one of the four event kinds below, and this
 * module decides which metrics that feeds and by how much. Adding a mission
 * against an existing metric is a migration and a catalog row, not a code
 * change here; adding a *new* metric is.
 */

import type { DomainEvent } from "@/lib/domain-events";

export type MissionEvent = DomainEvent;

/** One increment to apply to every enabled mission on this metric. */
export interface MissionSignal {
  metric: string;
  delta: number;
}

// Every event that counts as "played something today" also feeds the
// cross-category weekly total and the deduped "active this many days"
// weekly total -- shared here so the three don't drift out of step.
function playedSomething(metric: string): MissionSignal[] {
  return [
    { metric, delta: 1 },
    { metric: "games_played_any", delta: 1 },
    { metric: "active_day", delta: 1 },
  ];
}

export function missionSignalsForEvent(event: MissionEvent): MissionSignal[] {
  switch (event.kind) {
    case "poker_hand_played": {
      const signals = playedSomething("poker_hands_played");
      if (event.multiplayer) signals.push({ metric: "multiplayer_hands_played", delta: 1 });
      return signals;
    }
    case "duel_won":
      return playedSomething("duels_won");
    case "cribbage_won":
      return playedSomething("cribbage_hands_won");
    case "sit_and_go_won":
      return playedSomething("sit_and_go_wins");
    case "heads_up_won":
      return playedSomething("heads_up_matches_won");
    case "puzzle_completed":
      return playedSomething("puzzles_completed");
    case "level_gained":
      // Zero levels is not a signal at all -- awardWager calls this
      // unconditionally, and most wagers cross none.
      return event.levels > 0 ? [{ metric: "levels_gained", delta: event.levels }] : [];
  }
}
