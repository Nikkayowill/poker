/**
 * What "today's puzzle" means.
 *
 * Pure and clock-free: every function takes the instant it should read, so
 * the whole calendar is reachable from `npm test` and a route is the only
 * thing that ever calls `new Date()`. Same shape as the rest of lib/arcade:
 * the engines take their randomness and their answers as arguments rather
 * than reaching for them.
 *
 * The day boundary is UTC everywhere. A local-timezone rollover would be
 * friendlier to a player in Auckland and would destroy the game: the whole
 * value of a daily puzzle is that everyone had the same one. "Word Stack 128
 * 4/6" is a brag only if the person reading it knows which word 128 was.
 * Roll over locally and two friends in different zones are comparing scores
 * on different words, a share button that quietly lies. So the UI states
 * UTC rather than letting a player discover it at 7pm.
 *
 * `dailyIndex` walks the pool with a stride rather than hashing the date
 * modulo its size. A hash is the obvious thing and it's wrong: collisions
 * are birthday-paradox frequent, so a 300-word list would repeat an answer
 * inside a month while three hundred other words sat unused. A stride
 * coprime to the pool size visits every entry once before repeating any,
 * and still doesn't walk the list in order the way `puzzleNumber % size`
 * would.
 */

import { hashString } from "@/lib/seeded-random";

/**
 * Day zero. Fixed forever: the puzzle number is a public, shareable label, so
 * moving this renumbers every puzzle anyone has ever posted.
 */
export const PUZZLE_EPOCH_DAY = "2026-01-01";

const MS_PER_DAY = 86_400_000;

/** A calendar day as `YYYY-MM-DD`, always UTC. This string is the storage key. */
export type PuzzleDay = string;

/** The UTC calendar day an instant falls on. */
export function puzzleDay(now: Date): PuzzleDay {
  return now.toISOString().slice(0, 10);
}

function dayStartMs(day: PuzzleDay): number {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) throw new Error(`Not a calendar day: ${day}`);
  return parsed;
}

/**
 * The number a player sees and shares. Days since the epoch, +1 so the
 * first puzzle is #1 rather than #0. Nobody brags about puzzle zero.
 */
export function puzzleNumber(day: PuzzleDay): number {
  return Math.round((dayStartMs(day) - dayStartMs(PUZZLE_EPOCH_DAY)) / MS_PER_DAY) + 1;
}

/** How long until the next puzzle, in ms. What the "next puzzle in 4:12:08" countdown reads. */
export function msUntilNextPuzzle(now: Date): number {
  const next = dayStartMs(puzzleDay(now)) + MS_PER_DAY;
  return Math.max(0, next - now.getTime());
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Which entry of a pool today's puzzle draws.
 *
 * `salt` separates the games: Word Stack and Connections must not advance
 * in lockstep, or a player who works out one list's order has learned
 * something about the other's.
 *
 * The stride is derived from the salt and then nudged up until it is
 * coprime to the pool size, which is what makes the walk a full cycle:
 * every entry is used once before any is used twice. Not a hash of the day;
 * see the note at the top of this file for why that repeats far sooner than
 * it looks like it should.
 */
export function dailyIndex(day: PuzzleDay, poolSize: number, salt: string): number {
  if (!Number.isInteger(poolSize) || poolSize <= 0) {
    throw new Error("A puzzle pool needs at least one entry.");
  }
  if (poolSize === 1) return 0;

  let stride = (hashString(`${salt}:stride`) % (poolSize - 1)) + 1;
  while (gcd(stride, poolSize) !== 1) stride = (stride % (poolSize - 1)) + 1;

  const offset = hashString(`${salt}:offset`) % poolSize;
  const n = puzzleNumber(day);
  // JS `%` keeps the sign of the dividend, so a day before the epoch would
  // index negatively without this. Cheap, and the alternative is a crash on a
  // clock skew nobody would think to test.
  return (((n * stride + offset) % poolSize) + poolSize) % poolSize;
}

/** Picks today's entry out of a pool. The pool never leaves the server; only the pick does. */
export function pickDaily<T>(pool: readonly T[], day: PuzzleDay, salt: string): T {
  return pool[dailyIndex(day, pool.length, salt)];
}
