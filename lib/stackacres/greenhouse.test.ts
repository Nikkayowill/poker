import { describe, expect, it } from "vitest";
import { STACKACRES_CROPS } from "./catalogue";
import { BARN_FOOTPRINT, FARM_ZONE, WHEAT_FIELD, growAreaBounds } from "./world";
import {
  GREENHOUSE_ALLOWED_STOCK,
  GREENHOUSE_BUILD_COST,
  GREENHOUSE_GROWTH_MULTIPLIER,
  GREENHOUSE_PLOT,
  GREENHOUSE_SLOT_CAP,
  environmentModifierFor,
  greenhouseBoundary,
  greenhouseBuildCheck,
  greenhouseDurationMs,
  greenhouseSlotLayouts,
  greenhouseSlotLocal,
  greenhouseSlotWorldPoint,
  isGreenhouseStock,
} from "./greenhouse";
import { isoProject, isoProjectLocal, isoUnprojectLocal, } from "./iso";

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("GREENHOUSE_PLOT", () => {
  it("sits entirely inside FARM_ZONE", () => {
    expect(GREENHOUSE_PLOT.x).toBeGreaterThanOrEqual(FARM_ZONE.x);
    expect(GREENHOUSE_PLOT.y).toBeGreaterThanOrEqual(FARM_ZONE.y);
    expect(GREENHOUSE_PLOT.x + GREENHOUSE_PLOT.width).toBeLessThanOrEqual(FARM_ZONE.x + FARM_ZONE.width);
    expect(GREENHOUSE_PLOT.y + GREENHOUSE_PLOT.height).toBeLessThanOrEqual(FARM_ZONE.y + FARM_ZONE.height);
  });

  it("does not overlap the barn, the Farmstead's grow area, or the wheat field", () => {
    expect(overlaps(GREENHOUSE_PLOT, BARN_FOOTPRINT)).toBe(false);
    expect(overlaps(GREENHOUSE_PLOT, growAreaBounds("farmstead"))).toBe(false);
    expect(overlaps(GREENHOUSE_PLOT, WHEAT_FIELD)).toBe(false);
  });
});

describe("greenhouseBoundary / slots", () => {
  it("lays out exactly GREENHOUSE_SLOT_CAP distinct slots, every one inside the plot", () => {
    const layouts = greenhouseSlotLayouts();
    expect(layouts).toHaveLength(GREENHOUSE_SLOT_CAP);
    const seen = new Set(layouts.map((l) => `${l.row}:${l.col}`));
    expect(seen.size).toBe(GREENHOUSE_SLOT_CAP);
    for (const layout of layouts) {
      expect(layout.at.x).toBeGreaterThanOrEqual(GREENHOUSE_PLOT.x);
      expect(layout.at.y).toBeGreaterThanOrEqual(GREENHOUSE_PLOT.y);
      expect(layout.at.x).toBeLessThanOrEqual(GREENHOUSE_PLOT.x + GREENHOUSE_PLOT.width);
      expect(layout.at.y).toBeLessThanOrEqual(GREENHOUSE_PLOT.y + GREENHOUSE_PLOT.height);
    }
  });

  it("agrees with isoProjectLocal's additive property", () => {
    // greenhouseSlotWorldPoint is plain world-space addition (origin + local);
    // isoProjectLocal projects that same sum via the sub-grid seam. The two
    // must land on the exact same screen point, or the seam is not actually
    // inheriting the main projection the way the header claims.
    const boundary = greenhouseBoundary();
    const local = greenhouseSlotLocal(1, 2, boundary);
    const at = greenhouseSlotWorldPoint(1, 2, boundary);
    const viaWorldSpaceAddition = isoProject(at.x, at.y);
    const viaLocalProjection = isoProjectLocal(boundary.origin, local);
    expect(viaLocalProjection.x).toBeCloseTo(viaWorldSpaceAddition.x, 9);
    expect(viaLocalProjection.y).toBeCloseTo(viaWorldSpaceAddition.y, 9);
  });
});

