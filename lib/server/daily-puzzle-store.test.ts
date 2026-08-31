import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDailyPuzzlesForTest,
  createPuzzleRound,
  getOrCreateCanonicalAnswer,
  getPuzzleRoundsForProfile,
} from "./daily-puzzle-store";

/**
 * The store-level primitives the puzzle archive is built on, tested
 * independently of either game -- both games' services exercise these
 * through their own end-to-end tests, but the caching/backfill/race
 * behaviour belongs here and doesn't need a real word or puzzle to prove.
 */

beforeEach(() => {
  __resetDailyPuzzlesForTest();
});

describe("getOrCreateCanonicalAnswer", () => {
  it("computes once and caches: a later call never re-runs compute", async () => {
    const compute = vi.fn(() => "first");
    const first = await getOrCreateCanonicalAnswer("word-stack", "2026-02-01", compute, () => "unused");
    expect(first).toBe("first");
    expect(compute).toHaveBeenCalledTimes(1);

    // A compute that would answer differently must not be trusted on a hit --
    // this is the whole guarantee the archive feature relies on to survive
    // the answer pool changing size after a day has already been answered.
    const second = await getOrCreateCanonicalAnswer(
      "word-stack",
      "2026-02-01",
      () => "second-would-be-wrong",
      () => "unused",
    );
    expect(second).toBe("first");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("keeps games and days apart", async () => {
    const wordStack = await getOrCreateCanonicalAnswer("word-stack", "2026-02-02", () => "word", () => "unused");
    const connections = await getOrCreateCanonicalAnswer(
      "connections",
      "2026-02-02",
      () => "groups",
      () => "unused",
    );
    const nextDay = await getOrCreateCanonicalAnswer("word-stack", "2026-02-03", () => "other-word", () => "unused");

    expect(wordStack).toBe("word");
    expect(connections).toBe("groups");
    expect(nextDay).toBe("other-word");
  });

  it("backfills from a real pre-existing attempt in preference to compute()", async () => {
    const day = "2026-02-10";
    await createPuzzleRound({
      profileId: randomUUID(),
      game: "word-stack",
      day,
      round: { answer: "planted" },
      complete: false,
    });

    const compute = vi.fn(() => "would-be-wrong");
    const answer = await getOrCreateCanonicalAnswer(
      "word-stack",
      day,
      compute,
      (round) => (round as { answer: string }).answer,
    );

    expect(answer).toBe("planted");
    expect(compute).not.toHaveBeenCalled();
  });

  it("converges two concurrent first-callers on one answer", async () => {
    const day = "2026-02-20";
    let calls = 0;
    const compute = () => {
      calls += 1;
      return `answer-${calls}`;
    };

    const [a, b] = await Promise.all([
      getOrCreateCanonicalAnswer("word-stack", day, compute, () => "unused"),
      getOrCreateCanonicalAnswer("word-stack", day, compute, () => "unused"),
    ]);

    expect(a).toBe(b);
  });
});

describe("__resetDailyPuzzlesForTest", () => {
  it("clears the canon cache too, not just player attempts", async () => {
    await getOrCreateCanonicalAnswer("word-stack", "2026-03-01", () => "before-reset", () => "unused");
    __resetDailyPuzzlesForTest();
    const compute = vi.fn(() => "after-reset");
    const answer = await getOrCreateCanonicalAnswer("word-stack", "2026-03-01", compute, () => "unused");
    expect(answer).toBe("after-reset");
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

describe("getPuzzleRoundsForProfile", () => {
  it("returns an empty list for a profile with no history, rather than erroring", async () => {
    const rounds = await getPuzzleRoundsForProfile(randomUUID(), "word-stack");
    expect(rounds).toEqual([]);
  });

  it("scopes to one profile and one game, sorted newest first", async () => {
    const profileId = randomUUID();
    const otherProfileId = randomUUID();

    await createPuzzleRound({ profileId, game: "word-stack", day: "2026-02-01", round: {}, complete: true });
    await createPuzzleRound({ profileId, game: "word-stack", day: "2026-02-03", round: {}, complete: true });
    await createPuzzleRound({ profileId, game: "connections", day: "2026-02-02", round: {}, complete: true });
    await createPuzzleRound({ profileId: otherProfileId, game: "word-stack", day: "2026-02-04", round: {}, complete: true });

    const rounds = await getPuzzleRoundsForProfile(profileId, "word-stack");
    expect(rounds.map((round) => round.day)).toEqual(["2026-02-03", "2026-02-01"]);
  });

  it("respects an exclusive `before`", async () => {
    const profileId = randomUUID();
    await createPuzzleRound({ profileId, game: "word-stack", day: "2026-02-01", round: {}, complete: true });
    await createPuzzleRound({ profileId, game: "word-stack", day: "2026-02-05", round: {}, complete: true });

    const rounds = await getPuzzleRoundsForProfile(profileId, "word-stack", { before: "2026-02-05" });
    expect(rounds.map((round) => round.day)).toEqual(["2026-02-01"]);
  });
});
