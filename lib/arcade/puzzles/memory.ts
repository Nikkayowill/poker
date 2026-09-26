/**
 * Memory Match: pair the card backs against the clock.
 *
 * Sixteen cards face down in a four-by-four grid, eight matching ranks. Turn
 * two: a pair stays up, anything else goes back over. Pure and clock-free like
 * the rest of lib/arcade/puzzles: the shuffle comes in as a `randomInt` and
 * the time comes in as a `Date`.
 *
 * The layout is dealt per player, not per day. Every other daily here gives
 * everybody the same board, and that is the point of them: "Word Stack 128
 * 4/6" only means something because word 128 was the same word for everyone.
 * Memory is the one puzzle where a shared board would destroy the game
 * rather than make it. The whole test is whether *you* remember where a card
 * was, so a layout anyone could be told in advance is not a harder or easier
 * puzzle, it is no puzzle at all, and a single screenshot in a group chat
 * would end it for everybody.
 *
 * So the board is shuffled per attempt and what is compared is the score:
 * everyone gets the same size grid, the same eight ranks and one attempt a
 * day, and posts their time and their turn count. That is a fair contest over
 * a fair board, which is what the shared-daily rule was actually protecting.
 *
 * The face-down cards are genuinely face down: `toMemorySnapshot` sends
 * `null` for every tile that is neither matched nor currently turned over.
 * Not a card marked hidden, no card at all. A client that held the layout
 * could win in eight turns every time, and the score is the only thing this
 * game produces.
 */

import type { RandomInt } from "@/lib/game/deck";
import type { Card, Rank } from "@/lib/game/types";

/** Eight pairs, sixteen tiles, a four-by-four grid. Fits a phone without scrolling. */
export const MEMORY_PAIRS = 8;
export const MEMORY_TILES = MEMORY_PAIRS * 2;
export const MEMORY_COLUMNS = 4;

/** The biggest board a big stake deals: fifteen pairs, six by five. */
export const MEMORY_MAX_PAIRS = 15;
export const MEMORY_MAX_TILES = MEMORY_MAX_PAIRS * 2;

/**
 * The ranks in play, high first. The standard board uses the top eight,
 * because high cards are the ones a player can tell apart at a glance.
 * Bigger boards reach further down.
 */
export const MEMORY_RANKS: readonly Rank[] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];

/**
 * Grid columns for a board of this many pairs. Bigger boards go wider rather
 * than taller so they still fit a phone screen.
 */
export function memoryColumnsFor(pairs: number): number {
  if (pairs <= 8) return 4;
  if (pairs <= 10) return 5;
  return 6;
}

/** How many pairs a round holds. Read off the tiles, so old 16-tile rounds need no new field. */
export function memoryPairsOf(round: Pick<MemoryRound, "tiles">): number {
  return round.tiles.length / 2;
}

/**
 * Whether two tiles pair off. By rank, until a board has more pairs than
 * there are ranks: then each rank can show up as a black pair and a red pair,
 * so colour has to match too.
 */
export function memoryTilesMatch(a: Card, b: Card, pairs: number): boolean {
  if (a.rank !== b.rank) return false;
  if (pairs <= MEMORY_RANKS.length) return true;
  return isRed(a) === isRed(b);
}

function isRed(card: Card): boolean {
  return card.suit === "hearts" || card.suit === "diamonds";
}

export type MemoryStatus = "playing" | "solved";

