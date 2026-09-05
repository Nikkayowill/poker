import { describe, expect, it } from "vitest";
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
  greenhouseHitAt,
  greenhouseInteriorScreenBounds,
  greenhouseSlotAt,
  greenhouseSlotLayouts,
  greenhouseSlotLocal,
  greenhouseSlotWorldPoint,
  isGreenhouseStock,
} from "./greenhouse";
import { isoProject, isoProjectLocal, isoUnprojectLocal, projectedBounds } from "./iso";

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

describe("greenhouseHitAt", () => {
  it("hits inside the plot and misses outside it", () => {
    expect(greenhouseHitAt(GREENHOUSE_PLOT.x + 1, GREENHOUSE_PLOT.y + 1)).toBe(true);
    expect(
      greenhouseHitAt(
        GREENHOUSE_PLOT.x + GREENHOUSE_PLOT.width - 1,
        GREENHOUSE_PLOT.y + GREENHOUSE_PLOT.height - 1,
      ),
    ).toBe(true);
    expect(greenhouseHitAt(GREENHOUSE_PLOT.x - 5, GREENHOUSE_PLOT.y)).toBe(false);
    expect(greenhouseHitAt(GREENHOUSE_PLOT.x, GREENHOUSE_PLOT.y - 5)).toBe(false);
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

  it("greenhouseSlotAt round-trips against every slot's own world point", () => {
    const boundary = greenhouseBoundary();
    for (let row = 0; row < boundary.rows; row += 1) {
      for (let col = 0; col < boundary.cols; col += 1) {
        const at = greenhouseSlotWorldPoint(row, col, boundary);
        expect(greenhouseSlotAt(at.x, at.y, boundary)).toEqual({ row, col });
      }
    }
  });

  it("greenhouseSlotAt refuses a point outside the matrix", () => {
    const boundary = greenhouseBoundary();
    expect(greenhouseSlotAt(boundary.origin.x - 5, boundary.origin.y, boundary)).toBeNull();
    expect(greenhouseSlotAt(boundary.origin.x, boundary.origin.y - 5, boundary)).toBeNull();
    const farX = boundary.origin.x + boundary.cols * boundary.tileSize + 5;
    expect(greenhouseSlotAt(farX, boundary.origin.y, boundary)).toBeNull();
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

describe("greenhouseInteriorScreenBounds", () => {
  it("matches projecting GREENHOUSE_PLOT directly", () => {
    const bounds = greenhouseInteriorScreenBounds();
    const direct = projectedBounds(GREENHOUSE_PLOT);
    expect(bounds).toEqual(direct);
  });
});

describe("isGreenhouseStock / greenhouseDurationMs", () => {
  it("only accepts the two crop kinds", () => {
    expect(GREENHOUSE_ALLOWED_STOCK).toEqual(["sprout", "cash_crop"]);
    expect(isGreenhouseStock("sprout")).toBe(true);
    expect(isGreenhouseStock("cash_crop")).toBe(true);
    expect(isGreenhouseStock("hen")).toBe(false);
    expect(isGreenhouseStock("pig")).toBe(false);
    expect(isGreenhouseStock("cattle")).toBe(false);
  });

  it("shrinks a crop's duration by the growth multiplier when housed", () => {
    expect(greenhouseDurationMs("sprout", 1000, true)).toBe(Math.round(1000 * GREENHOUSE_GROWTH_MULTIPLIER));
    expect(greenhouseDurationMs("cash_crop", 4 * 60 * 60 * 1000, true)).toBe(
      Math.round(4 * 60 * 60 * 1000 * GREENHOUSE_GROWTH_MULTIPLIER),
    );
  });

  it("leaves duration unchanged when not housed, and for livestock even if told it is", () => {
    expect(greenhouseDurationMs("sprout", 1000, false)).toBe(1000);
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
