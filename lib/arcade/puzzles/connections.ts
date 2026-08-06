/**
 * Connections -- sixteen words, four hidden groups of four.
 *
 * Pure and synchronous, and like wordle.ts it takes the puzzle as *data*
 * rather than importing one. This module is client-imported (the board renders
 * from these types and the share matrix is built from its levels), so a puzzle
 * set imported here would ship every future answer to every browser. The sets
 * live in connections-puzzles.ts behind `server-only`.
 *
 * ## What a guess is allowed to teach you
 *
 * The interesting redaction in this game is not the answer, it is the
 * *feedback*. Internally a guess is scored by looking up each selected word's
 * group, so the server knows -- and must not say -- which of your four words
 * came from where. Reporting per-word colours on a wrong guess would turn four
 * mistakes into a free complete solution: guess any four words, read off their
 * groups, done. So a wrong guess reports exactly one bit beyond "wrong": `one
 * away`, when three of the four share a group. That is the same information
 * the real game gives, and it is the most that can be given without handing
 * over the board.
 *
 * The per-word colour matrix the share text is built from is therefore only
 * released once the round is over -- see toConnectionsSnapshot. By then every
 * group is revealed anyway, so it costs nothing.
 *
 * ## Difficulty is the colour
 *
 * `level` 0..3 runs easiest to hardest and maps to yellow / green / blue /
 * purple, which is why the share grid reads as a difficulty story rather than
 * a list of ticks: a row of purple first says something a row of yellow does
 * not. Storing the level rather than a colour name keeps the ordering
 * meaningful and leaves the palette to the renderer.
 */

import type { RandomInt } from "@/lib/game/deck";

/** 0 easiest (yellow) through 3 hardest (purple). The order is the difficulty ramp. */
export type ConnectionsLevel = 0 | 1 | 2 | 3;

export const CONNECTIONS_LEVELS: readonly ConnectionsLevel[] = [0, 1, 2, 3];
export const CONNECTIONS_GROUP_SIZE = 4;
export const CONNECTIONS_MAX_MISTAKES = 4;

export interface ConnectionsGroup {
  level: ConnectionsLevel;
  /** The category, shown once the group is found. Short -- it sits on one row of the board. */
  label: string;
  /** Exactly CONNECTIONS_GROUP_SIZE words. */
  members: string[];
}

/** A puzzle as authored: four groups, one per level. */
export interface ConnectionsPuzzle {
  groups: ConnectionsGroup[];
}

/** What the player is told about the guess they just made. */
export type ConnectionsVerdict = "correct" | "one-away" | "wrong";

export type ConnectionsStatus = "active" | "won" | "lost";

export interface ConnectionsRound {
  /** The solution. Secret in full until the round ends. */
  groups: ConnectionsGroup[];
  /** All sixteen words in board order, shuffled once at deal so the board is stable across a refresh. */
  order: string[];
  /** Levels the player has solved, in the order they found them. */
  solvedLevels: ConnectionsLevel[];
  /** Every selection played, oldest first. Words, not levels -- this is what detects a repeat. */
  attempts: string[][];
  mistakes: number;
  status: ConnectionsStatus;
  /** The most recent guess's verdict. Survives a refresh, which is harmless and saves a special case. */
  lastVerdict: ConnectionsVerdict | null;
}

/** Why a selection cannot be played, or null if it can. */
export type ConnectionsGuessProblem = "finished" | "size" | "unknown-word" | "solved-word" | "repeat";

export function normalizeWord(word: string): string {
  return word.trim().toUpperCase();
}

/** Validates an authored puzzle. Called at deal time so a malformed set fails loudly, not silently mid-game. */
export function assertPlayablePuzzle(puzzle: ConnectionsPuzzle): void {
  const levels = puzzle.groups.map((group) => group.level).sort();
  if (puzzle.groups.length !== CONNECTIONS_LEVELS.length || levels.join() !== CONNECTIONS_LEVELS.join()) {
    throw new Error("A Connections puzzle needs exactly one group per level 0-3.");
  }
  const words = puzzle.groups.flatMap((group) => group.members.map(normalizeWord));
  if (puzzle.groups.some((group) => group.members.length !== CONNECTIONS_GROUP_SIZE)) {
    throw new Error("Every Connections group needs exactly four words.");
  }
  if (new Set(words).size !== words.length) {
    // A word in two groups makes the puzzle unsolvable in a way that only
    // shows up as a player insisting a correct group was rejected.
    throw new Error("A word appears in more than one group.");
  }
}

function levelIndex(round: ConnectionsRound): Map<string, ConnectionsLevel> {
  const index = new Map<string, ConnectionsLevel>();
  round.groups.forEach((group) => {
    group.members.forEach((member) => index.set(normalizeWord(member), group.level));
  });
  return index;
}

/** Words still on the board: everything whose group has not been solved. */
export function remainingWords(round: ConnectionsRound): string[] {
  const index = levelIndex(round);
  const solved = new Set(round.solvedLevels);
  return round.order.filter((word) => {
    const level = index.get(word);
    return level !== undefined && !solved.has(level);
  });
}

