import { describe, expect, it } from "vitest";
import { intentOf } from "./farm-actions";

describe("intentOf: the processing track", () => {
  it("keeps two recipes and two machine kinds apart", () => {
    expect(intentOf({ action: "process", recipe: "cheese" })).toBe("process:cheese");
    expect(intentOf({ action: "process", recipe: "cloth" })).toBe("process:cloth");
    expect(intentOf({ action: "place-machine", kind: "mill" })).toBe("place-machine:mill");
    expect(intentOf({ action: "place-machine", kind: "dairy" })).toBe("place-machine:dairy");
  });

  it("keys a divert on the one animal, and the field-wide passes on the action alone", () => {
    expect(intentOf({ action: "divert", unitId: "cow-1" })).toBe("divert:cow-1");
    expect(intentOf({ action: "sow-wheat" })).toBe("sow-wheat");
    expect(intentOf({ action: "work" })).toBe("work");
    expect(intentOf({ action: "seal-vat" })).toBe("seal-vat");
    expect(intentOf({ action: "collect-vat" })).toBe("collect-vat");
  });

  it("still keys a pipe on its tile, not on its kind", () => {
    expect(intentOf({ action: "place-pipe", tx: 3, ty: -2, kind: "well" })).toBe("place-pipe:3,-2");
  });

  it("keys an aim on its tile too, never on the direction", () => {
    expect(intentOf({ action: "aim-pipe", tx: 3, ty: -2, facing: 4 })).toBe("aim-pipe:3,-2");
    expect(intentOf({ action: "aim-pipe", tx: 3, ty: -2, facing: 8 })).toBe("aim-pipe:3,-2");
  });
});
