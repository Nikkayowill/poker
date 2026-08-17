import { describe, expect, it } from "vitest";
import { achievementCountersForEvent } from "./events";

describe("achievementCountersForEvent", () => {
  it("feeds a duel win into the duels_won counter", () => {
    expect(achievementCountersForEvent({ kind: "duel_won" })).toEqual([
      { metric: "duels_won", delta: 1 },
    ]);
  });

  it("feeds a completed puzzle into the puzzles_completed counter", () => {
    expect(achievementCountersForEvent({ kind: "puzzle_completed" })).toEqual([
      { metric: "puzzles_completed", delta: 1 },
    ]);
  });

  it("is a no-op for a poker hand -- hands_played/hands_won are stat-sourced, not counted", () => {
    expect(achievementCountersForEvent({ kind: "poker_hand_played", multiplayer: false })).toEqual([]);
    expect(achievementCountersForEvent({ kind: "poker_hand_played", multiplayer: true })).toEqual([]);
  });

  it("is a no-op for a level-up -- rank is live-sourced, not counted", () => {
    expect(achievementCountersForEvent({ kind: "level_gained", levels: 3 })).toEqual([]);
  });
});
