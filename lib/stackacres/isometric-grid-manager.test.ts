import { describe, expect, it } from "vitest";
import {
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  IsometricGridManager,
  stubSpriteFactory,
  type Footprint,
} from "./isometric-grid-manager";

function makeGrid(columns = 12, rows = 12, origin = { x: 400, y: 100 }) {
  const stub = stubSpriteFactory();
  const grid = new IsometricGridManager({ columns, rows, origin, createSprite: stub.factory });
  return { grid, stub };
}

describe("grid math", () => {
  it("projects cells onto a 2:1 diamond lattice from the origin", () => {
    const { grid } = makeGrid();
    expect(grid.gridToScreen(0, 0)).toEqual({ x: 400, y: 100 });
    expect(grid.gridToScreen(1, 0)).toEqual({ x: 400 + ISO_TILE_WIDTH / 2, y: 100 + ISO_TILE_HEIGHT / 2 });
    expect(grid.gridToScreen(0, 1)).toEqual({ x: 400 - ISO_TILE_WIDTH / 2, y: 100 + ISO_TILE_HEIGHT / 2 });
    expect(grid.gridToScreen(1, 1)).toEqual({ x: 400, y: 100 + ISO_TILE_HEIGHT });
  });

  it("round-trips every cell center exactly", () => {
    const { grid } = makeGrid();
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.columns; x++) {
        const p = grid.gridToScreen(x, y);
        expect(grid.screenToGridExact(p.x, p.y)).toEqual({ x, y });
        expect(grid.screenToGrid(p.x, p.y)).toEqual({ x, y });
      }
    }
  });

  it("maps a point anywhere inside a diamond to that cell, and past its edge to the neighbour", () => {
    const { grid } = makeGrid();
    const center = grid.gridToScreen(4, 6);
    // Just inside the four corners of cell (4, 6)'s diamond.
    expect(grid.screenToGrid(center.x + 31, center.y)).toEqual({ x: 4, y: 6 });
    expect(grid.screenToGrid(center.x - 31, center.y)).toEqual({ x: 4, y: 6 });
    expect(grid.screenToGrid(center.x, center.y + 15)).toEqual({ x: 4, y: 6 });
    expect(grid.screenToGrid(center.x, center.y - 15)).toEqual({ x: 4, y: 6 });
    // Just past an edge lands in the diagonal neighbour that edge borders.
    expect(grid.screenToGrid(center.x + 17, center.y + 9)).toEqual({ x: 5, y: 6 });
    expect(grid.screenToGrid(center.x - 17, center.y + 9)).toEqual({ x: 4, y: 7 });
  });

  it("returns null off the map and clamps with nearestCell", () => {
    const { grid } = makeGrid();
    const above = grid.gridToScreen(0, 0);
    expect(grid.screenToGrid(above.x, above.y - 40)).toBeNull();
    expect(grid.nearestCell(above.x, above.y - 40)).toEqual({ x: 0, y: 0 });
    const farEast = grid.gridToScreen(30, 2);
    expect(grid.screenToGrid(farEast.x, farEast.y)).toBeNull();
    expect(grid.nearestCell(farEast.x, farEast.y)).toEqual({ x: 11, y: 2 });
  });

  it("sizes a footprint's ground diamond from its cell count", () => {
    const { grid } = makeGrid();
    const bounds = grid.footprintBounds({ x: 2, y: 2, width: 3, height: 3 });
    expect(bounds.width).toBe(6 * (ISO_TILE_WIDTH / 2));
    expect(bounds.height).toBe(6 * (ISO_TILE_HEIGHT / 2));
    const single = grid.footprintBounds({ x: 0, y: 0, width: 1, height: 1 });
    expect(single).toEqual({ x: 400 - 32, y: 100 - 16, width: ISO_TILE_WIDTH, height: ISO_TILE_HEIGHT });
  });
});

