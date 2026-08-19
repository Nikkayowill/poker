import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { pickDaily, puzzleDay } from "@/lib/arcade/puzzles/daily";
import { WORD_STACK_ANSWERS } from "@/lib/arcade/puzzles/word-stack-answers";
import { __resetDailyPuzzlesForTest } from "./daily-puzzle-store";
import {
  WORD_STACK_GAME,
  WordStackRequestError,
  playWordStackGuess,
  readWordStackPuzzle,
  startWordStackPuzzle,
} from "./word-stack-service";
import { ensureProfile } from "./profile-store";

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
      playWordStackGuess(token, { day: "2020-01-01", version: 1, guess: "slate" }),
    ).rejects.toMatchObject({ status: 409, reason: "rolled-over" });
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
