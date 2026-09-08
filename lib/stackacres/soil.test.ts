import { describe, expect, it } from "vitest";

import { growthStage, cropRank, cropRanks, cropSpot, growAreaBounds, STACKACRES_TILE } from "./world";
import {
  MEADOW_TILE,
  meadowBaseDensity,
  meadowDensityAt,
  meadowTileAt,
} from "./zones";
import {
  SOIL_COL_PITCH,
  SOIL_EDGE_BAND,
  SOIL_SLOTS_PER_TILE,
  SOIL_SLOT_COLS,
  SOIL_SLOT_ROWS,
  SOIL_STARTER_TILES,
  SOIL_TILE,
  SOIL_TILE_PRICE_GOLD,
  addSoilSlot,
  buildCropInstances,
  createSoilMap,
  getClosestDryCrop,
  getClosestHarvestableCrop,
  hasSoilTile,
  nextSoilOrder,
  onSoil,
  orderedSoilTiles,
  placeSoilTile,
  removeSoilTile,
  soilCapacity,
  soilSignedDistance,
  soilSlotPoint,
  soilSlotSpotForRank,
  soilSlotSpot,
  soilTileAt,
  soilTileDiamond,
  soilTileKey,
  soilTileOwnedSlots,
  soilTileRect,
  soilTileTier,
  mergeSoilTiles,
  nextFreeSoilSlot,
  soilSlotTile,
  soilTileState,
  soilTilesEqual,
  starterSoilTiles,
  type CropSource,
  type SoilTile,
} from "./soil";

const MEADOW = growAreaBounds("meadow");

function starterMap() {
  return createSoilMap(starterSoilTiles(MEADOW));
}

/* ------------------------------------------------------------------ */
/* The restated constants                                              */
/* ------------------------------------------------------------------ */

/**
 * `SOIL_TILE` and `SOIL_EDGE_BAND` are written as literals in ./soil.ts
 * because that module cannot value-import the files those numbers belong to
 * without a runtime cycle (see its header). These are the tests that make
 * the restatement safe -- exactly what `PEN_BLOCKS` never had when it
 * restated `GROW_AREA` and silently drifted out of agreement with it.
 */
describe("restated constants stay tied to their sources", () => {
  it("a soil tile is four art units", () => {
    expect(SOIL_TILE).toBe(STACKACRES_TILE * 4);
  });

  it("the stubble collar is a tile and a half of meadow", () => {
    expect(SOIL_EDGE_BAND).toBe(MEADOW_TILE * 1.5);
  });

  it("the collar cannot reach past one soil tile", () => {
    // `soilSignedDistance` probes only the 3x3 block of coordinates around
    // the point. That is exhaustive exactly while the band is under one tile
    // wide; widen it past this and the SDF starts missing beds two
    // coordinates away.
    expect(SOIL_EDGE_BAND).toBeLessThan(SOIL_TILE);
  });
});

/* ------------------------------------------------------------------ */
/* The coordinate map                                                  */
/* ------------------------------------------------------------------ */

