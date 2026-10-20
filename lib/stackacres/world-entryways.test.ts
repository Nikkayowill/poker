import { describe, expect, it } from "vitest";
import { growAreaInterior, penFeedSpot } from "./world";
import { PEN_ZONE_IDS } from "./zones";

describe("penFeedSpot", () => {
  it("puts every pen's trough on its own walkable ground", () => {
    for (const zone of PEN_ZONE_IDS) {
      const spot = penFeedSpot(zone);
      const inside = growAreaInterior(zone);
      expect(spot.x).toBeGreaterThan(inside.x);
      expect(spot.x).toBeLessThan(inside.x + inside.width);
      expect(spot.y).toBeGreaterThan(inside.y);
      expect(spot.y).toBeLessThan(inside.y + inside.height);
    }
  });
});
