import { describe, expect, it } from "vitest";

import { barnHitAt, growAreaAt } from "../world";
import { HIDDEN_ZONES, hiddenZoneAt } from "../secrets";
import { QUEST_PLACES, isQuestPlaceId, questPlaceAt } from "./places";

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

describe("questPlaceAt", () => {
  it("hits at every place's corners and center", () => {
    for (const place of QUEST_PLACES) {
      const b = place.bounds;
      expect(questPlaceAt(b.x, b.y)?.id).toBe(place.id);
      expect(questPlaceAt(b.x + b.width, b.y)?.id).toBe(place.id);
      expect(questPlaceAt(b.x, b.y + b.height)?.id).toBe(place.id);
      expect(questPlaceAt(b.x + b.width, b.y + b.height)?.id).toBe(place.id);
      expect(questPlaceAt(b.x + b.width / 2, b.y + b.height / 2)?.id).toBe(place.id);
    }
  });

  it("misses just outside a place's box", () => {
    for (const place of QUEST_PLACES) {
      const b = place.bounds;
      expect(questPlaceAt(b.x - 1, b.y)).toBeNull();
      expect(questPlaceAt(b.x + b.width + 1, b.y)).toBeNull();
      expect(questPlaceAt(b.x, b.y - 1)).toBeNull();
      expect(questPlaceAt(b.x, b.y + b.height + 1)).toBeNull();
    }
  });

  it("misses a point far from every place", () => {
    expect(questPlaceAt(-5000, -5000)).toBeNull();
  });
});

describe("disjointness from GROW_AREA, BARN_FOOTPRINT and the hidden zones", () => {
  it("never lands a quest place's corners on a district's grow area, the barn, or a hidden zone", () => {
    for (const place of QUEST_PLACES) {
      const b = place.bounds;
      const corners: [number, number][] = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ];
      for (const [x, y] of corners) {
        expect(growAreaAt(x, y)).toBeNull();
        expect(barnHitAt(x, y)).toBe(false);
        expect(hiddenZoneAt(x, y)).toBeNull();
      }
    }
  });

  it("sanity-checks the hidden zones are themselves non-degenerate (guards the test above from a false pass)", () => {
    for (const zone of HIDDEN_ZONES) {
      expect(zone.bounds.width).toBeGreaterThan(0);
      expect(zone.bounds.height).toBeGreaterThan(0);
    }
  });
});
