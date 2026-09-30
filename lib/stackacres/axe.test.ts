import { describe, expect, it } from "vitest";
import { AXE_DAMAGE, AXE_LEVELS, AXE_LEVEL_DEFS, STARTING_AXE_LEVEL, nextAxeLevel, swingsToFell } from "./axe";
import { WOOD_HITS_TO_FELL } from "./wood";

describe("the axe", () => {
  it("fells a Homestead tree in 3, 2 and then 1 swing", () => {
    expect(AXE_LEVELS.map((level) => swingsToFell(WOOD_HITS_TO_FELL, level))).toEqual([3, 2, 1]);
  });

  it("walks up one level at a time and stops at the top", () => {
    expect(nextAxeLevel(STARTING_AXE_LEVEL)).toBe(2);
    expect(nextAxeLevel(2)).toBe(3);
    expect(nextAxeLevel(3)).toBeNull();
  });

  it("never makes a better axe weaker", () => {
    expect(AXE_DAMAGE[1]).toBeLessThan(AXE_DAMAGE[2]);
    expect(AXE_DAMAGE[2]).toBeLessThan(AXE_DAMAGE[3]);
  });

  it("prices every upgrade both ways, and the starting axe not at all", () => {
    expect(AXE_LEVEL_DEFS[1].gold).toBeNull();
    expect(AXE_LEVEL_DEFS[1].materials).toBeNull();
    for (const level of [2, 3] as const) {
      expect(AXE_LEVEL_DEFS[level].gold).toBeGreaterThan(0);
      expect(AXE_LEVEL_DEFS[level].materials?.length).toBeGreaterThan(0);
    }
    expect(AXE_LEVEL_DEFS[3].gold!).toBeGreaterThan(AXE_LEVEL_DEFS[2].gold!);
  });
});
