import { describe, expect, it } from "vitest";
import {
  CONNECTIONS_BOARD_COLUMNS,
  alignSelectionInline,
  selectionKey,
  shuffleBoardOrder,
} from "./board-order";

const BOARD = [
  "LION", "TIGER", "LEOPARD", "JAGUAR",
  "HEART", "SPADE", "CLUB", "DIAMOND",
  "CARD", "POOL", "LOAN", "SHARK",
  "MUSTANG", "BEETLE", "COBRA", "VIPER",
];

/** The identity permutation -- every swap is with the element itself. */
const noShuffle = (max: number) => max - 1;

/** A real permutation, deterministic. Same trick connections.test.ts uses. */
function counter() {
  let calls = 0;
  return (max: number) => (calls++ * 7) % max;
}

describe("shuffleBoardOrder", () => {
  it("keeps every word exactly once", () => {
    const next = shuffleBoardOrder(BOARD, counter());
    expect([...next].sort()).toEqual([...BOARD].sort());
  });

  it("does not mutate the board it was given", () => {
    const original = [...BOARD];
    shuffleBoardOrder(BOARD, counter());
    expect(BOARD).toEqual(original);
  });

  it("actually reorders", () => {
    expect(shuffleBoardOrder(BOARD, counter())).not.toEqual(BOARD);
  });
});

describe("alignSelectionInline", () => {
  it("seats the selection on the top row", () => {
    const selection = ["POOL", "CARD", "COBRA", "HEART"];
    const next = alignSelectionInline(BOARD, selection, counter());
    expect(next.slice(0, CONNECTIONS_BOARD_COLUMNS)).toEqual(selection);
  });

  it("keeps the player's tap order rather than board order", () => {
    const next = alignSelectionInline(BOARD, ["VIPER", "LION"], noShuffle);
    expect(next.slice(0, 2)).toEqual(["VIPER", "LION"]);
  });

  it("seats a partial selection contiguously, still on the top row", () => {
    const next = alignSelectionInline(BOARD, ["CLUB", "LOAN"], counter());
    expect(next.slice(0, 2)).toEqual(["CLUB", "LOAN"]);
    expect(next).toHaveLength(BOARD.length);
  });

  it("keeps every word exactly once and drops none", () => {
    const next = alignSelectionInline(BOARD, ["SPADE", "MUSTANG"], counter());
    expect([...next].sort()).toEqual([...BOARD].sort());
  });

  it("ignores a word that is no longer on the board", () => {
    const shrunk = BOARD.slice(0, 12);
    // MUSTANG's group was solved between the tap and the press.
    const next = alignSelectionInline(shrunk, ["MUSTANG", "CARD"], counter());
    expect(next[0]).toBe("CARD");
    expect([...next].sort()).toEqual([...shrunk].sort());
  });

  it("never seats one tile twice if the selection repeats a word", () => {
    const next = alignSelectionInline(BOARD, ["CARD", "CARD", "POOL"], counter());
    expect(next.slice(0, 2)).toEqual(["CARD", "POOL"]);
    expect([...next].sort()).toEqual([...BOARD].sort());
  });

  it("falls back to a plain shuffle when nothing is selected", () => {
    const next = alignSelectionInline(BOARD, [], counter());
    expect(next).toEqual(shuffleBoardOrder(BOARD, counter()));
  });

  it("shuffles the unselected words rather than leaving them put", () => {
    const next = alignSelectionInline(BOARD, ["LION"], counter());
    expect(next.slice(1)).not.toEqual(BOARD.filter((word) => word !== "LION"));
  });
});

describe("selectionKey", () => {
  it("is the same selection whatever order the tiles were tapped in", () => {
    expect(selectionKey(["LION", "TIGER"])).toBe(selectionKey(["TIGER", "LION"]));
  });

  it("changes when a tile is swapped", () => {
    expect(selectionKey(["LION", "TIGER"])).not.toBe(selectionKey(["LION", "COBRA"]));
  });
});
