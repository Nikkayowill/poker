import { describe, expect, it } from "vitest";
import { missionSignalsForEvent } from "./events";

describe("missionSignalsForEvent", () => {
  it("feeds a solo poker hand into the hand and cross-category metrics, not multiplayer", () => {
    const signals = missionSignalsForEvent({ kind: "poker_hand_played", multiplayer: false });
    expect(signals).toEqual([
      { metric: "poker_hands_played", delta: 1 },
      { metric: "games_played_any", delta: 1 },
      { metric: "active_day", delta: 1 },
    ]);
  });

  it("adds the multiplayer metric only when the hand had another real player in it", () => {
    const signals = missionSignalsForEvent({ kind: "poker_hand_played", multiplayer: true });
    expect(signals).toContainEqual({ metric: "multiplayer_hands_played", delta: 1 });
    expect(signals).toHaveLength(4);
  });

  it("feeds a duel win into duels_won plus both cross-category metrics", () => {
    const signals = missionSignalsForEvent({ kind: "duel_won" });
    expect(signals).toEqual([
      { metric: "duels_won", delta: 1 },
      { metric: "games_played_any", delta: 1 },
      { metric: "active_day", delta: 1 },
    ]);
  });

  it("feeds a completed puzzle the same three-way shape", () => {
    const signals = missionSignalsForEvent({ kind: "puzzle_completed" });
    expect(signals).toEqual([
      { metric: "puzzles_completed", delta: 1 },
      { metric: "games_played_any", delta: 1 },
      { metric: "active_day", delta: 1 },
    ]);
  });

  it("scales levels_gained by every level a single wager crossed", () => {
    expect(missionSignalsForEvent({ kind: "level_gained", levels: 3 })).toEqual([
      { metric: "levels_gained", delta: 3 },
    ]);
  });

  it("is a no-op for a wager that crossed no level", () => {
    expect(missionSignalsForEvent({ kind: "level_gained", levels: 0 })).toEqual([]);
  });
});
