/**
 * A payout ladder, snapshotted onto the round it was promised to.
 *
 * Word Stack and Connections both compute their payout from a module-level
 * multiplier table *at settlement*, not at open. That is fine while the table
 * never moves and wrong the moment it does: these are once-a-day boards, so a
 * round can be opened in the morning and finished at night, and a retune
 * landing in between pays the player at a rate they never agreed to. The
 * 2026-08-27 retune made that concrete -- Word Stack's six-guess rung went
 * from 1.5x to 0.7x, which is the difference between a profit and a loss on
 * the same board the player was already halfway through.
 *
 * The fix is the rule the rest of this app already follows: copy the terms
 * onto the thing they govern when it is created, and never re-read them
 * afterwards. `AnteUpAttempt.multiplier` and `AnteUpMinesweeperAttempt`'s
 * `timeLimitMs` both say so in their own doc comments. These two games could
 * not do it with a single number, because their multiplier depends on an
 * outcome that has not happened yet -- so they store the whole ladder instead.
 *
 * Stored as jsonb, so keys arrive back as strings. That is harmless: JavaScript
 * object keys are strings anyway, and a numeric index reads through unchanged.
 */

/** Rung key (guesses taken, mistakes made) to the multiple of the wager it pays. */
export type WagerLadder = Readonly<Record<number, number>>;

/**
 * The multiplier a round should be paid at.
 *
 * `stored` is the ladder copied onto the round when it opened. It is optional
 * because rounds written before ladders were stored do not have one; those
 * fall back to the live table, which is the best available answer and exactly
 * what they would have got anyway.
 *
 * `floor` is the multiplier for a rung the ladder does not name. It must be
 * the ladder's *lowest* value, never its highest: an unrecognised rung is a
 * bug, and a bug must not be the cheap way to the biggest payout.
 */
export function ladderMultiplier(
  stored: WagerLadder | undefined,
  live: WagerLadder,
  rung: number,
  floor: number,
): number {
  return (stored ?? live)[rung] ?? floor;
}
