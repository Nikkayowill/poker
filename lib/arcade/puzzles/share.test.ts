import { describe, expect, it } from "vitest";
import { startConnectionsRound, submitConnectionsGuess, toConnectionsSnapshot, type ConnectionsPuzzle } from "./connections";
import {
  CONNECTIONS_BLOCKS,
  WORD_STACK_BLOCKS,
  connectionsGrid,
  connectionsShareText,
  puzzleShareTitle,
  wordStackGrid,
  wordStackScoreLine,
  wordStackShareText,
} from "./share";
import { startWordStackRound, submitWordStackGuess, toWordStackSnapshot } from "./word-stack";

const meta = { day: "2026-08-05", puzzleNumber: 217, version: 1 };

function wordStack(answer: string, guesses: string[]) {
  return toWordStackSnapshot(guesses.reduce(submitWordStackGuess, startWordStackRound(answer)), meta);
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

describe("wordStackScoreLine", () => {
  it("counts the guesses it took", () => {
    expect(wordStackScoreLine(wordStack("crane", ["slate", "crane"]))).toBe("2/6");
  });

  it("prints X on a loss, not a number that would sort as a good score", () => {
    const lost = wordStack("crane", ["slate", "brick", "pound", "fudge", "vinyl", "mirth"]);
    expect(wordStackScoreLine(lost)).toBe("X/6");
  });
});

describe("wordStackGrid", () => {
  it("is one row of blocks per guess", () => {
    const grid = wordStackGrid(wordStack("crane", ["slate", "crane"]));
    const rows = grid.split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(WORD_STACK_BLOCKS.correct.repeat(5));
    // Five blocks a row, counted by code point -- these are astral characters,
    // so String.length would report ten and quietly pass a broken grid.
    expect([...rows[0]]).toHaveLength(5);
  });

  it("uses the three blocks everyone already reads", () => {
    expect(WORD_STACK_BLOCKS.correct).toBe("🟩");
    expect(WORD_STACK_BLOCKS.present).toBe("🟧");
    expect(WORD_STACK_BLOCKS.absent).toBe("⬛");
  });
});

describe("wordStackShareText", () => {
  it("is a heading, a blank line and the grid", () => {
    expect(wordStackShareText(wordStack("crane", ["nacre", "crane"]))).toBe(
      ["StackChips Word Stack #217 2/6", "", "🟧🟧🟧🟧🟩", "🟩🟩🟩🟩🟩"].join("\n"),
    );
  });

  it("never contains the answer or a guessed word", () => {
    // The property that makes the result postable at all: a share that spoils
    // the puzzle is worse than no share button.
    const snapshot = wordStack("crane", ["slate", "crane"]);
    const text = wordStackShareText(snapshot) as string;
    expect(text).not.toContain("crane");
    expect(text).not.toContain("slate");
    // The grid itself must be blocks and newlines and nothing else -- the
    // heading is the only place letters are allowed, so checking the whole
    // string would only ever be testing the word "StackChips".
    expect(wordStackGrid(snapshot)).not.toMatch(/[a-z]/i);
  });

  it("refuses to build a share for a round still in progress", () => {
    // Null rather than a partial grid -- a mid-round share is a spoiler, and
    // returning something the caller must remember not to use is how that ships.
    expect(wordStackShareText(wordStack("crane", ["slate"]))).toBeNull();
  });

  it("appends a link only when asked", () => {
    const text = wordStackShareText(wordStack("crane", ["crane"]), { link: "https://stackchips.app" }) as string;
    expect(text.endsWith("\n\nhttps://stackchips.app")).toBe(true);
    expect(wordStackShareText(wordStack("crane", ["crane"]))).not.toContain("stackchips.app");
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
    expect(puzzleShareTitle("word-stack", 217)).toBe("StackChips Word Stack #217");
    expect(puzzleShareTitle("connections", 217)).toBe("StackChips Connections #217");
  });
});
