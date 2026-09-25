import "server-only";
import type { RandomInt } from "@/lib/game/deck";
import { WORD_RACE_WORDS } from "@/lib/pvp/word-race-words";

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

export function pickWordGuessWord(randomInt: RandomInt): string {
  return WORD_GUESS_WORDS[randomInt(WORD_GUESS_WORDS.length)];
}

export const WORD_GUESS_WORD_COUNT = WORD_GUESS_WORDS.length;
