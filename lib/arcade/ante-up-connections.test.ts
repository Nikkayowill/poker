import { describe, expect, it } from "vitest";
import {
  anteUpConnectionsGuessProblem,
  anteUpConnectionsPayout,
  connectionsDailyBonusMultiplier,
  playAnteUpConnectionsGuess,
  resignAnteUpConnections,
  startAnteUpConnections,
  toAnteUpConnectionsSnapshot,
  type AnteUpConnectionsAttempt,
} from "./ante-up-connections";
import type { ConnectionsPuzzle } from "./puzzles/connections";

const START = new Date("2026-08-21T12:00:00Z");

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

const CATS = ["LION", "TIGER", "LEOPARD", "JAGUAR"];
const SUITS = ["HEART", "SPADE", "CLUB", "DIAMOND"];
const SHARKS = ["CARD", "POOL", "LOAN", "TIGER SHARK"];
const CARS = ["MUSTANG", "BEETLE", "COBRA", "VIPER"];

/** Four selections that each miss, in an order that never wins on the way -- forces a loss at the 4th. */
const WRONG_GUESSES = [
  ["LION", "HEART", "CARD", "VIPER"],
  ["TIGER", "SPADE", "POOL", "BEETLE"],
  ["LEOPARD", "CLUB", "LOAN", "COBRA"],
  ["JAGUAR", "DIAMOND", "TIGER SHARK", "MUSTANG"],
];

function open(wager = 1000): AnteUpConnectionsAttempt {
  return startAnteUpConnections(PUZZLE, noShuffle, wager, START);
}

function play(attempt: AnteUpConnectionsAttempt, selection: string[]): AnteUpConnectionsAttempt {
  return playAnteUpConnectionsGuess(attempt, selection);
}

describe("startAnteUpConnections", () => {
  it("opens active, carrying the wager and a fresh board", () => {
    const attempt = open(750);
    expect(attempt.status).toBe("active");
    expect(attempt.wager).toBe(750);
    expect(attempt.puzzle.order).toHaveLength(16);
  });
});

describe("anteUpConnectionsGuessProblem", () => {
  it("delegates to the puzzle engine while active", () => {
    const attempt = open();
    expect(anteUpConnectionsGuessProblem(attempt, CATS)).toBeNull();
    expect(anteUpConnectionsGuessProblem(attempt, CATS.slice(0, 3))).toBe("size");
  });

  it("refuses any guess once the attempt is over", () => {
    const attempt = play(open(), CATS);
    const lost = resignAnteUpConnections(attempt);
    expect(anteUpConnectionsGuessProblem(lost, SUITS)).toBe("finished");
  });
});

describe("playAnteUpConnectionsGuess", () => {
  it("solves a group without ending the attempt", () => {
    const attempt = play(open(), CATS);
    expect(attempt.status).toBe("active");
    expect(attempt.puzzle.solvedLevels).toEqual([0]);
  });

  it("wins the moment the fourth group falls", () => {
    const won = [CATS, SUITS, SHARKS, CARS].reduce(play, open());
    expect(won.status).toBe("won");
    expect(won.puzzle.mistakes).toBe(0);
  });

  it("loses on the fourth mistake, not the third", () => {
    const three = WRONG_GUESSES.slice(0, 3).reduce(play, open());
    expect(three.status).toBe("active");
    const four = play(three, WRONG_GUESSES[3]);
    expect(four.status).toBe("lost");
    expect(four.puzzle.mistakes).toBe(4);
  });

  it("is inert on a selection the round cannot accept", () => {
    const attempt = open();
    expect(play(attempt, ["LION"])).toBe(attempt);
  });

  it("is inert once the attempt has already finished", () => {
    const won = [CATS, SUITS, SHARKS, CARS].reduce(play, open());
    expect(play(won, CATS)).toBe(won);
  });
});

describe("resignAnteUpConnections", () => {
  it("ends an active attempt as a loss", () => {
    expect(resignAnteUpConnections(open()).status).toBe("lost");
  });

  it("is a no-op on an attempt that already ended", () => {
    const won = [CATS, SUITS, SHARKS, CARS].reduce(play, open());
    expect(resignAnteUpConnections(won).status).toBe("won");
  });
});

