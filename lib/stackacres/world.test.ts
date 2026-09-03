import { describe, expect, it } from "vitest";
import { STACKACRES_GRID_PLOTS, STACKACRES_STOCK } from "./catalogue";
import { nearPath } from "./paths";
import type { StackAcresPlotSnapshot, StackAcresPlotState } from "./plots";
import {
  FARM_ZONE,
  STACKACRES_CELL,
  STACKACRES_CHUNK,
  STACKACRES_ZOOM_MAX,
  STACKACRES_ZOOM_MIN,
  STACKACRES_ZOOM_OPEN_MAX,
  cellCenter,
  cellOrigin,
  chunkScenery,
  clampZoom,
  clearedLayout,
  critterCount,
  inFarmZone,
  openingZoom,
  ownedBounds,
  penGroupBounds,
  penInterior,
  plotIndexAt,
  plotNeighbor,
  plotPenZone,
  powerOfTwoCeil,
  scrollToKeepUnderPointer,
  seededRandom,
  spawnCritter,
  stepCritter,
  STACKACRES_PEN_ZONES,
  stockAllowedOnPlot,
  thicketLayout,
} from "./world";

function plot(
  plotIndex: number,
  state: StackAcresPlotState,
  over: Partial<StackAcresPlotSnapshot> = {},
): StackAcresPlotSnapshot {
  return {
    plotIndex,
    state,
    stock: null,
    stake: null,
    yieldQuantity: null,
    startedAt: null,
    readyAt: null,
    progress: null,
    hungryAt: null,
    muckFee: null,
    permanent: false,
    unlockPrice: null,
    purchasable: false,
    ...over,
  };
}

/** The first `owned` of the Farmstead's own four Hen Coop plots, cleared --
 *  kept inside that one block rather than spanning all sixteen, since plots
 *  5 and up now live in three other districts entirely (see "owned bounds"
 *  below). */
function henFarm(owned: number): StackAcresPlotSnapshot[] {
  return Array.from({ length: owned }, (_, i) => plot(i + 1, "empty"));
}

function cellRectFor(plotIndex: number) {
  const origin = cellOrigin(plotIndex);
  return { x: origin.x, y: origin.y, width: STACKACRES_CELL, height: STACKACRES_CELL };
}

describe("plot placement", () => {
  it("lays each kind's four plots out 2x2, reading order, inside its own block", () => {
    const hen = penGroupBounds("hen");
    expect(cellOrigin(1)).toEqual({ x: hen.x, y: hen.y });
    expect(cellOrigin(2)).toEqual({ x: hen.x + STACKACRES_CELL, y: hen.y });
    expect(cellOrigin(3)).toEqual({ x: hen.x, y: hen.y + STACKACRES_CELL });
    expect(cellOrigin(4)).toEqual({ x: hen.x + STACKACRES_CELL, y: hen.y + STACKACRES_CELL });
  });

  it("puts each kind's block in the district that kind now lives in", () => {
    // 1-4 Hen Coops (Farmstead), 5-8 Crop Fields (Long Meadow), 9-12 Sheep
    // Pens (Wallow), 13-16 Cattle Pens (Ox Fields) -- see plotPenZone's own
    // header for why this order.
    const field = penGroupBounds("field");
    const pig = penGroupBounds("pig");
    const cattle = penGroupBounds("cattle");
    expect(cellOrigin(5)).toEqual({ x: field.x, y: field.y });
    expect(cellOrigin(9)).toEqual({ x: pig.x, y: pig.y });
    expect(cellOrigin(13)).toEqual({ x: cattle.x, y: cattle.y });
  });

  it("hit-tests every plot's centre back to itself", () => {
    for (let index = 1; index <= STACKACRES_GRID_PLOTS; index += 1) {
      const centre = cellCenter(index);
      expect(plotIndexAt(centre.x, centre.y)).toBe(index);
    }
  });

  it("gives a plot's far edge to the next plot within its own block, and the last pixel to itself", () => {
    const origin = cellOrigin(1);
    expect(plotIndexAt(origin.x, origin.y)).toBe(1);
    expect(plotIndexAt(origin.x + STACKACRES_CELL - 0.01, origin.y)).toBe(1);
    expect(plotIndexAt(origin.x + STACKACRES_CELL, origin.y)).toBe(2);
    expect(plotIndexAt(origin.x, origin.y + STACKACRES_CELL)).toBe(3);
  });

  it("returns null off every block, including the open ground between two of them", () => {
    expect(plotIndexAt(0, 0)).toBeNull();
    expect(plotIndexAt(1_000_000, 100)).toBeNull();
    // Between the Farmstead's Hen Coops and its own barn -- inside the
    // district, not inside any plot.
    expect(plotIndexAt(100, 0)).toBeNull();
  });
});

