import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUZZLE_EPOCH_DAY, pickDaily, previousDay, puzzleDay } from "@/lib/arcade/puzzles/daily";
import { WORD_STACK_ANSWERS } from "@/lib/arcade/puzzles/word-stack-answers";
import { __resetDailyPuzzlesForTest } from "./daily-puzzle-store";
import {
  WORD_STACK_GAME,
  WordStackRequestError,
  listWordStackArchive,
  playWordStackGuess,
  readWordStackPuzzle,
  startWordStackPuzzle,
} from "./word-stack-service";
import { adjustGold, ensureProfile } from "./profile-store";
import { advancePuzzleRound, createPuzzleRound, getPuzzleRound } from "./daily-puzzle-store";
import { WAGER_MULTIPLIER_BY_GUESSES } from "@/lib/arcade/ante-up-word-stack";
import type { StoredWordStackRound } from "./word-stack-service";

/**
 * A switch for making the canonical-answer lookup fail, for the ordering test
 * at the bottom of this file. Everything else in daily-puzzle-store is the
 * real thing -- this only stands in for the one call, and only when asked.
 */
const canon = vi.hoisted(() => ({ fails: false }));

vi.mock("./daily-puzzle-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./daily-puzzle-store")>();
  return {
    ...actual,
    getOrCreateCanonicalAnswer: (...args: Parameters<typeof actual.getOrCreateCanonicalAnswer>) =>
      canon.fails
        ? Promise.reject(new Error("canon unavailable"))
        : actual.getOrCreateCanonicalAnswer(...args),
  };
});

/**
 * The contract, in memory mode.
 *
 * The answer is *derived* here rather than injected: the service takes its
 * word from a server-only list keyed on the UTC day, and adding a seam to
 * override that would be a seam an attacker would want. Recomputing it with
 * the same public function the service uses is enough to drive a winning
 * board, and it doubles as a check that the selection really is deterministic
 * -- if it were not, every test below would fail.
 */

/** What today's word must be, computed the same way the service computes it. */
function todaysAnswer(): string {
  return pickDaily(WORD_STACK_ANSWERS, puzzleDay(new Date()), WORD_STACK_GAME);
}

function today(): string {
  return puzzleDay(new Date());
}

function tomorrow(): string {
  return puzzleDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

async function player() {
  const token = randomUUID();
  await ensureProfile(token);
  return token;
}

/** Six wrong guesses that are real words, so none is rejected by the dictionary. */
const WRONG = ["slate", "brick", "pound", "fudge", "vinyl", "mirth"];

function wrongGuesses(answer: string): string[] {
  return WRONG.filter((word) => word !== answer);
}

beforeEach(() => {
  __resetDailyPuzzlesForTest();
});

describe("readWordStackPuzzle", () => {
  it("reports no board before one is opened, and does not open one", () => {
    // A read that opened a board would mean visiting the page consumed the
    // day's attempt.
    return (async () => {
      const token = await player();
      expect((await readWordStackPuzzle(token)).round).toBeNull();
      expect((await readWordStackPuzzle(token)).round).toBeNull();
    })();
  });

  it("carries the day and puzzle number even with no board", async () => {
    const view = await readWordStackPuzzle(await player());
    expect(view.day).toBe(today());
    expect(view.puzzleNumber).toBeGreaterThan(0);
    expect(view.msUntilNextPuzzle).toBeGreaterThan(0);
  });
});

describe("startWordStackPuzzle", () => {
  it("opens an empty board", async () => {
    const view = await startWordStackPuzzle(await player());
    expect(view.resumed).toBe(false);
    expect(view.round?.guesses).toEqual([]);
    expect(view.round?.status).toBe("active");
  });

  it("never sends the answer while the board is live", async () => {
    // The entire reason the round lives on the server.
    const view = await startWordStackPuzzle(await player());
    expect(view.round?.answer).toBeNull();
    expect(JSON.stringify(view)).not.toContain(todaysAnswer());
  });

  it("resumes rather than re-dealing", async () => {
    const token = await player();
    const first = await startWordStackPuzzle(token);
    await playWordStackGuess(token, {
      day: today(),
      version: 1,
      guess: wrongGuesses(todaysAnswer())[0],
    });

    const second = await startWordStackPuzzle(token);
    expect(second.resumed).toBe(true);
    // The guess is still there: a second POST must not hand back a clean board.
    expect(second.round?.guesses).toHaveLength(1);
    expect(first.round?.day).toBe(second.round?.day);
  });

  it("resumes a FINISHED board rather than dealing a second one", async () => {
    // The rule the whole feature rests on. Everyone shares one word per day,
    // so a replay would be the same word again -- and the shared grid would be
    // a claim nobody could trust.
    const token = await player();
    await startWordStackPuzzle(token);
    await playWordStackGuess(token, { day: today(), version: 1, guess: todaysAnswer() });

    const again = await startWordStackPuzzle(token);
    expect(again.resumed).toBe(true);
    expect(again.round?.status).toBe("won");
    expect(again.round?.guesses).toHaveLength(1);
  });

  it("gives two players the same word on the same day", async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const answer = todaysAnswer();
    await Promise.all([startWordStackPuzzle(a), startWordStackPuzzle(b)]);
    const [first, second] = await Promise.all([
      playWordStackGuess(a, { day: today(), version: 1, guess: answer }),
      playWordStackGuess(b, { day: today(), version: 1, guess: answer }),
    ]);
    expect(first.round?.status).toBe("won");
    expect(second.round?.status).toBe("won");
  });
});

