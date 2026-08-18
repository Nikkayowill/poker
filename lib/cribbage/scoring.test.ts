import { describe, expect, it } from "vitest";
import {
  countFifteens,
  countPairs,
  heelsBonus,
  scoreFlush,
  scoreHand,
  scoreNobs,
  scorePeggingPlay,
  scoreRuns,
} from "./scoring";
import type { Card, Rank } from "./types";

function c(rank: Rank, suit: Card["suit"]): Card {
  return { rank, suit };
}

describe("countFifteens", () => {
  it("scores one combination as 2 points", () => {
    expect(countFifteens([c(5, "S"), c(10, "H")])).toBe(2);
  });

  it("counts every distinct subset that sums to 15", () => {
    // 5-5-5 (the three fives, one way) and 5-10 (three ways, one per five).
    expect(countFifteens([c(5, "S"), c(5, "H"), c(5, "D"), c(13, "C")])).toBe(8);
  });

  it("scores nothing when no subset sums to 15", () => {
    expect(countFifteens([c(2, "S"), c(3, "H"), c(4, "D")])).toBe(0);
  });
});

describe("countPairs", () => {
  it("scores a pair as 2", () => {
    expect(countPairs([c(5, "S"), c(5, "H")])).toBe(2);
  });

  it("scores three of a kind as 6", () => {
    expect(countPairs([c(5, "S"), c(5, "H"), c(5, "D")])).toBe(6);
  });

  it("scores four of a kind as 12", () => {
    expect(countPairs([c(5, "S"), c(5, "H"), c(5, "D"), c(5, "C")])).toBe(12);
  });

  it("scores nothing for all distinct ranks", () => {
    expect(countPairs([c(2, "S"), c(3, "H"), c(4, "D")])).toBe(0);
  });
});

describe("scoreRuns", () => {
  it("scores a plain run of 3", () => {
    expect(scoreRuns([c(3, "S"), c(4, "H"), c(5, "D")])).toBe(3);
  });

  it("scores a plain run of 4", () => {
    expect(scoreRuns([c(3, "S"), c(4, "H"), c(5, "D"), c(6, "C")])).toBe(4);
  });

  it("doubles a run for a duplicated rank inside it", () => {
    // 3-3-4-5: run of 3, twice over (once per 3) -> 6.
    expect(scoreRuns([c(3, "S"), c(3, "H"), c(4, "D"), c(5, "C")])).toBe(6);
  });

  it("scores a double-double run", () => {
    // 3-3-4-4-5: run of 3, times (2 threes * 2 fours) = 4 -> 12.
    expect(scoreRuns([c(3, "S"), c(3, "H"), c(4, "D"), c(4, "C"), c(5, "S")])).toBe(12);
  });

  it("scores nothing when ranks are not consecutive", () => {
    expect(scoreRuns([c(2, "S"), c(4, "H"), c(6, "D")])).toBe(0);
  });

  it("scores nothing for a run shorter than 3", () => {
    expect(scoreRuns([c(3, "S"), c(4, "H")])).toBe(0);
  });
});

describe("scoreFlush", () => {
  const hand = [c(2, "S"), c(5, "S"), c(9, "S"), c(13, "S")];

  it("scores 4 for a hand flush the starter does not extend", () => {
    expect(scoreFlush(hand, c(3, "H"), false)).toBe(4);
  });

  it("scores 5 when the starter also matches", () => {
    expect(scoreFlush(hand, c(3, "S"), false)).toBe(5);
  });

  it("scores nothing when the hand itself is not one suit", () => {
    expect(scoreFlush([c(2, "S"), c(5, "H"), c(9, "S"), c(13, "S")], c(3, "S"), false)).toBe(0);
  });

  it("a crib flush is 5-or-nothing: never 4", () => {
    expect(scoreFlush(hand, c(3, "H"), true)).toBe(0);
    expect(scoreFlush(hand, c(3, "S"), true)).toBe(5);
  });
});

describe("scoreNobs / heelsBonus", () => {
  it("scores nobs for a hand Jack matching the starter's suit", () => {
    expect(scoreNobs([c(11, "S"), c(2, "H")], c(4, "S"))).toBe(1);
  });

  it("scores no nobs for a Jack of the wrong suit", () => {
    expect(scoreNobs([c(11, "H"), c(2, "H")], c(4, "S"))).toBe(0);
  });

  it("scores heels only when the starter is a Jack", () => {
    expect(heelsBonus(c(11, "D"))).toBe(2);
    expect(heelsBonus(c(10, "D"))).toBe(0);
  });
});

