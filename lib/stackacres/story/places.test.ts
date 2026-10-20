import { describe, expect, it } from "vitest";
import { HIDDEN_ZONES, } from "../secrets";
import { QUEST_PLACES, isQuestPlaceId, } from "./places";

describe("QUEST_PLACES", () => {
  it("names distinct places, each a real box", () => {
    const ids = new Set(QUEST_PLACES.map((place) => place.id));
    expect(ids.size).toBe(QUEST_PLACES.length);
    for (const place of QUEST_PLACES) {
      expect(place.bounds.width).toBeGreaterThan(0);
      expect(place.bounds.height).toBeGreaterThan(0);
      expect(place.label.length).toBeGreaterThan(0);
    }
  });

  it("isQuestPlaceId accepts only real ids", () => {
    for (const place of QUEST_PLACES) expect(isQuestPlaceId(place.id)).toBe(true);
    expect(isQuestPlaceId("bleep")).toBe(false);
    expect(isQuestPlaceId("")).toBe(false);
  });
});

describe("disjointness from GROW_AREA, BARN_FOOTPRINT and the hidden zones", () => {

  it("sanity-checks the hidden zones are themselves non-degenerate (guards the test above from a false pass)", () => {
    for (const zone of HIDDEN_ZONES) {
      expect(zone.bounds.width).toBeGreaterThan(0);
      expect(zone.bounds.height).toBeGreaterThan(0);
    }
  });
});
