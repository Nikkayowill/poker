/**
 * Deterministic randomness shared by every seeded puzzle/duel engine
 * (Sudoku, Minesweeper, Word Stack/Connections' daily draw, Word Race,
 * Trivia Showdown). Each of these used to carry its own byte-for-byte copy
 * -- consolidated here so a bug in either function is fixed once, not
 * rediscovered per game.
 */

/** FNV-1a. Any stable string hash would do; this one is short and has no dependencies. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Mulberry32 -- a small, fast 32-bit PRNG. Not cryptographic and does not
 * need to be: the only property that matters here is that it is completely
 * determined by its seed, so a round/match/board can be reproduced from the
 * seed alone (replay, a test pinning an exact board) and a client holding no
 * seed has nothing to run this on to predict what's coming.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
