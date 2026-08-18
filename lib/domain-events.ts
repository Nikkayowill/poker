/**
 * The canonical play-event vocabulary.
 *
 * lib/missions/events.ts and lib/achievements/events.ts each map this same
 * union to their own signal shape (mission progress deltas vs. lifetime
 * counter deltas) rather than declaring two independent unions that could
 * quietly drift -- a new event kind is one addition here, and both mapping
 * functions get a compiler error (an unhandled switch case) until each has
 * decided whether it cares.
 *
 * Pure and dependency-free: nothing here reads a clock, a database or a
 * catalog.
 */
export type DomainEvent =
  | { kind: "poker_hand_played"; multiplayer: boolean }
  | { kind: "duel_won" }
  // A 3-4 player cribbage table win -- its own kind, not folded into
  // duel_won. That event's own catalog copy already says "PvP duels"
  // ("Win three PvP duels", "Win 10 PvP duels"); silently counting a
  // free-for-all table against it would misword shipped text and dilute a
  // metric that means something structurally different (1v1, always).
  | { kind: "cribbage_won" }
  | { kind: "puzzle_completed" }
  | { kind: "level_gained"; levels: number };
