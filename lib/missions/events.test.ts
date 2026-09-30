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

  it("counts rank_points_gained by the points a single wager added", () => {
    expect(missionSignalsForEvent({ kind: "rank_points_gained", points: 30 })).toEqual([
      { metric: "rank_points_gained", delta: 30 },
    ]);
  });

  it("is a no-op for a wager that added no rank points", () => {
    expect(missionSignalsForEvent({ kind: "rank_points_gained", points: 0 })).toEqual([]);
  });
});
