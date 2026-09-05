/**
 * The canonical play-event vocabulary.
 *
 * lib/missions/events.ts and lib/achievements/events.ts each map this same
 * union to their own signal shape (mission progress deltas vs. lifetime
 * counter deltas) rather than declaring two independent unions that could
 * quietly drift. A new event kind is one addition here, and both mapping
 * functions get a compiler error (an unhandled switch case) until each has
 * decided whether it cares.
 *
 * Pure and dependency-free: nothing here reads a clock, a database or a
 * catalog.
 */
export type DomainEvent =
  | { kind: "poker_hand_played"; multiplayer: boolean }
  | { kind: "duel_won" }
  // A 3-4 player cribbage table win, kept as its own kind rather than
  // folded into duel_won. That event's catalog copy already says "PvP
  // duels" ("Win three PvP duels", "Win 10 PvP duels"); counting a
  // free-for-all table against it would misword shipped text and dilute a
  // metric that's always meant 1v1.
  | { kind: "cribbage_won" }
  // A 6-max Sit & Go win, kept separate from duel_won for the same reason
  // cribbage_won is: it's the same "PvP duels" copy problem, and a Sit & Go
  // is a 6-way table, not a 1v1, the same structural difference cribbage has.
  | { kind: "sit_and_go_won" }
  // A heads-up poker match win. Kept distinct from duel_won for the same
  // reason cribbage_won is: it's a different game with its own catalog copy,
  // even though (unlike cribbage) it genuinely is 1v1 -- a future
  // "win N heads-up matches" mission/achievement wants its own metric rather
  // than silently inflating duel_won's "Win 10 PvP duels" count.
  | { kind: "heads_up_won" }
  | { kind: "puzzle_completed" }
  | { kind: "level_gained"; levels: number }
  // Ray's Museum's hidden wing: every core secret exhibit piece has been
  // found for the first time ever (see lib/stackacres/museum-secrets.ts's
  // `secretHiddenSetComplete`). Fired once, by the harvest that completes
  // it -- a later harvest with the set already full never re-fires this.
  | { kind: "museum_secret_set_completed" };
