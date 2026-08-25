import { describe, expect, it } from "vitest";
import {
  ANTE_UP_MEMORY_MAX_TURNS,
  MIN_ANTE_UP_WAGER,
  anteUpMemoryFlipProblem,
  anteUpMemoryPayout,
  flipAnteUpMemoryTile,
  resignAnteUpMemory,
  startAnteUpMemory,
  toAnteUpMemorySnapshot,
  wagerMultiplierForTurns,
  type AnteUpMemoryAttempt,
} from "./ante-up-memory";
import {
  MEMORY_PAIRS,
  MEMORY_RANKS,
  dealMemoryRound,
  startMemoryRound,
  type MemoryRound,
} from "./puzzles/memory";
import type { Card } from "@/lib/game/types";

const START = new Date("2026-08-21T12:00:00Z");

/** A board laid out in a known order: pairs sit side by side, 0-1, 2-3, and so on -- same idiom memory.test.ts uses. */
function orderedTiles(): Card[] {
  return MEMORY_RANKS.flatMap((rank) => [
    { rank, suit: "spades" as const },
    { rank, suit: "hearts" as const },
  ]);
}

function orderedAttempt(wager: number, now: Date): AnteUpMemoryAttempt {
  return {
    wager,
    board: startMemoryRound(orderedTiles(), now),
    status: "active",
    startedAt: now.toISOString(),
  };
}

/** Turns matching pair `n` over on an ordered attempt -- one turn, always a match. */
function takeMatchedPair(attempt: AnteUpMemoryAttempt, pair: number, now = START): AnteUpMemoryAttempt {
  const first = flipAnteUpMemoryTile(attempt, pair * 2, now);
  return flipAnteUpMemoryTile(first, pair * 2 + 1, now);
}

/** Clears the whole board in the fewest turns -- pairs 0..7, in order. */
function clearBoard(attempt: AnteUpMemoryAttempt, now = START): AnteUpMemoryAttempt {
  let current = attempt;
  for (let pair = 0; pair < MEMORY_PAIRS; pair += 1) current = takeMatchedPair(current, pair, now);
  return current;
}

/**
 * Drives an ordered board to `targetTurns` turns without ever matching a
 * pair, by clicking through one tile per rank (indices 0,2,4,...,14 -- the
 * "spades" half of every rank on an ordered board) in rotation. Consecutive
 * clicks always land on different ranks, so every turn is a mismatch; by the
 * time a cycle repeats an index it was long since swept by a later flip.
 */
function forceMismatches(attempt: AnteUpMemoryAttempt, targetTurns: number, now = START): AnteUpMemoryAttempt {
  const cycle = [0, 2, 4, 6, 8, 10, 12, 14];
  let current = attempt;
  let step = 0;
  while (current.status === "active" && current.board.turns < targetTurns) {
    current = flipAnteUpMemoryTile(current, cycle[step % cycle.length], now);
    step += 1;
    if (step > 200) throw new Error("stuck forcing mismatches");
  }
  return current;
}

function fakeSolvedBoard(turns: number): MemoryRound {
  const round = dealMemoryRound((max) => max - 1, START);
  return { ...round, status: "solved", turns, finishedAt: START.toISOString() };
}

describe("startAnteUpMemory", () => {
  it("deals a fresh, active board carrying the wager", () => {
    const attempt = startAnteUpMemory((max) => max - 1, 1000, START);
    expect(attempt.status).toBe("active");
    expect(attempt.wager).toBe(1000);
    expect(attempt.board.status).toBe("playing");
    expect(attempt.board.tiles).toHaveLength(16);
    expect(attempt.startedAt).toBe(START.toISOString());
  });

  it("deals a different layout for a different shuffle", () => {
    const a = startAnteUpMemory(() => 0, 0, START);
    const b = startAnteUpMemory((max) => max - 1, 0, START);
    expect(a.board.tiles).not.toEqual(b.board.tiles);
  });
});

describe("flipAnteUpMemoryTile", () => {
  it("wins the moment the board clears, whatever turn it happens on", () => {
    const attempt = orderedAttempt(1000, START);
    const solved = clearBoard(attempt, START);
    expect(solved.status).toBe("won");
    expect(solved.board.status).toBe("solved");
    expect(solved.board.turns).toBe(MEMORY_PAIRS);
  });

  it("stays active up through exactly the turn cap", () => {
    const atCap = forceMismatches(orderedAttempt(500, START), ANTE_UP_MEMORY_MAX_TURNS, START);
    expect(atCap.status).toBe("active");
    expect(atCap.board.turns).toBe(ANTE_UP_MEMORY_MAX_TURNS);
  });

  it("forfeits the instant a flip pushes turns past the cap", () => {
    const forfeited = forceMismatches(orderedAttempt(500, START), ANTE_UP_MEMORY_MAX_TURNS + 1, START);
    expect(forfeited.status).toBe("lost");
    expect(forfeited.board.turns).toBe(ANTE_UP_MEMORY_MAX_TURNS + 1);
  });

  it("refuses a flip once the attempt is over, without touching state", () => {
    const attempt = orderedAttempt(500, START);
    const finished = resignAnteUpMemory(attempt);
    expect(anteUpMemoryFlipProblem(finished, 0)).toBe("finished");
    expect(flipAnteUpMemoryTile(finished, 0, START)).toBe(finished);
  });
});

