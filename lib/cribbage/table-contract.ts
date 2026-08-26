/**
 * The contract cribbage's own table service knows about: the N-seat
 * counterpart to lib/pvp/match-contract.ts's DuelGame.
 *
 * Not a generalization of DuelGame: that interface's DuelSeat = 0 | 1 and
 * `otherSeat()` are baked in at every layer below it (the store, the
 * migration, the money service), and cribbage is the only game so far that
 * needs more than two seats. Genericizing the working four games under time
 * pressure risks them for a hypothetical future game, so this is a small,
 * parallel contract instead. If a second N-seat game ever ships, that's the
 * moment to look at extracting one shared shape.
 *
 * The same determinism and redaction rules from DuelGame's header apply here
 * verbatim: `createState` takes a seed rather than calling Math.random(), and
 * `snapshot` is the only thing a browser ever sees, redacted per viewer.
 */

import type { CribbageSeat } from "./types";

/** Cribbage is always decisive, first to 121, so there is no draw case. */
export interface CribbageOutcome {
  winner: CribbageSeat;
  reason: string;
}

export type CribbageMoveResult<TState> =
  | { next: TState }
  | { reject: string };

export interface CribbageGame<TState, TMove, TSnapshot> {
  id: string;
  label: string;
  /** `playerCount` is fixed for the whole match, 3 or 4, decided when the table starts. */
  createState(seed: number, now: number, playerCount: number): TState;
  applyMove(state: TState, seat: CribbageSeat, move: TMove, now: number): CribbageMoveResult<TState>;
  /** No real-time clock in cribbage; see engine.ts's tick for why this stays a documented no-op. */
  tick?(state: TState, now: number): TState | null;
  result(state: TState): CribbageOutcome | null;
  snapshot(state: TState, seat: CribbageSeat | null, now: number): TSnapshot;
  resign?(state: TState, seat: CribbageSeat, now: number): TState;
}

/**
 * Checks an engine against the real generic interface once, at the point
 * it's written, the same reason defineDuelGame exists in match-contract.ts.
 * Cribbage has only one engine, so there's no registry to erase its types
 * into; this is purely a compile-time check that CRIBBAGE_GAME's methods
 * actually line up, so a typo'd or reshaped method is a build error here
 * rather than a runtime surprise in the money layer.
 */
export function defineCribbageGame<TState, TMove, TSnapshot>(
  game: CribbageGame<TState, TMove, TSnapshot>,
): CribbageGame<TState, TMove, TSnapshot> {
  return game;
}
