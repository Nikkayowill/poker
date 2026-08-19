import { describe, expect, it } from "vitest";
import { CONNECTIONS_PUZZLES } from "./connections-puzzles";
import { CONNECTIONS_GROUP_SIZE, assertPlayablePuzzle, normalizeWord } from "./connections";
import { WORD_STACK_ANSWERS } from "./word-stack-answers";
import { WORD_STACK_ALLOWED_GUESSES, isAllowedWordStackGuess } from "./word-stack-dictionary";
import { WORD_STACK_WORD_LENGTH, startWordStackRound } from "./word-stack";

/**
 * The data files, checked for the faults that would otherwise surface on
 * exactly one day -- the day that entry came up -- for every player at once.
 * A daily puzzle has no gradual rollout: a bad row is a total outage of that
 * day's game, so these are cheap insurance.
 */

describe("WORD_STACK_ANSWERS", () => {
  it("is every answer a legal guess", () => {
    // The one that would be unwinnable rather than merely wrong: an answer the
    // dictionary rejects cannot be typed, so the board could not be solved at all.
    const orphans = WORD_STACK_ANSWERS.filter((word) => !isAllowedWordStackGuess(word));
    expect(orphans).toEqual([]);
  });

  it("is all five-letter lowercase words", () => {
    const malformed = WORD_STACK_ANSWERS.filter((word) => !/^[a-z]{5}$/.test(word));
    expect(malformed).toEqual([]);
    expect(WORD_STACK_WORD_LENGTH).toBe(5);
  });

  it("has no duplicates", () => {
    // A duplicate silently doubles that word's odds and shortens the cycle.
    expect(new Set(WORD_STACK_ANSWERS).size).toBe(WORD_STACK_ANSWERS.length);
  });

  it("every answer opens a playable round", () => {
    expect(() => WORD_STACK_ANSWERS.forEach(startWordStackRound)).not.toThrow();
  });

  it("runs long enough that a player will not see a repeat", () => {
    // dailyIndex walks the pool rather than sampling it, so the cycle length
    // IS the pool size -- over two years here.
    expect(WORD_STACK_ANSWERS.length).toBeGreaterThan(730);
  });
});

describe("WORD_STACK_ALLOWED_GUESSES", () => {
  it("is wide enough that real words are not rejected", () => {
    // A rejection reads as a bug rather than a rule, so the dictionary has to
    // be in the same range as the game this is modelled on (~13k).
    expect(WORD_STACK_ALLOWED_GUESSES.size).toBeGreaterThan(12_000);
  });

  it("accepts ordinary opening guesses", () => {
    ["slate", "crane", "adieu", "audio", "raise", "stare"].forEach((word) => {
      expect(isAllowedWordStackGuess(word)).toBe(true);
    });
  });

  it("rejects a non-word and normalizes what it is given", () => {
    expect(isAllowedWordStackGuess("zzzzz")).toBe(false);
    expect(isAllowedWordStackGuess("  SLATE ")).toBe(true);
  });

  it("holds only five-letter lowercase words", () => {
    const malformed = [...WORD_STACK_ALLOWED_GUESSES].filter((word) => !/^[a-z]{5}$/.test(word));
    expect(malformed).toEqual([]);
  });
});

describe("CONNECTIONS_PUZZLES", () => {
  it("every set is playable", () => {
    // Four groups, one per level, four members each, no word in two groups --
    // the last is the one that produces a player insisting a correct group was
    // rejected, which is unfalsifiable from a support message.
    CONNECTIONS_PUZZLES.forEach((puzzle, index) => {
      expect(() => assertPlayablePuzzle(puzzle), `puzzle ${index}`).not.toThrow();
    });
  });

  it("puts sixteen distinct words on every board", () => {
    CONNECTIONS_PUZZLES.forEach((puzzle, index) => {
      const words = puzzle.groups.flatMap((group) => group.members.map(normalizeWord));
      expect(words, `puzzle ${index}`).toHaveLength(16);
      expect(new Set(words).size, `puzzle ${index}`).toBe(16);
    });
  });

  it("keeps tiles short enough to fit four across on a phone", () => {
    // A long tile either shrinks the type until it is unreadable or wraps and
    // breaks the grid. Ten characters is what the board was laid out against.
    const long = CONNECTIONS_PUZZLES.flatMap((puzzle) =>
      puzzle.groups.flatMap((group) => group.members.filter((word) => word.length > 10)),
    );
    expect(long).toEqual([]);
  });

  it("keeps labels to one row", () => {
    const long = CONNECTIONS_PUZZLES.flatMap((puzzle) =>
      puzzle.groups.filter((group) => group.label.length > 24).map((group) => group.label),
    );
    expect(long).toEqual([]);
  });

  it("is authored in level order, so the difficulty ramp is readable", () => {
    CONNECTIONS_PUZZLES.forEach((puzzle, index) => {
      expect(puzzle.groups.map((group) => group.level), `puzzle ${index}`).toEqual([0, 1, 2, 3]);
    });
  });

  it("stores tiles already normalized, so the board is not shouting inconsistently", () => {
    CONNECTIONS_PUZZLES.forEach((puzzle, index) => {
      puzzle.groups.forEach((group) => {
        group.members.forEach((word) => {
          expect(word, `puzzle ${index}`).toBe(normalizeWord(word));
        });
      });
    });
  });

  it("has enough sets to be worth opening daily", () => {
    expect(CONNECTIONS_PUZZLES.length).toBeGreaterThanOrEqual(20);
    expect(CONNECTIONS_GROUP_SIZE).toBe(4);
  });

  it("has no two identical boards", () => {
    const boards = CONNECTIONS_PUZZLES.map((puzzle) =>
      puzzle.groups.flatMap((group) => group.members).sort().join("|"),
    );
    expect(new Set(boards).size).toBe(boards.length);
  });
});
