import { describe, expect, it } from "vitest";

import { growthStage, cropRank, cropRanks, cropSpot, CROP_FIELD_BEDS, STACKACRES_TILE } from "./world";
import {
  MEADOW_TILE,
  meadowBaseDensity,
  meadowDensityAt,
  meadowTileAt,
} from "./zones";
import {
  SOIL_EDGE_BAND,
  SOIL_TILE,
  SOIL_TILE_PRICE_GOLD,
  buildCropInstances,
  createSoilMap,
  getClosestDryCrop,
  getClosestHarvestableCrop,
  hasSoilTile,
  nextSoilOrder,
  onSoil,
  orderedSoilTiles,
  placeSoilTile,
  plantSoilTile,
  removeSoilTile,
  soilCapacity,
  soilSignedDistance,
  soilSlotForTile,
  soilSlotPoint,
  soilSlotSpotForRank,
  soilSlotSpot,
  soilTileAt,
  soilTileDiamond,
  soilTileKey,
  soilTileRect,
  soilTileTier,
  nextFreeSoilSlot,
  soilSlotTile,
  soilTileState,
  soilTilesEqual,
  type CropSource,
  type SoilMap,
  type SoilTile,
} from "./soil";

const MEADOW = CROP_FIELD_BEDS;

/**
 * A populated soil map for tests that just need "a farm with beds already
 * standing" and do not care where. `starterSoilTiles` used to be the obvious
 * source for that shape; it granted free tiles and was removed along with
 * the feature (see ./soil.ts's "starter kit" section). A plain row of beds
 * across the field serves every test below exactly as well -- none of them
 * are asserting anything about WHICH cells a bed lands on, only that a bed
 * is there.
 */
