import { describe, expect, it } from "vitest";
import { startConnectionsRound, submitConnectionsGuess, toConnectionsSnapshot, type ConnectionsPuzzle } from "./connections";
import {
  CONNECTIONS_BLOCKS,
  WORDLE_BLOCKS,
  connectionsGrid,
  connectionsShareText,
  puzzleShareTitle,
  wordleGrid,
  wordleScoreLine,
  wordleShareText,
} from "./share";
import { startWordleRound, submitWordleGuess, toWordleSnapshot } from "./wordle";

const meta = { day: "2026-08-05", puzzleNumber: 217, version: 1 };

function wordle(answer: string, guesses: string[]) {
  return toWordleSnapshot(guesses.reduce(submitWordleGuess, startWordleRound(answer)), meta);
}

const PUZZLE: ConnectionsPuzzle = {
  groups: [
    { level: 0, label: "Big cats", members: ["LION", "TIGER", "LEOPARD", "JAGUAR"] },
    { level: 1, label: "Card suits", members: ["HEART", "SPADE", "CLUB", "DIAMOND"] },
    { level: 2, label: "___ shark", members: ["CARD", "POOL", "LOAN", "TIGER SHARK"] },
    { level: 3, label: "Cars", members: ["MUSTANG", "BEETLE", "COBRA", "VIPER"] },
  ],
};

function connections(selections: string[][]) {
  return toConnectionsSnapshot(selections.reduce(submitConnectionsGuess, startConnectionsRound(PUZZLE, () => 0)), meta);
}

describe("wordleScoreLine", () => {
  it("counts the guesses it took", () => {
    expect(wordleScoreLine(wordle("crane", ["slate", "crane"]))).toBe("2/6");
  });

  it("prints X on a loss, not a number that would sort as a good score", () => {
    const lost = wordle("crane", ["slate", "brick", "pound", "fudge", "vinyl", "mirth"]);
    expect(wordleScoreLine(lost)).toBe("X/6");
  });
});

describe("wordleGrid", () => {
  it("is one row of blocks per guess", () => {
    const grid = wordleGrid(wordle("crane", ["slate", "crane"]));
    const rows = grid.split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(WORDLE_BLOCKS.correct.repeat(5));
    // Five blocks a row, counted by code point -- these are astral characters,
    // so String.length would report ten and quietly pass a broken grid.
    expect([...rows[0]]).toHaveLength(5);
  });

  it("uses the three blocks everyone already reads", () => {
    expect(WORDLE_BLOCKS.correct).toBe("🟩");
    expect(WORDLE_BLOCKS.present).toBe("🟨");
    expect(WORDLE_BLOCKS.absent).toBe("⬛");
  });
});

describe("wordleShareText", () => {
  it("is a heading, a blank line and the grid", () => {
    expect(wordleShareText(wordle("crane", ["nacre", "crane"]))).toBe(
      ["StackChips Wordle #217 2/6", "", "🟨🟨🟨🟨🟩", "🟩🟩🟩🟩🟩"].join("\n"),
    );
  });

  it("never contains the answer or a guessed word", () => {
    // The property that makes the result postable at all: a share that spoils
    // the puzzle is worse than no share button.
    const snapshot = wordle("crane", ["slate", "crane"]);
    const text = wordleShareText(snapshot) as string;
    expect(text).not.toContain("crane");
    expect(text).not.toContain("slate");
    // The grid itself must be blocks and newlines and nothing else -- the
    // heading is the only place letters are allowed, so checking the whole
    // string would only ever be testing the word "StackChips".
    expect(wordleGrid(snapshot)).not.toMatch(/[a-z]/i);
  });

  it("refuses to build a share for a round still in progress", () => {
    // Null rather than a partial grid -- a mid-round share is a spoiler, and
    // returning something the caller must remember not to use is how that ships.
    expect(wordleShareText(wordle("crane", ["slate"]))).toBeNull();
  });

  it("appends a link only when asked", () => {
    const text = wordleShareText(wordle("crane", ["crane"]), { link: "https://stackchips.app" }) as string;
    expect(text.endsWith("\n\nhttps://stackchips.app")).toBe(true);
    expect(wordleShareText(wordle("crane", ["crane"]))).not.toContain("stackchips.app");
  });
});

describe("connectionsGrid", () => {
  it("is one row of four colours per guess, in the order they were played", () => {
    const snapshot = connections([
      ["LION", "TIGER", "LEOPARD", "COBRA"],
      ["LION", "TIGER", "LEOPARD", "JAGUAR"],
      ["HEART", "SPADE", "CLUB", "DIAMOND"],
      ["CARD", "POOL", "LOAN", "TIGER SHARK"],
      ["MUSTANG", "BEETLE", "COBRA", "VIPER"],
    ]);
    expect(connectionsGrid(snapshot)).toBe(
      ["🟨🟨🟨🟪", "🟨🟨🟨🟨", "🟩🟩🟩🟩", "🟦🟦🟦🟦", "🟪🟪🟪🟪"].join("\n"),
    );
  });

  it("runs yellow to purple as the difficulty climbs", () => {
    // Storing the level rather than a colour is what keeps this ordering
    // meaningful: opening on a row of purple says something a row of yellow does not.
    expect(CONNECTIONS_BLOCKS[0]).toBe("🟨");
    expect(CONNECTIONS_BLOCKS[1]).toBe("🟩");
    expect(CONNECTIONS_BLOCKS[2]).toBe("🟦");
    expect(CONNECTIONS_BLOCKS[3]).toBe("🟪");
  });
});

describe("connectionsShareText", () => {
  it("is a heading, a blank line and the grid", () => {
    const snapshot = connections([
      ["LION", "TIGER", "LEOPARD", "JAGUAR"],
      ["HEART", "SPADE", "CLUB", "DIAMOND"],
      ["CARD", "POOL", "LOAN", "TIGER SHARK"],
      ["MUSTANG", "BEETLE", "COBRA", "VIPER"],
    ]);
    expect(connectionsShareText(snapshot)).toBe(
      ["StackChips Connections #217", "", "🟨🟨🟨🟨", "🟩🟩🟩🟩", "🟦🟦🟦🟦", "🟪🟪🟪🟪"].join("\n"),
    );
  });

  it("names no word from the board", () => {
    const snapshot = connections([
      ["LION", "TIGER", "LEOPARD", "JAGUAR"],
      ["HEART", "SPADE", "CLUB", "DIAMOND"],
      ["CARD", "POOL", "LOAN", "TIGER SHARK"],
      ["MUSTANG", "BEETLE", "COBRA", "VIPER"],
    ]);
    const text = connectionsShareText(snapshot) as string;
    ["LION", "HEART", "MUSTANG", "Big cats", "Cars"].forEach((secret) => {
      expect(text).not.toContain(secret);
    });
  });

  it("refuses to build a share for a round still in progress", () => {
    expect(connectionsShareText(connections([["LION", "TIGER", "LEOPARD", "JAGUAR"]]))).toBeNull();
  });
});

describe("puzzleShareTitle", () => {
  it("names the game and the puzzle", () => {
    expect(puzzleShareTitle("wordle", 217)).toBe("StackChips Wordle #217");
    expect(puzzleShareTitle("connections", 217)).toBe("StackChips Connections #217");
  });
});
