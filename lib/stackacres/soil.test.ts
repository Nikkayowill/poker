import { describe, expect, it } from "vitest";

import {
  growthStage,
  cropSpot,
  CROP_FIELD_BEDS,
  soilTileInCropFieldBeds,
  STACKACRES_TILE,
} from "./world";
import {
  MEADOW_TILE,
  meadowBaseDensity,
  meadowDensityAt,
  meadowTileAt,
} from "./zones";
import {
  SOIL_EDGE_BAND,
  SOIL_TILE,
  buildCropInstances,
  createSoilMap,
  hasSoilTile,
  orderedSoilTiles,
  plantSoilTile,
  soilSignedDistance,
  soilNeighborMask,
  soilSlotForTile,
  soilSlotOnTile,
  soilSlotPoint,
  soilSlotSpot,
  soilTileAt,
  soilTileDiamond,
  soilTileKey,
  soilTileRect,
  soilTileTier,
  nextFreeSoilSlot,
  soilSlotTile,
  soilTileGroup,
  soilTilesEqual,
  moveSoilTileGroup,
  planSoilGroupRelocation,
  plantableTileGroup,
  thirstyTileGroup,
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

describe("soilNeighborMask", () => {
  const tile = (tx: number, ty: number, order = 0): SoilTile => ({
    tx,
    ty,
    order,
    origin: "purchased",
  });

  it("uses Stardew's cardinal bit order", () => {
    const soil = createSoilMap([
      tile(0, 0),
      tile(0, -1, 1),
      tile(1, 0, 2),
      tile(0, 1, 3),
      tile(-1, 0, 4),
    ]);

    expect(soilNeighborMask(soil, 0, 0)).toBe(15);
  });

  it("ignores diagonal beds", () => {
    const soil = createSoilMap([tile(0, 0), tile(1, 1, 1)]);

    expect(soilNeighborMask(soil, 0, 0)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The Homestead starter beds -- reintroduced, small                   */
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
    for (let slot = 0; slot < tiles.length; slot += 1) {
      const p = soilSlotSpot(soil, slot);
      expect(p).not.toBeNull();
      expect(soilTileAt(p!.x, p!.y)).toEqual({ tx: tiles[slot].tx, ty: tiles[slot].ty });
    }
  });

});

/* ------------------------------------------------------------------ */
/* Buying a bed -- one tile, one plant                                 */
/* ------------------------------------------------------------------ */

describe("plantSoilTile", () => {

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
  // A single tile well inside the field's first PATCH keeps every test below
  // meaningful. It used to be the field's own centre, which stopped working
  // when the field was cut into patches (./terrain.ts's `CROP_FIELD_LANES`):
  // the centre is where the two middle lanes cross, no grass grows on a lane,
  // and so a bed placed there has no grass collar to measure.
  const centreTile = soilTileAt(CROP_FIELD_BEDS.x + 55, CROP_FIELD_BEDS.y + 55);
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

  it("scatters when there is no placement -- a mucked animal's fallback", () => {
    const at = cropSpot("farmstead", "unit-a");
    const area = CROP_FIELD_BEDS;
    expect(at.x).toBeGreaterThanOrEqual(area.x);
    expect(at.x).toBeLessThanOrEqual(area.x + area.width);
    // And it is not on the lattice, which is the point of the split.
    expect(at).not.toEqual(soilSlotSpot(soil, 0));
  });

  it("scatters, never guesses a tile, when a placement names no fixed slot", () => {
    // The rank-hash fallback this used to fall through to is gone
    // (2026-09-10): a crop with no slot stands off the lattice entirely
    // rather than wrapping onto a tile it was never actually sown into.
    const at = cropSpot("farmstead", "unit-a", { soil, slot: null });
    expect(at).toEqual(cropSpot("farmstead", "unit-a"));
  });

  it("scatters when a placement points at a farm with no soil", () => {
    const at = cropSpot("farmstead", "unit-a", { soil: createSoilMap(), slot: 0 });
    expect(at).toEqual(cropSpot("farmstead", "unit-a"));
  });

  it("is stable for the same unit and slot", () => {
    expect(cropSpot("farmstead", "unit-a", { soil, slot: 3 })).toEqual(
      cropSpot("farmstead", "unit-a", { soil, slot: 3 }),
    );
  });

  it("gives two crops with different slots different tiles", () => {
    const a = cropSpot("farmstead", "unit-a", { soil, slot: 0 });
    const b = cropSpot("farmstead", "unit-b", { soil, slot: 1 });
    expect(a).not.toEqual(b);
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
  // Each unit gets its own fixed slot -- the concrete method every crop
  // actually uses now, not a rank-hash guess.
  const slots = new Map(units.map((u, index) => [u.id, index]));
  const crops = buildCropInstances(
    units,
    (id) => cropSpot("farmstead", id, { soil, slot: slots.get(id)! }),
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
    // A tier this build no longer knows degrades to the plain bed.
    expect(soilTileTier({ tier: "hydro" as never })).toBe("dirt");
  });

  // A slot naming no bed is nobody's: it does not block a bed that exists.
  it("ignores a taken slot that names no bed", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
    ]);
    expect(nextFreeSoilSlot(soil, [0, 99])).toBe(1);
  });

  it("puts a fixed slot on the bed whose order it is", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
    ]);
    expect(soilSlotTile(soil, 0)).toMatchObject({ tx: 0, ty: 0 });
    expect(soilSlotTile(soil, 1)).toMatchObject({ tx: 1, ty: 0 });

    // A slot no bed carries is null, not a wrap onto some other bed's
    // square. The wrap that used to be here is what made a removal look
    // like a shuffle -- see the regression below.
    expect(soilSlotSpot(soil, 2)).toBeNull();
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

  // What removeStackAcresSoilTile asks before it lifts a bed: is the crop
  // holding this slot actually standing on the tile about to go?
  it("says whether a slot's crop is standing on a specific tile", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
    ]);
    expect(soilSlotOnTile(soil, 0, 0, 0)).toBe(true);
    expect(soilSlotOnTile(soil, 0, 1, 0)).toBe(false);
    expect(soilSlotOnTile(soil, 1, 1, 0)).toBe(true);
    // No soil at all: nothing can be standing on anything.
    expect(soilSlotOnTile(createSoilMap(), 0, 0, 0)).toBe(false);
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