describe("cohesive placement", () => {
  it("snaps two 3x3 fields side by side so they share an edge with no gap", () => {
    const { grid } = makeGrid();
    const a = grid.placeAsset(0, 0, "crop", 3, 3);
    const b = grid.placeAsset(3, 0, "crop", 3, 3);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const ca = grid.footprintCorners(a.asset.footprint);
    const cb = grid.footprintCorners(b.asset.footprint);
    expect(cb.n).toEqual(ca.e);
    expect(cb.w).toEqual(ca.s);
    const edges = grid.footprintEdges(a.asset.footprint);
    expect(edges.east.from).toEqual(ca.e);
    expect(edges.east.to).toEqual(ca.s);
    expect(edges.east.along).toBe("y");
  });

  it("rounds a fractional drag position onto whole cells", () => {
    const { grid, stub } = makeGrid();
    const result = grid.placeAsset(2.4, 3.6, "building", 2, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.footprint).toEqual({ x: 2, y: 4, width: 2, height: 2 });
    expect(result.asset.anchor).toEqual(grid.footprintCorners(result.asset.footprint).s);
    const sprite = stub.sprites[0];
    expect(sprite.x).toBe(result.asset.anchor.x);
    expect(sprite.y).toBe(result.asset.anchor.y);
    expect(sprite.originX).toBe(0.5);
    expect(sprite.originY).toBe(1);
  });

  it("refuses an overlap and reports the cells in the way", () => {
    const { grid, stub } = makeGrid();
    expect(grid.placeAsset(1, 1, "crop", 3, 3).ok).toBe(true);
    const clash = grid.placeAsset(3, 3, "building", 2, 2);
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.reason).toBe("overlap");
    expect(clash.blockingCells).toEqual([{ x: 3, y: 3 }]);
    expect(stub.sprites).toHaveLength(1);
    expect(grid.getCell(4, 4)?.occupancy).toBe("empty");
  });

  it("refuses a footprint hanging off the map and a non-integer size", () => {
    const { grid } = makeGrid(4, 4);
    const off = grid.placeAsset(3, 3, "building", 2, 2);
    expect(off.ok).toBe(false);
    if (off.ok) return;
    expect(off.reason).toBe("out-of-bounds");
    expect(off.blockingCells).toEqual([
      { x: 4, y: 3 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ]);
    const bad = grid.canPlace(0, 0, 1.5, 1);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("invalid-size");
  });

  it("writes occupancy and texture key into every cell of the footprint", () => {
    const { grid } = makeGrid();
    const result = grid.placeAsset(5, 5, "crop", 2, 3, { textureKey: "wheat-field", id: "wheat-1" });
    expect(result.ok).toBe(true);
    const footprint: Footprint = { x: 5, y: 5, width: 2, height: 3 };
    for (let y = footprint.y; y < footprint.y + footprint.height; y++) {
      for (let x = footprint.x; x < footprint.x + footprint.width; x++) {
        expect(grid.matrix[y][x]).toEqual({ occupancy: "crop", textureKey: "wheat-field", assetId: "wheat-1" });
      }
    }
    expect(grid.assetAt(6, 7)?.id).toBe("wheat-1");
    expect(grid.getCell(7, 5)).toEqual({ occupancy: "empty", textureKey: "ground", assetId: null });
    expect(grid.placeAsset(0, 0, "path", 1, 1, { id: "wheat-1" })).toMatchObject({ ok: false, reason: "duplicate-id" });
  });

  it("removing an asset frees its cells and destroys its sprite", () => {
    const { grid, stub } = makeGrid();
    const placed = grid.placeAsset(2, 2, "building", 2, 2, { id: "coop" });
    expect(placed.ok).toBe(true);
    expect(grid.removeAsset("coop")).toBe(true);
    expect(grid.removeAsset("coop")).toBe(false);
    expect(stub.sprites[0].destroyed).toBe(true);
    expect(grid.getCell(3, 3)?.occupancy).toBe("empty");
    expect(grid.assets).toHaveLength(0);
    expect(grid.placeAsset(2, 2, "crop", 2, 2).ok).toBe(true);
  });
});

describe("depth ordering", () => {
  it("draws the nearer of two standing assets on top", () => {
    const { grid } = makeGrid();
    const far = grid.placeAsset(0, 0, "crop", 3, 3);
    const near = grid.placeAsset(0, 3, "building", 2, 2);
    expect(far.ok && near.ok).toBe(true);
    if (!far.ok || !near.ok) return;
    expect(near.asset.depth).toBeGreaterThan(far.asset.depth);
  });

  it("keeps paths under every standing asset regardless of position", () => {
    const { grid } = makeGrid();
    const path = grid.placeAsset(11, 11, "path", 1, 1);
    const crop = grid.placeAsset(0, 0, "crop", 1, 1);
    expect(path.ok && crop.ok).toBe(true);
    if (!path.ok || !crop.ok) return;
    expect(path.asset.depth).toBeLessThan(crop.asset.depth);
  });
});

describe("findNearestPlacement", () => {
  it("returns the requested anchor when it is free", () => {
    const { grid } = makeGrid();
    expect(grid.findNearestPlacement(4, 4, 2, 2)).toEqual({ x: 4, y: 4 });
  });

  it("slides to the closest open slot flush against the blocker", () => {
    const { grid } = makeGrid();
    expect(grid.placeAsset(4, 4, "crop", 3, 3).ok).toBe(true);
    // A 1x1 dropped in the field's middle lands on the nearest ring outside it.
    const slot = grid.findNearestPlacement(5, 5, 1, 1);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(Math.max(Math.abs(slot.x - 5), Math.abs(slot.y - 5))).toBe(2);
    expect(grid.canPlace(slot.x, slot.y, 1, 1).ok).toBe(true);
  });

  it("returns null when nothing fits within the radius", () => {
    const { grid } = makeGrid(3, 3);
    expect(grid.placeAsset(0, 0, "building", 3, 3).ok).toBe(true);
    expect(grid.findNearestPlacement(1, 1, 1, 1)).toBeNull();
  });
});

describe("stub sprite factory", () => {
  it("records the spec each sprite was created from", () => {
    const { grid, stub } = makeGrid();
    grid.placeAsset(1, 2, "path", 1, 1, { textureKey: "stone" });
    expect(stub.sprites[0].spec).toMatchObject({
      assetType: "path",
      textureKey: "stone",
      footprint: { x: 1, y: 2, width: 1, height: 1 },
    });
    grid.clear();
    expect(stub.sprites[0].destroyed).toBe(true);
    expect(grid.getCell(1, 2)?.occupancy).toBe("empty");
  });
});