describe("plot neighbours within a block", () => {
  it("finds the three real neighbours of a corner plot", () => {
    // Plot 1 is (col 0, row 0) of the Hen Coop block.
    expect(plotNeighbor(1, 1, 0)).toBe(2); // east
    expect(plotNeighbor(1, 0, 1)).toBe(3); // south
    expect(plotNeighbor(1, -1, 0)).toBeNull(); // off the block's own west edge
    expect(plotNeighbor(1, 0, -1)).toBeNull(); // off the block's own north edge
    expect(plotNeighbor(1, 1, 1)).toBe(4); // the diagonal is in-bounds too, just unused by any real caller
  });

  it("never crosses into a different kind's block", () => {
    // Plot 4 is the Hen block's own bottom-right corner; plot 5 is a
    // different kind (Crop Fields) entirely, even though the numbers are
    // sequential. Nothing about plotNeighbor may reach across that seam.
    expect(plotNeighbor(4, 1, 0)).toBeNull();
    expect(plotNeighbor(4, 0, 1)).toBeNull();
  });
});

describe("pen zones", () => {
  it("gives every one of the four blocks its own zone, in ladder order", () => {
    expect([1, 2, 3, 4].map(plotPenZone)).toEqual(["hen", "hen", "hen", "hen"]);
    expect([5, 6, 7, 8].map(plotPenZone)).toEqual(["field", "field", "field", "field"]);
    expect([9, 10, 11, 12].map(plotPenZone)).toEqual(["pig", "pig", "pig", "pig"]);
    expect([13, 14, 15, 16].map(plotPenZone)).toEqual(["cattle", "cattle", "cattle", "cattle"]);
  });

  it("names a zone for every plot on the ladder, with no gaps", () => {
    for (let index = 1; index <= STACKACRES_GRID_PLOTS; index += 1) {
      expect(STACKACRES_PEN_ZONES).toContain(plotPenZone(index));
    }
  });

  it("lets a crop stand only on a field, and an animal only on its own pen", () => {
    // Block 1 (hen): only the hen.
    expect(stockAllowedOnPlot(1, "hen")).toBe(true);
    expect(stockAllowedOnPlot(1, "pig")).toBe(false);
    expect(stockAllowedOnPlot(1, "cattle")).toBe(false);
    expect(stockAllowedOnPlot(1, "sprout")).toBe(false);
    // Block 2 (field): both crops, neither animal.
    expect(stockAllowedOnPlot(5, "sprout")).toBe(true);
    expect(stockAllowedOnPlot(5, "cash_crop")).toBe(true);
    expect(stockAllowedOnPlot(5, "hen")).toBe(false);
    expect(stockAllowedOnPlot(5, "pig")).toBe(false);
    expect(stockAllowedOnPlot(5, "cattle")).toBe(false);
    // Block 3 (pig) and block 4 (cattle): the same shape, one species each.
    expect(stockAllowedOnPlot(9, "pig")).toBe(true);
    expect(stockAllowedOnPlot(9, "cattle")).toBe(false);
    expect(stockAllowedOnPlot(13, "cattle")).toBe(true);
    expect(stockAllowedOnPlot(13, "pig")).toBe(false);
  });

  it("gives every real stock exactly one home on the ladder", () => {
    // Nothing in the catalogue is homeless or double-homed: a real farm has
    // one right place for a given animal or crop, not zero and not two.
    for (const stock of STACKACRES_STOCK) {
      const homes = Array.from({ length: STACKACRES_GRID_PLOTS }, (_, i) => i + 1).filter((index) =>
        stockAllowedOnPlot(index, stock),
      );
      expect(homes.length).toBeGreaterThan(0);
      const zones = new Set(homes.map(plotPenZone));
      expect(zones.size).toBe(1);
    }
  });
});

