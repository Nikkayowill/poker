/**
 * Connections board order: how the tiles are arranged on screen.
 *
 * Display order only. The server deals a shuffled `order` and never reads
 * this back, so nothing here can affect a guess, a mistake or a payout: it's
 * the arrangement of the same sixteen (then twelve, then eight...) words the
 * board already shows. That's what makes it safe to live client-side, and
 * why the shuffle button spends no request.
 *
 * It lives in `lib/` rather than beside the component because
 * `vitest.config.ts` collects only `lib/` and `app/`; a helper under
 * `components/` is unreachable by `npm test`.
 *
 * `alignSelectionInline` handles the first press of Shuffle while tiles are
 * selected: the picked words are pulled onto the board's top row, in the
 * order the player tapped them, and everything else is shuffled into the
 * slots below. Seeing a candidate group sitting as a row is the whole point;
 * it's how you check whether four words look like each other before
 * spending a mistake finding out.
 *
 * Randomness is injected exactly as `makeDeck` takes it, so a test gets a
 * deterministic arrangement instead of asserting around `Math.random`.
 */

import type { RandomInt } from "@/lib/game/deck";

/** Tiles per row: `.cx-tiles` is `grid-template-columns: repeat(4, 1fr)` in 25-puzzles.css. */
export const CONNECTIONS_BOARD_COLUMNS = 4;

/** Fisher-Yates over a copy, the same shape as `makeDeck`'s. Never mutates the input. */
export function shuffleBoardOrder(words: readonly string[], randomInt: RandomInt): string[] {
  const next = [...words];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(index + 1);
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
  }
  return next;
}

/**
 * Shuffles the board, but seats the selected words together on the top row.
 *
 * The selection is taken in tap order and filtered against `words`, because a
 * tile can be solved out from under a stale selection between the tap and the
 * press. With nothing selected, or nothing selected that is still on the
 * board, this is an ordinary shuffle, so the button never does nothing.
 */
export function alignSelectionInline(
  words: readonly string[],
  selection: readonly string[],
  randomInt: RandomInt,
): string[] {
  const live = new Set(words);
  const seated: string[] = [];
  selection.forEach((word) => {
    // Deduped as well as filtered: a repeated word would seat one tile twice
    // and drop another off the board entirely.
    if (live.has(word) && !seated.includes(word)) seated.push(word);
  });

  // A selection cannot exceed a row (the board caps it at four), but slicing
  // rather than trusting that keeps the "one row" promise true regardless.
  const row = seated.slice(0, CONNECTIONS_BOARD_COLUMNS);
  if (row.length === 0) return shuffleBoardOrder(words, randomInt);

  const rest = words.filter((word) => !row.includes(word));
  return [...row, ...shuffleBoardOrder(rest, randomInt)];
}

/**
 * A stable key for "this exact selection", used to decide whether a Shuffle
 * press is the *first* one for the current picks. Sorted, so re-tapping the
 * same four tiles in a different order is the same selection and does not
 * re-arm the alignment.
 */
export function selectionKey(selection: readonly string[]): string {
  return [...selection].sort().join("|");
}