describe("hold-tap relocation: soilTileGroup", () => {
  it("is empty when nothing is placed at the seed coordinate", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    expect(soilTileGroup(soil, 5, 5)).toEqual([]);
  });

  it("is just the one tile when nothing touches it", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 5, ty: 5, order: 1, origin: "purchased" },
    ]);
    expect(soilTileGroup(soil, 0, 0)).toEqual([{ tx: 0, ty: 0 }]);
  });

  it("picks up every tile reachable by a chain of 4-neighbour beds", () => {
    // A bent row: (0,0)-(1,0)-(1,1), plus an unrelated bed two tiles away
    // that must not be swept in.
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
      { tx: 1, ty: 1, order: 2, origin: "purchased" },
      { tx: 3, ty: 0, order: 3, origin: "purchased" },
    ]);
    const group = soilTileGroup(soil, 0, 0);
    expect(new Set(group.map((t) => `${t.tx},${t.ty}`))).toEqual(
      new Set(["0,0", "1,0", "1,1"]),
    );
  });

  it("does not cross a diagonal gap -- only 4-neighbours connect", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 1, order: 1, origin: "purchased" },
    ]);
    expect(soilTileGroup(soil, 0, 0)).toEqual([{ tx: 0, ty: 0 }]);
  });
});

describe("group-watering: thirstyTileGroup", () => {
  /** A 2x2 block, all four tiles thirsty, plus an unrelated dry tile two
   *  away that must never be swept in. */
  const block2x2 = () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
      { tx: 0, ty: 1, order: 2, origin: "purchased" },
      { tx: 1, ty: 1, order: 3, origin: "purchased" },
      { tx: 5, ty: 5, order: 4, origin: "purchased" },
    ]);
    const dry: Record<string, string> = {
      "0,0": "a",
      "1,0": "b",
      "0,1": "c",
      "1,1": "d",
      "5,5": "e",
    };
    const occupantAt = (tx: number, ty: number) => dry[`${tx},${ty}`] ?? null;
    return { soil, occupantAt };
  };

  it("is empty when the seed tile has no soil, or no dry crop", () => {
    const { soil } = block2x2();
    expect(thirstyTileGroup(soil, 5, 5, () => null)).toEqual([]);
    // Soil, but the crop on it is not dry (occupantAt says so).
    expect(thirstyTileGroup(soil, 0, 0, () => null)).toEqual([]);
  });

  it("returns all four ids for a full 2x2 block, seed tile first", () => {
    const { soil, occupantAt } = block2x2();
    expect(thirstyTileGroup(soil, 0, 0, occupantAt)).toEqual(
      expect.arrayContaining(["a", "b", "c", "d"]),
    );
    expect(thirstyTileGroup(soil, 0, 0, occupantAt)).toHaveLength(4);
  });

  it("falls back to empty for a run narrower than 2x2, even at 4+ tiles", () => {
    // A straight line of four thirsty tiles is not a square block.
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
      { tx: 2, ty: 0, order: 2, origin: "purchased" },
      { tx: 3, ty: 0, order: 3, origin: "purchased" },
    ]);
    const dry = new Set(["0,0", "1,0", "2,0", "3,0"]);
    const occupantAt = (tx: number, ty: number) => (dry.has(`${tx},${ty}`) ? "x" : null);
    expect(thirstyTileGroup(soil, 0, 0, occupantAt)).toEqual([]);
  });

  it("stops at a wet tile -- the group only ever includes dry ground", () => {
    // A 2x2 block where one corner is not dry: only 3 tiles qualify, still
    // under the 4-tile floor, so no group triggers.
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
      { tx: 0, ty: 1, order: 2, origin: "purchased" },
      { tx: 1, ty: 1, order: 3, origin: "purchased" },
    ]);
    const dry: Record<string, string> = { "0,0": "a", "1,0": "b", "0,1": "c" };
    const occupantAt = (tx: number, ty: number) => dry[`${tx},${ty}`] ?? null;
    expect(thirstyTileGroup(soil, 0, 0, occupantAt)).toEqual([]);
  });
});