describe("owned bounds", () => {
  it("frames a subset of one block's plots, no padding", () => {
    const bounds = ownedBounds(henFarm(2));
    const hen = penGroupBounds("hen");
    expect(bounds).toEqual({ x: hen.x, y: hen.y, width: 2 * STACKACRES_CELL, height: STACKACRES_CELL });
  });

  it("frames a whole block once every plot in it is owned", () => {
    expect(ownedBounds(henFarm(4))).toEqual(penGroupBounds("hen"));
  });

  it("frames the plot list's own first entry when nothing is acreage", () => {
    expect(ownedBounds([])).toEqual(cellRectFor(1));
  });

  it("does not count locked land that is not for sale", () => {
    const bounds = ownedBounds([plot(1, "empty"), plot(4, "locked")]);
    expect(bounds).toEqual(cellRectFor(1));
  });

  it("is zone-blind: given plots from two different kinds, it unions them honestly rather than assuming one place", () => {
    // ownedBounds itself does not know or care that plot 1 (a Hen Coop, at
    // the Farmstead) and plot 5 (a Crop Field, at the Long Meadow) are 800
    // units apart -- it is up to a caller that wants "one place" to filter
    // to one block's plots first, the way the scene's own home view does.
    const bounds = ownedBounds([plot(1, "empty"), plot(5, "empty")]);
    const hen = cellRectFor(1);
    const field = cellRectFor(5);
    expect(bounds.x).toBe(Math.min(hen.x, field.x));
    expect(bounds.y).toBe(Math.min(hen.y, field.y));
    expect(bounds.x + bounds.width).toBe(Math.max(hen.x + hen.width, field.x + field.width));
    expect(bounds.y + bounds.height).toBe(Math.max(hen.y + hen.height, field.y + field.height));
  });
});

describe("zoom", () => {
  it("holds fixed min/max now the camera is unbounded", () => {
    expect(clampZoom(0.1)).toBe(STACKACRES_ZOOM_MIN);
    expect(clampZoom(50)).toBe(STACKACRES_ZOOM_MAX);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(Number.NaN)).toBe(STACKACRES_ZOOM_MIN);
  });

  it("opens a small farm close but not so close a hen fills the screen", () => {
    const bounds = ownedBounds(henFarm(4));
    const opening = openingZoom(bounds, 844, 390);
    expect(opening).toBeGreaterThanOrEqual(STACKACRES_ZOOM_MIN);
    expect(opening).toBeLessThanOrEqual(STACKACRES_ZOOM_OPEN_MAX);
  });

  it("never opens past the open-zoom cap even on a huge window", () => {
    const bounds = ownedBounds(henFarm(4));
    expect(openingZoom(bounds, 4000, 3000)).toBe(STACKACRES_ZOOM_OPEN_MAX);
  });

  it("keeps the world point under the finger through a zoom", () => {
    const view = { width: 800, height: 400 };
    const finger = { x: 600, y: 100 };
    const world = { x: 250, y: 120 };
    for (const zoom of [1, 2, 3.5]) {
      const scroll = scrollToKeepUnderPointer(world, finger, view.width, view.height, zoom);
      // Phaser: worldX = scrollX + width/2 + (screenX - width/2) / zoom.
      const back = scroll.x + view.width / 2 + (finger.x - view.width / 2) / zoom;
      expect(back).toBeCloseTo(world.x);
      const backY = scroll.y + view.height / 2 + (finger.y - view.height / 2) / zoom;
      expect(backY).toBeCloseTo(world.y);
    }
  });
});

