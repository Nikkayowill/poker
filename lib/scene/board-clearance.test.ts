import { describe, expect, it } from "vitest";
import { clampBoardCardWidth } from "./board-clearance";

const BOUNDS = { min: 44, max: 52 };

describe("clampBoardCardWidth", () => {
  it("holds the raw projection when the pot is comfortably far away", () => {
    // Row at 50px cards is ~244px (5*50 - 2*.2*50*2 + 2*.14*50*2); 300px of
    // real gap clears that plus the 18px breathing margin with room to spare.
    const width = clampBoardCardWidth(
      50,
      { x: 400, y: 300 },
      { x: 400, y: 0 }, // 300px away
      BOUNDS,
    );
    expect(width).toBe(50);
  });

  it("clamps to the ceiling even with plenty of room", () => {
    const width = clampBoardCardWidth(
      90,
      { x: 400, y: 300 },
      { x: 400, y: -100 }, // 400px away -- clears the row even at the ceiling
      BOUNDS,
    );
    expect(width).toBe(BOUNDS.max);
  });

  it("clamps to the floor when the projection undershoots it", () => {
    const width = clampBoardCardWidth(
      10,
      { x: 400, y: 300 },
      { x: 400, y: 50 },
      BOUNDS,
    );
    expect(width).toBe(BOUNDS.min);
  });

  it("shrinks below the raw projection when the pot sits close", () => {
    // At 52px cards the row is ~5*52 - 2*.2*52*2 + 2*.14*52*2 ≈ 253.76px, so
    // a 200px gap cannot hold it -- the row must give up width until it does.
    const width = clampBoardCardWidth(
      52,
      { x: 400, y: 300 },
      { x: 400, y: 100 }, // 200px away
      BOUNDS,
    );
    expect(width).toBeLessThan(52);
    expect(width).toBeGreaterThanOrEqual(BOUNDS.min);
  });

  it("never renders past the floor even when the pot sits on top of the board", () => {
    const width = clampBoardCardWidth(
      52,
      { x: 400, y: 300 },
      { x: 401, y: 301 }, // effectively no gap at all
      BOUNDS,
    );
    expect(width).toBe(BOUNDS.min);
  });
});
