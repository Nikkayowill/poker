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
 * One mulberry32 step, as a pure function: the accumulator in, the next
 * accumulator and a float in [0, 1) out. `mulberry32` below is a thin
 * closure wrapper around this for callers that just want "the next number";
 * this raw form exists for a caller that has to carry the accumulator itself
 * across a serialized/persisted state rather than close over it in memory --
 * lib/cribbage/deck.ts's `rngState` is the one so far (a cribbage match runs
 * an unbounded number of deals, so it can't pre-generate a fixed sequence up
 * front the way a single-seed generator's callers do). Keep both forms
 * calling this one implementation: a PRNG bug fixed in one and not the other
 * is exactly the duplication this module exists to prevent.
 */
export function mulberry32Step(state: number): [number, number] {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [nextState, value];
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
    const [nextState, value] = mulberry32Step(state);
    state = nextState;
    return value;
  };
}
