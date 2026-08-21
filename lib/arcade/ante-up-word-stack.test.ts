import { describe, expect, it } from "vitest";
import {
  anteUpWordStackGuessProblem,
  anteUpWordStackPayout,
  playAnteUpWordStackGuess,
  resignAnteUpWordStack,
  startAnteUpWordStack,
  toAnteUpWordStackSnapshot,
  wordStackDailyBonusMultiplier,
  type AnteUpWordStackAttempt,
} from "./ante-up-word-stack";

const START = new Date("2026-08-21T12:00:00Z");
const ANSWER = "crane";

/** Plays every guess in order, returning the attempt after the last one. */
function playAll(attempt: AnteUpWordStackAttempt, guesses: string[]): AnteUpWordStackAttempt {
  return guesses.reduce((current, guess) => playAnteUpWordStackGuess(current, guess), attempt);
}

describe("startAnteUpWordStack", () => {
  it("starts active with no guesses yet", () => {
    const attempt = startAnteUpWordStack(ANSWER, 1000, START);
    expect(attempt.status).toBe("active");
    expect(attempt.wager).toBe(1000);
    expect(attempt.word.guesses).toEqual([]);
    expect(attempt.startedAt).toBe(START.toISOString());
  });
});

describe("anteUpWordStackGuessProblem", () => {
  it("is null for a playable guess", () => {
    const attempt = startAnteUpWordStack(ANSWER, 500, START);
    expect(anteUpWordStackGuessProblem(attempt, "stone")).toBeNull();
  });

  it("rejects a guess once the attempt has finished", () => {
    const attempt = startAnteUpWordStack(ANSWER, 500, START);
    const resigned = resignAnteUpWordStack(attempt);
    expect(anteUpWordStackGuessProblem(resigned, "stone")).toBe("finished");
  });

  it("flags a guess that is not five letters", () => {
    const attempt = startAnteUpWordStack(ANSWER, 500, START);
    expect(anteUpWordStackGuessProblem(attempt, "ab")).toBe("length");
  });
});

describe("playAnteUpWordStackGuess", () => {
  it("wins the moment the answer is guessed", () => {
    const attempt = startAnteUpWordStack(ANSWER, 1000, START);
    const won = playAnteUpWordStackGuess(attempt, ANSWER);
    expect(won.status).toBe("won");
    expect(won.word.status).toBe("won");
    expect(won.word.guesses).toEqual([ANSWER]);
  });

  it("loses on the sixth failed guess", () => {
    const attempt = startAnteUpWordStack(ANSWER, 1000, START);
    const lost = playAll(attempt, ["stone", "stone", "stone", "stone", "stone", "stone"]);
    expect(lost.status).toBe("lost");
    expect(lost.word.guesses).toHaveLength(6);
  });

  it("stays active through guesses that neither win nor exhaust the attempt", () => {
    const attempt = startAnteUpWordStack(ANSWER, 1000, START);
    const afterOne = playAnteUpWordStackGuess(attempt, "stone");
    expect(afterOne.status).toBe("active");
    expect(afterOne.word.guesses).toEqual(["stone"]);
  });

  it("is a no-op once the attempt has already finished", () => {
    const attempt = startAnteUpWordStack(ANSWER, 1000, START);
    const won = playAnteUpWordStackGuess(attempt, ANSWER);
    const again = playAnteUpWordStackGuess(won, "stone");
    expect(again).toBe(won);
  });
});

describe("resignAnteUpWordStack", () => {
  it("ends an active attempt as a loss", () => {
    const attempt = startAnteUpWordStack(ANSWER, 500, START);
    expect(resignAnteUpWordStack(attempt).status).toBe("lost");
  });

  it("is a no-op on an attempt that already ended", () => {
    const attempt = startAnteUpWordStack(ANSWER, 500, START);
    const won = playAnteUpWordStackGuess(attempt, ANSWER);
    expect(resignAnteUpWordStack(won).status).toBe("won");
  });
});