describe("scoreHand", () => {
  it("scores a 0-point hand", () => {
    const { total, breakdown } = scoreHand([c(2, "S"), c(4, "H"), c(8, "D"), c(12, "C")], c(13, "S"), false);
    expect(total).toBe(0);
    expect(breakdown).toEqual([]);
  });

  it("scores the maximum 29-point hand", () => {
    // Three 5s + the Jack of the starter's suit in hand, the 4th 5 as starter.
    const hand = [c(5, "H"), c(5, "D"), c(5, "C"), c(11, "S")];
    const { total, breakdown } = scoreHand(hand, c(5, "S"), false);
    expect(total).toBe(29);
    expect(breakdown).toEqual([
      { label: "15s", points: 16 },
      { label: "Pairs", points: 12 },
      { label: "His Nobs", points: 1 },
    ]);
  });

  it("scores a flush-5 hand with a run alongside it (a flush hand can never also pair -- its four ranks are necessarily distinct)", () => {
    // 3-4-5-6 of spades (a run of 4, no pair possible in a flush hand), a
    // spade 10 as starter: extends the flush to 5 without extending the run.
    const hand = [c(3, "S"), c(4, "S"), c(5, "S"), c(6, "S")];
    const { total, breakdown } = scoreHand(hand, c(10, "S"), false);
    // 15s: {5,10} and {4,5,6} -> 2 combinations -> 4. Runs: 4. Flush: 5.
    expect(total).toBe(13);
    expect(breakdown).toEqual([
      { label: "15s", points: 4 },
      { label: "Runs", points: 4 },
      { label: "Flush", points: 5 },
    ]);
  });
});

describe("scorePeggingPlay", () => {
  it("scores nothing for an ordinary low play", () => {
    const { total, breakdown } = scorePeggingPlay([], c(2, "S"), 2);
    expect(total).toBe(0);
    expect(breakdown).toEqual([]);
  });

  it("scores 2 for hitting 15 exactly", () => {
    const { total } = scorePeggingPlay([c(10, "S")], c(5, "H"), 15);
    expect(total).toBe(2);
  });

  it("scores 2 for hitting 31 exactly", () => {
    const pile = [c(10, "S"), c(10, "H"), c(9, "D")]; // count 29
    const { total } = scorePeggingPlay(pile, c(2, "C"), 31);
    expect(total).toBe(2);
  });

  it("scores a trailing pair", () => {
    const { total, breakdown } = scorePeggingPlay([c(5, "S")], c(5, "H"), 10);
    expect(total).toBe(2);
    expect(breakdown).toEqual([{ label: "Pair", points: 2 }]);
  });

  it("scores a trailing triple as 6, plus 15 if it lands there", () => {
    const pile = [c(5, "S"), c(5, "H")];
    const { total, breakdown } = scorePeggingPlay(pile, c(5, "D"), 15);
    expect(total).toBe(8);
    expect(breakdown).toEqual(
      expect.arrayContaining([
        { label: "15", points: 2 },
        { label: "Pairs", points: 6 },
      ]),
    );
  });

  it("scores a trailing quad as 12", () => {
    const pile = [c(5, "S"), c(5, "H"), c(5, "D")];
    const { total } = scorePeggingPlay(pile, c(5, "C"), 20);
    expect(total).toBe(12);
  });

  it("scores a trailing run of 3", () => {
    const pile = [c(3, "S"), c(4, "H")];
    const { total, breakdown } = scorePeggingPlay(pile, c(5, "D"), 12);
    expect(total).toBe(3);
    expect(breakdown).toEqual([{ label: "Run", points: 3 }]);
  });

  it("a duplicate rank inside the window breaks the run -- pegging has no double runs", () => {
    const pile = [c(3, "S"), c(4, "H"), c(4, "D")];
    const { total } = scorePeggingPlay(pile, c(5, "C"), 16);
    expect(total).toBe(0);
  });

  it("picks the longest qualifying trailing run, not a shorter false start", () => {
    const pile = [c(2, "S"), c(3, "H"), c(4, "D")];
    const { total, breakdown } = scorePeggingPlay(pile, c(5, "C"), 14);
    expect(total).toBe(4);
    expect(breakdown).toEqual([{ label: "Run", points: 4 }]);
  });
});
