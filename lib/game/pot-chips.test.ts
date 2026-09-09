import { describe, expect, it } from "vitest";
import { POT_CHIP_DENOMINATIONS_BB } from "./pot-chips";

describe("POT_CHIP_DENOMINATIONS_BB", () => {
  it("is descending, so a greedy breakdown draws the largest chip first", () => {
    const values = [...POT_CHIP_DENOMINATIONS_BB];
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("bottoms out at 1 big blind, so any pot resolves to at least one chip", () => {
    expect(POT_CHIP_DENOMINATIONS_BB.at(-1)).toBe(1);
  });
});
