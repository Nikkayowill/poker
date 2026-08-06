import { describe, expect, it } from "vitest";
import {
  CONNECTIONS_MAX_MISTAKES,
  connectionsGuessProblem,
  connectionsGuessRows,
  remainingWords,
  startConnectionsRound,
  submitConnectionsGuess,
  toConnectionsSnapshot,
  type ConnectionsPuzzle,
  type ConnectionsRound,
} from "./connections";

const PUZZLE: ConnectionsPuzzle = {
  groups: [
    { level: 0, label: "Big cats", members: ["LION", "TIGER", "LEOPARD", "JAGUAR"] },
    { level: 1, label: "Card suits", members: ["HEART", "SPADE", "CLUB", "DIAMOND"] },
    { level: 2, label: "___ shark", members: ["CARD", "POOL", "LOAN", "TIGER SHARK"] },
    { level: 3, label: "Cars", members: ["MUSTANG", "BEETLE", "COBRA", "VIPER"] },
  ],
};

/** A no-op shuffle keeps the board in authored order, so tests read as written. */
const noShuffle = () => 0;

function open(): ConnectionsRound {
  return startConnectionsRound(PUZZLE, noShuffle);
}

const CATS = ["LION", "TIGER", "LEOPARD", "JAGUAR"];
const SUITS = ["HEART", "SPADE", "CLUB", "DIAMOND"];
const SHARKS = ["CARD", "POOL", "LOAN", "TIGER SHARK"];
const CARS = ["MUSTANG", "BEETLE", "COBRA", "VIPER"];
/** Three cats and a stray -- the "one away" shape. */
const NEARLY_CATS = ["LION", "TIGER", "LEOPARD", "COBRA"];

describe("startConnectionsRound", () => {
  it("puts all sixteen words on the board", () => {
    expect(open().order).toHaveLength(16);
    expect(new Set(open().order).size).toBe(16);
  });

  it("shuffles, so the board does not open with the yellows in a row", () => {
    let calls = 0;
    // A descending counter is a real permutation rather than the identity,
    // which is what the no-op used elsewhere in this file gives.
    const round = startConnectionsRound(PUZZLE, (max) => (calls++ * 7) % max);
    expect(round.order).not.toEqual(open().order);
    expect(new Set(round.order).size).toBe(16);
  });

  it("rejects a malformed puzzle at deal time rather than mid-game", () => {
    expect(() =>
      startConnectionsRound({ groups: PUZZLE.groups.slice(0, 3) }, noShuffle),
    ).toThrow();
    expect(() =>
      startConnectionsRound(
        { groups: [...PUZZLE.groups.slice(0, 3), { level: 3, label: "Short", members: ["A", "B", "C"] }] },
        noShuffle,
      ),
    ).toThrow();
    // A word in two groups is unsolvable in a way that only surfaces as a
    // player insisting a correct group was rejected.
    expect(() =>
      startConnectionsRound(
        {
          groups: [
            ...PUZZLE.groups.slice(0, 3),
            { level: 3, label: "Dupe", members: ["LION", "BEETLE", "COBRA", "VIPER"] },
          ],
        },
        noShuffle,
      ),
    ).toThrow();
  });
});

describe("connectionsGuessProblem", () => {
  it("accepts four distinct words on the board", () => {
    expect(connectionsGuessProblem(open(), CATS)).toBeNull();
    // Mixed groups are a legal guess -- a wrong one, but legal.
    expect(connectionsGuessProblem(open(), ["LION", "HEART", "CARD", "VIPER"])).toBeNull();
  });

  it("rejects the wrong count or a repeated word", () => {
    expect(connectionsGuessProblem(open(), CATS.slice(0, 3))).toBe("size");
    expect(connectionsGuessProblem(open(), ["LION", "LION", "TIGER", "SPADE"])).toBe("size");
  });

  it("rejects a word that is not on this board", () => {
    expect(connectionsGuessProblem(open(), ["LION", "TIGER", "LEOPARD", "WOMBAT"])).toBe("unknown-word");
  });

  it("rejects a word from an already-solved group", () => {
    const solved = submitConnectionsGuess(open(), CATS);
    expect(connectionsGuessProblem(solved, ["LION", "HEART", "SPADE", "CLUB"])).toBe("solved-word");
  });

  it("rejects a repeat without charging a mistake", () => {
    // Charging for a mis-click the player already paid for reads as the game
    // cheating, so a repeat is refused rather than scored.
    const once = submitConnectionsGuess(open(), NEARLY_CATS);
    expect(connectionsGuessProblem(once, NEARLY_CATS)).toBe("repeat");
    // Order must not launder it into a new guess.
    expect(connectionsGuessProblem(once, [...NEARLY_CATS].reverse())).toBe("repeat");
    expect(submitConnectionsGuess(once, NEARLY_CATS).mistakes).toBe(1);
  });

  it("rejects any guess once the round is over", () => {
    const won = [CATS, SUITS, SHARKS, CARS].reduce(submitConnectionsGuess, open());
    expect(connectionsGuessProblem(won, CATS)).toBe("finished");
  });
});

