/**
 * Ante Up: Connections -- a solo skill wager, and the daily bonus's scoring.
 *
 * Wager Gold, solve a fresh grid (never the shared daily puzzle), cash out a
 * multiple of the wager if you find all four groups before running out of
 * mistakes. Same shape as ante-up-word-stack.ts -- see that file's header for
 * the reasoning this mirrors; the only real difference is a guess here is a
 * selection of four words, not a five-letter string.
 *
 * Reuses lib/arcade/puzzles/connections.ts's engine untouched -- the puzzle is
 * picked fresh per attempt (never a calendar day), same "never competes with
 * the shared Daily Connections" contract every Ante Up game keeps. No
 * difficulty choice and no clock: Connections already has a natural loss
 * condition (four mistakes), so the multiplier is scored at settlement off
 * how many mistakes the win actually cost.
 */

import {
  CONNECTIONS_GROUP_SIZE,
  CONNECTIONS_MAX_MISTAKES,
  connectionsGuessProblem,
  connectionsGuessRows,
  remainingWords,
  startConnectionsRound,
  submitConnectionsGuess,
  type ConnectionsGroupView,
  type ConnectionsGuessProblem,
  type ConnectionsLevel,
  type ConnectionsPuzzle,
  type ConnectionsRound,
  type ConnectionsVerdict,
} from "./puzzles/connections";
import type { RandomInt } from "@/lib/game/deck";

/** The floor for a wager. Restated per game -- see ante-up-word-stack.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

/** Win-only payout multiplier, keyed by mistakes made. Starting numbers, easy to retune here. */
const WAGER_MULTIPLIER_BY_MISTAKES: Readonly<Record<number, number>> = {
  0: 8, 1: 5, 2: 3, 3: 1.5,
};

/** Always-pays multiplier for the shared daily board's completion bonus. A loss still floors at 1.0x. */
const DAILY_BONUS_MULTIPLIER_BY_MISTAKES: Readonly<Record<number, number>> = {
  0: 3.0, 1: 2.0, 2: 1.5, 3: 1.1,
};

export type AnteUpConnectionsStatus = "active" | "won" | "lost";

export interface AnteUpConnectionsAttempt {
  /** Already debited by the time an attempt exists -- see the service. */
  wager: number;
  puzzle: ConnectionsRound;
  status: AnteUpConnectionsStatus;
  startedAt: string;
}

/** A fresh attempt: `puzzle`/`randomInt` are never the shared daily pick -- see the file header. */
export function startAnteUpConnections(
  puzzle: ConnectionsPuzzle,
  randomInt: RandomInt,
  wager: number,
  now: Date,
): AnteUpConnectionsAttempt {
  return {
    wager,
    puzzle: startConnectionsRound(puzzle, randomInt),
    status: "active",
    startedAt: now.toISOString(),
  };
}

/** Why a selection cannot be played, or null if it can. */
export function anteUpConnectionsGuessProblem(
  attempt: AnteUpConnectionsAttempt,
  selection: string[],
): ConnectionsGuessProblem | null {
  if (attempt.status !== "active") return "finished";
  return connectionsGuessProblem(attempt.puzzle, selection);
}

/** Plays a selection. All four groups found becomes a win; a fourth mistake becomes a loss. */
export function playAnteUpConnectionsGuess(
  attempt: AnteUpConnectionsAttempt,
  selection: string[],
): AnteUpConnectionsAttempt {
  if (anteUpConnectionsGuessProblem(attempt, selection)) return attempt;

  const puzzle = submitConnectionsGuess(attempt.puzzle, selection);
  const status: AnteUpConnectionsStatus =
    puzzle.status === "active" ? "active" : puzzle.status === "won" ? "won" : "lost";
  return { ...attempt, puzzle, status };
}

/** Gives up early. The wager is already spent -- this only records how it ended. */
export function resignAnteUpConnections(attempt: AnteUpConnectionsAttempt): AnteUpConnectionsAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, status: "lost" };
}

/** What a WAGER win pays. Zero on anything but a win -- the wager is forfeit on a loss. */
export function anteUpConnectionsPayout(attempt: Pick<AnteUpConnectionsAttempt, "wager" | "puzzle">): number {
  if (attempt.puzzle.status !== "won") return 0;
  const multiplier = WAGER_MULTIPLIER_BY_MISTAKES[attempt.puzzle.mistakes] ?? 1.5;
  return Math.round(attempt.wager * multiplier);
}

/**
 * What the shared daily board's completion bonus pays, as a multiplier on
 * DAILY_BONUS_BASE (lib/server/daily-puzzle-bonus.ts). Always at least 1.0 --
 * a lost daily attempt still pays the floor, matching how the retired flat
 * mission paid on any completion. Only call this once `round.status !== "active"`.
 */
export function connectionsDailyBonusMultiplier(round: Pick<ConnectionsRound, "status" | "mistakes">): number {
  if (round.status === "lost") return 1.0;
  return DAILY_BONUS_MULTIPLIER_BY_MISTAKES[round.mistakes] ?? 1.0;
}

/** The attempt as the browser may see it. Redacted the same way toConnectionsSnapshot redacts it. */
export interface AnteUpConnectionsSnapshot {
  id: string;
  wager: number;
  version: number;
  status: AnteUpConnectionsStatus;
  words: string[];
  revealed: ConnectionsGroupView[];
  mistakes: number;
  mistakesAllowed: number;
  guessCount: number;
  lastVerdict: ConnectionsVerdict | null;
  guessRows: ConnectionsLevel[][] | null;
  groupSize: number;
  /** wager * multiplier on a win, stated rather than left for the client to compute. Zero otherwise. */
  payout: number;
}

export function toAnteUpConnectionsSnapshot(
  attempt: AnteUpConnectionsAttempt,
  meta: { id: string; version: number },
): AnteUpConnectionsSnapshot {
  const round = attempt.puzzle;
  const byLevel = new Map<ConnectionsLevel, (typeof round.groups)[number]>(
    round.groups.map((group) => [group.level, group]),
  );
  const revealed: ConnectionsGroupView[] = round.solvedLevels.map((level) => ({
    ...byLevel.get(level)!,
    solved: true,
  }));
  if (round.status !== "active") {
    const solved = new Set(round.solvedLevels);
    round.groups
      .map((group) => group.level)
      .filter((level) => !solved.has(level))
      .forEach((level) => revealed.push({ ...byLevel.get(level)!, solved: false }));
  }

  return {
    id: meta.id,
    wager: attempt.wager,
    version: meta.version,
    status: attempt.status,
    words: remainingWords(round),
    revealed,
    mistakes: round.mistakes,
    mistakesAllowed: CONNECTIONS_MAX_MISTAKES,
    guessCount: round.attempts.length,
    lastVerdict: round.lastVerdict,
    guessRows: round.status === "active" ? null : connectionsGuessRows(round),
    groupSize: CONNECTIONS_GROUP_SIZE,
    payout: anteUpConnectionsPayout(attempt),
  };
}