describe("animals", () => {
  it("shows a picture of the pen, not the yield", () => {
    expect(critterCount("hen")).toBe(3);
    expect(critterCount("pig")).toBe(2);
    expect(critterCount("cattle")).toBe(2);
    expect(critterCount("sprout")).toBe(0);
    expect(critterCount(null)).toBe(0);
  });

  it("keeps a pen's walkable area inside the fence", () => {
    const cell = cellOrigin(6);
    const pen = penInterior(6);
    expect(pen.x).toBeGreaterThan(cell.x);
    expect(pen.y).toBeGreaterThan(cell.y);
    expect(pen.x + pen.width).toBeLessThan(cell.x + STACKACRES_CELL);
    expect(pen.y + pen.height).toBeLessThan(cell.y + STACKACRES_CELL);
  });

  it("never walks an animal through the fence, however long it wanders", () => {
    const pen = penInterior(3);
    const random = seededRandom(99);
    let critter = spawnCritter(pen, random);
    let walked = 0;
    for (let i = 0; i < 5_000; i += 1) {
      const before = critter;
      critter = stepCritter(critter, pen, 14, 33, random);
      if (critter.mode === "walk" && before.mode === "walk") walked += 1;
      expect(critter.x).toBeGreaterThanOrEqual(pen.x);
      expect(critter.x).toBeLessThanOrEqual(pen.x + pen.width);
      expect(critter.y).toBeGreaterThanOrEqual(pen.y);
      expect(critter.y).toBeLessThanOrEqual(pen.y + pen.height);
    }
    // It actually went somewhere, rather than idling for the whole run.
    expect(walked).toBeGreaterThan(100);
  });

  it("faces the way it is walking and arrives exactly on its target", () => {
    const pen = { x: 0, y: 0, width: 100, height: 100 };
    const critter = {
      x: 10,
      y: 10,
      targetX: 10,
      targetY: 10,
      mode: "idle" as const,
      waitMs: 1,
      facing: 1 as const,
    };
    // A random source that always picks the far corner.
    const toCorner = () => 0.9;
    const walking = stepCritter(critter, pen, 10, 16, toCorner);
    expect(walking.mode).toBe("walk");
    expect(walking.targetX).toBe(90);
    expect(walking.facing).toBe(-1);
    let c = walking;
    for (let i = 0; i < 2_000 && c.mode === "walk"; i += 1) c = stepCritter(c, pen, 10, 16, toCorner);
    expect(c.mode).toBe("idle");
    expect(c.x).toBe(90);
    expect(c.y).toBe(90);
  });

  it("caps a long frame so a background tab does not teleport the herd", () => {
    const pen = { x: 0, y: 0, width: 1000, height: 10 };
    const critter = {
      x: 0,
      y: 5,
      targetX: 1000,
      targetY: 5,
      mode: "walk" as const,
      waitMs: 0,
      facing: -1 as const,
    };
    const after = stepCritter(critter, pen, 100, 60_000, () => 0.5);
    // 250ms at 100 units/s, not 60s worth.
    expect(after.x).toBeCloseTo(25);
  });
});

