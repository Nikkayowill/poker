import { describe, expect, it } from "vitest";
import {
  DEAL_LEAD_MS,
  dealDelayMs,
  dealSettledByMs,
} from "./deal-choreography";
import { TURN_TIMEOUT_MS } from "./engine";

const SIX_MAX = 6;

describe("dealDelayMs", () => {
  it("deals to the local player first", () => {
    // Slot 0 is the near edge of the ring, which is always the local seat.
    const everyoneElse = [1, 2, 3, 4, 5].map((slot) => dealDelayMs(slot, 0, SIX_MAX));
    expect(Math.min(...everyoneElse)).toBeGreaterThan(dealDelayMs(0, 0, SIX_MAX));
  });

  it("finishes the first card round before starting the second", () => {
    // The defect this replaced: per-seat and per-card offsets were independent,
    // so seat 0's second card was dealt before seat 5 had received a first.
    const firstRound = [0, 1, 2, 3, 4, 5].map((slot) => dealDelayMs(slot, 0, SIX_MAX));
    const secondRound = [0, 1, 2, 3, 4, 5].map((slot) => dealDelayMs(slot, 1, SIX_MAX));
    expect(Math.max(...firstRound)).toBeLessThan(Math.min(...secondRound));
  });

  it("orders a round by slot, with no two cards sharing a moment", () => {
    const schedule = [0, 1].flatMap((cardIndex) =>
      [0, 1, 2, 3, 4, 5].map((slot) => dealDelayMs(slot, cardIndex, SIX_MAX)),
    );
    expect(new Set(schedule).size).toBe(schedule.length);
    expect([...schedule].sort((a, b) => a - b)).toEqual(schedule);
  });

  it("starts the very first card after a beat, not on the same frame as the snapshot", () => {
    expect(dealDelayMs(0, 0, SIX_MAX)).toBe(DEAL_LEAD_MS);
    expect(DEAL_LEAD_MS).toBeGreaterThan(0);
  });

  it("survives a degenerate seat count rather than collapsing the sequence", () => {
    // seatCount 0 would make every card in round 1 collide with round 0.
    expect(dealDelayMs(0, 1, 0)).toBeGreaterThan(dealDelayMs(0, 0, 0));
  });
});

describe("dealSettledByMs", () => {
  it("keeps the whole deal well inside the turn clock it is running against", () => {
    // The server starts the clock when the hand is dealt and does not wait for
    // CSS, so this is time a player spends unable to read a hand they are
    // already on the clock for. Ten percent of the shortest clock is the line;
    // the previous schedule spent 1,815ms, which was over it.
    const settled = dealSettledByMs(SIX_MAX);
    expect(settled).toBeLessThan(TURN_TIMEOUT_MS * 0.1);
    expect(settled).toBeLessThan(1_500);
  });

  it("grows with the table but stays bounded at six-max", () => {
    expect(dealSettledByMs(2)).toBeLessThan(dealSettledByMs(SIX_MAX));
  });

  it("covers the last card dealt", () => {
    const lastCardStart = dealDelayMs(SIX_MAX - 1, 1, SIX_MAX);
    expect(dealSettledByMs(SIX_MAX)).toBeGreaterThan(lastCardStart);
  });
});
