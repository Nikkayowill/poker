import { describe, expect, it } from "vitest";
import {
  BRAIN_STREAK_CONFIGS,
  generatePattern,
  patternDistractors,
  patternIsAmbiguous,
} from "./brain-streak-rounds";
import {
  SEQUENCE_RECALL_BANDS,
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
    expect(next.status).toBe("lost");
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
    expect(after?.status).toBe("lost");
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
    attempt = { ...attempt, score: 6, status: "won" };
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

describe("finished statuses fit the ante_up_attempts.status CHECK", () => {
  // The table only accepts these. "finished" used to be written here and every
  // run's settlement write failed in production, leaving it active forever.
  const allowed = new Set(["active", "won", "lost", "timed-out"]);
  const now = new Date("2026-01-01T00:00:00Z");

  it("covers a miss, an expired clock and a cash out, paying or not", () => {
    const survival = BRAIN_STREAK_CONFIGS["sequence-recall"];
    const sprint = BRAIN_STREAK_CONFIGS["quick-math"];
    const missed = answerBrainStreakRound(
      startBrainStreakAttempt("sequence-recall", survival, 1000, fixedRandom([1]), now),
      survival,
      "nope",
      fixedRandom([0]),
      now,
    ).attempt;
    const sprintRun = startBrainStreakAttempt("quick-math", sprint, 1000, fixedRandom([3]), now);
    const expiredLow = tickBrainStreakAttempt(sprintRun, new Date(Date.parse(sprintRun.expiresAt!) + 1))!;
    const expiredHigh = tickBrainStreakAttempt({ ...sprintRun, score: 12 }, new Date(Date.parse(sprintRun.expiresAt!) + 1))!;
    const cashedOut = resignBrainStreakAttempt({ ...sprintRun, score: 20 }, now);

    for (const attempt of [missed, expiredLow, expiredHigh, cashedOut]) expect(allowed.has(attempt.status)).toBe(true);
    expect(expiredLow.status).toBe("lost");
    expect(expiredHigh.status).toBe("won");
    expect(brainStreakPayout(expiredHigh)).toBe(1300);
    expect(brainStreakPayout(cashedOut)).toBe(3000);
  });
});

/** A seeded generator, so these sweeps are repeatable. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return (max: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
}

describe("stake pressure on the streak engine", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("copies the band onto the run at open and keeps using it", () => {
    const config = BRAIN_STREAK_CONFIGS["sequence-recall"];
    const attempt = startBrainStreakAttempt("sequence-recall", config, 1_000_000, seededRandom(1), now);
    expect(attempt.pressure).toBe(3);
    expect((attempt.round.prompt.sequence as number[]).length).toBe(SEQUENCE_RECALL_BANDS[3].startLength);
    const next = answerBrainStreakRound(attempt, config, attempt.round.answer, seededRandom(2), now).attempt;
    expect((next.round.prompt.sequence as number[]).length).toBe(SEQUENCE_RECALL_BANDS[3].startLength + 1);
    expect(next.round.prompt.colors).toBe(6);
    expect(toBrainStreakSnapshot(next, { id: "x", version: 2 }, now).pressure).toBe(3);
  });

  it("free play and small wagers play band 0", () => {
    const config = BRAIN_STREAK_CONFIGS["sequence-recall"];
    for (const wager of [0, 500, 9_999]) {
      const attempt = startBrainStreakAttempt("sequence-recall", config, wager, seededRandom(3), now);
      expect(attempt.pressure).toBe(0);
      expect(attempt.round.prompt).toMatchObject({ colors: 4, flashMs: 400, gapMs: 160 });
      expect((attempt.round.prompt.sequence as number[]).length).toBe(2);
    }
  });

  it("flash timing follows the 400/250/200/175ms steps and never slows down", () => {
    const flashes = ([0, 1, 2, 3] as const).map((p) => SEQUENCE_RECALL_BANDS[p].flashMs);
    expect(flashes).toEqual([400, 250, 200, 175]);
    for (const p of [0, 1, 2, 3] as const) {
      expect(SEQUENCE_RECALL_BANDS[p].gapMs).toBe(SEQUENCE_RECALL_BANDS[p].flashMs * 0.4);
    }
  });

  it("loads a run stored before pressure existed as band 0", () => {
    const config = BRAIN_STREAK_CONFIGS["sequence-recall"];
    const old = startBrainStreakAttempt("sequence-recall", config, 2_000_000, seededRandom(4), now);
    delete old.pressure;
    const next = answerBrainStreakRound(old, config, old.round.answer, seededRandom(5), now).attempt;
    // Its next round keeps the rules it opened with: 4 pads, 550ms, length 3 + score.
    expect(next.round.prompt).toMatchObject({ colors: 4, flashMs: 550, gapMs: 200 });
    expect((next.round.prompt.sequence as number[]).length).toBe(4);
    expect(toBrainStreakSnapshot(old, { id: "x", version: 1 }, now).pressure).toBe(0);
  });

  it("trivia raises the bar for a profit per band, copied onto the run", () => {
    const config = BRAIN_STREAK_CONFIGS["trivia-blitz"];
    const bars = [1000, 10_000, 100_000, 5_000_000].map((wager) => {
      const attempt = startBrainStreakAttempt("trivia-blitz", config, wager, seededRandom(1), now);
      expect(attempt.maxMisses).toBe(3);
      return [...attempt.ladder].reverse().find((rung) => rung.multiplier > 1)!.min;
    });
    expect(bars).toEqual([10, 15, 20, 27]);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i] / bars[i - 1]).toBeGreaterThanOrEqual(1.2);
      expect(bars[i] / bars[i - 1]).toBeLessThanOrEqual(1.5);
    }
    const run = startBrainStreakAttempt("trivia-blitz", config, 100_000, seededRandom(1), now);
    expect(streakMultiplierForScore(run.ladder, 19)).toBeLessThan(1);
    expect(streakMultiplierForScore(run.ladder, 20)).toBeGreaterThan(1);
  });

  it("quick math allows three misses only at the top band", () => {
    const config = BRAIN_STREAK_CONFIGS["quick-math"];
    expect(startBrainStreakAttempt("quick-math", config, 100_000, seededRandom(1), now).maxMisses).toBeNull();
    expect(startBrainStreakAttempt("quick-math", config, 1_000_000, seededRandom(1), now).maxMisses).toBe(3);
  });

  it("trivia stops dealing the short myth statements from 10k up", () => {
    const config = BRAIN_STREAK_CONFIGS["trivia-blitz"];
    const random = seededRandom(9);
    for (let i = 0; i < 300; i++) {
      const round = config.nextRound(0, random, 1);
      expect(round.prompt.claim).toBeDefined();
    }
  });
});

describe("quick math by stake band", () => {
  const config = BRAIN_STREAK_CONFIGS["quick-math"];
  const deal = (pressure: 0 | 1 | 2 | 3, score: number, count = 400) => {
    const random = seededRandom(pressure * 100 + score + 1);
    return Array.from({ length: count }, () => config.nextRound(score, random, pressure));
  };

  it("band 0 keeps the small classic operands", () => {
    for (const round of deal(0, 0)) {
      const { a, b } = round.prompt as { a: number; b: number };
      expect(a).toBeLessThanOrEqual(12);
      expect(b).toBeLessThanOrEqual(12);
    }
  });

  it("every band's answer is a whole, non-negative number that fits the keypad", () => {
    for (const pressure of [0, 1, 2, 3] as const) {
      for (const score of [0, 10, 25]) {
        for (const round of deal(pressure, score)) {
          const value = Number(round.answer);
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(round.answer.length).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it("bigger stakes deal bigger numbers and harder operations", () => {
    const ops = (pressure: 0 | 1 | 2 | 3) => new Set(deal(pressure, 0).map((round) => round.prompt.op));
    expect(ops(0)).toEqual(new Set(["+", "-", "×"]));
    expect(ops(1)).toEqual(new Set(["+", "-", "×", "÷"]));
    expect(ops(3).has("+")).toBe(false);
    const mean = (pressure: 0 | 1 | 2 | 3) => {
      const rounds = deal(pressure, 0);
      return rounds.reduce((sum, round) => sum + (round.prompt.a as number), 0) / rounds.length;
    };
    expect(mean(1)).toBeGreaterThan(mean(0));
    expect(mean(2)).toBeGreaterThan(mean(1));
    const twoByTwo = deal(3, 0).filter((round) => round.prompt.op === "×" && (round.prompt.b as number) >= 11);
    expect(twoByTwo.length).toBeGreaterThan(0);
  });
});

describe("pattern predictor", () => {
  const config = BRAIN_STREAK_CONFIGS["pattern-predictor"];

  it("always offers four distinct options with exactly one right answer", () => {
    for (const pressure of [0, 1, 2, 3] as const) {
      const random = seededRandom(pressure + 7);
      for (let score = 0; score < 25; score++) {
        for (let i = 0; i < 40; i++) {
          const round = config.nextRound(score, random, pressure);
          const options = round.prompt.options as number[];
          expect(options).toHaveLength(4);
          expect(new Set(options).size).toBe(4);
          expect(options.filter((option) => String(option) === round.answer)).toHaveLength(1);
          expect(options.every((option) => Number.isSafeInteger(option))).toBe(true);
        }
      }
    }
  });

  it("distractors never equal the answer", () => {
    const random = seededRandom(11);
    for (let level = 0; level < 30; level++) {
      for (let i = 0; i < 40; i++) {
        const pattern = generatePattern(level, random);
        expect(patternDistractors(pattern, random)).not.toContain(pattern.next);
      }
    }
  });

  it("never deals a round a simpler rule also explains with a different answer", () => {
    const random = seededRandom(12);
    for (let level = 0; level < 30; level++) {
      for (let i = 0; i < 40; i++) expect(patternIsAmbiguous(generatePattern(level, random))).toBe(false);
    }
  });

  it("uses rival rules for distractors, so plain linear guessing is often wrong", () => {
    // 2, 4, 8, 16: a player who assumes +8 picks 24.
    const pattern = { terms: [2, 4, 8, 16], next: 32 };
    expect(patternDistractors(pattern, seededRandom(1)).length).toBe(3);
    const seen = new Set<number>();
    for (let seed = 0; seed < 30; seed++) for (const value of patternDistractors(pattern, seededRandom(seed))) seen.add(value);
    expect(seen.has(24)).toBe(true);
  });

  it("ramps up: later rounds and bigger stakes deal longer, bigger patterns", () => {
    const size = (pressure: 0 | 1 | 2 | 3, score: number) => {
      const random = seededRandom(score * 10 + pressure);
      let total = 0;
      for (let i = 0; i < 200; i++) {
        const terms = config.nextRound(score, random, pressure).prompt.terms as number[];
        total += Math.max(...terms.map(Math.abs));
      }
      return total / 200;
    };
    expect(size(0, 12)).toBeGreaterThan(size(0, 0));
    expect(size(3, 0)).toBeGreaterThan(size(0, 0));
    expect(size(3, 0)).toBeGreaterThan(size(1, 0));
  });
});