describe("submitConnectionsGuess", () => {
  it("solves a group and takes it off the board", () => {
    const round = submitConnectionsGuess(open(), CATS);
    expect(round.solvedLevels).toEqual([0]);
    expect(round.lastVerdict).toBe("correct");
    expect(round.mistakes).toBe(0);
    expect(remainingWords(round)).toHaveLength(12);
    expect(remainingWords(round)).not.toContain("LION");
  });

  it("says one away for three of a group plus a stray", () => {
    const round = submitConnectionsGuess(open(), NEARLY_CATS);
    expect(round.lastVerdict).toBe("one-away");
    expect(round.mistakes).toBe(1);
  });

  it("says only wrong for a genuinely scattered guess", () => {
    const round = submitConnectionsGuess(open(), ["LION", "HEART", "CARD", "VIPER"]);
    expect(round.lastVerdict).toBe("wrong");
    expect(round.mistakes).toBe(1);
  });

  it("counts a two-and-two split as wrong, not one away", () => {
    const round = submitConnectionsGuess(open(), ["LION", "TIGER", "HEART", "SPADE"]);
    expect(round.lastVerdict).toBe("wrong");
  });

  it("wins when the fourth group falls", () => {
    const round = [CATS, SUITS, SHARKS, CARS].reduce(submitConnectionsGuess, open());
    expect(round.status).toBe("won");
    expect(round.solvedLevels).toEqual([0, 1, 2, 3]);
    expect(remainingWords(round)).toEqual([]);
  });

  it("loses on the fourth mistake, not the third", () => {
    const wrong = [
      ["LION", "HEART", "CARD", "VIPER"],
      ["TIGER", "SPADE", "POOL", "BEETLE"],
      ["LEOPARD", "CLUB", "LOAN", "COBRA"],
      ["JAGUAR", "DIAMOND", "TIGER SHARK", "MUSTANG"],
    ];
    const three = wrong.slice(0, 3).reduce(submitConnectionsGuess, open());
    expect(three.status).toBe("active");
    const four = submitConnectionsGuess(three, wrong[3]);
    expect(four.status).toBe("lost");
    expect(four.mistakes).toBe(CONNECTIONS_MAX_MISTAKES);
  });

  it("is inert on a guess it cannot accept, rather than throwing", () => {
    const round = open();
    expect(submitConnectionsGuess(round, ["LION"])).toBe(round);
  });

  it("normalizes case, so a lowercase selection still solves", () => {
    expect(submitConnectionsGuess(open(), CATS.map((word) => word.toLowerCase())).solvedLevels).toEqual([0]);
  });
});

describe("connectionsGuessRows", () => {
  it("maps each guess to the difficulty levels of the words in it", () => {
    const round = [NEARLY_CATS, CATS].reduce(submitConnectionsGuess, open());
    expect(connectionsGuessRows(round)).toEqual([
      [0, 0, 0, 3],
      [0, 0, 0, 0],
    ]);
  });
});

describe("toConnectionsSnapshot", () => {
  const meta = { day: "2026-08-05", puzzleNumber: 217, version: 1 };

  it("withholds the per-word colours while the round is live", () => {
    // The real redaction in this game. Four wrong guesses that each reported
    // per-word groups would be a free complete solution.
    const round = submitConnectionsGuess(open(), NEARLY_CATS);
    const snapshot = toConnectionsSnapshot(round, meta);
    expect(snapshot.guessRows).toBeNull();
    expect(snapshot.lastVerdict).toBe("one-away");
  });

  it("does not name an unsolved group", () => {
    const snapshot = toConnectionsSnapshot(submitConnectionsGuess(open(), CATS), meta);
    expect(snapshot.revealed).toHaveLength(1);
    expect(snapshot.revealed[0]).toMatchObject({ level: 0, label: "Big cats", solved: true });
    const wire = JSON.stringify(snapshot);
    expect(wire).not.toContain("Card suits");
    expect(wire).not.toContain("Cars");
  });

  it("releases the colour matrix once the round is over", () => {
    const round = [CATS, SUITS, SHARKS, CARS].reduce(submitConnectionsGuess, open());
    const snapshot = toConnectionsSnapshot(round, meta);
    expect(snapshot.guessRows).toEqual([[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]]);
    expect(snapshot.status).toBe("won");
  });

  it("reveals the groups the player never found, once they have lost", () => {
    const wrong = [
      ["LION", "HEART", "CARD", "VIPER"],
      ["TIGER", "SPADE", "POOL", "BEETLE"],
      ["LEOPARD", "CLUB", "LOAN", "COBRA"],
      ["JAGUAR", "DIAMOND", "TIGER SHARK", "MUSTANG"],
    ];
    const lost = wrong.reduce(submitConnectionsGuess, open());
    const snapshot = toConnectionsSnapshot(lost, meta);
    expect(snapshot.status).toBe("lost");
    expect(snapshot.revealed).toHaveLength(4);
    expect(snapshot.revealed.every((group) => !group.solved)).toBe(true);
    expect(snapshot.revealed.map((group) => group.label)).toContain("Cars");
  });

  it("lists solved groups first, in the order they were found", () => {
    const round = [SHARKS, CATS].reduce(submitConnectionsGuess, open());
    expect(toConnectionsSnapshot(round, meta).revealed.map((group) => group.level)).toEqual([2, 0]);
  });
});
