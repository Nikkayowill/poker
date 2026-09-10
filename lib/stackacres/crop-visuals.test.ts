import { describe, expect, it } from "vitest";
import { STACKACRES_CROPS } from "./catalogue";
import {
  CROP_DRY_ALPHA,
  CROP_FOOTPRINT_HALF,
  cropArtFor,
  cropBox,
  cropCollarBehind,
  cropCollarScale,
  cropFootShiftX,
  cropFootprintHalf,
  cropGroundOffset,
  cropShadowScale,
  cropSpriteAlpha,
  cropSpriteScale,
  CROP_GROWTH_TWEEN_MS,
  cropGroundOffsetBlend,
  cropShadowScaleBlend,
  cropStageSpriteBlend,
  type CropStage,
} from "./crop-visuals";

const STAGES: CropStage[] = [0, 1, 2];

describe("cropArtFor", () => {
  it("gives every crop kind a frame set and no livestock kind one", () => {
    // Every crop id is its own art id now (no more sprout->carrot /
    // cash_crop->corn indirection -- see crop-visuals.ts's own header).
    expect(cropArtFor("carrot")).toBe("carrot");
    expect(cropArtFor("corn")).toBe("corn");
    for (const stock of STACKACRES_CROPS) expect(cropArtFor(stock)).not.toBeNull();
    for (const stock of ["hen", "pig", "cattle"] as const) expect(cropArtFor(stock)).toBeNull();
  });
});

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

describe("cropGroundOffset / cropFootShiftX", () => {
  /**
   * The whole point of the pair. A frame is trimmed to its ink and pasted
   * flush to its canvas's bottom edge, so the anchor the scene places it by
   * -- bottom centre -- is the lowest pixel anywhere in the frame, not the
   * point the plant grows out of. `CROP_FOOT` carries the measured root
   * point (see its own doc comment) and these two slide the sprite onto it.
   */
  const ARTS = STACKACRES_CROPS.map((crop) => cropArtFor(crop)).filter(
    (art): art is NonNullable<ReturnType<typeof cropArtFor>> => art !== null,
  );

  it("keeps every correction inside the frame it is correcting", () => {
    // A correction bigger than the frame would slide the plant off its own
    // bed entirely, which is the failure this exists to fix, not cause.
    for (const art of ARTS) {
      for (const stage of STAGES) {
        const box = cropBox(art);
        const scale = cropSpriteScale(stage);
        expect(Math.abs(cropGroundOffset(art, stage))).toBeLessThan(box.h * scale);
        expect(Math.abs(cropFootShiftX(art, stage))).toBeLessThan((box.w / 2) * scale);
      }
    }
  });

  it("grows the correction with the frame, so a ripe plant sits no higher than a seedling", () => {
    // Phaser scales about the (0.5, 1) anchor, so the gap between the anchor
    // and the root point is multiplied along with the plant.
    for (const art of ["cabbage", "onion"] as const) {
      expect(cropGroundOffset(art, 2)).toBeCloseTo(
        cropGroundOffset(art, 0) * cropSpriteScale(2),
        10,
      );
      expect(cropFootShiftX(art, 2)).toBeCloseTo(
        cropFootShiftX(art, 0) * cropSpriteScale(2),
        10,
      );
    }
  });

  it("pulls a sprawling crop back over its bed", () => {
    // The cabbage is the case that named this bug: its lowest ink is a front
    // leaf, so bottom-centre anchoring drew it up and back off the soil.
    expect(cropGroundOffset("cabbage", 2)).toBeGreaterThan(0);
    // The onion's root point is right of its canvas centre, so it moves left.
    expect(cropFootShiftX("onion", 2)).toBeLessThan(0);
  });

  it("never lifts a plant off its own soil", () => {
    // The trim script clamps `dy` at zero. A model whose projected root lands
    // below its own lowest ink would otherwise be honoured by raising the
    // sprite, which hung the carrot about three units over its heap.
    for (const art of ARTS) {
      for (const stage of STAGES) expect(cropGroundOffset(art, stage)).toBeGreaterThanOrEqual(0);
    }
  });

  it("banks a wider heap around a wider crop", () => {
    // One heap size for all 22 read as a smudge beside the big crops, which
    // is most of what made them look unattached.
    expect(cropCollarScale("cabbage", 2)).toBeGreaterThan(cropCollarScale("garlic", 2));
    expect(cropCollarScale("garlic", 2)).toBeGreaterThan(0);
  });

  it("puts the heap behind the crops that lie across their own base", () => {
    // A heap in FRONT of a rosette lands in the middle of its leaves.
    expect(cropCollarBehind("cabbage")).toBe(true);
    expect(cropCollarBehind("pumpkin")).toBe(true);
    expect(cropCollarBehind("carrot")).toBe(false);
    expect(cropCollarBehind("onion")).toBe(false);
  });
});