describe("anteUpWordStackPayout", () => {
  it("pays nothing on anything but a win", () => {
    const attempt = startAnteUpWordStack(ANSWER, 1000, START);
    expect(anteUpWordStackPayout(attempt)).toBe(0);
    const resigned = resignAnteUpWordStack(attempt);
    expect(anteUpWordStackPayout(resigned)).toBe(0);
  });

  it("pays nothing on a zero (practice) wager win", () => {
    const attempt = startAnteUpWordStack(ANSWER, 0, START);
    const won = playAnteUpWordStackGuess(attempt, ANSWER);
    expect(anteUpWordStackPayout(won)).toBe(0);
  });

  // Mirrors WAGER_MULTIPLIER_BY_GUESSES in ante-up-word-stack.ts: 1/2 guesses
  // -> 8x, 3 -> 5x, 4 -> 3x, 5 -> 2x, 6 -> 1.5x.
  it.each([
    [1, 8],
    [2, 8],
    [3, 5],
    [4, 3],
    [5, 2],
    [6, 1.5],
  ])("pays wager * the tier for a %i-guess win", (guessCount, multiplier) => {
    const attempt = startAnteUpWordStack(ANSWER, 1000, START);
    const filler = Array.from({ length: guessCount - 1 }, () => "stone");
    const won = playAll(attempt, [...filler, ANSWER]);
    expect(won.status).toBe("won");
    expect(anteUpWordStackPayout(won)).toBe(Math.round(1000 * multiplier));
  });

  it("rounds wager * multiplier to a whole Gold amount", () => {
    const attempt = startAnteUpWordStack(ANSWER, 333, START);
    const won = playAnteUpWordStackGuess(attempt, ANSWER); // 1-guess win, 8x -> 2664
    expect(anteUpWordStackPayout(won)).toBe(Math.round(333 * 8));
  });
});

describe("wordStackDailyBonusMultiplier", () => {
  it("floors a loss at 1.0x", () => {
    expect(wordStackDailyBonusMultiplier({ status: "lost", guesses: Array(6).fill("stone") })).toBe(1.0);
  });

  // Mirrors DAILY_BONUS_MULTIPLIER_BY_GUESSES: 1/2 -> 3.0x, 3 -> 2.2x,
  // 4 -> 1.6x, 5 -> 1.2x, 6 -> 1.0x, all on a win.
  it.each([
    [1, 3.0],
    [2, 3.0],
    [3, 2.2],
    [4, 1.6],
    [5, 1.2],
    [6, 1.0],
  ])("pays %ix for a win taking %i guesses", (guessCount, multiplier) => {
    expect(
      wordStackDailyBonusMultiplier({ status: "won", guesses: Array(guessCount).fill("stone") }),
    ).toBe(multiplier);
  });
});

describe("toAnteUpWordStackSnapshot", () => {
  it("redacts the answer while the attempt is active", () => {
    const attempt = startAnteUpWordStack(ANSWER, 500, START);
    const snap = toAnteUpWordStackSnapshot(attempt, { id: "a1", version: 1 });
    expect(snap.answer).toBeNull();
  });

  it("reveals the answer once the round itself has finished (a real loss, not a resignation)", () => {
    const attempt = startAnteUpWordStack(ANSWER, 500, START);
    const lost = playAll(attempt, ["stone", "stone", "stone", "stone", "stone", "stone"]);
    const snap = toAnteUpWordStackSnapshot(lost, { id: "a1", version: 1 });
    expect(snap.answer).toBe(ANSWER);
  });

  // A resignation only flips the attempt-level status -- the underlying
  // WordStackRound (word.status) never gets a guess that would end it, so the
  // redaction here (keyed off word.status, not attempt.status) keeps the
  // answer hidden. Documented, not asserted as ideal.
  it("keeps the answer hidden on a resignation, since the round itself never finished", () => {
    const attempt = startAnteUpWordStack(ANSWER, 500, START);
    const resigned = resignAnteUpWordStack(attempt);
    const snap = toAnteUpWordStackSnapshot(resigned, { id: "a1", version: 1 });
    expect(snap.status).toBe("lost");
    expect(snap.answer).toBeNull();
  });

  it("states the payout as computed by anteUpWordStackPayout", () => {
    const attempt = startAnteUpWordStack(ANSWER, 1000, START);
    const won = playAnteUpWordStackGuess(attempt, ANSWER);
    const snap = toAnteUpWordStackSnapshot(won, { id: "a1", version: 2 });
    expect(snap.payout).toBe(anteUpWordStackPayout(won));
    expect(snap.payout).toBe(8000);
  });

  it("carries the id and version passed in, not anything stored on the attempt", () => {
    const attempt = startAnteUpWordStack(ANSWER, 500, START);
    const snap = toAnteUpWordStackSnapshot(attempt, { id: "attempt-9", version: 4 });
    expect(snap.id).toBe("attempt-9");
    expect(snap.version).toBe(4);
  });
});
