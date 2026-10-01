import { describe, expect, it } from "vitest";
import {
  BRAIN_STREAK_CONFIGS,
  answerBrainStreakRound,
  brainStreakPayout,
  resignBrainStreakAttempt,
  startBrainStreakAttempt,
  streakMultiplierForScore,
  tickBrainStreakAttempt,
  toBrainStreakSnapshot,
} from "./brain-streak";

const fixedRandom = (values: number[]) => {
  let i = 0;
  return (max: number) => {
    const v = values[i % values.length] % max;
    i++;
    return v;
  };
};

describe("brain streak: survival mode (Sequence Recall)", () => {
  const config = BRAIN_STREAK_CONFIGS["sequence-recall"];
  const now = new Date("2026-01-01T00:00:00Z");

  it("advances score on a correct answer and serves a longer round", () => {
    const attempt = startBrainStreakAttempt("sequence-recall", config, 1000, fixedRandom([1, 2, 0]), now);
    const { attempt: next, correct } = answerBrainStreakRound(
      attempt,
      config,
      attempt.round.answer,
      fixedRandom([0]),
      now,
    );
    expect(correct).toBe(true);
    expect(next.score).toBe(1);
    expect(next.status).toBe("active");
  });

  it("ends the run on a wrong answer", () => {
    const attempt = startBrainStreakAttempt("sequence-recall", config, 1000, fixedRandom([1, 2, 0]), now);
    const { attempt: next, correct } = answerBrainStreakRound(attempt, config, "not-it", fixedRandom([0]), now);
    expect(correct).toBe(false);
    expect(next.status).toBe("finished");
    expect(next.score).toBe(0);
  });

  it("never carries an overall clock", () => {
    const attempt = startBrainStreakAttempt("sequence-recall", config, 0, fixedRandom([1]), now);
    expect(attempt.expiresAt).toBeNull();
    expect(tickBrainStreakAttempt(attempt, new Date(now.getTime() + 1_000_000))).toBeNull();
  });
});

describe("brain streak: sprint mode (Quick Math Sprint)", () => {
  const config = BRAIN_STREAK_CONFIGS["quick-math"];
  const now = new Date("2026-01-01T00:00:00Z");

  it("keeps the run alive after a wrong answer, serving the next round", () => {
    const attempt = startBrainStreakAttempt("quick-math", config, 1000, fixedRandom([3]), now);
    const { attempt: next, correct } = answerBrainStreakRound(attempt, config, "not a number", fixedRandom([3]), now);
    expect(correct).toBe(false);
    expect(next.status).toBe("active");
    expect(next.score).toBe(0);
  });

  it("ends only once the clock expires", () => {
    const attempt = startBrainStreakAttempt("quick-math", config, 1000, fixedRandom([3]), now);
    expect(tickBrainStreakAttempt(attempt, now)).toBeNull();
    const after = tickBrainStreakAttempt(attempt, new Date(Date.parse(attempt.expiresAt!) + 1));
    expect(after?.status).toBe("finished");
  });
});

describe("streakMultiplierForScore", () => {
  it("pays zero below the lowest rung and the matching rung otherwise", () => {
    const ladder = [
      { min: 10, multiplier: 2 },
      { min: 5, multiplier: 1 },
    ];
    expect(streakMultiplierForScore(ladder, 2)).toBe(0);
    expect(streakMultiplierForScore(ladder, 5)).toBe(1);
    expect(streakMultiplierForScore(ladder, 11)).toBe(2);
  });
});

describe("brainStreakPayout / resign", () => {
  it("pays nothing while active and something once finished with a scoring rung", () => {
    const config = BRAIN_STREAK_CONFIGS["pattern-predictor"];
    const now = new Date("2026-01-01T00:00:00Z");
    let attempt = startBrainStreakAttempt("pattern-predictor", config, 1000, fixedRandom([0, 1, 2]), now);
    expect(brainStreakPayout(attempt)).toBe(0);
    attempt = { ...attempt, score: 6, status: "finished" };
    expect(brainStreakPayout(attempt)).toBeGreaterThan(0);
  });

  it("resign is a no-op once already finished", () => {
    const config = BRAIN_STREAK_CONFIGS["trivia-blitz"];
    const now = new Date("2026-01-01T00:00:00Z");
    const attempt = startBrainStreakAttempt("trivia-blitz", config, 0, fixedRandom([0]), now);
    const resigned = resignBrainStreakAttempt(attempt, now);
    expect(resignBrainStreakAttempt(resigned, now)).toBe(resigned);
  });

  it("snapshot never leaks the answer for a game where the prompt isn't the answer", () => {
    const config = BRAIN_STREAK_CONFIGS["quick-math"];
    const now = new Date("2026-01-01T00:00:00Z");
    const attempt = startBrainStreakAttempt("quick-math", config, 0, fixedRandom([3]), now);
    const snapshot = toBrainStreakSnapshot(attempt, { id: "x", version: 1 }, now);
    expect(JSON.stringify(snapshot.prompt)).not.toContain(attempt.round.answer);
  });
});
