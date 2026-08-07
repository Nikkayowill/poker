import { describe, expect, it } from "vitest";
import {
  MEMORY_COLUMNS,
  MEMORY_PAIRS,
  MEMORY_RANKS,
  MEMORY_TILES,
  PERFECT_TURNS,
  dealMemoryRound,
  dealMemoryTiles,
  flipMemoryTile,
  memoryElapsedMs,
  memoryFlipProblem,
  memoryOutcomeLabel,
  startMemoryRound,
  toMemorySnapshot,
  type MemoryRound,
} from "./memory";
import type { Card } from "@/lib/game/types";

const START = new Date("2026-08-06T12:00:00Z");
const LATER = new Date("2026-08-06T12:03:44Z");

/** A board laid out in a known order: pairs sit side by side, 0-1, 2-3, and so on. */
function orderedTiles(): Card[] {
  return MEMORY_RANKS.flatMap((rank) => [
    { rank, suit: "spades" as const },
    { rank, suit: "hearts" as const },
  ]);
}

function orderedRound(): MemoryRound {
  return startMemoryRound(orderedTiles(), START);
}

/** Turns over both halves of pair `n` on an ordered board. */
function takePair(round: MemoryRound, pair: number, now = START): MemoryRound {
  const first = flipMemoryTile(round, pair * 2, now);
  return flipMemoryTile(first, pair * 2 + 1, now);
}

describe("the board", () => {
  it("is sixteen tiles, eight ranks twice, in a four-wide grid", () => {
    expect(MEMORY_TILES).toBe(16);
    expect(MEMORY_PAIRS).toBe(8);
    expect(MEMORY_COLUMNS).toBe(4);
    expect(MEMORY_RANKS).toHaveLength(MEMORY_PAIRS);
    expect(new Set(MEMORY_RANKS).size).toBe(MEMORY_PAIRS);
  });

  it("deals exactly two of every rank", () => {
    const counts = new Map<string, number>();
    for (const tile of dealMemoryTiles((max) => max - 1)) {
      counts.set(tile.rank, (counts.get(tile.rank) ?? 0) + 1);
    }
    expect(counts.size).toBe(MEMORY_PAIRS);
    for (const count of counts.values()) expect(count).toBe(2);
  });

  it("gives the two copies of a rank different suits, so the grid is not a spot-the-difference", () => {
    const tiles = dealMemoryTiles((max) => max - 1);
    for (const rank of MEMORY_RANKS) {
      const suits = tiles.filter((tile) => tile.rank === rank).map((tile) => tile.suit);
      expect(new Set(suits).size).toBe(2);
    }
  });

  it("actually shuffles", () => {
    const straight = dealMemoryTiles(() => 0);
    const other = dealMemoryTiles((max) => max - 1);
    expect(straight).not.toEqual(other);
  });

  it("refuses a board that is not the right size", () => {
    expect(() => startMemoryRound([], START)).toThrow(/exactly 16 tiles/);
  });
});

describe("flipMemoryTile", () => {
  it("turns one card over without ending a turn", () => {
    const round = flipMemoryTile(orderedRound(), 0, START);
    expect(round.revealed).toEqual([0]);
    expect(round.turns).toBe(0);
    expect(round.matched).toEqual([]);
  });

  it("keeps a matching pair up and counts the turn", () => {
    const round = takePair(orderedRound(), 0);
    expect(round.matched).toEqual([0, 1]);
    expect(round.revealed).toEqual([]);
    expect(round.turns).toBe(1);
  });

  it("leaves a non-matching pair face up so the player can see it", () => {
    // Swept by the NEXT flip rather than by a timer -- a timer would race a
    // slow connection and take the cards away before they had been rendered.
    const first = flipMemoryTile(orderedRound(), 0, START);
    const round = flipMemoryTile(first, 2, START);
    expect(round.revealed).toEqual([0, 2]);
    expect(round.matched).toEqual([]);
    expect(round.turns).toBe(1);
  });

  it("sweeps a standing non-match when the next card is turned", () => {
    const first = flipMemoryTile(orderedRound(), 0, START);
    const missed = flipMemoryTile(first, 2, START);
    const next = flipMemoryTile(missed, 4, START);
    expect(next.revealed).toEqual([4]);
    expect(next.turns).toBe(1);
  });

  it("refuses a free peek at a card already face up", () => {
    // Turning the same card again to "look once more" would cost no turn,
    // which is the one way to cheat a memory game.
    const round = flipMemoryTile(orderedRound(), 0, START);
    expect(memoryFlipProblem(round, 0)).toBe("already-up");
    expect(flipMemoryTile(round, 0, START)).toBe(round);
  });

  it("refuses a card already matched", () => {
    const round = takePair(orderedRound(), 0);
    expect(memoryFlipProblem(round, 0)).toBe("already-matched");
    expect(flipMemoryTile(round, 0, START)).toBe(round);
  });

  it("refuses an index off the board", () => {
    const round = orderedRound();
    expect(memoryFlipProblem(round, -1)).toBe("out-of-range");
    expect(memoryFlipProblem(round, MEMORY_TILES)).toBe("out-of-range");
    expect(memoryFlipProblem(round, 1.5)).toBe("out-of-range");
  });

  it("solves the board on the last pair and stamps the clock", () => {
    let round = orderedRound();
    for (let pair = 0; pair < MEMORY_PAIRS; pair += 1) round = takePair(round, pair, LATER);
    expect(round.status).toBe("solved");
    expect(round.matched).toHaveLength(MEMORY_TILES);
    expect(round.turns).toBe(PERFECT_TURNS);
    expect(round.finishedAt).toBe(LATER.toISOString());
  });

  it("is inert once cleared", () => {
    let round = orderedRound();
    for (let pair = 0; pair < MEMORY_PAIRS; pair += 1) round = takePair(round, pair);
    expect(memoryFlipProblem(round, 0)).toBe("finished");
    expect(flipMemoryTile(round, 0, START)).toBe(round);
  });

  it("does not mutate the round it was given", () => {
    const round = orderedRound();
    flipMemoryTile(round, 0, START);
    expect(round.revealed).toEqual([]);
    expect(round.turns).toBe(0);
  });
});

