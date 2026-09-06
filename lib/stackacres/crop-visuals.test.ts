import { describe, expect, it } from "vitest";
import { STACKACRES_CROPS } from "./catalogue";
import {
  CROP_DRY_ALPHA,
  CROP_FOOTPRINT_HALF,
  cropArtFor,
  cropFootprintHalf,
  cropGroundOffset,
  cropShadowScale,
  cropSpriteAlpha,
  cropSpriteScale,
  type CropStage,
} from "./crop-visuals";

const STAGES: CropStage[] = [0, 1, 2];

describe("cropArtFor", () => {
  it("gives every crop kind a frame set and no livestock kind one", () => {
    expect(cropArtFor("sprout")).toBe("carrot");
    expect(cropArtFor("cash_crop")).toBe("corn");
    for (const stock of STACKACRES_CROPS) expect(cropArtFor(stock)).not.toBeNull();
    for (const stock of ["hen", "pig", "cattle"] as const) expect(cropArtFor(stock)).toBeNull();
  });
});

describe("cropSpriteScale", () => {
  // The two numbers the mobile-legibility pass actually specified.
  it("draws a sprout at 2.5x and a mature crop at 4x its painted size", () => {
    expect(cropSpriteScale(1)).toBe(2.5);
    expect(cropSpriteScale(2)).toBe(4);
  });

  it("grows strictly with the frame, so the three read as one ramp", () => {
    expect(cropSpriteScale(0)).toBeLessThan(cropSpriteScale(1));
    expect(cropSpriteScale(1)).toBeLessThan(cropSpriteScale(2));
  });

  it("never draws any frame smaller than its own painted size", () => {
    for (const stage of STAGES) expect(cropSpriteScale(stage)).toBeGreaterThanOrEqual(1);
  });
});

describe("cropGroundOffset", () => {
  /**
   * The whole point of the offset. A painter anchors at its box's bottom edge
   * and Phaser scales about that anchor, so ink sitting `d` above the edge
   * ends up `scale * d` above it. Pushing the sprite down by the growth in
   * that gap puts the ink back where it was at 1x -- and a frame already
   * drawn to its own baseline needs no push at all.
   *
   * Every frame is zero now: all six are generated sprites, fit flush to
   * their box's bottom edge by the FLUX prep pipeline (see FOOT_INSET's own
   * doc comment in crop-visuals.ts), so none of them need a push.
   */
  it("never pushes a frame further down than its own box is tall", () => {
    // A correction bigger than the gap it corrects would bury the sprite. The
    // insets are fractions of a unit, so every offset stays well inside the
    // 16- and 22-unit boxes these frames are drawn in.
    for (const art of ["carrot", "corn"] as const) {
      for (const stage of STAGES) expect(cropGroundOffset(art, stage)).toBeLessThan(2);
    }
  });

  it("leaves alone every frame, all of which are already drawn to their own baseline", () => {
    for (const art of ["carrot", "corn"] as const) {
      for (const stage of STAGES) expect(cropGroundOffset(art, stage)).toBe(0);
    }
  });

  it("pushes down, never up -- a correction can only ever reground", () => {
    for (const art of ["carrot", "corn"] as const) {
      for (const stage of STAGES) expect(cropGroundOffset(art, stage)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("cropFootprintHalf", () => {
  it("expands a mature crop's touch target with its 4x sprite", () => {
    // 12-unit painter box at 4x is 48 wide, so 24 either side of the stem.
    expect(cropFootprintHalf(2)).toBe(24);
    expect(cropFootprintHalf(2)).toBe(CROP_FOOTPRINT_HALF * 2);
  });

  it("grows monotonically, so a bigger crop is never a smaller target", () => {
    expect(cropFootprintHalf(0)).toBeLessThanOrEqual(cropFootprintHalf(1));
    expect(cropFootprintHalf(1)).toBeLessThanOrEqual(cropFootprintHalf(2));
  });

  it("never falls below the flat half every crop used before they were grown", () => {
    for (const stage of STAGES) {
      expect(cropFootprintHalf(stage)).toBeGreaterThanOrEqual(CROP_FOOTPRINT_HALF);
    }
    // The seedling is the case that would otherwise shrink: 1.6x of a 6-unit
    // half is 9.6, under the floor.
    expect(cropFootprintHalf(0)).toBe(CROP_FOOTPRINT_HALF);
  });
});

describe("cropSpriteAlpha", () => {
  it("fades a dry crop to 55% and leaves a watered one alone", () => {
    expect(cropSpriteAlpha(false)).toBe(0.55);
    expect(cropSpriteAlpha(false)).toBe(CROP_DRY_ALPHA);
    expect(cropSpriteAlpha(true)).toBe(1);
  });
});

describe("cropShadowScale", () => {
  it("tracks the footprint, not a second hand-tuned ladder", () => {
    for (const stage of STAGES) {
      expect(cropShadowScale(stage)).toBeCloseTo((0.8 * cropFootprintHalf(stage) * 2) / 16);
    }
  });

  it("grows monotonically with the plant, same as the footprint it tracks", () => {
    expect(cropShadowScale(0)).toBeLessThanOrEqual(cropShadowScale(1));
    expect(cropShadowScale(1)).toBeLessThanOrEqual(cropShadowScale(2));
  });

  it("stays smaller than the plant's own footprint diamond -- a pool under the canopy, not level with it", () => {
    for (const stage of STAGES) {
      // cropShadowScale is a Phaser scale factor against a 16-wide painter;
      // its rendered diameter must stay under the footprint's own diamond.
      expect(cropShadowScale(stage) * 16).toBeLessThan(cropFootprintHalf(stage) * 2);
    }
  });
});

describe("how big the grown footprint actually gets", () => {
  /**
   * The scene unions this diamond with the sprite's own bounds to decide what
   * a finger hit, and a ripe crop's diamond is now 48 units across. The Long
   * Meadow's walkable interior is 136x118 (`growAreaInterior`) and holds up to
   * six of each crop kind, so overlapping diamonds are the normal case -- which
   * is why `unitAt` had to stop resolving those purely by depth. This test
   * exists to make that pressure visible if the scale is ever raised again.
   */
  it("keeps a ripe crop's diamond inside the meadow it has to share", () => {
    const MEADOW_W = 136;
    const diamond = cropFootprintHalf(2) * 2;
    expect(diamond).toBe(48);
    // Six of them side by side would not fit, which is the whole point of the
    // art-beats-ground tap rule -- but one must at least not span the field.
    expect(diamond).toBeLessThan(MEADOW_W / 2);
  });
});