describe("playWordStackGuess", () => {
  it("scores a guess and advances the version", async () => {
    const token = await player();
    await startWordStackPuzzle(token);
    const view = await playWordStackGuess(token, {
      day: today(),
      version: 1,
      guess: wrongGuesses(todaysAnswer())[0],
    });
    expect(view.round?.guesses).toHaveLength(1);
    expect(view.round?.results[0]).toHaveLength(5);
    expect(view.round?.status).toBe("active");
  });

  it("reveals the answer only once the board is done", async () => {
    const token = await player();
    const answer = todaysAnswer();
    await startWordStackPuzzle(token);

    const mid = await playWordStackGuess(token, { day: today(), version: 1, guess: wrongGuesses(answer)[0] });
    expect(mid.round?.answer).toBeNull();

    const won = await playWordStackGuess(token, { day: today(), version: 2, guess: answer });
    expect(won.round?.status).toBe("won");
    expect(won.round?.answer).toBe(answer);
  });

  it("gives a losing player the word", async () => {
    const token = await player();
    const answer = todaysAnswer();
    await startWordStackPuzzle(token);

    let version = 1;
    for (const guess of wrongGuesses(answer).slice(0, 6)) {
      const view = await playWordStackGuess(token, { day: today(), version, guess });
      version = version + 1;
      if (view.round?.status !== "active") {
        expect(view.round?.status).toBe("lost");
        expect(view.round?.answer).toBe(answer);
        return;
      }
    }
    throw new Error("board should have ended");
  });

  it("rejects a non-word without spending a guess", async () => {
    // Ordinary play, not a fault: the board must come back untouched or a
    // typo would cost a sixth of the game.
    const token = await player();
    await startWordStackPuzzle(token);
    await expect(
      playWordStackGuess(token, { day: today(), version: 1, guess: "zzzzz" }),
    ).rejects.toMatchObject({ status: 400, reason: "unknown-word" });

    const after = await readWordStackPuzzle(token);
    expect(after.round?.guesses).toEqual([]);
  });

  it("carries the true board back on a rejection, so a stuck client resyncs", async () => {
    const token = await player();
    await startWordStackPuzzle(token);
    await playWordStackGuess(token, { day: today(), version: 1, guess: wrongGuesses(todaysAnswer())[0] });

    const error = await playWordStackGuess(token, {
      day: today(),
      version: 1,
      guess: wrongGuesses(todaysAnswer())[1],
    }).catch((thrown) => thrown as WordStackRequestError);

    expect(error).toBeInstanceOf(WordStackRequestError);
    expect((error as WordStackRequestError).status).toBe(409);
    expect((error as WordStackRequestError).round?.guesses).toHaveLength(1);
  });

  it("refuses a stale version, so a double-fired submit costs one guess not two", async () => {
    const token = await player();
    const answer = todaysAnswer();
    await startWordStackPuzzle(token);

    const [first, second] = await Promise.allSettled([
      playWordStackGuess(token, { day: today(), version: 1, guess: wrongGuesses(answer)[0] }),
      playWordStackGuess(token, { day: today(), version: 1, guess: wrongGuesses(answer)[1] }),
    ]);
    const accepted = [first, second].filter((result) => result.status === "fulfilled");
    expect(accepted).toHaveLength(1);

    const after = await readWordStackPuzzle(token);
    expect(after.round?.guesses).toHaveLength(1);
  });

  it("refuses a guess aimed at a board that has rolled over", async () => {
    const token = await player();
    await startWordStackPuzzle(token);
    await expect(
      playWordStackGuess(token, { day: tomorrow(), version: 1, guess: "slate" }),
    ).rejects.toMatchObject({ status: 409, reason: "rolled-over" });
  });

  it("refuses a guess dated before the archive begins", async () => {
    const token = await player();
    await startWordStackPuzzle(token);
    const beforeEpoch = previousDay(PUZZLE_EPOCH_DAY);
    await expect(
      playWordStackGuess(token, { day: beforeEpoch, version: 1, guess: "slate" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a guess before the board is opened", async () => {
    await expect(
      playWordStackGuess(await player(), { day: today(), version: 1, guess: "slate" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses another guess once the board is done", async () => {
    const token = await player();
    await startWordStackPuzzle(token);
    await playWordStackGuess(token, { day: today(), version: 1, guess: todaysAnswer() });
    await expect(
      playWordStackGuess(token, { day: today(), version: 2, guess: "slate" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps two players' boards apart", async () => {
    const [a, b] = await Promise.all([player(), player()]);
    await Promise.all([startWordStackPuzzle(a), startWordStackPuzzle(b)]);
    await playWordStackGuess(a, { day: today(), version: 1, guess: wrongGuesses(todaysAnswer())[0] });

    expect((await readWordStackPuzzle(a)).round?.guesses).toHaveLength(1);
    expect((await readWordStackPuzzle(b)).round?.guesses).toHaveLength(0);
  });
});

describe("the puzzle archive", () => {
  it("opens and plays a past day end to end, free, with that day's own puzzle number", async () => {
    const token = await player();
    const day = previousDay(today());
    const answer = pickDaily(WORD_STACK_ANSWERS, day, WORD_STACK_GAME);

    const opened = await startWordStackPuzzle(token, 0, day);
    expect(opened.day).toBe(day);
    expect(opened.round?.wager).toBe(0);

    const won = await playWordStackGuess(token, { day, version: 1, guess: answer });
    expect(won.round?.status).toBe("won");
    expect(won.day).toBe(day);
  });

  it("refuses a wager on an archive day, and never touches the wallet", async () => {
    const token = await player();
    const before = (await ensureProfile(token)).goldBalance;
    const day = previousDay(today());
    await expect(startWordStackPuzzle(token, 1000, day)).rejects.toMatchObject({ status: 400 });
    expect((await ensureProfile(token)).goldBalance).toBe(before);
  });

  it("rejects opening a day after today", async () => {
    await expect(startWordStackPuzzle(await player(), 0, tomorrow())).rejects.toMatchObject({ status: 400 });
  });

  it("rejects opening a day before the archive begins", async () => {
    await expect(
      startWordStackPuzzle(await player(), 0, previousDay(PUZZLE_EPOCH_DAY)),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("gives no daily bonus for completing an archive day, only for completing today's puzzle", async () => {
    const archiveToken = await player();
    const day = previousDay(today());
    await startWordStackPuzzle(archiveToken, 0, day);
    const beforeArchive = (await ensureProfile(archiveToken)).goldBalance;
    await playWordStackGuess(archiveToken, { day, version: 1, guess: pickDaily(WORD_STACK_ANSWERS, day, WORD_STACK_GAME) });
    expect((await ensureProfile(archiveToken)).goldBalance).toBe(beforeArchive);

    const todayToken = await player();
    await startWordStackPuzzle(todayToken, 0);
    const beforeToday = (await ensureProfile(todayToken)).goldBalance;
    await playWordStackGuess(todayToken, { day: today(), version: 1, guess: todaysAnswer() });
    expect((await ensureProfile(todayToken)).goldBalance).toBeGreaterThan(beforeToday);
  });

  it("gives a later archive opener the same answer a prior real attempt already recorded", async () => {
    // The regression this guards: pickDaily is a pure function of the
    // answer pool's *current* size, so recomputing it fresh for an old day
    // would silently disagree with whatever the first real player actually
    // saw if the pool has changed size since. A planted mismatch stands in
    // for that pool drift.
    const day = previousDay(today());
    const trueAnswer = pickDaily(WORD_STACK_ANSWERS, day, WORD_STACK_GAME);
    const plantedAnswer = WORD_STACK_ANSWERS.find((word) => word !== trueAnswer);
    if (!plantedAnswer) throw new Error("need two distinct pool entries to plant a mismatch");

    const priorToken = await player();
    const priorProfile = await ensureProfile(priorToken);
    await createPuzzleRound<StoredWordStackRound>({
      profileId: priorProfile.id,
      game: WORD_STACK_GAME,
      day,
      round: { answer: plantedAnswer, guesses: [], results: [], status: "active", wager: 0 },
      complete: false,
    });

    const laterToken = await player();
    await startWordStackPuzzle(laterToken, 0, day);
    const laterProfile = await ensureProfile(laterToken);
    const stored = await getPuzzleRound<StoredWordStackRound>(laterProfile.id, WORD_STACK_GAME, day);
    expect(stored?.round.answer).toBe(plantedAnswer);
    expect(stored?.round.answer).not.toBe(trueAnswer);
  });

  it("lists every day since the epoch, newest first, with this player's own status", async () => {
    const token = await player();
    const yesterday = previousDay(today());
    await startWordStackPuzzle(token, 0, yesterday);
    await playWordStackGuess(token, {
      day: yesterday,
      version: 1,
      guess: pickDaily(WORD_STACK_ANSWERS, yesterday, WORD_STACK_GAME),
    });

    const archive = await listWordStackArchive(token);
    expect(archive[0].day).toBe(yesterday);
    expect(archive[0].status).toBe("won");
    expect(archive.every((entry) => entry.day < today())).toBe(true);
    expect(archive.every((entry) => entry.day >= PUZZLE_EPOCH_DAY)).toBe(true);
    // Untouched days default to not-started rather than being queried for
    // individually.
    expect(archive.some((entry) => entry.status === "not-started")).toBe(true);
  });

  it("answers a null token (no session cookie yet) without minting a profile", async () => {
    // The regression this guards: session-minting.test.ts enforces that a
    // GET-only route never creates a session, and the archive list route is
    // GET-only. A visitor with no cookie has by definition played nothing,
    // so this must answer that honestly rather than reaching for a token to
    // read/create a profile with.
    const archive = await listWordStackArchive(null);
    expect(archive.length).toBeGreaterThan(0);
    expect(archive.every((entry) => entry.status === "not-started")).toBe(true);
  });
});

/**
 * A daily board is opened once and can be finished many hours later, so the
 * payout ladder it was opened under has to travel with it. Without this, a
 * retune landing mid-round pays the player at a rate they never agreed to --
 * and the 2026-08-27 retune moved the six-guess rung from 1.5x to 0.7x, which
 * is the difference between a profit and a loss on the same board.
 */
describe("the wager ladder travels with the round", () => {
  async function fundedPlayer(gold: number) {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const delta = gold - profile.goldBalance;
    if (delta !== 0) await adjustGold(profile.id, delta);
    return { token, id: profile.id };
  }

  it("stamps the live ladder onto a wagered round at open", async () => {
    const { token, id } = await fundedPlayer(50_000);
    await startWordStackPuzzle(token, 1000);

    const stored = await getPuzzleRound<StoredWordStackRound>(id, WORD_STACK_GAME, today());
    expect(stored?.round.wagerLadder).toEqual(WAGER_MULTIPLIER_BY_GUESSES);
  });

  it("leaves a free round without one, since it has no payout to protect", async () => {
    const { token, id } = await fundedPlayer(50_000);
    await startWordStackPuzzle(token, 0);

    const stored = await getPuzzleRound<StoredWordStackRound>(id, WORD_STACK_GAME, today());
    expect(stored?.round.wagerLadder).toBeUndefined();
  });

  it("carries the ladder through every guess, not just the first write", async () => {
    const { token, id } = await fundedPlayer(50_000);
    await startWordStackPuzzle(token, 1000);

    const wrong = wrongGuesses(todaysAnswer());
    await playWordStackGuess(token, { day: today(), version: 1, guess: wrong[0] });
    await playWordStackGuess(token, { day: today(), version: 2, guess: wrong[1] });

    const stored = await getPuzzleRound<StoredWordStackRound>(id, WORD_STACK_GAME, today());
    expect(stored?.round.guesses).toHaveLength(2);
    expect(stored?.round.wagerLadder).toEqual(WAGER_MULTIPLIER_BY_GUESSES);
  });

  it("pays a mid-flight round from its own ladder after a retune", async () => {
    const { token, id } = await fundedPlayer(50_000);
    await startWordStackPuzzle(token, 1000);

    // Stand in for a retune landing while the board is open: write the
    // pre-retune ladder back through the store, exactly as a round opened
    // before the deploy would carry it. It has to go through the store --
    // reads are defensively cloned, so mutating what getPuzzleRound returns
    // changes nothing.
    const opened = await getPuzzleRound<StoredWordStackRound>(id, WORD_STACK_GAME, today());
    if (!opened) throw new Error("no round");
    await advancePuzzleRound<StoredWordStackRound>(
      opened,
      { ...opened.round, wagerLadder: { 1: 8, 2: 8, 3: 5, 4: 3, 5: 2, 6: 1.5 } },
      false,
    );

    const balanceBefore = (await ensureProfile(token)).goldBalance;
    await playWordStackGuess(token, { day: today(), version: 2, guess: todaysAnswer() });
    const credited = (await ensureProfile(token)).goldBalance - balanceBefore;

    // One-guess win: 8x under the stored ladder, 4x under today's table.
    expect(credited).toBe(8000);
  });
});

/**
 * The stake must not leave before everything that can throw has thrown.
 *
 * This was a live bug: getOrCreateCanonicalAnswer sat between the debit and
 * the try/catch that refunds a failed round creation, so any throw from it
 * charged the player and handed back no board. It was not hypothetical --
 * daily_puzzle_canon's migration went unapplied while its calling code was
 * live, so the call threw on every wagered open until the table was created
 * on 2026-09-01.
 *
 * The fix is ordering, not another try/catch: the canon fetch moved above the
 * debit, since it touches no money and needs nothing the debit produces.
 */
describe("a failed canon lookup does not take the stake", () => {
  async function fundedPlayer(gold: number) {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const delta = gold - profile.goldBalance;
    if (delta !== 0) await adjustGold(profile.id, delta);
    return { token, id: profile.id };
  }

  it("leaves the balance untouched when the canonical answer cannot be read", async () => {
    const { token, id } = await fundedPlayer(50_000);
    const before = (await ensureProfile(token)).goldBalance;

    canon.fails = true;
    try {
      await expect(startWordStackPuzzle(token, 1000)).rejects.toThrow("canon unavailable");
    } finally {
      canon.fails = false;
    }

    expect((await ensureProfile(token)).goldBalance).toBe(before);
    // And no half-open round was left behind to burn the day's attempt.
    expect(await getPuzzleRound<StoredWordStackRound>(id, WORD_STACK_GAME, today())).toBeNull();
  });
});
