import { describe, expect, it } from "vitest";
import {
  CONNECTIONS_LADDER_BY_PRESSURE,
  anteUpConnectionsPayout,
  connectionsDailyBonusMultiplier,
  connectionsStakeRules,
} from "./ante-up-connections";
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
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 0) })).toBe(4000);
  });

  it("pays less at each mistake tier: 1 -> 2.2x, 2 -> 1.2x, 3 -> 0.6x", () => {
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 1) })).toBe(2200);
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 2) })).toBe(1200);
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 3) })).toBe(600);
  });

  it("returns less than the wager for a win on the last life", () => {
    // Below 1x on purpose: a table where every win profits is what made the
    // wager risk-free. See WAGER_MULTIPLIER_BY_MISTAKES' own comment.
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 3) })).toBeLessThan(1000);
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

describe("connectionsStakeRules", () => {
  it.each([
    [0, 4, 0],
    [9_999, 4, 0],
    [10_000, 3, 1],
    [100_000, 2, 2],
    [1_000_000, 1, 3],
  ] as const)("a %i wager allows %i mistakes, band %i ladder", (wager, maxMistakes, band) => {
    expect(connectionsStakeRules(wager)).toEqual({ maxMistakes, ladder: CONNECTIONS_LADDER_BY_PRESSURE[band] });
  });

  it("names a rung for every win the mistake limit allows", () => {
    for (const wager of [500, 10_000, 100_000, 1_000_000]) {
      const { ladder, maxMistakes } = connectionsStakeRules(wager);
      expect(Object.keys(ladder)).toHaveLength(maxMistakes);
    }
  });

  it("profits only on a clean solve from 10k up, and the clean multiple shrinks by band", () => {
    const cleans = ([1, 2, 3] as const).map((band) => {
      const ladder = CONNECTIONS_LADDER_BY_PRESSURE[band];
      expect(ladder[0]).toBeGreaterThan(1);
      for (const [mistakes, multiplier] of Object.entries(ladder)) {
        if (mistakes !== "0") expect(multiplier).toBeLessThan(1);
      }
      return ladder[0];
    });
    expect(cleans).toEqual([...cleans].sort((a, b) => b - a));
  });

  it("pays a small-stake win on the last life a little over the stake", () => {
    const ladder = CONNECTIONS_LADDER_BY_PRESSURE[0];
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 3), ladder })).toBe(1050);
  });

  it("pays a 1M clean solve 1.6x", () => {
    const ladder = CONNECTIONS_LADDER_BY_PRESSURE[3];
    expect(anteUpConnectionsPayout({ wager: 1_000_000, puzzle: puzzle("won", 0), ladder })).toBe(1_600_000);
    // A rung the ladder does not name falls to the usual floor, never higher.
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 2), ladder })).toBe(600);
  });
});
