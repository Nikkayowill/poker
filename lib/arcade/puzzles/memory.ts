/**
 * Memory Match -- pair the card backs against the clock.
 *
 * Sixteen cards face down in a four-by-four grid, eight matching ranks. Turn
 * two: a pair stays up, anything else goes back over. Pure and clock-free like
 * the rest of lib/arcade/puzzles -- the shuffle comes in as a `randomInt` and
 * the time comes in as a `Date`.
 *
 * ## The layout is dealt per player, not per day
 *
 * Every other daily here gives everybody the same board, and that is the point
 * of them: "Wordle 128 4/6" only means something because word 128 was the same
 * word for everyone. Memory is the one puzzle where a shared board would
 * destroy the game rather than make it. The whole test is whether *you*
 * remember where a card was, so a layout anyone could be told in advance is
 * not a harder or easier puzzle -- it is no puzzle at all, and a single
 * screenshot in a group chat would end it for everybody.
 *
 * So the board is shuffled per attempt and what is compared is the score:
 * everyone gets the same size grid, the same eight ranks and one attempt a
 * day, and posts their time and their turn count. That is a fair contest over
 * a fair board, which is what the shared-daily rule was actually protecting.
 *
 * ## The face-down cards are genuinely face down
 *
 * `toMemorySnapshot` sends `null` for every tile that is neither matched nor
 * currently turned over. Not a card marked hidden -- no card at all. A client
 * that held the layout could win in eight turns every time, and the score is
 * the only thing this game produces.
 */

import type { RandomInt } from "@/lib/game/deck";
import type { Card, Rank } from "@/lib/game/types";

/** Eight pairs, sixteen tiles, a four-by-four grid. Fits a phone without scrolling. */
export const MEMORY_PAIRS = 8;
export const MEMORY_TILES = MEMORY_PAIRS * 2;
export const MEMORY_COLUMNS = 4;

/**
 * The ranks in play. High cards, because they are the ones a player can tell
 * apart at a glance -- a grid of 2s through 9s is legible but not memorable,
 * and this game is entirely about what sticks.
 */
export const MEMORY_RANKS: readonly Rank[] = ["A", "K", "Q", "J", "10", "9", "8", "7"];

export type MemoryStatus = "playing" | "solved";

export interface MemoryRound {
  /** SECRET. Dropped by toMemorySnapshot for every tile not already shown. */
  tiles: Card[];
  /** Tile indices already paired off. Stays face up for the rest of the game. */
  matched: number[];
  /** Tile indices currently turned over -- at most two, and cleared by the next turn. */
  revealed: number[];
  /** Completed turns: one per pair of cards turned over. The score. */
  turns: number;
  status: MemoryStatus;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * A shuffled board.
 *
 * The two copies of a rank are dealt in different suits so the grid is
 * pleasant to look at; matching is by RANK, never by suit, which is what makes
 * the pair findable rather than a spot-the-difference.
 */
export function dealMemoryTiles(randomInt: RandomInt): Card[] {
  const tiles: Card[] = MEMORY_RANKS.flatMap((rank) => [
    { rank, suit: "spades" as const },
    { rank, suit: "hearts" as const },
  ]);
  // Fisher-Yates, the same shuffle lib/game/deck.ts uses, over the sixteen.
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(index + 1);
    [tiles[index], tiles[swapWith]] = [tiles[swapWith], tiles[index]];
  }
  return tiles;
}

export function startMemoryRound(tiles: Card[], now: Date): MemoryRound {
  if (tiles.length !== MEMORY_TILES) throw new Error(`A memory board is exactly ${MEMORY_TILES} tiles.`);
  return {
    tiles: [...tiles],
    matched: [],
    revealed: [],
    turns: 0,
    status: "playing",
    startedAt: now.toISOString(),
    finishedAt: null,
  };
}

/** A fresh, shuffled board. `makeDeck` is not used -- this needs eight ranks twice, not fifty-two once. */
export function dealMemoryRound(randomInt: RandomInt, now: Date): MemoryRound {
  return startMemoryRound(dealMemoryTiles(randomInt), now);
}

export type MemoryFlipProblem = "finished" | "out-of-range" | "already-matched" | "already-up";

