/**
 * The letter-grid rules Word Fill-In's server moves and its client share: what
 * a grid looks like after a word is placed or a slot is cleared. Kept apart
 * from word-fill-in.ts, which carries the word bank, so the board can paint a
 * queued move without shipping the dictionary to the browser.
 */

export function slotWord(guesses: string, cells: readonly number[]): string {
  return cells.map((cell) => guesses[cell]).join("");
}

export function slotFilled(guesses: string, cells: readonly number[]): boolean {
  return cells.every((cell) => /^[A-Z]$/.test(guesses[cell]));
}

/** Blanks a slot, except letters a different fully filled slot still uses. */
export function clearedSlotGuesses(guesses: string, slots: readonly (readonly number[])[], slotIndex: number): string {
  const keep = new Set<number>();
  slots.forEach((cells, index) => {
    if (index !== slotIndex && slotFilled(guesses, cells)) cells.forEach((cell) => keep.add(cell));
  });
  const next = guesses.split("");
  for (const cell of slots[slotIndex] ?? []) {
    if (!keep.has(cell)) next[cell] = "_";
  }
  return next.join("");
}

/**
 * Writes an upper-case word over a slot, crossings included. A word already
 * spelled out in another slot moves rather than appearing twice.
 */
export function placedSlotGuesses(
  guesses: string,
  slots: readonly (readonly number[])[],
  slotIndex: number,
  word: string,
): string {
  const elsewhere = slots.findIndex((cells, index) => index !== slotIndex && slotWord(guesses, cells) === word);
  const base = elsewhere === -1 ? guesses : clearedSlotGuesses(guesses, slots, elsewhere);
  const next = base.split("");
  (slots[slotIndex] ?? []).forEach((cell, i) => {
    next[cell] = word[i];
  });
  return next.join("");
}
