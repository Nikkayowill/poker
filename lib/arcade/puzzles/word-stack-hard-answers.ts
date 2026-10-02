import "server-only";

import type { WordStackWordTier } from "./word-stack";
import { WORD_STACK_ANSWERS } from "./word-stack-answers";

/**
 * The harder words a big Word Stack stake plays instead of the shared daily word.
 *
 * `server-only` for the same reason as the answer list it reads: these are
 * future answers.
 *
 * Every word here is still from WORD_STACK_ANSWERS, so a hard board is never
 * an obscure word, only a tricky one. What makes a common word hard to solve
 * is mostly look-alikes: TIGHT shares four letters in place with LIGHT, MIGHT,
 * NIGHT and the rest, and only guessing through them finds the one. Repeated
 * letters and rare letters add a little on top.
 */

/** How much of the answer list, hardest first, each band draws from. */
const HARDEST_SHARE_BY_TIER: Readonly<Record<WordStackWordTier, number>> = {
  1: 0.45,
  2: 0.25,
  3: 0.12,
};

/** Letters outside this many of the most common ones count as rare. */
const COMMON_LETTER_COUNT = 15;

/**
 * How hard `word` is to solve, against the other words in `pool`. Two points
 * per look-alike (a pool word one letter away), two per repeated letter, one
 * per rare letter.
 */
export function wordStackDifficulty(word: string, pool: readonly string[]): number {
  return difficultyTable(pool).get(word) ?? 0;
}

const tables = new WeakMap<readonly string[], Map<string, number>>();

function difficultyTable(pool: readonly string[]): Map<string, number> {
  const cached = tables.get(pool);
  if (cached) return cached;

  // Words one letter apart share a pattern with that letter blanked out.
  const patterns = new Map<string, number>();
  const letterCounts = new Map<string, number>();
  for (const word of pool) {
    for (let index = 0; index < word.length; index += 1) {
      const pattern = `${word.slice(0, index)}_${word.slice(index + 1)}`;
      patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
      letterCounts.set(word[index], (letterCounts.get(word[index]) ?? 0) + 1);
    }
  }
  const common = new Set(
    [...letterCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, COMMON_LETTER_COUNT)
      .map(([letter]) => letter),
  );

  const table = new Map<string, number>();
  for (const word of pool) {
    let lookAlikes = 0;
    for (let index = 0; index < word.length; index += 1) {
      lookAlikes += (patterns.get(`${word.slice(0, index)}_${word.slice(index + 1)}`) ?? 1) - 1;
    }
    const distinct = new Set(word);
    const repeats = word.length - distinct.size;
    const rare = [...distinct].filter((letter) => !common.has(letter)).length;
    table.set(word, lookAlikes * 2 + repeats * 2 + rare);
  }
  tables.set(pool, table);
  return table;
}

/** The hardest slice of `pool` for a band, hardest first, ties in alphabetical order. */
export function hardWordPool(pool: readonly string[], tier: WordStackWordTier): string[] {
  const table = difficultyTable(pool);
  const ranked = [...pool].sort((a, b) => (table.get(b) ?? 0) - (table.get(a) ?? 0) || a.localeCompare(b));
  return ranked.slice(0, Math.max(1, Math.round(pool.length * HARDEST_SHARE_BY_TIER[tier])));
}

const pools = new Map<WordStackWordTier, readonly string[]>();

/** The live answer list's hard slice for a band. Computed once per process. */
export function wordStackHardAnswers(tier: WordStackWordTier): readonly string[] {
  let pool = pools.get(tier);
  if (!pool) {
    pool = hardWordPool(WORD_STACK_ANSWERS, tier);
    pools.set(tier, pool);
  }
  return pool;
}