const FIXTURE_BED_COUNT = 24;
function fixtureMap(count = FIXTURE_BED_COUNT): SoilMap {
  const origin = soilTileAt(MEADOW.x, MEADOW.y);
  const tiles: SoilTile[] = Array.from({ length: count }, (_, i) => ({
    tx: origin.tx + i,
    ty: origin.ty,
    order: i,
    origin: "purchased" as const,
  }));
  return createSoilMap(tiles);
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
  it("a soil tile is one art unit", () => {
    expect(SOIL_TILE).toBe(STACKACRES_TILE);
  });

  it("the stubble collar is three quarters of a soil tile", () => {
    expect(SOIL_EDGE_BAND).toBe(SOIL_TILE * 0.75);
  });

  it("reaches the nearest off-bed meadow tile's own centre", () => {
    // Meadow tiles are SOIL_TILE wide too, so the nearest one off a bed has
    // its centre exactly SOIL_TILE/2 from the bed's edge -- the band has to
    // clear that or the collar can never fire. See SOIL_EDGE_BAND's header.
    expect(SOIL_EDGE_BAND).toBeGreaterThan(SOIL_TILE / 2);
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
/* The starter kit is gone -- see ./soil.ts's own "starter kit" section --   */
/* so there is no describe block here for it any more.                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* The slot lattice                                                    */
/* ------------------------------------------------------------------ */

describe("the slot lattice -- one plant per bed", () => {
  const tile = { tx: 4, ty: 9 };

  it("puts a bed's one slot dead centre of its own tile", () => {
    const r = soilTileRect(tile.tx, tile.ty);
    const p = soilSlotPoint(tile);
    expect(p.x).toBeCloseTo(r.x + r.width / 2, 10);
    expect(p.y).toBeCloseTo(r.y + r.height / 2, 10);
  });

  it("fills beds in placement order, one plant each", () => {
    const soil = fixtureMap();
    const tiles = orderedSoilTiles(soil);
    for (let rank = 0; rank < tiles.length; rank += 1) {
      const p = soilSlotSpotForRank(soil, rank);
      expect(p).not.toBeNull();
      expect(soilTileAt(p!.x, p!.y)).toEqual({ tx: tiles[rank].tx, ty: tiles[rank].ty });
    }
    // A rank past the bed count has nowhere new to go -- it wraps back to
    // the first bed rather than spilling past the last one.
    expect(soilSlotSpotForRank(soil, tiles.length)).toEqual(soilSlotSpotForRank(soil, 0));
  });

  it("has no soil to offer when none is placed", () => {
    expect(soilSlotSpotForRank(createSoilMap(), 0)).toBeNull();
    expect(soilCapacity(createSoilMap())).toBe(0);
  });

  it("capacity is exactly the bed count -- one plant per bed", () => {
    const soil = fixtureMap();
    expect(soilCapacity(soil)).toBe(FIXTURE_BED_COUNT);
  });

  it("wraps a rank past capacity instead of losing the plant", () => {
    const soil = fixtureMap();
    const capacity = soilCapacity(soil);
    // Two plants sharing a slot is worse-looking than a bigger farm, and
    // strictly better than one that is invisible and untappable.
    expect(soilSlotSpotForRank(soil, capacity)).toEqual(soilSlotSpotForRank(soil, 0));
  });

  it("keeps every placed crop standing on placed soil", () => {
    const soil = fixtureMap();
    for (let rank = 0; rank < soilCapacity(soil); rank += 1) {
      const p = soilSlotSpotForRank(soil, rank)!;
      expect(onSoil(soil, p.x, p.y)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Buying a bed -- one tile, one plant                                 */
/* ------------------------------------------------------------------ */

describe("plantSoilTile", () => {
  it("plants a brand new bed on bare ground", () => {
    const soil = createSoilMap();
    const result = plantSoilTile(soil, { tx: 0, ty: 0 }, "dirt");
    expect(result.kind).toBe("created");
    expect(result.kind === "created" && result.tile.tier).toBe("dirt");
    expect(soilCapacity(soil)).toBe(1);
  });

  it("refuses a second bed on an occupied coordinate, tier-blind", () => {
    const soil = createSoilMap();
    plantSoilTile(soil, { tx: 0, ty: 0 }, "enriched");
    expect(plantSoilTile(soil, { tx: 0, ty: 0 }, "dirt")).toEqual({ kind: "occupied" });
    // The refusal never touched the bed standing there.
    expect(soilTileTier(soilSlotTile(soil, 0)!)).toBe("enriched");
    expect(soilCapacity(soil)).toBe(1);
  });

  it("hands out orders in placement sequence across multiple beds", () => {
    const soil = createSoilMap();
    plantSoilTile(soil, { tx: 0, ty: 0 }, "dirt");
    plantSoilTile(soil, { tx: 1, ty: 0 }, "dirt");
    expect(soilSlotTile(soil, 0)).toMatchObject({ tx: 0, ty: 0, order: 0 });
    expect(soilSlotTile(soil, 1)).toMatchObject({ tx: 1, ty: 0, order: 1 });
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
  // ONE ISOLATED TILE, not `fixtureMap()`'s row of 24 -- with a bed now the
  // same size as a meadow tile, a run of adjacent beds leaves little to no
  // bare ground immediately next to any one of them, so a "just outside the
  // bed" probe would as often land on a NEIGHBOURING bed as on open ground.
  // A single tile at the field's own centre keeps every test below
  // meaningful.
  const centreTile = soilTileAt(
    CROP_FIELD_BEDS.x + CROP_FIELD_BEDS.width / 2,
    CROP_FIELD_BEDS.y + CROP_FIELD_BEDS.height / 2,
  );
  const soil = createSoilMap([{ ...centreTile, order: 0, origin: "starter" }]);
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
  const soil = fixtureMap();

  it("puts a crop on the lattice when it is given a placement", () => {
    const at = cropSpot("farmstead", "unit-a", { soil, rank: 0 });
    expect(onSoil(soil, at.x, at.y)).toBe(true);
    expect(at).toEqual(soilSlotSpotForRank(soil, 0));
  });

  it("scatters when there is no placement -- a mucked animal's fallback", () => {
    const at = cropSpot("farmstead", "unit-a");
    const area = CROP_FIELD_BEDS;
    expect(at.x).toBeGreaterThanOrEqual(area.x);
    expect(at.x).toBeLessThanOrEqual(area.x + area.width);
    // And it is not on the lattice, which is the point of the split.
    expect(at).not.toEqual(soilSlotSpotForRank(soil, 0));
  });

  it("scatters when a placement points at a farm with no soil", () => {
    const at = cropSpot("farmstead", "unit-a", { soil: createSoilMap(), rank: 0 });
    expect(at).toEqual(cropSpot("farmstead", "unit-a"));
  });

  it("is stable for the same unit and rank", () => {
    expect(cropSpot("farmstead", "unit-a", { soil, rank: 3 })).toEqual(
      cropSpot("farmstead", "unit-a", { soil, rank: 3 }),
    );
  });

  it("gives two crops in the same bed different slots", () => {
    const a = cropSpot("farmstead", "unit-a", { soil, rank: 0 });
    const b = cropSpot("farmstead", "unit-b", { soil, rank: 1 });
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
  const soil = fixtureMap();
  const units: CropSource[] = [
    { id: "dry-far", stock: "carrot", state: "dry", progress: 0.5 },
    { id: "ripe-near", stock: "corn", state: "ready", progress: 1 },
    { id: "busy", stock: "carrot", state: "working", progress: 0.2 },
    { id: "dry-near", stock: "carrot", state: "dry", progress: 0.9 },
  ];
  const ranks = cropRanks(units.map((u) => u.id));
  const crops = buildCropInstances(
    units,
    (id) => cropSpot("farmstead", id, { soil, rank: ranks.get(id)! }),
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
    // Four beds, one plant each -- one slot per bed is the whole point now.
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
      { tx: 2, ty: 0, order: 2, origin: "purchased" },
      { tx: 3, ty: 0, order: 3, origin: "purchased" },
    ]);
    const capacity = soilCapacity(soil);
    expect(capacity).toBe(4);

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
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
    ]);
    const capacity = soilCapacity(soil);
    expect(nextFreeSoilSlot(soil, [capacity])).toBe(1);
  });

  it("puts a fixed slot on the tile that owns it, and wraps past capacity", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased", tier: "enriched" },
    ]);
    // Slot 0 is the first bed; slot 1 is the second, and carries that bed's
    // own tier -- one plant per bed, so the next bed is always one slot on.
    expect(soilSlotTile(soil, 0)).toMatchObject({ tx: 0, ty: 0 });
    expect(soilSlotTile(soil, 1)).toMatchObject({ tx: 1, ty: 0 });
    expect(soilTileTier(soilSlotTile(soil, 1)!)).toBe("enriched");

    // Wrapping, so selling ground never makes a crop invisible.
    const capacity = soilCapacity(soil);
    expect(soilSlotSpot(soil, capacity)).toEqual(soilSlotSpot(soil, 0));
    expect(soilSlotSpot(createSoilMap([]), 0)).toBeNull();
  });

  // The inverse of soilSlotTile -- what a sow that names the tile the player
  // actually tapped checks its slot against.
  it("finds the slot a specific tile holds, or null off the lattice", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
    ]);
    expect(soilSlotForTile(soil, 0, 0)).toBe(0);
    expect(soilSlotForTile(soil, 1, 0)).toBe(1);
    expect(soilSlotForTile(soil, 9, 9)).toBeNull();
    expect(soilSlotForTile(createSoilMap(), 0, 0)).toBeNull();
  });
});

describe("the Crop Fields can actually hold bought beds", () => {
  // THE BUG THIS EXISTS FOR. A bed is only placeable where it fits ENTIRELY
  // inside the grow area, so the field's origin AND its size both have to be
  // whole multiples of SOIL_TILE. At 160x160 starting at 220 (2.5 beds across,
  // off-lattice) not one cell qualified, so there was nowhere on the whole
  // farm to buy a bed and the "Till a Bed" button never appeared. Any future
  // move of this district has to keep both properties.
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

  it("has a cell to buy for every tile of the field, with none hanging over the fence", () => {
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
  });
});

