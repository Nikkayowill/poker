import { describe, expect, it } from "vitest";
import {
  ALL_NONOGRAM_PICTURES,
  NONOGRAM_PICTURES,
  nonogramPicturesFor,
} from "./nonogram-pictures";
import { isNoGuessNonogram, nonogramConfig } from "./nonogram";

/**
 * The gate that lets a drawing ship.
 *
 * lib/arcade/ante-up-nonogram.ts stakes real Gold on every board being
 * finishable by reasoning alone. A drawing that needs a guess is a coin flip
 * dressed as a puzzle, and no amount of eyeballing catches one -- ambiguity in
 * a nonogram is not visible in the picture. So every entry in the library is
 * run through the line solver here, upright and mirrored, and a new drawing
 * that fails is not a test to relax. Thicken it: a run of one square in an
 * otherwise quiet line is almost always what did it.
 */

/** Mirrors a row-major grid left to right, the one transform nonogram-deal.ts applies. */
function mirror(cells: string, size: number): string {
  let out = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) out += cells[row * size + (size - 1 - col)];
  }
  return out;
}

describe("the picture library", () => {
  it.each(ALL_NONOGRAM_PICTURES.map((p) => [`${p.size}x${p.size} ${p.name}`, p] as const))(
    "%s is square and the right length",
    (_label, picture) => {
      expect(picture.cells).toHaveLength(picture.size * picture.size);
      expect([...picture.cells].every((cell) => cell === "#" || cell === ".")).toBe(true);
    },
  );

  it.each(ALL_NONOGRAM_PICTURES.map((p) => [`${p.size}x${p.size} ${p.name}`, p] as const))(
    "%s can be finished by line logic alone, either way round",
    (_label, picture) => {
      expect(isNoGuessNonogram(picture.cells, picture.size)).toBe(true);
      expect(isNoGuessNonogram(mirror(picture.cells, picture.size), picture.size)).toBe(true);
    },
  );

  it("draws something on every board: never blank, never solid", () => {
    for (const picture of ALL_NONOGRAM_PICTURES) {
      expect(picture.cells).toContain("#");
      expect(picture.cells).toContain(".");
    }
  });

  it("gives each drawing at a size its own name, since the name is the reveal", () => {
    for (const [size, pictures] of Object.entries(NONOGRAM_PICTURES)) {
      const names = pictures.map((picture) => picture.name);
      expect({ size, names: new Set(names).size }).toEqual({ size, names: names.length });
    }
  });

  /**
   * A floor rather than an exact count, so adding art never fails a test.
   *
   * It is here because the library shrinking is the one change that quietly
   * makes the game worse: a player who has seen every drawing at a rung can
   * recognise a board instead of solving it, and recognising is faster than
   * reasoning on a board that pays out. More art is the defence.
   */
  it("keeps enough drawings per rung that a board is not recognisable on sight", () => {
    for (const size of [5, 10, 15]) {
      expect({ size, count: nonogramPicturesFor(size).length }).toEqual({
        size,
        count: expect.any(Number),
      });
      expect(nonogramPicturesFor(size).length).toBeGreaterThanOrEqual(16);
    }
  });

  it("covers exactly the rungs whose boards are small enough to draw on", () => {
    // 20x20 and 25x25 are grown by nonogram-deal.ts instead; 400 and 625
    // squares are past what hand-drawn art can carry.
    expect(Object.keys(NONOGRAM_PICTURES).map(Number).sort((a, b) => a - b)).toEqual([5, 10, 15]);
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      expect(nonogramPicturesFor(nonogramConfig(difficulty).size).length).toBeGreaterThan(0);
    }
    for (const difficulty of ["expert", "master"] as const) {
      expect(nonogramPicturesFor(nonogramConfig(difficulty).size)).toEqual([]);
    }
  });
});