describe("cropFootprintHalf", () => {
  // carrot's real CraftPix box is 34 wide (crop-visuals.ts's CROP_BOX) --
  // 17 either side of the stem, so a 1.25x sprite is 21.25 either side.
  it("expands a mature crop's touch target with its 1.25x sprite", () => {
    expect(cropFootprintHalf("carrot", 2)).toBe(21.25);
  });

  it("grows monotonically, so a bigger crop is never a smaller target", () => {
    expect(cropFootprintHalf("carrot", 0)).toBeLessThanOrEqual(cropFootprintHalf("carrot", 1));
    expect(cropFootprintHalf("carrot", 1)).toBeLessThanOrEqual(cropFootprintHalf("carrot", 2));
  });

  it("never falls below the flat half every crop used before they were grown", () => {
    for (const stage of STAGES) {
      expect(cropFootprintHalf("carrot", stage)).toBeGreaterThanOrEqual(CROP_FOOTPRINT_HALF);
    }
    // Grapes are the narrowest box (14 units): even at 1x a 7-unit half is
    // under the floor -- this is the case that would otherwise shrink.
    expect(cropFootprintHalf("grap", 0)).toBe(CROP_FOOTPRINT_HALF);
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
   * carrot's real CraftPix box (34 wide) keeps a mature diamond comfortably
   * under the field, same as the old hand-vector art this replaced. At the
   * gentler 1.25x stage-2 ladder even the widest crop (pumpkin, 41 units)
   * stays well inside the meadow, so the wider-crops overflow this test used
   * to flag against the old 4x ladder no longer applies.
   */
  it("keeps carrot's ripe diamond inside the meadow it has to share", () => {
    const MEADOW_W = 136;
    const diamond = cropFootprintHalf("carrot", 2) * 2;
    expect(diamond).toBe(42.5);
    expect(diamond).toBeLessThanOrEqual(MEADOW_W);
  });
});

describe("bake scales land on whole pixels", () => {
  // Restated from their sources rather than imported: the painter boxes live
  // in components/arcade/stackacres/stackacres-art.ts (`painter(12, 16, ...)`
  // for carrot0, `painter(12, 22, ...)` for corn0) and ART_SCALE in
  // art-kit.ts, and both of those pull Phaser, which a lib/ test may not.
  // Same "restate and hold it with a test" split SOIL_TILE already uses.
  const ART_SCALE = 8;
  const CROP_BOXES = [
    { name: "carrot", w: 12, h: 16 },
    { name: "corn", w: 12, h: 22 },
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

describe("growing between two frames", () => {
  it("starts the new texture at exactly the old frame's apparent size", () => {
    // The swap itself must be invisible: at t = 0 the new frame, drawn at its
    // own baked size, has to render at the size the old one occupied.
    expect(cropStageSpriteBlend(0, 1, 0)).toBeCloseTo(cropSpriteScale(0) / cropSpriteScale(1));
    expect(cropStageSpriteBlend(1, 2, 0)).toBeCloseTo(cropSpriteScale(1) / cropSpriteScale(2));
  });

  it("lands on the new frame's own natural size", () => {
    for (const [from, to] of [
      [0, 1],
      [1, 2],
      [0, 2],
    ] as const) {
      expect(cropStageSpriteBlend(from, to, 1)).toBe(1);
    }
  });

  it("grows monotonically across the tween", () => {
    let previous = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const scale = cropStageSpriteBlend(1, 2, t);
      expect(scale).toBeGreaterThan(previous);
      previous = scale;
    }
  });

  it("clamps rather than overshooting its target frame", () => {
    expect(cropStageSpriteBlend(1, 2, 1.4)).toBe(1);
    expect(cropStageSpriteBlend(1, 2, -0.4)).toBeCloseTo(cropSpriteScale(1) / cropSpriteScale(2));
    expect(cropStageSpriteBlend(1, 2, Number.NaN)).toBe(1);
  });

  it("moves the shadow in lockstep with the plant, ending on the new stage's own size", () => {
    expect(cropShadowScaleBlend("carrot", 1, 2, 0)).toBeCloseTo(cropShadowScale("carrot", 1));
    expect(cropShadowScaleBlend("carrot", 1, 2, 1)).toBeCloseTo(cropShadowScale("carrot", 2));
    // Linear in t, which is what "lockstep" has to mean for a shadow driven
    // off the same proxy as the plant above it.
    expect(cropShadowScaleBlend("carrot", 1, 2, 0.5)).toBeCloseTo(
      (cropShadowScale("carrot", 1) + cropShadowScale("carrot", 2)) / 2,
    );
  });

  it("keeps the feet correction pinned at both ends of a growth", () => {
    for (const art of ["carrot", "corn"] as const) {
      expect(cropGroundOffsetBlend(art, 1, 2, 0)).toBe(cropGroundOffset(art, 1));
      expect(cropGroundOffsetBlend(art, 1, 2, 1)).toBe(cropGroundOffset(art, 2));
    }
  });

  it("is short enough to finish inside the beat a tap already plays", () => {
    // popUnit's own chain is 90 + 130 + 150 = 370ms.
    expect(CROP_GROWTH_TWEEN_MS).toBeLessThan(370);
    expect(CROP_GROWTH_TWEEN_MS).toBeGreaterThan(200);
  });
});
