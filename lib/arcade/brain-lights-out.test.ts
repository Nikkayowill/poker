import { describe, expect, it } from "vitest";
import {
  LIGHTS_OUT_MAX_MOVES,
  brainLightsOutPayout,
  resignBrainLightsOut,
  startBrainLightsOut,
  tapBrainLightsOut,
  toBrainLightsOutSnapshot,
  wagerMultiplierForMoves,
} from "./brain-lights-out";

const cyclingRandom = (values: number[]) => {
  let i = 0;
  return (max: number) => values[i++ % values.length] % max;
};

describe("brain lights out", () => {
  it("deals a board that is not already solved", () => {
    const attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    expect(attempt.lights.some(Boolean)).toBe(true);
  });

  it("tapping the same cell twice returns the board to its prior state (own inverse)", () => {
    const attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    const once = tapBrainLightsOut(attempt, 6, new Date());
    const twice = tapBrainLightsOut(once, 6, new Date());
    expect(twice.lights).toEqual(attempt.lights);
  });

  it("forfeits once the move cap is reached without clearing the board", () => {
    let attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    for (let i = 0; i < LIGHTS_OUT_MAX_MOVES; i++) {
      attempt = tapBrainLightsOut(attempt, i % 2, new Date());
      if (attempt.status !== "active") break;
    }
    expect(attempt.status === "won" || attempt.status === "lost").toBe(true);
    if (attempt.status === "lost") expect(attempt.moves).toBeGreaterThanOrEqual(LIGHTS_OUT_MAX_MOVES);
  });

  it("pays zero on anything but a win", () => {
    expect(brainLightsOutPayout({ wager: 1000, status: "lost", moves: 3 })).toBe(0);
    expect(brainLightsOutPayout({ wager: 1000, status: "won", moves: 4 })).toBeGreaterThan(0);
  });

  it("pays less the slower the clear", () => {
    expect(wagerMultiplierForMoves(4)).toBeGreaterThan(wagerMultiplierForMoves(18));
  });

  it("resign settles an active attempt as lost", () => {
    const attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    const resigned = resignBrainLightsOut(attempt, new Date());
    expect(resigned.status).toBe("lost");
  });

  it("snapshot never reveals more cells than are actually lit", () => {
    const attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    const snapshot = toBrainLightsOutSnapshot(attempt, { id: "x", version: 1 });
    expect(snapshot.lights).toEqual(attempt.lights);
    expect(snapshot.size * snapshot.size).toBe(attempt.lights.length);
  });
});