describe("open-world scenery", () => {
  it("grows a chunk deterministically and keeps every piece inside it", () => {
    const first = chunkScenery(5, -2);
    expect(chunkScenery(5, -2)).toEqual(first);
    expect(chunkScenery(6, -2)).not.toEqual(first);
    for (const piece of first) {
      expect(piece.x).toBeGreaterThanOrEqual(5 * STACKACRES_CHUNK);
      expect(piece.x).toBeLessThan(6 * STACKACRES_CHUNK);
      expect(piece.y).toBeGreaterThanOrEqual(-2 * STACKACRES_CHUNK);
      expect(piece.y).toBeLessThan(-1 * STACKACRES_CHUNK);
    }
  });

  it("never grows scenery inside the farm zone", () => {
    // The chunk sitting on top of the farm itself is the sharpest test: every
    // candidate point in it falls inside FARM_ZONE somewhere along the way.
    const cx = Math.floor(FARM_ZONE.x / STACKACRES_CHUNK);
    const cy = Math.floor(FARM_ZONE.y / STACKACRES_CHUNK);
    for (const piece of chunkScenery(cx, cy)) {
      expect(inFarmZone(piece.x, piece.y)).toBe(false);
    }
  });

  it("keeps the barn yard, the lane's verge and the mailbox inside the farm zone", () => {
    // Roof peak of the barn, the stone wall's sprite top, the lane's lamps
    // on the west verge, and the mailbox at the lane's end.
    expect(inFarmZone(108, -28)).toBe(true);
    expect(inFarmZone(160, -50)).toBe(true);
    expect(inFarmZone(36, 300)).toBe(true);
    expect(inFarmZone(46, 404)).toBe(true);
    // And not the woods a chunk away.
    expect(inFarmZone(-100, 100)).toBe(false);
    expect(inFarmZone(200, -100)).toBe(false);
  });

  it("never grows scenery on a path", () => {
    // The chunks the track crosses on its way out, the ones the road curves
    // through, and the one holding the lane's verge: every candidate near a
    // path is dropped rather than shifted.
    for (const [cx, cy] of [[-1, -1], [-1, -2], [0, -1], [0, 0], [0, 1], [0, 2], [2, -1], [3, -1]]) {
      for (const piece of chunkScenery(cx, cy)) {
        expect(nearPath(piece.x, piece.y), `${cx}:${cy} ${piece.kind} at ${piece.x},${piece.y}`).toBe(false);
      }
    }
  });

  it("sorts a chunk's scenery by y, for correct draw order", () => {
    const items = chunkScenery(3, 8);
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i].y).toBeGreaterThanOrEqual(items[i - 1].y);
    }
  });

  it("caps a chunk's woodland by distance from the farm", () => {
    const isWood = (p: { kind: string }) => p.kind !== "tuft" && !p.kind.startsWith("flower");
    // Chunk (0, -1) sits just north of the farm, close enough to be in the
    // dense tier -- the cap holds even though some of its candidates land
    // inside FARM_ZONE and are dropped rather than shifted.
    expect(chunkScenery(0, -1).filter(isWood).length).toBeLessThanOrEqual(9);
    // Far out, only the sparse tier applies.
    expect(chunkScenery(40, 40).filter(isWood).length).toBeLessThanOrEqual(3);
  });
});

describe("locked-plot thicket", () => {
  it("is deterministic per plot and stays in cell-local bounds", () => {
    const first = thicketLayout(7, false);
    expect(thicketLayout(7, false)).toEqual(first);
    expect(thicketLayout(8, false)).not.toEqual(first);
    for (const layout of [first, thicketLayout(7, true), clearedLayout(7)]) {
      for (const piece of layout) {
        expect(piece.x).toBeGreaterThanOrEqual(0);
        expect(piece.x).toBeLessThanOrEqual(STACKACRES_CELL);
        expect(piece.y).toBeGreaterThanOrEqual(0);
        expect(piece.y).toBeLessThanOrEqual(STACKACRES_CELL);
      }
    }
  });

  it("thins the thicket on the plot that is for sale", () => {
    expect(thicketLayout(9, true).length).toBeLessThan(thicketLayout(9, false).length);
  });

  it("sorts by y, for correct draw order", () => {
    const items = thicketLayout(11, false);
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i].y).toBeGreaterThanOrEqual(items[i - 1].y);
    }
  });
});

describe("powerOfTwoCeil", () => {
  it("rounds a texture side up to the next power of two, never down", () => {
    expect(powerOfTwoCeil(1)).toBe(1);
    expect(powerOfTwoCeil(2)).toBe(2);
    expect(powerOfTwoCeil(3)).toBe(4);
    expect(powerOfTwoCeil(112)).toBe(128);
    expect(powerOfTwoCeil(128)).toBe(128);
    expect(powerOfTwoCeil(640)).toBe(1024);
    expect(powerOfTwoCeil(0)).toBe(1);
    expect(powerOfTwoCeil(Number.NaN)).toBe(1);
  });

  it("makes every painter side a power of two once scaled", () => {
    // The whole point: the renderer only mips power-of-two textures.
    for (const side of [12, 14, 16, 20, 22, 24, 30, 34, 62, 74, 80, 160]) {
      const px = powerOfTwoCeil(Math.ceil(side * 8));
      expect(Math.log2(px) % 1).toBe(0);
      expect(px).toBeGreaterThanOrEqual(side * 8);
    }
  });
});

describe("seeded randomness", () => {
  it("is repeatable and in range", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    for (let i = 0; i < 50; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
