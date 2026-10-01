import { describe, expect, it } from "vitest";
import { anteUpStakeProblem, anteUpTierAllowed } from "./ante-up-stakes";
import { stakePressure } from "./stake-pressure";

describe("stakePressure", () => {
  it("bands stakes at 25k, 100k, 500k and 1M", () => {
    expect(
      [0, 500, 24_999, 25_000, 99_999, 100_000, 499_999, 500_000, 999_999, 1_000_000, 50_000_000].map(stakePressure),
    ).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("anteUpStakeProblem", () => {
  it("lets any tier through below 25k and never limits the stake itself", () => {
    expect(anteUpStakeProblem("sudoku", "easy", 5_000)).toBeNull();
    expect(anteUpStakeProblem("sudoku", "expert", 500_000_000)).toBeNull();
  });

  it("pushes big stakes onto harder boards", () => {
    expect(anteUpTierAllowed("sudoku", "easy", 25_000)).toBe(false);
    expect(anteUpTierAllowed("sudoku", "medium", 25_000)).toBe(true);
    expect(anteUpTierAllowed("blockudoku", "standard", 100_000)).toBe(false);
    expect(anteUpTierAllowed("blockudoku", "hardcore", 1_000_000)).toBe(true);
    expect(anteUpStakeProblem("minesweeper", "beginner", 250_000)).toMatch(/Expert or harder/);
  });

  it("has nothing to say about games without tiers", () => {
    expect(anteUpStakeProblem("quick-math", null, 5_000_000)).toBeNull();
  });
});
