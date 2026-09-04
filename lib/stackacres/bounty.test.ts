import { describe, expect, it } from "vitest";
import {
  BOUNTIFUL_MIN_UNITS,
  CROP_ROTATION_MAX_MULTIPLIER,
  MONO_CROP_MAX_MULTIPLIER,
  applyBountifulHarvest,
  bountifulHarvest,
} from "./bounty";
import { STACKACRES_STOCK, isLivestock, type StackAcresStock } from "./catalogue";

/**
 * Bountiful Harvest is a property of a SET, which is the only reason it needs
 * its own module: everything else in StackAcres can be decided one row at a
 * time. These tests are mostly about the edges of that set -- one too few, one
 * kind too many, a mix that is technically mixed but nowhere near balanced.
 */
describe("bountifulHarvest", () => {
  it("pays nothing for a sweep smaller than the minimum", () => {
    for (let count = 0; count < BOUNTIFUL_MIN_UNITS; count += 1) {
      const stocks = Array.from({ length: count }, () => "cattle" as StackAcresStock);
      expect(bountifulHarvest(stocks)).toMatchObject({ kind: null, multiplier: 1, label: null });
    }
  });

  it("pays Mono-cropping for one kind throughout, and more of it for more units", () => {
    const three = bountifulHarvest(["cattle", "cattle", "cattle"]);
    const four = bountifulHarvest(["cattle", "cattle", "cattle", "cattle"]);
    expect(three.kind).toBe("mono_crop");
    expect(three.multiplier).toBe(1.05);
    expect(four.multiplier).toBe(1.1);
    expect(four.multiplier).toBeGreaterThan(three.multiplier);
  });

  it("caps Mono-cropping, so the last capacity slot is not bought for the multiplier", () => {
    // Well past what the capacity ladder can actually reach (6 of a kind).
    const enormous = Array.from({ length: 40 }, () => "hen" as StackAcresStock);
    expect(bountifulHarvest(enormous).multiplier).toBe(MONO_CROP_MAX_MULTIPLIER);
  });

  it("pays Crop Rotation for a balanced mix of fields and pens", () => {
    // Two crops, two livestock: a perfect half-and-half split, so the bonus is
    // at its cap.
    const balanced = bountifulHarvest(["sprout", "cash_crop", "hen", "cattle"]);
    expect(balanced.kind).toBe("crop_rotation");
    expect(balanced.multiplier).toBe(CROP_ROTATION_MAX_MULTIPLIER);
    expect(balanced.detail).toContain("2 from the fields");
  });

  it("refuses Crop Rotation when the mix is a token one", () => {
    // Four cattle and one carrot is not a rotation, and this is the case the
    // whole minimum-share rule exists for: without it, a herd could bolt one
    // cheap crop on and take a bonus on the herd.
    expect(bountifulHarvest(["cattle", "cattle", "cattle", "cattle", "sprout"])).toMatchObject({
      kind: null,
      multiplier: 1,
    });
    // One-in-three is exactly the floor, and passes.
    expect(bountifulHarvest(["cattle", "cattle", "sprout"]).kind).toBe("crop_rotation");
  });

  it("refuses a mix that is several kinds but all one track", () => {
    // Three kinds, no crops: varied, but nothing was rotated.
    expect(bountifulHarvest(["hen", "pig", "cattle"])).toMatchObject({ kind: null, multiplier: 1 });
    expect(bountifulHarvest(["sprout", "cash_crop", "sprout"])).toMatchObject({
      kind: null,
      multiplier: 1,
    });
  });

  /**
   * The structural claim, and the reason the module returns one bonus rather
   * than a list: a set cannot be both, so nothing has to decide whether they
   * stack. A third bonus would have to answer that question deliberately, and
   * this test is what makes it impossible to answer it by accident.
   */
  it("never applies more than one bonus, over every mix of the whole catalogue", () => {
    const seen = new Set<string>();
    const walk = (sweep: StackAcresStock[]) => {
      if (sweep.length > 4) return;
      if (sweep.length >= 1) {
        const key = sweep.join(",");
        if (seen.has(key)) return;
        seen.add(key);
        const bounty = bountifulHarvest(sweep);
        // Exactly one kind, or none. `kind` being a single field is the
        // enforcement; what this checks is that the two conditions are never
        // simultaneously satisfiable by construction.
        const oneKind = new Set(sweep).size === 1;
        const bothTracks = sweep.some(isLivestock) && sweep.some((s) => !isLivestock(s));
        expect(oneKind && bothTracks).toBe(false);
        if (bounty.kind === "mono_crop") expect(oneKind).toBe(true);
        if (bounty.kind === "crop_rotation") expect(bothTracks).toBe(true);
        expect(bounty.multiplier).toBeGreaterThanOrEqual(1);
      }
      for (const stock of STACKACRES_STOCK) walk([...sweep, stock]);
    };
    walk([]);
    expect(seen.size).toBeGreaterThan(100);
  });

  it("never returns a multiplier below 1, so a bonus cannot cost anything", () => {
    for (const stock of STACKACRES_STOCK) {
      for (let count = 0; count <= 8; count += 1) {
        const sweep = Array.from({ length: count }, () => stock);
        expect(bountifulHarvest(sweep).multiplier).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("applyBountifulHarvest", () => {
  it("floors, so a bonus never invents a Gold piece out of a rounding rule", () => {
    // 101 * 1.05 is 106.05.
    expect(applyBountifulHarvest(101, bountifulHarvest(["hen", "hen", "hen"]))).toBe(106);
  });

  it("leaves a gross alone when nothing applied", () => {
    expect(applyBountifulHarvest(1_234, bountifulHarvest(["cattle"]))).toBe(1_234);
  });
});