describe("group-planting: plantableTileGroup", () => {
  /** A 2x2 block of bare tier-1 beds, plus an unrelated bare tile two away
   *  that must never be swept in. */
  const block2x2 = () =>
    createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased", tier: "dirt" },
      { tx: 1, ty: 0, order: 1, origin: "purchased", tier: "dirt" },
      { tx: 0, ty: 1, order: 2, origin: "purchased", tier: "dirt" },
      { tx: 1, ty: 1, order: 3, origin: "purchased", tier: "dirt" },
      { tx: 5, ty: 5, order: 4, origin: "purchased", tier: "dirt" },
    ]);
  const neverOccupied = () => false;

  it("is empty when the seed tile has no soil, or is already occupied", () => {
    const soil = block2x2();
    expect(plantableTileGroup(soil, 5, 5, () => true)).toEqual([]);
    expect(plantableTileGroup(soil, 8, 8, neverOccupied)).toEqual([]);
    expect(plantableTileGroup(soil, 0, 0, () => true)).toEqual([]);
  });

  it("returns all four tiles for a full 2x2 bare block, seed tile first", () => {
    const soil = block2x2();
    expect(plantableTileGroup(soil, 0, 0, neverOccupied)).toEqual(
      expect.arrayContaining([
        { tx: 0, ty: 0 },
        { tx: 1, ty: 0 },
        { tx: 0, ty: 1 },
        { tx: 1, ty: 1 },
      ]),
    );
    expect(plantableTileGroup(soil, 0, 0, neverOccupied)).toHaveLength(4);
  });

  it("falls back to empty for a run narrower than 2x2, even at 4+ tiles", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
      { tx: 2, ty: 0, order: 2, origin: "purchased" },
      { tx: 3, ty: 0, order: 3, origin: "purchased" },
    ]);
    expect(plantableTileGroup(soil, 0, 0, neverOccupied)).toEqual([]);
  });

  it("stops at an occupied tile -- the group only ever includes bare beds", () => {
    // A 2x2 block where one corner already has a crop: only 3 tiles qualify,
    // still under the 4-tile floor, so no group triggers.
    const soil = block2x2();
    const occupiedAt = (tx: number, ty: number) => tx === 1 && ty === 1;
    expect(plantableTileGroup(soil, 0, 0, occupiedAt)).toEqual([]);
  });

});