/** Why a tile cannot be turned over, or null if it can. */
export function memoryFlipProblem(round: MemoryRound, index: number): MemoryFlipProblem | null {
  if (round.status !== "playing") return "finished";
  if (!Number.isInteger(index) || index < 0 || index >= MEMORY_TILES) return "out-of-range";
  if (round.matched.includes(index)) return "already-matched";
  // Turning the same card back over to "look again" would be a free peek that
  // costs no turn, which is the one way to cheat a memory game.
  if (round.revealed.includes(index)) return "already-up";
  return null;
}

/**
 * Turns a tile over.
 *
 * A pair of non-matching cards is left face up when the turn ends, so the
 * player can actually see what they got -- and is swept away by the *next*
 * flip rather than by a timer. That matters: a timer would race a slow
 * connection and take the cards away before they had been rendered, which is
 * the difference between a memory game and a reflex test.
 *
 * Inert on an illegal flip rather than throwing -- the service checks first.
 */
export function flipMemoryTile(round: MemoryRound, index: number, now: Date): MemoryRound {
  if (memoryFlipProblem(round, index)) return round;

  // Sweep a completed, unmatched turn before this one begins.
  const standing = round.revealed.length >= 2 ? [] : round.revealed;
  if (standing.includes(index)) return round;

  const revealed = [...standing, index];
  if (revealed.length < 2) return { ...round, revealed };

  const [first, second] = revealed;
  const turns = round.turns + 1;

  if (round.tiles[first].rank !== round.tiles[second].rank) {
    // Left up on purpose. The next flip clears them.
    return { ...round, revealed, turns };
  }

  const matched = [...round.matched, first, second];
  const solved = matched.length >= MEMORY_TILES;
  return {
    ...round,
    matched,
    revealed: [],
    turns,
    status: solved ? "solved" : "playing",
    finishedAt: solved ? now.toISOString() : null,
  };
}

/** How long the attempt took, in ms. Null while it is still running. */
export function memoryElapsedMs(round: Pick<MemoryRound, "startedAt" | "finishedAt">): number | null {
  if (!round.finishedAt) return null;
  return Math.max(0, Date.parse(round.finishedAt) - Date.parse(round.startedAt));
}

/**
 * The fewest turns the board can be finished in from a cold start.
 *
 * Eight -- one per pair -- and it is unreachable without luck, which is the
 * point of showing it: it is what a perfect run would look like, not a target.
 */
export const PERFECT_TURNS = MEMORY_PAIRS;

export function memoryOutcomeLabel(round: Pick<MemoryRound, "status" | "turns" | "matched">): string {
  if (round.status !== "solved") {
    const pairs = round.matched.length / 2;
    return pairs === 0 ? "Turn two cards" : `${pairs} of ${MEMORY_PAIRS} paired`;
  }
  return round.turns === PERFECT_TURNS ? "Perfect board" : `Cleared in ${round.turns}`;
}

/**
 * The board as the browser may see it.
 *
 * `board` holds a card only where one is genuinely face up -- matched, or
 * turned over this turn. Everywhere else it is `null`, and `tiles` is absent
 * from the type entirely. A client with the layout wins in eight turns every
 * time, and the score is the only thing this game produces.
 */
export interface MemorySnapshot {
  day: string;
  puzzleNumber: number;
  version: number;
  /** Null for a face-down tile. Not a hidden card -- no card. */
  board: (Card | null)[];
  matched: number[];
  revealed: number[];
  turns: number;
  status: MemoryStatus;
  pairs: number;
  columns: number;
  perfectTurns: number;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number | null;
}

export function toMemorySnapshot(
  round: MemoryRound,
  meta: { day: string; puzzleNumber: number; version: number },
): MemorySnapshot {
  const shown = new Set([...round.matched, ...round.revealed]);
  return {
    day: meta.day,
    puzzleNumber: meta.puzzleNumber,
    version: meta.version,
    board: round.tiles.map((card, index) => (shown.has(index) ? { ...card } : null)),
    matched: [...round.matched],
    revealed: [...round.revealed],
    turns: round.turns,
    status: round.status,
    pairs: MEMORY_PAIRS,
    columns: MEMORY_COLUMNS,
    perfectTurns: PERFECT_TURNS,
    startedAt: round.startedAt,
    finishedAt: round.finishedAt,
    elapsedMs: memoryElapsedMs(round),
  };
}
