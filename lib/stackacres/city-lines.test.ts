import { describe, expect, it } from "vitest";
import { cityBuildingLine, cityGreeting } from "./city-lines";

describe("city lines", () => {
  it("answers the City's buildings and says nothing for tags it does not know", () => {
    for (const kind of ["inn", "tailor", "bakery", "markethall", "chapel", "mill", "millrow", "crane", "cross", "stall"]) {
      expect(cityBuildingLine(kind), kind).toBeTruthy();
    }
    expect(cityBuildingLine("grocery")).toBeNull();
    expect(cityBuildingLine("noticeboard")).toBeNull();
  });

  it("gives the same greeting to the same person every time", () => {
    expect(cityGreeting("gus")).toBe(cityGreeting("gus"));
    expect(cityGreeting("mabel").length).toBeGreaterThan(0);
  });
});