describe("the coordinate map tracks what was placed", () => {
  it("keys a tile by its own coordinates and finds it again", () => {
    const soil = createSoilMap();
    expect(hasSoilTile(soil, 3, 9)).toBe(false);
    expect(placeSoilTile(soil, { tx: 3, ty: 9, order: 0, origin: "purchased" })).toBe(true);
    expect(soil.has(soilTileKey(3, 9))).toBe(true);
    expect(hasSoilTile(soil, 3, 9)).toBe(true);
    expect(soil.size).toBe(1);
  });

  it("refuses a second tile on an occupied coordinate rather than overwriting", () => {
    const soil = createSoilMap();
    placeSoilTile(soil, { tx: 1, ty: 1, order: 0, origin: "starter" });
    expect(placeSoilTile(soil, { tx: 1, ty: 1, order: 1, origin: "purchased" })).toBe(false);
    // The original survives, so a shop charging on `true` cannot take Gold
    // for a tile that changed nothing.
    expect(soil.get(soilTileKey(1, 1))?.origin).toBe("starter");
    expect(soil.size).toBe(1);
  });

  it("removes a tile and reports whether there was one", () => {
    const soil = createSoilMap([{ tx: 2, ty: 2, order: 0, origin: "purchased" }]);
    expect(removeSoilTile(soil, 2, 2)).toBe(true);
    expect(removeSoilTile(soil, 2, 2)).toBe(false);
    expect(soil.size).toBe(0);
  });

  it("hands out an order past every tile standing, not the map's size", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "starter" },
      { tx: 1, ty: 0, order: 1, origin: "starter" },
      { tx: 2, ty: 0, order: 2, origin: "purchased" },
    ]);
    removeSoilTile(soil, 1, 0);
    // size is 2 now; handing out order 2 would collide with the tile at
    // (2, 0) and drop two tiles into one slot range.
    expect(nextSoilOrder(soil)).toBe(3);
  });

  it("snaps a world point to its tile, flooring through negative space", () => {
    expect(soilTileAt(0, 0)).toEqual({ tx: 0, ty: 0 });
    expect(soilTileAt(SOIL_TILE - 1, SOIL_TILE - 1)).toEqual({ tx: 0, ty: 0 });
    expect(soilTileAt(SOIL_TILE, SOIL_TILE)).toEqual({ tx: 1, ty: 1 });
    // The trap `meadowTileAt` documents: truncation would collapse these two.
    expect(soilTileAt(-1, -1)).toEqual({ tx: -1, ty: -1 });
    expect(soilTileAt(-SOIL_TILE, -SOIL_TILE)).toEqual({ tx: -1, ty: -1 });
  });

  // What the placement preview relies on: the outline it draws is the tile
  // the purchase will land on, for EVERY point inside that tile -- not the
  // point the finger reported. A preview built from the raw point instead
  // would drift up to a full tile away from the bed it is previewing.
  it("gives one diamond for every point inside the same tile", () => {
    const corner = soilTileDiamond(3, -2);
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [SOIL_TILE - 1, SOIL_TILE - 1],
      [SOIL_TILE / 2, SOIL_TILE / 2],
    ]) {
      const { tx, ty } = soilTileAt(3 * SOIL_TILE + x, -2 * SOIL_TILE + y);
      expect(soilTileDiamond(tx, ty)).toEqual(corner);
    }
  });

  // The crispness property, stated where it can be checked: a tile's corners
  // are whole screen pixels, so the outline never straddles one. This holds
  // because SOIL_TILE is even -- isoProject halves (x + y), and an odd tile
  // size would put every other corner on a half pixel.
  it("puts a tile's corners on whole screen pixels", () => {
    expect(SOIL_TILE % 2).toBe(0);
    for (const [tx, ty] of [
      [0, 0],
      [3, -2],
      [-5, 7],
      [11, 11],
    ]) {
      for (const corner of Object.values(soilTileDiamond(tx, ty))) {
        expect(Number.isInteger(corner.x)).toBe(true);
        expect(Number.isInteger(corner.y)).toBe(true);
      }
    }
  });

  it("orders tiles by placement, not by Map insertion", () => {
    const soil = createSoilMap([
      { tx: 9, ty: 9, order: 2, origin: "purchased" },
      { tx: 0, ty: 0, order: 0, origin: "starter" },
      { tx: 5, ty: 5, order: 1, origin: "starter" },
    ]);
    expect(orderedSoilTiles(soil).map((t) => t.order)).toEqual([0, 1, 2]);
  });
});

/* ------------------------------------------------------------------ */
/* The starter kit                                                     */
/* ------------------------------------------------------------------ */

