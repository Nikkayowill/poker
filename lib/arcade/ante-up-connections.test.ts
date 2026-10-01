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

  it("pays less at each mistake tier: 1 -> 2.2x, 2 -> 1.5x, 3 -> 1.15x", () => {
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 1) })).toBe(2200);
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 2) })).toBe(1500);
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 3) })).toBe(1150);
  });

  it("returns more than the wager for a win on the last life, but less than a clean solve", () => {
    const last = anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 3) });
    expect(last).toBeGreaterThan(1000);
    expect(last).toBeLessThan(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 0) }));
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
    [24_999, 4, 0],
    [25_000, 3, 1],
    [100_000, 2, 2],
    [500_000, 2, 3],
    [1_000_000, 1, 4],
  ] as const)("a %i wager allows %i mistakes, band %i ladder", (wager, maxMistakes, band) => {
    expect(connectionsStakeRules(wager)).toEqual({ maxMistakes, ladder: CONNECTIONS_LADDER_BY_PRESSURE[band] });
  });

  it("names a rung for every win the mistake limit allows", () => {
    for (const wager of [500, 25_000, 100_000, 500_000, 1_000_000]) {
      const { ladder, maxMistakes } = connectionsStakeRules(wager);
      expect(Object.keys(ladder)).toHaveLength(maxMistakes);
    }
  });

  it("pays more than the stake on every win in every band, and a bigger clean solve in every band up", () => {
    const bands = ([0, 1, 2, 3, 4] as const).map((band) => CONNECTIONS_LADDER_BY_PRESSURE[band]);
    for (const ladder of bands) {
      for (const multiplier of Object.values(ladder)) expect(multiplier).toBeGreaterThan(1);
    }
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i][0]).toBeGreaterThanOrEqual(bands[i - 1][0]);
      for (const [mistakes, multiplier] of Object.entries(bands[i])) {
        if (mistakes in bands[i - 1]) expect(multiplier).toBeGreaterThanOrEqual(bands[i - 1][Number(mistakes)]);
      }
    }
  });

  it("pays an Easy win on the last life a little over the stake", () => {
    const ladder = CONNECTIONS_LADDER_BY_PRESSURE[0];
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 3), ladder })).toBe(1060);
  });

  it("pays a 1M clean solve 5.65x", () => {
    const ladder = CONNECTIONS_LADDER_BY_PRESSURE[4];
    expect(anteUpConnectionsPayout({ wager: 1_000_000, puzzle: puzzle("won", 0), ladder })).toBe(5_650_000);
    // A rung the ladder does not name falls to the least any win pays, never higher.
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 2), ladder })).toBe(1050);
  });
});
