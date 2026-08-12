/**
 * Every duel the app offers, by its storage key.
 *
 * The service resolves a match's `game` column through here rather than taking
 * a game object from the caller, which is what stops a request naming an
 * engine that is not offered. A key absent from this map is a match that
 * cannot be created, read, or settled -- so retiring a duel is a deletion from
 * one object, not a hunt through routes.
 *
 * Keys are also the `game` value written into pvp_matches and pvp_challenges,
 * so they are stable identifiers rather than display names: renaming one
 * orphans every stored row that used it.
 *
 * Deliberately in lib/ rather than lib/server: vitest.config.ts collects only
 * lib/ and app/, and the engines are the part with real rules in them. Nothing
 * here may import from lib/server or pull in node-only modules -- the boards
 * import their own game's types from these same files.
 */

import type { AnyDuelGame } from "./match-contract";
import { CHESS_DUEL } from "./chess";
import { CHECKERS_DUEL } from "./checkers";
import { TRIVIA_DUEL } from "./trivia";
import { WORD_RACE_DUEL } from "./word-race";

export const DUEL_GAMES: Readonly<Record<string, AnyDuelGame>> = {
  chess: CHESS_DUEL,
  checkers: CHECKERS_DUEL,
  trivia: TRIVIA_DUEL,
  "word-race": WORD_RACE_DUEL,
};

/** The keys, for route validation and the matchmaking UI. */
export const DUEL_GAME_IDS = Object.keys(DUEL_GAMES);

export function isDuelGameId(value: unknown): value is string {
  return typeof value === "string" && value in DUEL_GAMES;
}

/**
 * The engine behind a stored match, or null if that key is no longer offered.
 *
 * Null rather than a throw: a match row whose game has since been retired is a
 * real state the reader has to render something for, and it must not take the
 * whole route down.
 */
export function duelGame(id: string): AnyDuelGame | null {
  return DUEL_GAMES[id] ?? null;
}
