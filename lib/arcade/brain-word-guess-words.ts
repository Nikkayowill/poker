import "server-only";
import type { RandomInt } from "@/lib/game/deck";
import type { StakePressure } from "@/lib/arcade/stake-pressure";
import { WORD_RACE_WORDS } from "@/lib/pvp/word-race-words";
import { WORD_GUESS_BANDS, wordGuessDifficulty } from "./brain-word-guess";

/**
 * Word Guess's answers. Server-only: with a small bank in the page, a player
 * could narrow any word down from its length and win the top payout every
 * time. The Word Race bank supplies several hundred common, unambiguous
 * words, and the original list stays in for the longer ones.
 */

/** Everyday words, several categories, nothing that needs specialist knowledge. */
const ORIGINAL_WORDS: readonly string[] = [
  "guitar", "elephant", "sandwich", "volcano", "umbrella", "penguin", "mountain",
  "blanket", "dolphin", "carousel", "backpack", "sunflower", "pancake", "hammock",
  "lighthouse", "butterfly", "avocado", "trumpet", "kangaroo", "waterfall",
  "campfire", "notebook", "raincoat", "pretzel", "octopus", "telescope", "cactus",
  "blizzard", "harmonica", "pyramid", "compass", "marshmallow", "tornado",
  "raccoon", "seashell", "bicycle", "jigsaw", "lantern", "peacock", "snowflake",
];

const WORD_GUESS_WORDS: readonly string[] = [...new Set([...ORIGINAL_WORDS, ...WORD_RACE_WORDS.map((entry) => entry.word)])];

/** The words each stake band may deal: band 0 gets the whole bank, higher bands only the harder words. */
export const WORD_GUESS_POOLS: Record<StakePressure, readonly string[]> = {
  0: poolFor(0),
  1: poolFor(1),
  2: poolFor(2),
  3: poolFor(3),
};

function poolFor(pressure: StakePressure): readonly string[] {
  const floor = WORD_GUESS_BANDS[pressure].minDifficulty;
  return floor === null ? WORD_GUESS_WORDS : WORD_GUESS_WORDS.filter((word) => wordGuessDifficulty(word) >= floor);
}

/** The words for one run in this band: as many as the band deals, never the same word twice. */
export function pickWordGuessWords(randomInt: RandomInt, pressure: StakePressure = 0): string[] {
  const pool = [...WORD_GUESS_POOLS[pressure]];
  const count = Math.min(WORD_GUESS_BANDS[pressure].words, pool.length);
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export const WORD_GUESS_WORD_COUNT = WORD_GUESS_WORDS.length;