export interface MemoryRound {
  /** SECRET. Dropped by toMemorySnapshot for every tile not already shown. */
  tiles: Card[];
  /** Tile indices already paired off. Stays face up for the rest of the game. */
  matched: number[];
  /** Tile indices currently turned over. At most two, and cleared by the next turn. */
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
 * Up to thirteen pairs, the two copies of a rank are dealt in different suits
 * so the grid is pleasant to look at, and matching is by rank alone. Past
 * thirteen every rank is a black pair (spades and clubs) and the extra pairs
 * reuse the top ranks in red (hearts and diamonds); see memoryTilesMatch.
 */
export function dealMemoryTiles(randomInt: RandomInt, pairs: number = MEMORY_PAIRS): Card[] {
  if (!Number.isInteger(pairs) || pairs < 2 || pairs > MEMORY_MAX_PAIRS) {
    throw new Error(`A memory board is 2 to ${MEMORY_MAX_PAIRS} pairs.`);
  }
  const tiles: Card[] =
    pairs <= MEMORY_RANKS.length
      ? MEMORY_RANKS.slice(0, pairs).flatMap((rank) => [
        { rank, suit: "spades" as const },
        { rank, suit: "hearts" as const },
      ])
      : [
        ...MEMORY_RANKS.flatMap((rank) => [
          { rank, suit: "spades" as const },
          { rank, suit: "clubs" as const },
        ]),
        ...MEMORY_RANKS.slice(0, pairs - MEMORY_RANKS.length).flatMap((rank) => [
          { rank, suit: "hearts" as const },
          { rank, suit: "diamonds" as const },
        ]),
      ];
  // Fisher-Yates, the same shuffle lib/game/deck.ts uses.
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(index + 1);
    [tiles[index], tiles[swapWith]] = [tiles[swapWith], tiles[index]];
  }
  return tiles;
}

export function startMemoryRound(tiles: Card[], now: Date): MemoryRound {
  if (tiles.length % 2 !== 0 || tiles.length < 4 || tiles.length > MEMORY_MAX_TILES) {
    throw new Error(`A memory board is an even number of tiles, at most ${MEMORY_MAX_TILES}.`);
  }
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

/** A fresh, shuffled board. `makeDeck` is not used: this needs eight ranks twice, not fifty-two once. */
export function dealMemoryRound(randomInt: RandomInt, now: Date, pairs: number = MEMORY_PAIRS): MemoryRound {
  return startMemoryRound(dealMemoryTiles(randomInt, pairs), now);
}

export type MemoryFlipProblem = "finished" | "out-of-range" | "already-matched" | "already-up";

/** Why a tile cannot be turned over, or null if it can. */
export function memoryFlipProblem(round: MemoryRound, index: number): MemoryFlipProblem | null {
  if (round.status !== "playing") return "finished";
  if (!Number.isInteger(index) || index < 0 || index >= round.tiles.length) return "out-of-range";
  if (round.matched.includes(index)) return "already-matched";
  // Turning the same card back over to "look again" would be a free peek
  // that costs no turn: the one way to cheat a memory game.
  if (round.revealed.includes(index)) return "already-up";
  return null;
}

/**
 * Turns a tile over.
 *
 * A pair of non-matching cards is left face up when the turn ends, so the
 * player can actually see what they got, and is swept away by the *next*
 * flip rather than by a timer. That matters: a timer would race a slow
 * connection and take the cards away before they had been rendered, which is
 * the difference between a memory game and a reflex test.
 *
 * Inert on an illegal flip rather than throwing; the service checks first.
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

  if (!memoryTilesMatch(round.tiles[first], round.tiles[second], memoryPairsOf(round))) {
    // Left face up; the next flip clears them.
    return { ...round, revealed, turns };
  }

  const matched = [...round.matched, first, second];
  const solved = matched.length >= round.tiles.length;
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
 * Eight, one per pair, and it is unreachable without luck, which is the
 * point of showing it: it is what a perfect run would look like, not a target.
 */
export const PERFECT_TURNS = MEMORY_PAIRS;

/**
 * The board as the browser may see it.
 *
 * `board` holds a card only where one is genuinely face up: matched, or
 * turned over this turn. Everywhere else it is `null`, and `tiles` is absent
 * from the type entirely. A client with the layout wins in eight turns every
 * time, and the score is the only thing this game produces.
 */
export interface MemorySnapshot {
  day: string;
  puzzleNumber: number;
  version: number;
  /** Null for a face-down tile. Not a hidden card, no card. */
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
    pairs: memoryPairsOf(round),
    columns: memoryColumnsFor(memoryPairsOf(round)),
    perfectTurns: memoryPairsOf(round),
    startedAt: round.startedAt,
    finishedAt: round.finishedAt,
    elapsedMs: memoryElapsedMs(round),
  };
}
