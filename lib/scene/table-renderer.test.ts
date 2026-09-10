import { describe, expect, it } from "vitest";
import { RACETRACK_RENDERER, resolveTableRenderer } from "./table-renderer";

describe("the table renderer", () => {
  it("ships only the 2.5D table", () => {
    expect(RACETRACK_RENDERER).toBe("racetrack_2d5");
    expect(resolveTableRenderer()).toBe(RACETRACK_RENDERER);
  });
});
