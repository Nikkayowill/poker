import { describe, expect, it } from "vitest";
import { anteUpConnectionsPayout, connectionsDailyBonusMultiplier } from "./ante-up-connections";
import type { ConnectionsRound } from "./puzzles/connections";

function puzzle(status: ConnectionsRound["status"], mistakes: number): Pick<ConnectionsRound, "status" | "mistakes"> {
  return { status, mistakes };
}

describe("anteUpConnectionsPayout", () => {
  it("pays nothing on anything but a win", () => {
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("active", 0) })).toBe(0);
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("lost", 4) })).toBe(0);
  });

  it("pays the top multiplier for a clean solve", () => {
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 0) })).toBe(8000);
  });

  it("pays less at each mistake tier: 1 -> 5x, 2 -> 3x, 3 -> 1.5x", () => {
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 1) })).toBe(5000);
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 2) })).toBe(3000);
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 3) })).toBe(1500);
  });

  it("pays nothing on a zero (free) wager, even on a win", () => {
    expect(anteUpConnectionsPayout({ wager: 0, puzzle: puzzle("won", 0) })).toBe(0);
  });
});

describe("connectionsDailyBonusMultiplier", () => {
  it("floors a loss at 1.0x", () => {
    expect(connectionsDailyBonusMultiplier(puzzle("lost", 4))).toBe(1.0);
  });

  it("scales down from a clean solve to a near-loss win", () => {
    expect(connectionsDailyBonusMultiplier(puzzle("won", 0))).toBe(3.0);
    expect(connectionsDailyBonusMultiplier(puzzle("won", 1))).toBe(2.0);
    expect(connectionsDailyBonusMultiplier(puzzle("won", 2))).toBe(1.5);
    expect(connectionsDailyBonusMultiplier(puzzle("won", 3))).toBe(1.1);
  });
});
