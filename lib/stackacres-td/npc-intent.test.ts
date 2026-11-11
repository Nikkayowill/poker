import { describe, expect, it } from "vitest";
import { chooseMotive } from "./npc-intent";

const base = {
  needs: { energy: 1, social: 0 },
  doing: "water" as const,
  night: false,
  nearbyPeople: 0,
  farmerNearby: false,
  behindMs: 0,
};

describe("chooseMotive", () => {
  it("takes a rest motive at night", () => {
    expect(chooseMotive({ ...base, night: true })).toBe("rest");
  });

  it("prioritizes catching up over optional behavior", () => {
    expect(chooseMotive({ ...base, behindMs: 4000, needs: { energy: 0, social: 1 }, nearbyPeople: 2 })).toBe("work");
  });

  it("lets low energy win a quiet moment", () => {
    expect(chooseMotive({ ...base, needs: { energy: 0.1, social: 0.1 } })).toBe("rest");
  });

  it("prefers company when social need and company are both present", () => {
    expect(chooseMotive({ ...base, needs: { energy: 0.9, social: 1 }, nearbyPeople: 2 })).toBe("social");
  });

  it("uses observation when the farmer is nearby but other needs are low", () => {
    expect(chooseMotive({ ...base, doing: "idle", farmerNearby: true })).toBe("observe");
  });
});
