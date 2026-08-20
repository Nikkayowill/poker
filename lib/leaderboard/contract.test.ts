import { describe, expect, it } from "vitest";
import { DUEL_GAMES } from "@/lib/pvp/registry";
import { LEADERBOARD_GAMES, isLeaderboardGameId, leaderboardGame, leaderboardTabs } from "./contract";

describe("registry completeness", () => {
  it("has a leaderboard entry for every duel lib/pvp offers", () => {
    for (const gameId of Object.keys(DUEL_GAMES)) {
      expect(LEADERBOARD_GAMES[gameId], `missing leaderboard contract for duel "${gameId}"`).toBeDefined();
      expect(LEADERBOARD_GAMES[gameId].kind).toBe("win_loss_record");
    }
  });

  it("also covers cribbage and memory-match, which have no lib/pvp entry", () => {
    expect(LEADERBOARD_GAMES.cribbage).toBeDefined();
    expect(LEADERBOARD_GAMES["memory-match"]).toBeDefined();
  });

  it("keys every entry's gameId to match its own registry key", () => {
    for (const [key, contract] of Object.entries(LEADERBOARD_GAMES)) {
      expect(contract.gameId).toBe(key);
    }
  });
});

describe("leaderboardTabs", () => {
  it("leads with poker and global, then every registered game", () => {
    const tabs = leaderboardTabs();
    expect(tabs[0]).toEqual({ id: "poker", label: "Poker" });
    expect(tabs[1]).toEqual({ id: "global", label: "Global" });
    expect(tabs.slice(2).map((tab) => tab.id).sort()).toEqual(Object.keys(LEADERBOARD_GAMES).sort());
  });
});

describe("leaderboardGame / isLeaderboardGameId", () => {
  it("resolves a known id and rejects an unknown one", () => {
    expect(leaderboardGame("chess")).not.toBeNull();
    expect(leaderboardGame("checkers")).not.toBeNull();
    expect(leaderboardGame("solitaire")).toBeNull();
    expect(isLeaderboardGameId("cribbage")).toBe(true);
    expect(isLeaderboardGameId("poker")).toBe(false);
    expect(isLeaderboardGameId(42)).toBe(false);
  });
});

describe("formatRow", () => {
  it("formats a win/loss record with a percentage and a readable streak", () => {
    const chess = LEADERBOARD_GAMES.chess;
    const row = chess.formatRow({
      wins: 7, losses: 3, draws: 0, metricSum: 0, metricCount: 0, currentStreak: 3, bestStreak: 5,
    });
    expect(row.record).toBe("7-3");
    expect(row.winRate).toBe("70%");
    expect(row.streak).toBe("W3");
  });

  it("reads a negative streak as a loss streak, and zero as a dash", () => {
    const chess = LEADERBOARD_GAMES.chess;
    expect(chess.formatRow({ wins: 1, losses: 4, draws: 0, metricSum: 0, metricCount: 0, currentStreak: -2, bestStreak: 1 }).streak).toBe("L2");
    expect(chess.formatRow({ wins: 0, losses: 0, draws: 1, metricSum: 0, metricCount: 0, currentStreak: 0, bestStreak: 0 }).streak).toBe("—");
  });

  it("never divides by zero when nobody has played yet", () => {
    const chess = LEADERBOARD_GAMES.chess;
    const row = chess.formatRow({ wins: 0, losses: 0, draws: 0, metricSum: 0, metricCount: 0, currentStreak: 0, bestStreak: 0 });
    expect(row.winRate).toBe("0%");
  });

  it("averages Memory Match's turns, lower being better, and shows a dash with no rounds", () => {
    const memory = LEADERBOARD_GAMES["memory-match"];
    expect(memory.direction).toBe("lower_better");
    const row = memory.formatRow({ wins: 0, losses: 0, draws: 0, metricSum: 32, metricCount: 4, currentStreak: 0, bestStreak: 0 });
    expect(row.avgTurns).toBe("8.0");
    expect(row.rounds).toBe("4");

    const empty = memory.formatRow({ wins: 0, losses: 0, draws: 0, metricSum: 0, metricCount: 0, currentStreak: 0, bestStreak: 0 });
    expect(empty.avgTurns).toBe("—");
  });
});
