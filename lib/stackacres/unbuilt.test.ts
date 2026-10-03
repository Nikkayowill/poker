import { describe, expect, it } from "vitest";
import { UNBUILT_CUTTERS, isUnbuiltCutter } from "./unbuilt";
import { STACKACRES_CUTTERS } from "./cutters";

/**
 * Every id here has to match the catalogue it hides from. A typo would read
 * as "nothing to hide" and quietly put an inert purchase back on the shelf,
 * which is the exact thing this list exists to prevent.
 */
describe("unbuilt ids match their catalogues", () => {
  it("names real cutters", () => {
    for (const id of UNBUILT_CUTTERS) expect(STACKACRES_CUTTERS).toContain(id);
  });
});

describe("the predicates", () => {
  it("answer for the ids that are listed", () => {
    expect(isUnbuiltCutter("mower")).toBe(true);
  });
});