describe("resignAnteUpMemory", () => {
  it("ends an active attempt as a loss", () => {
    const attempt = orderedAttempt(500, START);
    expect(resignAnteUpMemory(attempt).status).toBe("lost");
  });

  it("is a no-op on an attempt that already ended", () => {
    const attempt = orderedAttempt(500, START);
    const won = clearBoard(attempt, START);
    expect(resignAnteUpMemory(won).status).toBe("won");
  });
});

describe("anteUpMemoryPayout", () => {
  it("pays nothing while the board is unsolved", () => {
    const attempt = orderedAttempt(1000, START);
    expect(anteUpMemoryPayout(attempt)).toBe(0);
  });

  it("pays nothing on a zero (practice) wager, even solved", () => {
    expect(anteUpMemoryPayout({ wager: 0, board: fakeSolvedBoard(MEMORY_PAIRS) })).toBe(0);
  });

  it("scales the multiplier down as turns climb toward the cap", () => {
    expect(anteUpMemoryPayout({ wager: 1000, board: fakeSolvedBoard(MEMORY_PAIRS) })).toBe(6000); // <=8
    expect(anteUpMemoryPayout({ wager: 1000, board: fakeSolvedBoard(10) })).toBe(4000); // <=10
    expect(anteUpMemoryPayout({ wager: 1000, board: fakeSolvedBoard(13) })).toBe(2500); // <=13
    expect(anteUpMemoryPayout({ wager: 1000, board: fakeSolvedBoard(16) })).toBe(1500); // <=16
    expect(anteUpMemoryPayout({ wager: 1000, board: fakeSolvedBoard(20) })).toBe(1200); // 17-20, still a real win
  });

  it("rounds to a whole Gold amount", () => {
    expect(anteUpMemoryPayout({ wager: 333, board: fakeSolvedBoard(13) })).toBe(Math.round(333 * 2.5));
  });
});

describe("wagerMultiplierForTurns", () => {
  // Exported so the board can show a live "cash out ~X now" figure while
  // playing -- attempt.payout itself is 0 for the whole game (see
  // anteUpMemoryPayout above), so the client needs this same formula
  // callable against the in-progress turn count. Pins the same ladder
  // anteUpMemoryPayout's own test exercises through a solved board, this
  // time directly against turns so a change to one cannot silently drift
  // from the other.
  it("matches the tier ladder anteUpMemoryPayout pays out on a win", () => {
    expect(wagerMultiplierForTurns(MEMORY_PAIRS)).toBe(6);
    expect(wagerMultiplierForTurns(10)).toBe(4);
    expect(wagerMultiplierForTurns(13)).toBe(2.5);
    expect(wagerMultiplierForTurns(16)).toBe(1.5);
    expect(wagerMultiplierForTurns(20)).toBe(1.2);
  });
});

describe("toAnteUpMemorySnapshot", () => {
  it("never carries the tiles", () => {
    const attempt = orderedAttempt(500, START);
    const snap = toAnteUpMemorySnapshot(attempt, { id: "a1", version: 1 }) as unknown as Record<string, unknown>;
    expect(snap.tiles).toBeUndefined();
    expect(JSON.stringify(snap)).not.toContain('"tiles"');
  });

  it("sends no card for a face-down tile, and reveals only what is face up", () => {
    const flipped = flipAnteUpMemoryTile(orderedAttempt(500, START), 0, START);
    const snap = toAnteUpMemorySnapshot(flipped, { id: "a1", version: 1 });
    expect(snap.board[0]).toEqual(flipped.board.tiles[0]);
    snap.board.forEach((tile, index) => {
      if (index !== 0) expect(tile).toBeNull();
    });
  });

  it("carries the turn cap and states the payout as settled, not left for the client to compute", () => {
    const active = orderedAttempt(1000, START);
    const activeSnap = toAnteUpMemorySnapshot(active, { id: "a1", version: 1 });
    expect(activeSnap.maxTurns).toBe(ANTE_UP_MEMORY_MAX_TURNS);
    expect(activeSnap.pairs).toBe(MEMORY_PAIRS);
    expect(activeSnap.payout).toBe(0);

    const won = clearBoard(active, START);
    const wonSnap = toAnteUpMemorySnapshot(won, { id: "a1", version: 1 });
    expect(wonSnap.status).toBe("won");
    expect(wonSnap.payout).toBe(anteUpMemoryPayout(won));
    expect(wonSnap.payout).toBeGreaterThan(0);
  });
});

describe("MIN_ANTE_UP_WAGER", () => {
  it("is the same floor every Ante Up game shares", () => {
    expect(MIN_ANTE_UP_WAGER).toBe(500);
  });
});