export function connectionsGuessProblem(
  round: ConnectionsRound,
  selection: string[],
): ConnectionsGuessProblem | null {
  if (round.status !== "active") return "finished";

  const words = selection.map(normalizeWord);
  if (words.length !== CONNECTIONS_GROUP_SIZE || new Set(words).size !== CONNECTIONS_GROUP_SIZE) {
    return "size";
  }

  const index = levelIndex(round);
  if (words.some((word) => !index.has(word))) return "unknown-word";

  const solved = new Set(round.solvedLevels);
  if (words.some((word) => solved.has(index.get(word) as ConnectionsLevel))) return "solved-word";

  // A repeat costs nothing, the same way it does not in the game this is
  // modelled on -- charging a mistake for a mis-click the player already paid
  // for reads as the game cheating.
  const key = [...words].sort().join("|");
  if (round.attempts.some((attempt) => [...attempt].sort().join("|") === key)) return "repeat";

  return null;
}

export function startConnectionsRound(puzzle: ConnectionsPuzzle, randomInt: RandomInt): ConnectionsRound {
  assertPlayablePuzzle(puzzle);
  const groups = puzzle.groups.map((group) => ({
    ...group,
    members: group.members.map(normalizeWord),
  }));

  const order = groups.flatMap((group) => group.members);
  // Fisher-Yates with injected randomness, exactly as makeDeck does it -- the
  // board must not open with the four yellows sitting in a row.
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(index + 1);
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
  }

  return { groups, order, solvedLevels: [], attempts: [], mistakes: 0, status: "active", lastVerdict: null };
}

/**
 * Plays one selection of four words.
 *
 * Inert on a selection the round cannot accept -- same convention as
 * submitWordleGuess and callHiLo: the service re-checks and answers 409, and a
 * throw here would surface as a 500.
 */
export function submitConnectionsGuess(round: ConnectionsRound, selection: string[]): ConnectionsRound {
  if (connectionsGuessProblem(round, selection)) return round;

  const words = selection.map(normalizeWord);
  const index = levelIndex(round);
  const levels = words.map((word) => index.get(word) as ConnectionsLevel);
  const attempts = [...round.attempts, words];

  const distinct = new Set(levels);
  if (distinct.size === 1) {
    const solvedLevels = [...round.solvedLevels, levels[0]];
    const won = solvedLevels.length === CONNECTIONS_LEVELS.length;
    return {
      ...round,
      attempts,
      solvedLevels,
      status: won ? "won" : "active",
      lastVerdict: "correct",
    };
  }

  // "One away" is three of one group plus a stray -- the only extra bit a
  // wrong guess is allowed to reveal. See the note at the top of this file.
  const counts = new Map<ConnectionsLevel, number>();
  levels.forEach((level) => counts.set(level, (counts.get(level) ?? 0) + 1));
  const oneAway = [...counts.values()].includes(CONNECTIONS_GROUP_SIZE - 1);

  const mistakes = round.mistakes + 1;
  return {
    ...round,
    attempts,
    mistakes,
    status: mistakes >= CONNECTIONS_MAX_MISTAKES ? "lost" : "active",
    lastVerdict: oneAway ? "one-away" : "wrong",
  };
}

/**
 * Every guess as a row of difficulty levels -- the share matrix's input.
 *
 * Derived rather than stored: the attempts and the groups are already the
 * truth, and a second copy that could disagree with them is a bug waiting for
 * the one player whose share text does not match their board.
 */
export function connectionsGuessRows(round: ConnectionsRound): ConnectionsLevel[][] {
  const index = levelIndex(round);
  return round.attempts.map((attempt) =>
    attempt.map((word) => index.get(word) as ConnectionsLevel),
  );
}

/** A group as the client may see it. `solved` false only ever appears once the round is lost. */
export interface ConnectionsGroupView extends ConnectionsGroup {
  solved: boolean;
}

export interface ConnectionsSnapshot {
  day: string;
  puzzleNumber: number;
  /** Echoed back with the next selection, which is what pins it to this exact state. */
  version: number;
  /** Unsolved words only, in board order. */
  words: string[];
  /** Solved groups in solve order; on a loss, the rest follow with `solved: false`. */
  revealed: ConnectionsGroupView[];
  mistakes: number;
  mistakesAllowed: number;
  guessCount: number;
  lastVerdict: ConnectionsVerdict | null;
  status: ConnectionsStatus;
  /** Null while the round is live -- releasing it early would hand over the board. */
  guessRows: ConnectionsLevel[][] | null;
  groupSize: number;
}

export function toConnectionsSnapshot(
  round: ConnectionsRound,
  meta: { day: string; puzzleNumber: number; version: number },
): ConnectionsSnapshot {
  const byLevel = new Map(round.groups.map((group) => [group.level, group]));
  const revealed: ConnectionsGroupView[] = round.solvedLevels.map((level) => ({
    ...(byLevel.get(level) as ConnectionsGroup),
    solved: true,
  }));
  if (round.status !== "active") {
    const solved = new Set(round.solvedLevels);
    CONNECTIONS_LEVELS.filter((level) => !solved.has(level)).forEach((level) => {
      revealed.push({ ...(byLevel.get(level) as ConnectionsGroup), solved: false });
    });
  }

  return {
    day: meta.day,
    puzzleNumber: meta.puzzleNumber,
    version: meta.version,
    words: remainingWords(round),
    revealed,
    mistakes: round.mistakes,
    mistakesAllowed: CONNECTIONS_MAX_MISTAKES,
    guessCount: round.attempts.length,
    lastVerdict: round.lastVerdict,
    status: round.status,
    guessRows: round.status === "active" ? null : connectionsGuessRows(round),
    groupSize: CONNECTIONS_GROUP_SIZE,
  };
}
