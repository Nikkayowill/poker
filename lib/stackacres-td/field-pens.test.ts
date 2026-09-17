import { describe, expect, it } from "vitest";
import { penFeedSpot } from "@/lib/stackacres/world";
import { FOLD_TROUGH, PASTURE_TROUGH, worldToMap } from "./field";

describe("worldToMap for the pens", () => {
  it("draws the Sheep Pens' feed spot at the Fold's trough", () => {
    expect(worldToMap(penFeedSpot("wallow"))).toEqual({ area: "fold", ...FOLD_TROUGH });
  });

  it("draws the Cattle Pens' feed spot at the Pasture's trough", () => {
    expect(worldToMap(penFeedSpot("oxfields"))).toEqual({ area: "pasture", ...PASTURE_TROUGH });
  });
});
