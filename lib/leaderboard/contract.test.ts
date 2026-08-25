import { describe, expect, it } from "vitest";
import { DUEL_GAMES } from "@/lib/pvp/registry";
import {
  LEADERBOARD_GAMES,
  formatRecord,
  formatStreak,
  isHeadToHeadGame,
  isLeaderboardGameId,
  leaderboardGame,
  leaderboardTabs,
} from "./contract";

describe("registry completeness", () => {
  it("has a leaderboard entry for every duel lib/pvp offers", () => {
    for (const gameId of Object.keys(DUEL_GAMES)) {
      expect(LEADERBOARD_GAMES[gameId], `missing leaderboard contract for duel "${gameId}"`).toBeDefined();
      expect(LEADERBOARD_GAMES[gameId].columns.map((column) => column.key)).toEqual(["record", "winRate", "streak"]);
    }
  });

  it("also covers cribbage, which has no lib/pvp entry", () => {
    expect(LEADERBOARD_GAMES.cribbage).toBeDefined();
  });

  it("registers no solo Ante Up game", () => {
    // The rule this file's header states. Named one by one rather than
    // derived from the arcade catalog, so adding a solo game there can never
    // quietly re-satisfy this test by changing what it checks.
    for (const soloGame of ["memory-match", "daily-sudoku", "minesweeper", "daily-word-stack", "connections"]) {
      expect(LEADERBOARD_GAMES[soloGame], `"${soloGame}" is solo and must not have a leaderboard`).toBeUndefined();
    }
  });

  it("keys every entry's gameId to match its own registry key", () => {
    for (const [key, contract] of Object.entries(LEADERBOARD_GAMES)) {
      expect(contract.gameId).toBe(key);
    }
  });
});

describe("leaderboardTabs", () => {
  it("leads with the three cross-game tabs, then every registered game", () => {
    const tabs = leaderboardTabs();
    expect(tabs[0]).toEqual({ id: "poker", label: "Poker" });
    expect(tabs[1]).toEqual({ id: "global", label: "Global" });
    expect(tabs[2]).toEqual({ id: "friends", label: "Friends" });
    expect(tabs.slice(3).map((tab) => tab.id).sort()).toEqual(Object.keys(LEADERBOARD_GAMES).sort());
  });

  it("keeps the three cross-game tab ids clear of every game id", () => {
    // app/api/leaderboard/route.ts dispatches on this one string, so a game
    // registered as "friends" would shadow the friends board entirely.
    for (const reserved of ["poker", "global", "friends"]) {
      expect(LEADERBOARD_GAMES[reserved]).toBeUndefined();
    }
  });
});

describe("isHeadToHeadGame", () => {
  it("covers every registered game and nothing else", () => {
    expect(isHeadToHeadGame("chess")).toBe(true);
    expect(isHeadToHeadGame("cribbage")).toBe(true);
    // Never written head-to-head: one pot at a six-handed table is not a
    // result between two named players.
    expect(isHeadToHeadGame("poker")).toBe(false);
    // A solo game has no opponent to hold a record against, and is kept out
    // by having no registry entry at all rather than by a second list here.
    expect(isHeadToHeadGame("memory-match")).toBe(false);
    expect(isHeadToHeadGame("solitaire")).toBe(false);
  });
});

describe("formatRecord / formatStreak", () => {
  it("hides the draw column until a draw has actually happened", () => {
    expect(formatRecord(4, 2, 0)).toBe("4-2");
    expect(formatRecord(4, 2, 1)).toBe("4-2-1");
  });

  it("reads a streak's sign as won or lost, and zero as a dash", () => {
    expect(formatStreak(3)).toBe("W3");
    expect(formatStreak(-5)).toBe("L5");
    expect(formatStreak(0)).toBe("—");
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
      wins: 7, losses: 3, draws: 0, currentStreak: 3, bestStreak: 5,
    });
    expect(row.record).toBe("7-3");
    expect(row.winRate).toBe("70%");
    expect(row.streak).toBe("W3");
  });

  it("reads a negative streak as a loss streak, and zero as a dash", () => {
    const chess = LEADERBOARD_GAMES.chess;
    expect(chess.formatRow({ wins: 1, losses: 4, draws: 0, currentStreak: -2, bestStreak: 1 }).streak).toBe("L2");
    expect(chess.formatRow({ wins: 0, losses: 0, draws: 1, currentStreak: 0, bestStreak: 0 }).streak).toBe("—");
  });

  it("never divides by zero when nobody has played yet", () => {
    const chess = LEADERBOARD_GAMES.chess;
    const row = chess.formatRow({ wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0 });
    expect(row.winRate).toBe("0%");
  });
});
