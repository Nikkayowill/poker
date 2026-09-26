/**
 * Unpredictable randomness for hidden information: Liar's Dice rolls,
 * cribbage deals, trivia choice order.
 *
 * A seeded PRNG is fine for setups nobody can see into, but a 31-bit
 * mulberry32 seed can be brute-forced from what a game reveals (one round's
 * dice at a showdown is enough), and then every later hidden roll is known.
 * These draws come from the Web Crypto CSPRNG at the moment they are dealt,
 * so nothing revealed earlier says anything about them.
 *
 * Web Crypto rather than node:crypto because the boards import their game's
 * module for types and constants, and globalThis.crypto exists in Node and in
 * browsers alike. Engines take a RandomInt argument that defaults to this, so
 * a test can pass a seeded one and get a fixed deal.
 */

import type { RandomInt } from "@/lib/game/deck";
import { mulberry32 } from "@/lib/seeded-random";

export type { RandomInt } from "@/lib/game/deck";

const UINT32_RANGE = 2 ** 32;

/** An integer in [0, maxExclusive), uniform, from the CSPRNG. */
export const secureRandomInt: RandomInt = (maxExclusive) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new Error("secureRandomInt needs a whole number range between 1 and 2^32.");
  }
  // Rejection sampling: values in the ragged top slice would favour the
  // low results, so they are redrawn rather than folded in.
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  const buffer = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value < limit) return value % maxExclusive;
  }
};

/**
 * A repeatable RandomInt from a seed. For tests and nothing else: its whole
 * point is that the seed predicts every draw.
 */
export function seededRandomInt(seed: number): RandomInt {
  const random = mulberry32(seed);
  return (maxExclusive) => Math.floor(random() * maxExclusive);
}

/** Fisher-Yates over a copy. */
export function shuffleWith<T>(items: readonly T[], randomInt: RandomInt): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const a = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = a;
  }
  return copy;
}