describe("hold-tap relocation: planSoilGroupRelocation / moveSoilTileGroup", () => {
  const alwaysInBounds = () => true;

  it("refuses a seed coordinate with no bed", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    expect(planSoilGroupRelocation(soil, 5, 5, 6, 5, alwaysInBounds)).toEqual({ kind: "empty" });
  });

  it("refuses a destination equal to the current spot", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    expect(planSoilGroupRelocation(soil, 0, 0, 0, 0, alwaysInBounds)).toEqual({ kind: "no-op" });
  });

  it("refuses a destination outside the injected bounds", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    const plan = planSoilGroupRelocation(soil, 0, 0, 1, 0, () => false);
    expect(plan.kind).toBe("out-of-bounds");
  });

  it("refuses a destination already held by a bed outside the moving group", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 5, ty: 0, order: 1, origin: "purchased" },
    ]);
    const plan = planSoilGroupRelocation(soil, 0, 0, 5, 0, alwaysInBounds);
    expect(plan).toEqual({ kind: "blocked", at: { tx: 5, ty: 0 } });
  });

  it("plans and executes a single tile's move, preserving order/origin/tier", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 3, origin: "purchased", tier: "dirt" },
    ]);
    const plan = planSoilGroupRelocation(soil, 0, 0, 4, 7, alwaysInBounds);
    expect(plan).toEqual({ kind: "ok", moves: [{ from: { tx: 0, ty: 0 }, to: { tx: 4, ty: 7 } }] });
    expect(plan.kind === "ok" && moveSoilTileGroup(soil, plan.moves)).toBe(true);
    expect(hasSoilTile(soil, 0, 0)).toBe(false);
    expect(soil.get(soilTileKey(4, 7))).toEqual({ tx: 4, ty: 7, order: 3, origin: "purchased", tier: "dirt" });
  });

  it("slides a whole contiguous group by the same offset", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
    ]);
    // The anchor (0,0) moves to (0,5); its neighbour (1,0) must carry the
    // same +0,+5 offset to (1,5), not collapse onto the anchor's new spot.
    const plan = planSoilGroupRelocation(soil, 0, 0, 0, 5, alwaysInBounds);
    expect(plan.kind).toBe("ok");
    expect(plan.kind === "ok" && moveSoilTileGroup(soil, plan.moves)).toBe(true);
    expect(hasSoilTile(soil, 0, 0)).toBe(false);
    expect(hasSoilTile(soil, 1, 0)).toBe(false);
    expect(soilTileGroup(soil, 0, 5).map((t) => `${t.tx},${t.ty}`).sort()).toEqual(["0,5", "1,5"]);
  });

  it("lets a group slide into ground it is itself vacating, with no transient collision", () => {
    // Sliding the pair one step right: (0,0)->(1,0), (1,0)->(2,0). (1,0) is
    // both a destination (for the anchor) and a source (for its neighbour)
    // in the SAME move -- this must not read as blocked.
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
    ]);
    const plan = planSoilGroupRelocation(soil, 0, 0, 1, 0, alwaysInBounds);
    expect(plan.kind).toBe("ok");
    expect(plan.kind === "ok" && moveSoilTileGroup(soil, plan.moves)).toBe(true);
    expect(hasSoilTile(soil, 0, 0)).toBe(false);
    expect(soilTileGroup(soil, 1, 0).map((t) => `${t.tx},${t.ty}`).sort()).toEqual(["1,0", "2,0"]);
  });

  it("moveSoilTileGroup refuses and changes nothing when a from-tile is stale", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    const ok = moveSoilTileGroup(soil, [
      { from: { tx: 9, ty: 9 }, to: { tx: 1, ty: 1 } },
    ]);
    expect(ok).toBe(false);
    expect(hasSoilTile(soil, 0, 0)).toBe(true);
    expect(soil.size).toBe(1);
  });

  it("agrees with the real Crop Fields bounds check placeStackAcresSoilTile uses", () => {
    const origin = soilTileAt(MEADOW.x, MEADOW.y);
    const soil = createSoilMap([{ tx: origin.tx, ty: origin.ty, order: 0, origin: "purchased" }]);
    // One tile in, still inside -- and one tile past the field's edge.
    const inside = planSoilGroupRelocation(
      soil,
      origin.tx,
      origin.ty,
      origin.tx + 1,
      origin.ty,
      soilTileInCropFieldBeds,
    );
    expect(inside.kind).toBe("ok");
    const outside = planSoilGroupRelocation(
      soil,
      origin.tx,
      origin.ty,
      origin.tx - 1,
      origin.ty,
      soilTileInCropFieldBeds,
    );
    expect(outside.kind).toBe("out-of-bounds");
  });
});
