import { describe, expect, it } from "vitest";
import { portraitExpression } from "./dialogue";
import { TRAVELER_IDS, travelerPortrait } from "./travelers";

describe("portraitExpression", () => {
  it("greets you gladly, thinks over a task, and is pleased when it's done", () => {
    expect(portraitExpression({ id: "pierre.hello" })).toBe("happy");
    expect(portraitExpression({ id: "pierre-bread.progress" })).toBe("thinking");
    expect(portraitExpression({ id: "pierre.locked" })).toBe("thinking");
    expect(portraitExpression({ id: "pierre-bread.done" })).toBe("happy");
    expect(portraitExpression({ id: "pierre.home" })).toBe("neutral");
    expect(portraitExpression({ id: "pierre.home.finale-hint" })).toBe("surprised");
  });
});

describe("travelerPortrait", () => {
  it("points every traveler at an exported portrait", () => {
    for (const id of TRAVELER_IDS) expect(travelerPortrait(id, "love")).toBe(`/stackacres-td/portraits/${id}-love.png`);
  });
});