describe("isGreenhouseStock / greenhouseDurationMs", () => {
  it("only accepts crop kinds, all 22 of them", () => {
    expect(GREENHOUSE_ALLOWED_STOCK).toEqual(STACKACRES_CROPS);
    expect(isGreenhouseStock("carrot")).toBe(true);
    expect(isGreenhouseStock("corn")).toBe(true);
    expect(isGreenhouseStock("hen")).toBe(false);
    expect(isGreenhouseStock("pig")).toBe(false);
    expect(isGreenhouseStock("cattle")).toBe(false);
  });

  it("shrinks a crop's duration by the growth multiplier when housed", () => {
    expect(greenhouseDurationMs("carrot", 1000, true)).toBe(Math.round(1000 * GREENHOUSE_GROWTH_MULTIPLIER));
    expect(greenhouseDurationMs("corn", 4 * 60 * 60 * 1000, true)).toBe(
      Math.round(4 * 60 * 60 * 1000 * GREENHOUSE_GROWTH_MULTIPLIER),
    );
  });

  it("leaves duration unchanged when not housed, and for livestock even if told it is", () => {
    expect(greenhouseDurationMs("carrot", 1000, false)).toBe(1000);
    expect(greenhouseDurationMs("cattle", 5000, true)).toBe(5000);
    expect(greenhouseDurationMs("hen", 5000, true)).toBe(5000);
  });
});

describe("environmentModifierFor", () => {
  it("is the identity outdoors", () => {
    expect(environmentModifierFor(false)).toEqual({ growthMultiplier: 1, ignoresAmbientWeather: false });
  });

  it("accelerates growth and isolates weather when housed", () => {
    const modifier = environmentModifierFor(true);
    expect(modifier.growthMultiplier).toBe(GREENHOUSE_GROWTH_MULTIPLIER);
    expect(modifier.growthMultiplier).toBeLessThan(1);
    expect(modifier.ignoresAmbientWeather).toBe(true);
  });
});

describe("greenhouseBuildCheck", () => {
  it("refuses when nothing is held", () => {
    const check = greenhouseBuildCheck({}, false);
    expect(check.ok).toBe(false);
    expect(check.alreadyBuilt).toBe(false);
    expect(check.lines.every((line) => !line.met)).toBe(true);
  });

  it("is ok once every line is met", () => {
    const check = greenhouseBuildCheck({ flour: 20, cloth: 12 }, false);
    expect(check.ok).toBe(true);
    expect(check.lines.every((line) => line.met)).toBe(true);
  });

  it("stays short by even one unit of one line", () => {
    const check = greenhouseBuildCheck({ flour: 19, cloth: 12 }, false);
    expect(check.ok).toBe(false);
    const flourLine = check.lines.find((line) => line.item === "flour");
    expect(flourLine?.met).toBe(false);
  });

  it("refuses outright when already built, regardless of inventory", () => {
    const check = greenhouseBuildCheck({ flour: 999, cloth: 999 }, true);
    expect(check.ok).toBe(false);
    expect(check.alreadyBuilt).toBe(true);
  });

  it("its two cost lines match GREENHOUSE_BUILD_COST exactly", () => {
    const check = greenhouseBuildCheck({}, false);
    const items = check.lines.map((line) => line.item).sort();
    expect(items).toEqual(Object.keys(GREENHOUSE_BUILD_COST).sort());
  });
});

describe("isoProjectLocal / isoUnprojectLocal re-export", () => {
  it("round-trips through the Greenhouse's own boundary origin", () => {
    const boundary = greenhouseBoundary();
    const local = { x: 12, y: 40 };
    const screen = isoProjectLocal(boundary.origin, local);
    const back = isoUnprojectLocal(boundary.origin, screen);
    expect(back.x).toBeCloseTo(local.x, 9);
    expect(back.y).toBeCloseTo(local.y, 9);
  });
});