describe("the starter kit", () => {
  it("hands out exactly two tiles", () => {
    expect(starterSoilTiles(MEADOW)).toHaveLength(SOIL_STARTER_TILES);
    expect(SOIL_STARTER_TILES).toBe(2);
  });

  it("puts both of them wholly inside the Crop Fields", () => {
    for (const tile of starterSoilTiles(MEADOW)) {
      const r = soilTileRect(tile.tx, tile.ty);
      expect(r.x).toBeGreaterThanOrEqual(MEADOW.x);
      expect(r.y).toBeGreaterThanOrEqual(MEADOW.y);
      expect(r.x + r.width).toBeLessThanOrEqual(MEADOW.x + MEADOW.width);
      expect(r.y + r.height).toBeLessThanOrEqual(MEADOW.y + MEADOW.height);
    }
  });

  it("is deterministic, so nothing has to persist it for a reload to match", () => {
    expect(starterSoilTiles(MEADOW)).toEqual(starterSoilTiles(MEADOW));
  });

  it("gives them distinct coordinates and distinct orders", () => {
    const tiles = starterSoilTiles(MEADOW);
    expect(new Set(tiles.map((t) => soilTileKey(t.tx, t.ty))).size).toBe(tiles.length);
    expect(new Set(tiles.map((t) => t.order)).size).toBe(tiles.length);
    expect(tiles.every((t) => t.origin === "starter")).toBe(true);
  });

  it("returns only what fits rather than hanging a tile over the fence", () => {
    // An area narrower than one tile can hold none.
    expect(starterSoilTiles({ x: 0, y: 0, width: SOIL_TILE - 1, height: SOIL_TILE - 1 })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The slot lattice                                                    */
/* ------------------------------------------------------------------ */

describe("the slot lattice", () => {
  const tile = { tx: 4, ty: 9 };

  it("puts every slot inside its own tile", () => {
    const r = soilTileRect(tile.tx, tile.ty);
    for (let slot = 0; slot < SOIL_SLOTS_PER_TILE; slot += 1) {
      const p = soilSlotPoint(tile, slot);
      expect(p.x).toBeGreaterThan(r.x);
      expect(p.x).toBeLessThan(r.x + r.width);
      expect(p.y).toBeGreaterThan(r.y);
      expect(p.y).toBeLessThan(r.y + r.height);
    }
  });

  it("gives every slot its own point", () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < SOIL_SLOTS_PER_TILE; slot += 1) {
      const p = soilSlotPoint(tile, slot);
      seen.add(`${p.x},${p.y}`);
    }
    expect(seen.size).toBe(SOIL_SLOTS_PER_TILE);
    expect(SOIL_SLOTS_PER_TILE).toBe(SOIL_SLOT_COLS * SOIL_SLOT_ROWS);
  });

  it("spaces columns at exactly the column pitch", () => {
    const a = soilSlotPoint(tile, 0);
    const b = soilSlotPoint(tile, 1);
    expect(b.x - a.x).toBeCloseTo(SOIL_COL_PITCH, 10);
    expect(b.y).toBeCloseTo(a.y, 10);
  });

  it("centres the columns, so an uneven fit has equal margins", () => {
    const r = soilTileRect(tile.tx, tile.ty);
    const first = soilSlotPoint(tile, 0);
    const last = soilSlotPoint(tile, SOIL_SLOT_COLS - 1);
    expect(first.x - r.x).toBeCloseTo(r.x + r.width - last.x, 10);
  });

  it("packs plants closer together than a mature plant is wide", () => {
    // The whole point of the pitch: a ripe crop reads about 48 units across
    // (a 12-unit painter box at 4x, see ./crop-visuals.ts), so neighbours
    // overlap and the bed reads as dense rather than as spaced stickers.
    expect(SOIL_COL_PITCH).toBeLessThan(48);
  });

  it("fills the first tile before starting the second", () => {
    const soil = starterMap();
    const tiles = orderedSoilTiles(soil);
    const firstTileRect = soilTileRect(tiles[0].tx, tiles[0].ty);
    for (let rank = 0; rank < SOIL_SLOTS_PER_TILE; rank += 1) {
      const p = soilSlotSpotForRank(soil, rank);
      expect(p).not.toBeNull();
      expect(soilTileAt(p!.x, p!.y)).toEqual({ tx: tiles[0].tx, ty: tiles[0].ty });
    }
    const spill = soilSlotSpotForRank(soil, SOIL_SLOTS_PER_TILE)!;
    expect(soilTileAt(spill.x, spill.y)).toEqual({ tx: tiles[1].tx, ty: tiles[1].ty });
    expect(soilTileRect(tiles[1].tx, tiles[1].ty)).not.toEqual(firstTileRect);
  });

  it("has no soil to offer when none is placed", () => {
    expect(soilSlotSpotForRank(createSoilMap(), 0)).toBeNull();
    expect(soilCapacity(createSoilMap())).toBe(0);
  });

  it("wraps a rank past capacity instead of losing the plant", () => {
    const soil = starterMap();
    const capacity = soilCapacity(soil);
    expect(capacity).toBe(SOIL_STARTER_TILES * SOIL_SLOTS_PER_TILE);
    // Two plants sharing a slot is worse-looking than a bigger farm, and
    // strictly better than one that is invisible and untappable.
    expect(soilSlotSpotForRank(soil, capacity)).toEqual(soilSlotSpotForRank(soil, 0));
  });

  it("keeps every placed crop standing on placed soil", () => {
    const soil = starterMap();
    for (let rank = 0; rank < soilCapacity(soil); rank += 1) {
      const p = soilSlotSpotForRank(soil, rank)!;
      expect(onSoil(soil, p.x, p.y)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Buying a bed one square at a time                                   */
/* ------------------------------------------------------------------ */

describe("soilTileOwnedSlots", () => {
  it("reads a missing boughtSlots as the whole bed, the same default tier gets", () => {
    expect(soilTileOwnedSlots({ boughtSlots: undefined })).toBe(SOIL_SLOTS_PER_TILE);
    expect(soilTileOwnedSlots({ boughtSlots: 1 })).toBe(1);
    expect(soilTileOwnedSlots({ boughtSlots: 7 })).toBe(7);
  });
});

describe("addSoilSlot", () => {
  it("starts a brand new one-square bed on bare ground", () => {
    const soil = createSoilMap();
    const result = addSoilSlot(soil, { tx: 0, ty: 0 }, "dirt");
    expect(result.kind).toBe("created");
    expect(result.kind === "created" && result.tile.boughtSlots).toBe(1);
    expect(soilCapacity(soil)).toBe(1);
  });

  it("grows the same bed by one square per call, up to the full lattice", () => {
    const soil = createSoilMap();
    addSoilSlot(soil, { tx: 0, ty: 0 }, "dirt");
    for (let i = 2; i <= SOIL_SLOTS_PER_TILE; i += 1) {
      const result = addSoilSlot(soil, { tx: 0, ty: 0 }, "dirt");
      expect(result.kind).toBe("grown");
      expect(result.kind === "grown" && result.tile.boughtSlots).toBe(i);
    }
    expect(soilCapacity(soil)).toBe(SOIL_SLOTS_PER_TILE);
  });

  it("refuses once every square in a bed is owned", () => {
    const soil = createSoilMap();
    for (let i = 0; i < SOIL_SLOTS_PER_TILE; i += 1) addSoilSlot(soil, { tx: 0, ty: 0 }, "dirt");
    expect(addSoilSlot(soil, { tx: 0, ty: 0 }, "dirt")).toEqual({ kind: "full" });
  });

  it("refuses a tier that does not match the bed already standing there", () => {
    const soil = createSoilMap();
    addSoilSlot(soil, { tx: 0, ty: 0 }, "enriched");
    expect(addSoilSlot(soil, { tx: 0, ty: 0 }, "dirt")).toEqual({
      kind: "tier-mismatch",
      tier: "enriched",
    });
    // The mismatch never touched the bed -- still one owned square, still
    // its original tier.
    expect(soilTileTier(soilSlotTile(soil, 0)!)).toBe("enriched");
    expect(soilCapacity(soil)).toBe(1);
  });

  it("fills a partial bed's squares in reading order, matching soilSlotPoint", () => {
    const soil = createSoilMap();
    addSoilSlot(soil, { tx: 2, ty: 5 }, "dirt");
    addSoilSlot(soil, { tx: 2, ty: 5 }, "dirt");
    addSoilSlot(soil, { tx: 2, ty: 5 }, "dirt");
    // Three owned squares: slots 0, 1 and 2 all stand on this bed, slot 3
    // does not exist yet -- capacity is exactly 3, not SOIL_SLOTS_PER_TILE.
    expect(soilCapacity(soil)).toBe(3);
    for (const slot of [0, 1, 2]) {
      expect(soilSlotSpot(soil, slot)).toEqual(soilSlotPoint({ tx: 2, ty: 5 }, slot));
    }
  });

  it("a rank/slot walk crosses correctly from a partial first bed into a full second one", () => {
    const soil = createSoilMap();
    addSoilSlot(soil, { tx: 0, ty: 0 }, "dirt");
    addSoilSlot(soil, { tx: 0, ty: 0 }, "dirt");
    const full: SoilTile = { tx: 1, ty: 0, order: 1, origin: "purchased" };
    placeSoilTile(soil, full);

    expect(soilCapacity(soil)).toBe(2 + SOIL_SLOTS_PER_TILE);
    // Slots 0 and 1 are the two-square bed; slot 2 is the FIRST square of
    // the full bed, not its own slot 2 -- a uniform "divide by
    // SOIL_SLOTS_PER_TILE" would have misplaced this by landing it on the
    // partial bed's own (nonexistent) slot 2 instead.
    expect(soilSlotTile(soil, 0)).toMatchObject({ tx: 0, ty: 0 });
    expect(soilSlotTile(soil, 1)).toMatchObject({ tx: 0, ty: 0 });
    expect(soilSlotTile(soil, 2)).toMatchObject({ tx: 1, ty: 0 });
    expect(soilSlotSpot(soil, 2)).toEqual(soilSlotPoint({ tx: 1, ty: 0 }, 0));
  });
});

/* ------------------------------------------------------------------ */
/* The SDF                                                             */
/* ------------------------------------------------------------------ */

describe("the soil signed distance", () => {
  const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "starter" }]);

  it("is negative on a bed and positive off it", () => {
    expect(soilSignedDistance(soil, SOIL_TILE / 2, SOIL_TILE / 2)).toBeLessThan(0);
    expect(soilSignedDistance(soil, -10, SOIL_TILE / 2)).toBeGreaterThan(0);
  });

  it("is zero on the edge", () => {
    expect(soilSignedDistance(soil, 0, SOIL_TILE / 2)).toBe(0);
  });

  it("measures the true gap to the nearest edge", () => {
    expect(soilSignedDistance(soil, -10, SOIL_TILE / 2)).toBeCloseTo(10, 10);
  });

  it("is infinite when nothing is placed, so no grass is ever cut", () => {
    expect(soilSignedDistance(createSoilMap(), 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("sees a bed one coordinate away, which is what the 3x3 probe buys", () => {
    const far = createSoilMap([{ tx: 1, ty: 0, order: 0, origin: "starter" }]);
    // Standing just inside tile 0, looking at the bed in tile 1.
    const d = soilSignedDistance(far, SOIL_TILE - 5, SOIL_TILE / 2);
    expect(d).toBeCloseTo(5, 10);
    expect(d).toBeLessThan(SOIL_EDGE_BAND);
  });
});

/* ------------------------------------------------------------------ */
/* The grass exclusion -- the drift guard                              */
/* ------------------------------------------------------------------ */

/**
 * THE REGRESSION THIS FILE EXISTS FOR. `PEN_BLOCKS` in ./zones.ts was a
 * hand-copied restatement of `GROW_AREA` guarding `zoneScenery`, and
 * `meadowBaseDensity` never consulted it at all -- so waist-high meadow
 * grass grew straight through the Crop Fields and interleaved with the
 * plants, at full `isoDepthAt` depth, over ground that was supposed to be
 * bare tilled soil. Nothing failed when that happened. These tests are what
 * fails now.
 */
describe("grass yields to placed soil", () => {
  const soil = starterMap();
  const bed = orderedSoilTiles(soil)[0];
  const centre = {
    x: (bed.tx + 0.5) * SOIL_TILE,
    y: (bed.ty + 0.5) * SOIL_TILE,
  };

  it("grows normally on the Crop Fields when no soil is placed", () => {
    // The control. Without this the test below would pass on a function that
    // had simply stopped growing grass anywhere.
    const t = meadowTileAt(centre.x, centre.y);
    expect(meadowBaseDensity(t.tx, t.ty)).toBeGreaterThan(0);
  });

  it("registers zero density on every meadow tile inside a bed", () => {
    const r = soilTileRect(bed.tx, bed.ty);
    let checked = 0;
    for (let y = r.y + MEADOW_TILE / 2; y < r.y + r.height; y += MEADOW_TILE) {
      for (let x = r.x + MEADOW_TILE / 2; x < r.x + r.width; x += MEADOW_TILE) {
        const t = meadowTileAt(x, y);
        expect(meadowBaseDensity(t.tx, t.ty, soil), `grass on the bed at ${x},${y}`).toBe(0);
        checked += 1;
      }
    }
    // A loop that checked nothing would pass vacuously.
    expect(checked).toBeGreaterThan(0);
  });

  it("leaves a stubble collar just outside the bed rather than a hard edge", () => {
    const r = soilTileRect(bed.tx, bed.ty);
    // A step outside the western edge, well inside the collar.
    const t = meadowTileAt(r.x - MEADOW_TILE / 2, r.y + r.height / 2);
    expect(meadowBaseDensity(t.tx, t.ty, soil)).toBe(1);
  });

  it("lets the meadow grow full height beyond the collar", () => {
    const r = soilTileRect(bed.tx, bed.ty);
    const x = r.x - SOIL_EDGE_BAND - MEADOW_TILE * 2;
    const y = r.y + r.height / 2;
    const t = meadowTileAt(x, y);
    // Whatever the field's own grain says here, the collar is not capping it.
    expect(meadowBaseDensity(t.tx, t.ty, soil)).toBe(meadowBaseDensity(t.tx, t.ty));
  });

  it("caps regrowth on a collar tile at stubble, not at full height", () => {
    const r = soilTileRect(bed.tx, bed.ty);
    const t = meadowTileAt(r.x - MEADOW_TILE / 2, r.y + r.height / 2);
    // Mown long ago: regrowth is capped by the tile's own base density, and
    // in the collar that base is 1.
    expect(meadowDensityAt(t.tx, t.ty, 0, 1e12, soil)).toBe(1);
  });

  it("defaults to the old behaviour for every caller that has no soil map", () => {
    const t = meadowTileAt(centre.x, centre.y);
    expect(meadowBaseDensity(t.tx, t.ty)).toBe(meadowBaseDensity(t.tx, t.ty, createSoilMap()));
  });
});

/* ------------------------------------------------------------------ */
/* cropSpot: the crop/animal split                                     */
/* ------------------------------------------------------------------ */

describe("cropSpot", () => {
  const soil = starterMap();

  it("puts a crop on the lattice when it is given a placement", () => {
    const at = cropSpot("meadow", "unit-a", { soil, rank: 0 });
    expect(onSoil(soil, at.x, at.y)).toBe(true);
    expect(at).toEqual(soilSlotSpotForRank(soil, 0));
  });

  it("scatters when there is no placement -- a mucked animal's fallback", () => {
    const at = cropSpot("meadow", "unit-a");
    const area = growAreaBounds("meadow");
    expect(at.x).toBeGreaterThanOrEqual(area.x);
    expect(at.x).toBeLessThanOrEqual(area.x + area.width);
    // And it is not on the lattice, which is the point of the split.
    expect(at).not.toEqual(soilSlotSpotForRank(soil, 0));
  });

  it("scatters when a placement points at a farm with no soil", () => {
    const at = cropSpot("meadow", "unit-a", { soil: createSoilMap(), rank: 0 });
    expect(at).toEqual(cropSpot("meadow", "unit-a"));
  });

  it("is stable for the same unit and rank", () => {
    expect(cropSpot("meadow", "unit-a", { soil, rank: 3 })).toEqual(
      cropSpot("meadow", "unit-a", { soil, rank: 3 }),
    );
  });

  it("gives two crops in the same bed different slots", () => {
    const a = cropSpot("meadow", "unit-a", { soil, rank: 0 });
    const b = cropSpot("meadow", "unit-b", { soil, rank: 1 });
    expect(a).not.toEqual(b);
  });
});

describe("cropRanks", () => {
  const ids = ["u-1", "u-2", "u-3", "u-4", "u-5"];

  it("gives every crop its own rank, densely from zero", () => {
    const ranks = cropRanks(ids);
    expect([...ranks.values()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not depend on the order the rows arrived", () => {
    // The rule `wheatPlotSpot` states: a rank taken from list position would
    // slide every surviving plant the moment an earlier one was cashed.
    const forwards = cropRanks(ids);
    const backwards = cropRanks([...ids].reverse());
    for (const id of ids) expect(backwards.get(id)).toBe(forwards.get(id));
  });

  it("keeps the relative order of survivors when one is harvested", () => {
    const before = cropRanks(ids);
    const after = cropRanks(ids.filter((id) => id !== "u-3"));
    const survivors = ids.filter((id) => id !== "u-3");
    const byBefore = [...survivors].sort((a, b) => before.get(a)! - before.get(b)!);
    const byAfter = [...survivors].sort((a, b) => after.get(a)! - after.get(b)!);
    expect(byAfter).toEqual(byBefore);
  });

  it("agrees with the single-crop convenience form", () => {
    for (const id of ids) expect(cropRank(id, ids)).toBe(cropRanks(ids).get(id));
  });
});

/* ------------------------------------------------------------------ */
/* Worker hooks                                                        */
/* ------------------------------------------------------------------ */

describe("the farmhand's view of the field", () => {
  const soil = starterMap();
  const units: CropSource[] = [
    { id: "dry-far", stock: "carrot", state: "dry", progress: 0.5 },
    { id: "ripe-near", stock: "corn", state: "ready", progress: 1 },
    { id: "busy", stock: "carrot", state: "working", progress: 0.2 },
    { id: "dry-near", stock: "carrot", state: "dry", progress: 0.9 },
  ];
  const ranks = cropRanks(units.map((u) => u.id));
  const crops = buildCropInstances(
    units,
    (id) => cropSpot("meadow", id, { soil, rank: ranks.get(id)! }),
    growthStage,
    soil,
  );

  it("exposes flat state hooks rather than a state string to re-derive", () => {
    const dry = crops.find((c) => c.unitId === "dry-far")!;
    expect(dry.isDry).toBe(true);
    expect(dry.needsHarvest).toBe(false);
    const ripe = crops.find((c) => c.unitId === "ripe-near")!;
    expect(ripe.needsHarvest).toBe(true);
    expect(ripe.growthStage).toBe(2);
    expect(crops.find((c) => c.unitId === "busy")!.growthStage).toBe(0);
  });

  it("tells a crop which bed it is standing on", () => {
    for (const crop of crops) {
      expect(crop.tile).not.toBeNull();
      expect(hasSoilTile(soil, crop.tile!.tx, crop.tile!.ty)).toBe(true);
    }
  });

  it("reports null for a crop that fell back off the lattice", () => {
    const [loose] = buildCropInstances(
      [units[0]],
      () => ({ x: -9999, y: -9999 }),
      growthStage,
      soil,
    );
    expect(loose.tile).toBeNull();
  });

  it("finds the closest dry crop to a worker", () => {
    const dryCrops = crops.filter((c) => c.isDry);
    const from = dryCrops[0].at;
    expect(getClosestDryCrop(from, crops)!.unitId).toBe(dryCrops[0].unitId);
  });

  it("finds the closest harvestable crop and ignores the rest", () => {
    const found = getClosestHarvestableCrop({ x: 0, y: 0 }, crops);
    expect(found!.unitId).toBe("ripe-near");
  });

  it("returns null rather than throwing when there is nothing to do", () => {
    const nothing = crops.filter((c) => !c.isDry && !c.needsHarvest);
    expect(getClosestDryCrop({ x: 0, y: 0 }, nothing)).toBeNull();
    expect(getClosestHarvestableCrop({ x: 0, y: 0 }, nothing)).toBeNull();
  });

  it("breaks a distance tie deterministically, so a worker cannot oscillate", () => {
    const tied = crops.filter((c) => c.isDry).map((c) => ({ ...c, at: { x: 10, y: 10 } }));
    const first = getClosestDryCrop({ x: 0, y: 0 }, tied);
    const second = getClosestDryCrop({ x: 0, y: 0 }, [...tied].reverse());
    expect(first!.unitId).toBe(second!.unitId);
  });

  it("summarises what one bed is holding", () => {
    const bed = orderedSoilTiles(soil)[0];
    const state = soilTileState(bed, crops);
    expect(state.occupied).toBe(true);
    expect(state.crops.length).toBe(crops.filter((c) => c.tile?.tx === bed.tx && c.tile?.ty === bed.ty).length);
    expect(state.dryCount).toBe(state.crops.filter((c) => c.isDry).length);
    expect(state.harvestableCount).toBe(state.crops.filter((c) => c.needsHarvest).length);
  });

  it("reports an empty bed as unoccupied", () => {
    const empty = soilTileState({ tx: 99, ty: 99, order: 9, origin: "purchased" }, crops);
    expect(empty.occupied).toBe(false);
    expect(empty.crops).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The column count is a fencepost                                     */
/* ------------------------------------------------------------------ */

describe("columns fill the bed", () => {
  it("fits every column that actually fits, not one fewer", () => {
    // n columns span (n - 1) pitches. Dividing the usable width by the pitch
    // counts gaps, so the count is that plus one -- the fencepost this got
    // wrong once, which showed up as dead margin at both edges of every bed.
    const usable = SOIL_TILE - 5 * 2;
    expect((SOIL_SLOT_COLS - 1) * SOIL_COL_PITCH).toBeLessThanOrEqual(usable);
    expect(SOIL_SLOT_COLS * SOIL_COL_PITCH).toBeGreaterThan(usable);
  });

  it("still leaves every slot inside the bed after the extra column", () => {
    const r = soilTileRect(0, 0);
    for (let slot = 0; slot < SOIL_SLOTS_PER_TILE; slot += 1) {
      const p = soilSlotPoint({ tx: 0, ty: 0 }, slot);
      expect(p.x).toBeGreaterThan(r.x);
      expect(p.x).toBeLessThan(r.x + r.width);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Placing a purchased tile costs Gold, flat                          */
/* ------------------------------------------------------------------ */

describe("SOIL_TILE_PRICE_GOLD", () => {
  it("is a flat, positive price with no ladder", () => {
    expect(SOIL_TILE_PRICE_GOLD).toBeGreaterThan(0);
    expect(Number.isInteger(SOIL_TILE_PRICE_GOLD)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* soilTilesEqual: the client's skip-a-repaint check                  */
/* ------------------------------------------------------------------ */

describe("soilTilesEqual", () => {
  const a: SoilTile = { tx: 0, ty: 0, order: 0, origin: "purchased" };
  const b: SoilTile = { tx: 1, ty: 2, order: 1, origin: "purchased" };

  it("is true for two empty lists", () => {
    expect(soilTilesEqual([], [])).toBe(true);
  });

  it("is true for the same tiles in a different order", () => {
    expect(soilTilesEqual([a, b], [b, a])).toBe(true);
  });

  it("is false when a tile's coordinate differs", () => {
    const moved: SoilTile = { ...b, tx: 99 };
    expect(soilTilesEqual([a, b], [a, moved])).toBe(false);
  });

  it("is false when a tile's order differs", () => {
    const reordered: SoilTile = { ...b, order: 5 };
    expect(soilTilesEqual([a, b], [a, reordered])).toBe(false);
  });

  it("is false when a tile's origin differs", () => {
    const starter: SoilTile = { ...b, origin: "starter" };
    expect(soilTilesEqual([a, b], [a, starter])).toBe(false);
  });

  it("is false when the lengths differ", () => {
    expect(soilTilesEqual([a], [a, b])).toBe(false);
  });

  /* -------------------------------------------------------------- */
  /* Tiers and the fixed slot                                        */
  /* -------------------------------------------------------------- */

  it("reads a missing tier as the plain bed", () => {
    expect(soilTileTier({ tier: undefined })).toBe("dirt");
    expect(soilTileTier({ tier: "enriched" })).toBe("enriched");
  });

  it("hands out the lowest free slot, and null once the soil is full", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    const capacity = soilCapacity(soil);

    expect(nextFreeSoilSlot(soil, [])).toBe(0);
    // Lowest, not next-after-the-highest: a harvested crop frees its slot and
    // the next sowing should reuse it rather than drifting off the end.
    expect(nextFreeSoilSlot(soil, [0, 1, 3])).toBe(2);
    expect(nextFreeSoilSlot(soil, Array.from({ length: capacity }, (_, i) => i))).toBeNull();
    // No soil at all is full, not slot zero.
    expect(nextFreeSoilSlot(createSoilMap([]), [])).toBeNull();
  });

  // An out-of-range stored slot must block the cell it is actually DRAWN in,
  // or two crops silently stack there.
  it("normalises an out-of-range taken slot before blocking", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    const capacity = soilCapacity(soil);
    expect(nextFreeSoilSlot(soil, [capacity])).toBe(1);
  });

  it("puts a fixed slot on the tile that owns it, and wraps past capacity", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased", tier: "enriched" },
    ]);
    // Slot 0 is on the first bed; the first slot of the second bed is
    // SOIL_SLOTS_PER_TILE along, and carries that bed's own tier.
    expect(soilSlotTile(soil, 0)).toMatchObject({ tx: 0, ty: 0 });
    expect(soilSlotTile(soil, SOIL_SLOTS_PER_TILE)).toMatchObject({ tx: 1, ty: 0 });
    expect(soilTileTier(soilSlotTile(soil, SOIL_SLOTS_PER_TILE)!)).toBe("enriched");

    // Wrapping, so selling ground never makes a crop invisible.
    const capacity = soilCapacity(soil);
    expect(soilSlotSpot(soil, capacity)).toEqual(soilSlotSpot(soil, 0));
    expect(soilSlotSpot(createSoilMap([]), 0)).toBeNull();
  });

  // The server assigns a slot index and the client draws it; they only agree
  // while both flatten the tiles the same way, which is why the merge has one
  // owner.
  it("puts the starter beds ahead of purchased ones in the merged space", () => {
    const area = growAreaBounds("meadow");
    const bought = { tx: 40, ty: 40, order: 0, origin: "purchased" as const };
    const merged = mergeSoilTiles(area, [bought]);
    expect(merged).toHaveLength(SOIL_STARTER_TILES + 1);
    expect(merged.slice(0, SOIL_STARTER_TILES)).toEqual(starterSoilTiles(area));
    expect(merged[merged.length - 1]).toEqual(bought);
  });
});

describe("the Crop Fields can actually hold bought beds", () => {
  // THE BUG THIS EXISTS FOR. A bed is only placeable where it fits ENTIRELY
  // inside the grow area, so the field's origin AND its size both have to be
  // whole multiples of SOIL_TILE. At 160x160 starting at 220 (2.5 beds across,
  // off-lattice) exactly two cells qualified -- and `starterSoilTiles` hands
  // out two, so there was nowhere on the whole farm to buy a bed and the
  // "Till a Bed" button never appeared. Any future move of this district has
  // to keep both properties.
  it("is aligned to the bed lattice and a whole number of beds across", () => {
    // `Math.abs` because the field sits at a negative origin since the
    // 2026-09-07 map re-lay, and `-128 % 64` is -0 in JavaScript, which
    // `toBe(0)` rejects under Object.is. The property being asserted is
    // divisibility, which -0 satisfies perfectly well.
    expect(Math.abs(MEADOW.x % SOIL_TILE)).toBe(0);
    expect(Math.abs(MEADOW.y % SOIL_TILE)).toBe(0);
    expect(Math.abs(MEADOW.width % SOIL_TILE)).toBe(0);
    expect(Math.abs(MEADOW.height % SOIL_TILE)).toBe(0);
  });

  it("leaves cells to buy after the starter beds take theirs", () => {
    const placeable: string[] = [];
    const acrossX = MEADOW.width / SOIL_TILE;
    const acrossY = MEADOW.height / SOIL_TILE;
    const origin = soilTileAt(MEADOW.x, MEADOW.y);
    for (let dx = 0; dx < acrossX; dx += 1) {
      for (let dy = 0; dy < acrossY; dy += 1) {
        const r = soilTileRect(origin.tx + dx, origin.ty + dy);
        // The exact containment test placeStackAcresSoilTile applies.
        const fits =
          r.x >= MEADOW.x &&
          r.y >= MEADOW.y &&
          r.x + r.width <= MEADOW.x + MEADOW.width &&
          r.y + r.height <= MEADOW.y + MEADOW.height;
        if (fits) placeable.push(soilTileKey(origin.tx + dx, origin.ty + dy));
      }
    }
    expect(placeable).toHaveLength(acrossX * acrossY);

    const taken = new Set(starterSoilTiles(MEADOW).map((t) => soilTileKey(t.tx, t.ty)));
    const buyable = placeable.filter((key) => !taken.has(key));
    expect(buyable.length).toBeGreaterThan(0);
    // Every starter bed must itself sit on a placeable cell, or the free beds
    // are drawn somewhere a bought one could never go.
    for (const key of taken) expect(placeable).toContain(key);
  });
});

