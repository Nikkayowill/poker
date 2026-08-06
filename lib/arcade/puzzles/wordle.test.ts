import { describe, expect, it } from "vitest";
import {
  WORDLE_MAX_GUESSES,
  scoreWordleGuess,
  startWordleRound,
  submitWordleGuess,
  toWordleSnapshot,
  wordleGuessProblem,
  wordleKeyboardState,
  type WordleRound,
} from "./wordle";

/** "cpa" -> correct, present, absent. Keeps the duplicate-letter cases readable. */
function tiles(shorthand: string) {
  return shorthand.split("").map((letter) => {
    if (letter === "c") return "correct";
    if (letter === "p") return "present";
    return "absent";
  });
}

function play(answer: string, guesses: string[]): WordleRound {
  return guesses.reduce(submitWordleGuess, startWordleRound(answer));
}

describe("scoreWordleGuess", () => {
  it("scores an exact hit all green", () => {
    expect(scoreWordleGuess("crane", "crane")).toEqual(tiles("ccccc"));
  });

  it("scores a miss all grey", () => {
    expect(scoreWordleGuess("blimp", "crude")).toEqual(tiles("aaaaa"));
  });

  it("marks a misplaced letter present", () => {
    expect(scoreWordleGuess("crane", "nacre")).toEqual(tiles("ppppc"));
  });

  // The whole reason scoring is two passes. A one-pass "is this letter in the
  // answer?" rule gets every one of these wrong, and gets every single-letter
  // word right -- which is exactly why it survives casual testing.
  describe("duplicate letters", () => {
    it("does not report a letter more often than the answer contains it", () => {
      // Three Es in EERIE, one in ABBEY. Exactly one is paid; the naive
      // "is this letter in the answer?" rule paints all three yellow.
      expect(scoreWordleGuess("eerie", "abbey")).toEqual(tiles("paaaa"));
    });

    it("gives greens first claim on the letter pool", () => {
      // GEESE has three Es, two of which land green. That leaves exactly one
      // for the guess's first E to draw -- not two, and not zero.
      expect(scoreWordleGuess("eerie", "geese")).toEqual(tiles("pcaac"));
    });

    it("pays a doubled letter twice when the answer really has two", () => {
      // Both Ls are paid (ALLOT has two) and only one of the two As is
      // (ALLOT has one). One guess, both halves of the rule.
      expect(scoreWordleGuess("llama", "allot")).toEqual(tiles("pcpaa"));
    });

    it("greys the earlier copies when a green has claimed the only one", () => {
      // CRANE's single E is taken by the green in last position, so the two
      // Es before it are grey. A one-pass scorer paints them yellow and tells
      // the player there is a second E to find.
      expect(scoreWordleGuess("eerie", "crane")).toEqual(tiles("aapac"));
    });
  });
});

describe("wordleGuessProblem", () => {
  const round = startWordleRound("crane");

  it("accepts a well-formed guess", () => {
    expect(wordleGuessProblem(round, "SLATE")).toBeNull();
    expect(wordleGuessProblem(round, " slate ")).toBeNull();
  });

  it("rejects the wrong length and non-letters", () => {
    expect(wordleGuessProblem(round, "slat")).toBe("length");
    expect(wordleGuessProblem(round, "slates")).toBe("length");
    expect(wordleGuessProblem(round, "sl4te")).toBe("letters");
  });

  it("rejects a guess after the round is over", () => {
    expect(wordleGuessProblem(play("crane", ["crane"]), "slate")).toBe("finished");
  });

  it("does not claim to know whether a word is real", () => {
    // There is no dictionary in this module by design -- it is client-imported
    // and a word list here would ship every answer to the browser. "zzzzz" is
    // structurally fine; the service is what rejects it.
    expect(wordleGuessProblem(round, "zzzzz")).toBeNull();
  });
});

describe("submitWordleGuess", () => {
  it("records the guess and its score", () => {
    const round = play("crane", ["slate"]);
    expect(round.guesses).toEqual(["slate"]);
    expect(round.results).toEqual([scoreWordleGuess("slate", "crane")]);
    expect(round.status).toBe("active");
  });

  it("wins on the answer", () => {
    expect(play("crane", ["slate", "crane"]).status).toBe("won");
  });

  it("loses after six wrong guesses, not five", () => {
    const wrong = ["slate", "brick", "pound", "fudge", "vinyl"];
    expect(play("crane", wrong).status).toBe("active");
    expect(play("crane", [...wrong, "mirth"]).status).toBe("lost");
    expect(WORDLE_MAX_GUESSES).toBe(6);
  });

  it("still wins on the last guess", () => {
    const round = play("crane", ["slate", "brick", "pound", "fudge", "vinyl", "crane"]);
    expect(round.status).toBe("won");
    expect(round.guesses).toHaveLength(6);
  });

  it("is inert on a guess it cannot accept, rather than throwing", () => {
    // Same convention as callHiLo: the service re-checks and answers 409, and
    // a throw here would surface to the player as a 500.
    const round = startWordleRound("crane");
    expect(submitWordleGuess(round, "nope")).toBe(round);
    const finished = play("crane", ["crane"]);
    expect(submitWordleGuess(finished, "slate")).toBe(finished);
  });

  it("normalizes case, so a shouted guess plays the same", () => {
    expect(play("crane", ["SLATE"]).guesses).toEqual(["slate"]);
  });
});

describe("wordleKeyboardState", () => {
  it("keeps the strongest thing known about each letter", () => {
    // E is present in the first guess and correct in the second; it must not
    // fall back to yellow just because a later guess said less about it.
    const round = play("crane", ["eerie", "crane"]);
    expect(wordleKeyboardState(round).e).toBe("correct");
  });

  it("does not downgrade a known letter to absent", () => {
    const round = play("abbey", ["eerie"]);
    expect(wordleKeyboardState(round).e).toBe("present");
    expect(wordleKeyboardState(round).r).toBe("absent");
  });
});

describe("toWordleSnapshot", () => {
  const meta = { day: "2026-08-05", puzzleNumber: 217, version: 1 };

  it("withholds the answer while the round is live", () => {
    // The one thing that would make the whole server-side round pointless: a
    // five-letter string in the payload is a one-guess win for anyone with a
    // network tab open.
    const snapshot = toWordleSnapshot(play("crane", ["slate"]), meta);
    expect(snapshot.answer).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("crane");
  });

  it("reveals the answer once the round is over", () => {
    expect(toWordleSnapshot(play("crane", ["crane"]), meta).answer).toBe("crane");
    const lost = play("crane", ["slate", "brick", "pound", "fudge", "vinyl", "mirth"]);
    expect(toWordleSnapshot(lost, meta).answer).toBe("crane");
  });

  it("carries the day and number the share text names", () => {
    const snapshot = toWordleSnapshot(startWordleRound("crane"), meta);
    expect(snapshot.day).toBe("2026-08-05");
    expect(snapshot.puzzleNumber).toBe(217);
  });

  it("copies its arrays, so a caller cannot reach back into the round", () => {
    const round = play("crane", ["slate"]);
    const snapshot = toWordleSnapshot(round, meta);
    snapshot.guesses.push("hacked");
    snapshot.results[0][0] = "correct";
    expect(round.guesses).toEqual(["slate"]);
    expect(round.results[0][0]).toBe(scoreWordleGuess("slate", "crane")[0]);
  });
});

describe("startWordleRound", () => {
  it("rejects an answer that is not a five-letter word", () => {
    expect(() => startWordleRound("four")).toThrow();
    expect(() => startWordleRound("sl4te")).toThrow();
  });
});
