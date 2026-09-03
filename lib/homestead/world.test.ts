import { describe, expect, it } from "vitest";
import { HOMESTEAD_GRID_PLOTS } from "./catalogue";
import { nearPath } from "./paths";
import type { HomesteadPlotSnapshot, HomesteadPlotState } from "./plots";
import {
  FARM_ZONE,
  HOMESTEAD_CELL,
  HOMESTEAD_CELL_TILES,
  HOMESTEAD_CHUNK,
  HOMESTEAD_MARGIN,
  HOMESTEAD_MARGIN_TILES,
  HOMESTEAD_TILE,
  HOMESTEAD_ZOOM_MAX,
  HOMESTEAD_ZOOM_MIN,
  HOMESTEAD_ZOOM_OPEN_MAX,
  cellCenter,
  cellOrigin,
  chunkScenery,
  clampZoom,
  clearedLayout,
  critterCount,
  inFarmZone,
  openingZoom,
  ownedBounds,
  penInterior,
  plotIndexAt,
  powerOfTwoCeil,
  scrollToKeepUnderPointer,
  seededRandom,
  spawnCritter,
  stepCritter,
  thicketLayout,
  worldSize,
} from "./world";

function plot(
  plotIndex: number,
  state: HomesteadPlotState,
  over: Partial<HomesteadPlotSnapshot> = {},
): HomesteadPlotSnapshot {
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
    unlockPrice: null,
    purchasable: false,
    ...over,
  };
}

/** A farm with the first `owned` plots cleared and the next one for sale. */
function farm(owned: number): HomesteadPlotSnapshot[] {
  return Array.from({ length: HOMESTEAD_GRID_PLOTS }, (_, i) => {
    const index = i + 1;
    if (index <= owned) return plot(index, "empty");
    return plot(index, "locked", { purchasable: index === owned + 1 });
  });
}

describe("plot placement", () => {
  it("lays the sixteen plots out four across, reading order, inside the margin", () => {
    expect(cellOrigin(1)).toEqual({ x: HOMESTEAD_MARGIN, y: HOMESTEAD_MARGIN });
    expect(cellOrigin(4)).toEqual({ x: HOMESTEAD_MARGIN + 3 * HOMESTEAD_CELL, y: HOMESTEAD_MARGIN });
    expect(cellOrigin(5)).toEqual({ x: HOMESTEAD_MARGIN, y: HOMESTEAD_MARGIN + HOMESTEAD_CELL });
    expect(cellOrigin(16)).toEqual({
      x: HOMESTEAD_MARGIN + 3 * HOMESTEAD_CELL,
      y: HOMESTEAD_MARGIN + 3 * HOMESTEAD_CELL,
    });
  });

  it("sizes the plot ladder's own footprint", () => {
    const size = worldSize();
    expect(size.width).toBe(2 * HOMESTEAD_MARGIN + 4 * HOMESTEAD_CELL);
    expect(size.height).toBe(2 * HOMESTEAD_MARGIN + 4 * HOMESTEAD_CELL);
    expect(HOMESTEAD_CELL).toBe(HOMESTEAD_TILE * HOMESTEAD_CELL_TILES);
    expect(HOMESTEAD_MARGIN).toBe(HOMESTEAD_TILE * HOMESTEAD_MARGIN_TILES);
  });

  it("hit-tests every plot's centre back to itself", () => {
    for (let index = 1; index <= HOMESTEAD_GRID_PLOTS; index += 1) {
      const centre = cellCenter(index);
      expect(plotIndexAt(centre.x, centre.y)).toBe(index);
    }
  });

  it("gives a plot's far edge to the next plot, and the last pixel to itself", () => {
    const origin = cellOrigin(1);
    expect(plotIndexAt(origin.x, origin.y)).toBe(1);
    expect(plotIndexAt(origin.x + HOMESTEAD_CELL - 0.01, origin.y)).toBe(1);
    expect(plotIndexAt(origin.x + HOMESTEAD_CELL, origin.y)).toBe(2);
    expect(plotIndexAt(origin.x, origin.y + HOMESTEAD_CELL)).toBe(5);
  });

  it("returns null off the ladder in every direction", () => {
    expect(plotIndexAt(0, 0)).toBeNull();
    expect(plotIndexAt(HOMESTEAD_MARGIN - 1, HOMESTEAD_MARGIN + 10)).toBeNull();
    expect(plotIndexAt(-5, 100)).toBeNull();
    expect(plotIndexAt(1_000_000, 100)).toBeNull();
  });
});