describe("anteUpConnectionsPayout", () => {
  it("pays nothing on anything but a win", () => {
    expect(anteUpConnectionsPayout(open(1000))).toBe(0);
    expect(anteUpConnectionsPayout(resignAnteUpConnections(open(1000)))).toBe(0);
  });

  it("pays the top multiplier for a clean solve", () => {
    const won = [CATS, SUITS, SHARKS, CARS].reduce(play, open(1000));
    expect(won.puzzle.mistakes).toBe(0);
    expect(anteUpConnectionsPayout(won)).toBe(8000);
  });

  it("pays less at each mistake tier: 1 -> 5x, 2 -> 3x, 3 -> 1.5x", () => {
    // One mistake, then clean up the rest.
    const oneMistake = [WRONG_GUESSES[0], CATS, SUITS, SHARKS, CARS].reduce(play, open(1000));
    expect(oneMistake.puzzle.mistakes).toBe(1);
    expect(anteUpConnectionsPayout(oneMistake)).toBe(5000);

    const twoMistakes = [WRONG_GUESSES[0], WRONG_GUESSES[1], CATS, SUITS, SHARKS, CARS].reduce(play, open(1000));
    expect(twoMistakes.puzzle.mistakes).toBe(2);
    expect(anteUpConnectionsPayout(twoMistakes)).toBe(3000);

    const threeMistakes = [WRONG_GUESSES[0], WRONG_GUESSES[1], WRONG_GUESSES[2], CATS, SUITS, SHARKS, CARS].reduce(
      play,
      open(1000),
    );
    expect(threeMistakes.puzzle.mistakes).toBe(3);
    expect(anteUpConnectionsPayout(threeMistakes)).toBe(1500);
  });

  it("pays nothing on a zero (practice) wager win", () => {
    const won = [CATS, SUITS, SHARKS, CARS].reduce(play, open(0));
    expect(won.status).toBe("won");
    expect(anteUpConnectionsPayout(won)).toBe(0);
  });
});

describe("connectionsDailyBonusMultiplier", () => {
  it("floors a loss at 1.0x", () => {
    expect(connectionsDailyBonusMultiplier({ status: "lost", mistakes: 4 })).toBe(1.0);
  });

  it("scales down from a clean solve to a near-loss win", () => {
    expect(connectionsDailyBonusMultiplier({ status: "won", mistakes: 0 })).toBe(3.0);
    expect(connectionsDailyBonusMultiplier({ status: "won", mistakes: 1 })).toBe(2.0);
    expect(connectionsDailyBonusMultiplier({ status: "won", mistakes: 2 })).toBe(1.5);
    expect(connectionsDailyBonusMultiplier({ status: "won", mistakes: 3 })).toBe(1.1);
  });
});

describe("toAnteUpConnectionsSnapshot", () => {
  const meta = { id: "attempt-1", version: 3 };

  it("never names an unsolved group while the attempt is active", () => {
    const attempt = play(open(1000), CATS);
    const snapshot = toAnteUpConnectionsSnapshot(attempt, meta);
    expect(snapshot.revealed).toHaveLength(1);
    expect(snapshot.revealed[0]).toMatchObject({ level: 0, label: "Big cats", solved: true });
    const wire = JSON.stringify(snapshot);
    expect(wire).not.toContain("Card suits");
    expect(wire).not.toContain("Cars");
    expect(snapshot.guessRows).toBeNull();
  });

  it("reveals every group, including the ones never found, once lost", () => {
    const lost = WRONG_GUESSES.reduce(play, open(1000));
    const snapshot = toAnteUpConnectionsSnapshot(lost, meta);
    expect(snapshot.status).toBe("lost");
    expect(snapshot.revealed).toHaveLength(4);
    expect(snapshot.revealed.every((group) => !group.solved)).toBe(true);
    expect(snapshot.payout).toBe(0);
  });

  it("states the payout as wager scored by mistakes, not left for the client to compute", () => {
    const won = [CATS, SUITS, SHARKS, CARS].reduce(play, open(2000));
    const snapshot = toAnteUpConnectionsSnapshot(won, meta);
    expect(snapshot.status).toBe("won");
    expect(snapshot.payout).toBe(16_000);
  });

  it("echoes the id and version passed in", () => {
    const snapshot = toAnteUpConnectionsSnapshot(open(500), meta);
    expect(snapshot.id).toBe("attempt-1");
    expect(snapshot.version).toBe(3);
  });
});
