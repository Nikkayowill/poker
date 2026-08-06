/**
 * The results matrix -- the part that actually travels.
 *
 * A daily puzzle spreads because the result is postable without spoiling
 * anything: the grid shows *how* the solve went and never which word it was.
 * That property is the whole design constraint here, and it is easy to break
 * by accident -- printing the answer, the guessed words, or per-word colours
 * from a round still in progress would each turn a brag into a spoiler. Every
 * generator below takes a *snapshot*, which is already redacted, rather than a
 * round, so this module could not leak an answer even if it tried.
 *
 * Pure string building, no DOM and no navigator: the share sheet lives in
 * components/arcade/share-result-button.tsx, and keeping the text generation
 * out of it is what puts these formats inside `npm test`, where an off-by-one
 * in a score fraction is caught rather than posted.
 *
 * ## The blocks
 *
 * These are the emoji everyone already reads at a glance, which is the point
 * -- an unfamiliar palette is a matrix nobody recognises in a group chat.
 * Absent is the dark block: the app is a dark-themed felt, and the light
 * variant (U+2B1C) disappears against it in most clients' previews.
 */

import type { ConnectionsLevel, ConnectionsSnapshot } from "./connections";
import type { WordleSnapshot, WordleTile } from "./wordle";

/** Wordle's three states. Green correct, yellow present, dark block absent. */
export const WORDLE_BLOCKS: Record<WordleTile, string> = {
  correct: "\u{1F7E9}", // 🟩
  present: "\u{1F7E8}", // 🟨
  absent: "\u{2B1B}", //  ⬛
};

/**
 * Connections' four difficulty colours, indexed by level 0-3.
 *
 * Yellow is the easiest group and purple the hardest, which is why the matrix
 * reads as a story rather than a scorecard -- opening on purple is a flex.
 */
export const CONNECTIONS_BLOCKS: Record<ConnectionsLevel, string> = {
  0: "\u{1F7E8}", // 🟨 easiest
  1: "\u{1F7E9}", // 🟩
  2: "\u{1F7E6}", // 🟦
  3: "\u{1F7EA}", // 🟪 hardest
};

export interface ShareOptions {
  /**
   * Appended as a final line. Omit it and the text is pure result -- some
   * clients treat a bare URL as a link preview and swallow the grid, so this
   * is the caller's call rather than always-on.
   */
  link?: string;
}

function withLink(lines: string[], options?: ShareOptions): string {
  const body = lines.join("\n");
  return options?.link ? `${body}\n\n${options.link}` : body;
}

/**
 * `4/6`, or `X/6` on a loss -- the fraction is the score, and X is the
 * universally understood way of saying "did not get it" without a number that
 * would sort as better than a 6.
 */
export function wordleScoreLine(snapshot: WordleSnapshot): string {
  return snapshot.status === "won" ? `${snapshot.guesses.length}/${snapshot.maxGuesses}` : `X/${snapshot.maxGuesses}`;
}

/** One row of blocks per guess. This is the grid, without the heading. */
export function wordleGrid(snapshot: WordleSnapshot): string {
  return snapshot.results
    .map((row) => row.map((tile) => WORDLE_BLOCKS[tile]).join(""))
    .join("\n");
}

/**
 * The full postable result, or null while the round is still live.
 *
 * Null rather than a partial grid: a mid-round share is a spoiler for the
 * person who has not played yet, and returning something the caller has to
 * remember not to use is how that ships.
 */
export function wordleShareText(snapshot: WordleSnapshot, options?: ShareOptions): string | null {
  if (snapshot.status === "active") return null;
  return withLink(
    [`StackChips Wordle #${snapshot.puzzleNumber} ${wordleScoreLine(snapshot)}`, "", wordleGrid(snapshot)],
    options,
  );
}

/** One row of four blocks per guess, in the order the player made them. */
export function connectionsGrid(snapshot: ConnectionsSnapshot): string {
  return (snapshot.guessRows ?? [])
    .map((row) => row.map((level) => CONNECTIONS_BLOCKS[level]).join(""))
    .join("\n");
}

/**
 * The full postable result, or null while the round is still live.
 *
 * `guessRows` is null on an active snapshot by construction (see
 * toConnectionsSnapshot), so this is guarded twice -- deliberately. The
 * per-word colours are the board; a leak here is the puzzle.
 */
export function connectionsShareText(snapshot: ConnectionsSnapshot, options?: ShareOptions): string | null {
  if (snapshot.status === "active" || !snapshot.guessRows) return null;
  return withLink(
    [`StackChips Connections #${snapshot.puzzleNumber}`, "", connectionsGrid(snapshot)],
    options,
  );
}

/** What the native share sheet shows as the subject. Short: some clients truncate hard. */
export function puzzleShareTitle(game: "wordle" | "connections", puzzleNumber: number): string {
  return game === "wordle"
    ? `StackChips Wordle #${puzzleNumber}`
    : `StackChips Connections #${puzzleNumber}`;
}
