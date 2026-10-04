import { describe, expect, it } from "vitest";
import {
  CROP_FOOTPRINT_HALF,
  cropFootprintHalf,
  cropShadowScale,
  cropSpriteScale,
  type CropStage,
} from "./crop-visuals";

const STAGES: CropStage[] = [0, 1, 2];

describe("cropSpriteScale", () => {
  it("draws a sprout at 1.125x and a mature crop at 1.25x its painted size", () => {
    expect(cropSpriteScale(1)).toBe(1.125);
    expect(cropSpriteScale(2)).toBe(1.25);
  });

  it("grows strictly with the frame, so the three read as one ramp", () => {
    expect(cropSpriteScale(0)).toBeLessThan(cropSpriteScale(1));
    expect(cropSpriteScale(1)).toBeLessThan(cropSpriteScale(2));
  });

  it("never draws any frame smaller than its own painted size", () => {
    for (const stage of STAGES) expect(cropSpriteScale(stage)).toBeGreaterThanOrEqual(1);
  });
});

describe("cropFootprintHalf", () => {

  it("never shrinks a target below the floor even as it stays constant across stages", () => {
    expect(cropFootprintHalf("carrot", 0)).toBeLessThanOrEqual(cropFootprintHalf("carrot", 1));
    expect(cropFootprintHalf("carrot", 1)).toBeLessThanOrEqual(cropFootprintHalf("carrot", 2));
  });
});

describe("cropShadowScale", () => {
  it("tracks the footprint, not a second hand-tuned ladder", () => {
    for (const stage of STAGES) {
      expect(cropShadowScale("carrot", stage)).toBeCloseTo((0.8 * cropFootprintHalf("carrot", stage) * 2) / 16);
    }
  });

  it("grows monotonically with the plant, same as the footprint it tracks", () => {
    expect(cropShadowScale("carrot", 0)).toBeLessThanOrEqual(cropShadowScale("carrot", 1));
    expect(cropShadowScale("carrot", 1)).toBeLessThanOrEqual(cropShadowScale("carrot", 2));
  });

  it("stays smaller than the plant's own footprint diamond -- a pool under the canopy, not level with it", () => {
    for (const stage of STAGES) {
      // cropShadowScale is a Phaser scale factor against a 16-wide painter;
      // its rendered diameter must stay under the footprint's own diamond.
      expect(cropShadowScale("carrot", stage) * 16).toBeLessThan(cropFootprintHalf("carrot", stage) * 2);
    }
  });
});

describe("how big the grown footprint actually gets", () => {
  /**
   * The scene unions this diamond with the sprite's own bounds to decide what
   * a finger hit. The Long Meadow's walkable interior is 136x118
   * (`growAreaInterior`) and holds up to six of each crop kind, so
   * overlapping diamonds are the normal case -- which is why `unitAt` had to
   * stop resolving those purely by depth.
   *
   * Every Gr8FarmPack box is well under CROP_BED_FIT_WIDTH (the widest,
   * green_bean, is 17 units), so `cropBedFit` never shrinks anything and a
   * ripe diamond is just 2x the flat floor -- comfortably inside the meadow.
   */
  it("keeps carrot's ripe diamond inside the meadow it has to share", () => {
    const MEADOW_W = 136;
    const diamond = cropFootprintHalf("carrot", 2) * 2;
    expect(diamond).toBe(CROP_FOOTPRINT_HALF * 2);
    expect(diamond).toBeLessThanOrEqual(MEADOW_W);
  });
});

describe("bake scales land on whole pixels", () => {
  // Restated from their sources rather than imported: the painter boxes live
  // in components/arcade/stackacres/stackacres-art.ts (`painter(9, 14, ...)`
  // for carrot0, `painter(13, 32, ...)` for corn0) and ART_SCALE in
  // art-kit.ts, and both of those pull Phaser, which a lib/ test may not.
  // Same "restate and hold it with a test" split SOIL_TILE already uses.
  const ART_SCALE = 8;
  const CROP_BOXES = [
    { name: "carrot", w: 9, h: 14 },
    { name: "corn", w: 13, h: 32 },
  ];
  const STAGES: CropStage[] = [0, 1, 2];

  // `bakeSpriteTexture` does Math.ceil(w * ART_SCALE * scale) on each axis
  // INDEPENDENTLY, so a fractional product resamples the frame by a slightly
  // different factor across than down -- a non-uniform stretch on top of the
  // softening. Every rung has to be exact on both axes of both crops.
  it("scales every crop frame by a whole number of pixels on both axes", () => {
    for (const stage of STAGES) {
      const scale = cropSpriteScale(stage);
      for (const box of CROP_BOXES) {
        const width = box.w * ART_SCALE * scale;
        const height = box.h * ART_SCALE * scale;
        expect(Number.isInteger(width), `${box.name} stage ${stage} width ${width}`).toBe(true);
        expect(Number.isInteger(height), `${box.name} stage ${stage} height ${height}`).toBe(true);
      }
    }
  });

  // The ramp still has to read as growth. Stage 0 is exactly 1x now (true
  // box size, same as everything else on the map); stages 1 and 2 carry the
  // whole ramp.
  it("keeps the stage ramp strictly increasing", () => {
    expect(cropSpriteScale(0)).toBeLessThan(cropSpriteScale(1));
    expect(cropSpriteScale(1)).toBeLessThan(cropSpriteScale(2));
    expect(cropSpriteScale(0)).toBe(1);
  });
});