describe("the clock", () => {
  it("reports nothing while running and a duration once cleared", () => {
    expect(memoryElapsedMs(orderedRound())).toBeNull();
    expect(memoryElapsedMs({ startedAt: START.toISOString(), finishedAt: LATER.toISOString() })).toBe(224_000);
  });

  it("never reports a negative duration", () => {
    expect(memoryElapsedMs({ startedAt: LATER.toISOString(), finishedAt: START.toISOString() })).toBe(0);
  });
});

describe("toMemorySnapshot", () => {
  const meta = { day: "2026-08-06", puzzleNumber: 218, version: 1 };

  it("sends no card at all for a face-down tile", () => {
    const snapshot = toMemorySnapshot(orderedRound(), meta);
    expect(snapshot.board).toHaveLength(MEMORY_TILES);
    expect(snapshot.board.every((tile) => tile === null)).toBe(true);
    // Not a card flagged hidden -- absent. A client with the layout clears the
    // board in eight turns, and the turn count is the entire score.
    expect("tiles" in snapshot).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('"tiles"');
  });

  it("reveals exactly the tiles that are face up, and no others", () => {
    const round = flipMemoryTile(orderedRound(), 5, START);
    const snapshot = toMemorySnapshot(round, meta);
    expect(snapshot.board[5]).toEqual(round.tiles[5]);
    snapshot.board.forEach((tile, index) => {
      if (index !== 5) expect(tile).toBeNull();
    });
  });

  it("keeps matched tiles visible for the rest of the game", () => {
    const round = flipMemoryTile(takePair(orderedRound(), 0), 4, START);
    const snapshot = toMemorySnapshot(round, meta);
    expect(snapshot.board[0]).not.toBeNull();
    expect(snapshot.board[1]).not.toBeNull();
    expect(snapshot.board[4]).not.toBeNull();
    expect(snapshot.board[5]).toBeNull();
  });

  it("does not leak the partner of a card turned over on its own", () => {
    // The single most valuable thing a cheat could learn: where the other
    // copy of the visible card is.
    const round = flipMemoryTile(orderedRound(), 0, START);
    const snapshot = toMemorySnapshot(round, meta);
    expect(snapshot.board[1]).toBeNull();
  });

  it("copies the cards, so a caller cannot reach back into the round", () => {
    const round = flipMemoryTile(orderedRound(), 0, START);
    const snapshot = toMemorySnapshot(round, meta);
    snapshot.board[0]!.rank = "2";
    expect(round.tiles[0].rank).not.toBe("2");
  });
});

describe("dealMemoryRound", () => {
  it("opens a playable board with the clock running", () => {
    const round = dealMemoryRound((max) => max - 1, START);
    expect(round.tiles).toHaveLength(MEMORY_TILES);
    expect(round.status).toBe("playing");
    expect(round.startedAt).toBe(START.toISOString());
    expect(round.finishedAt).toBeNull();
  });
});

describe("memoryOutcomeLabel", () => {
  it("names each state without saying `undefined`", () => {
    expect(memoryOutcomeLabel(orderedRound())).toBe("Turn two cards");
    expect(memoryOutcomeLabel(takePair(orderedRound(), 0))).toBe("1 of 8 paired");

    let perfect = orderedRound();
    for (let pair = 0; pair < MEMORY_PAIRS; pair += 1) perfect = takePair(perfect, pair);
    expect(memoryOutcomeLabel(perfect)).toBe("Perfect board");

    expect(memoryOutcomeLabel({ status: "solved", turns: 14, matched: [] })).toBe("Cleared in 14");
  });
});