describe("owned bounds", () => {
  it("frames the owned plots plus the one for sale, no padding", () => {
    const bounds = ownedBounds(farm(4));
    // Top row owned + plot 5 for sale: the box spans the full width and two rows.
    expect(bounds.x).toBe(HOMESTEAD_MARGIN);
    expect(bounds.y).toBe(HOMESTEAD_MARGIN);
    expect(bounds.width).toBe(4 * HOMESTEAD_CELL);
    expect(bounds.height).toBe(2 * HOMESTEAD_CELL);
  });

  it("grows when land is bought and never shrinks below the first row", () => {
    const small = ownedBounds(farm(4));
    const bigger = ownedBounds(farm(9));
    expect(bigger.height).toBeGreaterThan(small.height);
    expect(bigger.width).toBeGreaterThanOrEqual(small.width);
    const all = ownedBounds(farm(16));
    expect(all).toEqual({ x: HOMESTEAD_MARGIN, y: HOMESTEAD_MARGIN, width: 4 * HOMESTEAD_CELL, height: 4 * HOMESTEAD_CELL });
  });

  it("frames the first cell when nothing is owned or for sale", () => {
    const nothing = ownedBounds([]);
    const first = cellRectFor(1);
    expect(nothing).toEqual(first);
  });

  it("does not count locked land that is not for sale", () => {
    const bounds = ownedBounds([plot(1, "empty"), plot(16, "locked")]);
    expect(bounds).toEqual(cellRectFor(1));
  });
});

function cellRectFor(plotIndex: number) {
  const origin = cellOrigin(plotIndex);
  return { x: origin.x, y: origin.y, width: HOMESTEAD_CELL, height: HOMESTEAD_CELL };
}

describe("zoom", () => {
  it("holds fixed min/max now the camera is unbounded", () => {
    expect(clampZoom(0.1)).toBe(HOMESTEAD_ZOOM_MIN);
    expect(clampZoom(50)).toBe(HOMESTEAD_ZOOM_MAX);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(Number.NaN)).toBe(HOMESTEAD_ZOOM_MIN);
  });

  it("opens a small farm close but not so close a hen fills the screen", () => {
    const bounds = ownedBounds(farm(4));
    const opening = openingZoom(bounds, 844, 390);
    expect(opening).toBeGreaterThanOrEqual(HOMESTEAD_ZOOM_MIN);
    expect(opening).toBeLessThanOrEqual(HOMESTEAD_ZOOM_OPEN_MAX);
  });

  it("never opens past the open-zoom cap even on a huge window", () => {
    const bounds = ownedBounds(farm(4));
    expect(openingZoom(bounds, 4000, 3000)).toBe(HOMESTEAD_ZOOM_OPEN_MAX);
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
    expect(pen.x + pen.width).toBeLessThan(cell.x + HOMESTEAD_CELL);
    expect(pen.y + pen.height).toBeLessThan(cell.y + HOMESTEAD_CELL);
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
      expect(piece.x).toBeGreaterThanOrEqual(5 * HOMESTEAD_CHUNK);
      expect(piece.x).toBeLessThan(6 * HOMESTEAD_CHUNK);
      expect(piece.y).toBeGreaterThanOrEqual(-2 * HOMESTEAD_CHUNK);
      expect(piece.y).toBeLessThan(-1 * HOMESTEAD_CHUNK);
    }
  });

  it("never grows scenery inside the farm zone", () => {
    // The chunk sitting on top of the farm itself is the sharpest test: every
    // candidate point in it falls inside FARM_ZONE somewhere along the way.
    const cx = Math.floor(FARM_ZONE.x / HOMESTEAD_CHUNK);
    const cy = Math.floor(FARM_ZONE.y / HOMESTEAD_CHUNK);
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
        expect(piece.x).toBeLessThanOrEqual(HOMESTEAD_CELL);
        expect(piece.y).toBeGreaterThanOrEqual(0);
        expect(piece.y).toBeLessThanOrEqual(HOMESTEAD_CELL);
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
