import { randomUUID } from "crypto";
import {
  isHoeableMapTile,
  mapToSoilTile,
} from "@/lib/stackacres/hoeable";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "@/lib/stackacres/homestead-ground";
import { beforeEach, describe, expect, it } from "vitest";

import { CROP_FIELD_BEDS, soilTileInCropFieldBeds } from "@/lib/stackacres/world";
import {
  HOME_STARTER_TILE_COUNT,
  SOIL_TILE,
  createSoilMap,
  homeStarterSoilTiles,
  isHomeStarterSoilTile,
  soilSlotTile,
  soilTileAt,
  type SoilTile,
} from "@/lib/stackacres/soil";
import { STACKACRES_CROPS } from "@/lib/stackacres/catalogue";
import {
  __resetStackAcresSeedStockForTest,
  adjustStackAcresSeedStock,
} from "./stackacres-seed-store";
import {
  StackAcresRequestError,
  moveStackAcresSoilTileGroup,
  placeStackAcresSoilTile,
  readStackAcres,
  removeStackAcresSoilTile,
  stockStackAcres,
  workStackAcresLand,
} from "./stackacres-service";
import { OVERGROWN_SQUARE, cropFieldObstaclePlacements } from "@/lib/stackacres/crop-field-obstacles";
import { LAND_OBSTACLES, LAND_OBSTACLE_DEFS, landObstacle } from "@/lib/stackacres/land-clearing";
import {
  __resetStackAcresForTest,
  recordStackAcresCropFieldsUnlocked,
} from "./stackacres-store";
import {
  __resetStackAcresSoilTilesForTest,
} from "./stackacres-soil-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { adjustGold, ensureProfile } from "./profile-store";
import { SECTOR_LADDER } from "@/lib/stackacres/sectors";
import { recordStackAcresSectorCleared } from "./stackacres-store";

const T0 = new Date("2026-09-06T12:00:00.000Z");

async function funded(gold = 500_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  // Nothing is recorded about the Crop Fields here: tiling and sowing out
  // there are not gated any more, and the flag is what breaking the ground
  // SETS, which is the thing several of these tests are checking.
  return token;
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/** A funded farm with every sector cleared, so `stockStackAcres` will sow.
 *  Its own soil layout is reset first, so each farm starts as bare grass --
 *  there is no free starter grant any more (see lib/stackacres/soil.ts's
 *  own "starter kit" section). */
async function sowingFarm(gold = 500_000) {
  __resetStackAcresSoilTilesForTest();
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  for (const sector of SECTOR_LADDER) {
    await recordStackAcresSectorCleared(profile.id, sector, T0);
  }
  await recordStackAcresCropFieldsUnlocked(profile.id, T0);
  // Ray's seed shelf gates planting a crop now -- see the 2026-09-07 seed
  // inventory pass. This file's own crop-sowing tests predate that gate.
  for (const crop of STACKACRES_CROPS) await adjustStackAcresSeedStock(profile.id, crop, 1000);
  return token;
}

/** A tile comfortably inside the Crop Fields. */
function cropFieldTile(offset = 0) {
  const centre = soilTileAt(
    CROP_FIELD_BEDS.x + CROP_FIELD_BEDS.width / 2,
    CROP_FIELD_BEDS.y + CROP_FIELD_BEDS.height / 2,
  );
  return { tx: centre.tx + offset, ty: centre.ty };
}

/**
 * Every bare grass square on the Homestead outside the Crop Fields and clear of the six starter
 * beds, top to bottom, read off the real map (lib/stackacres/hoeable.ts) rather than written down,
 * so a redrawn map cannot leave a test pointing at a road.
 */
const BARE_GRASS = (() => {
  const tiles: { tx: number; ty: number }[] = [];
  for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my++) {
    for (let mx = 0; mx < HOMESTEAD_MAP_WIDTH; mx++) {
      if (!isHoeableMapTile(mx, my)) continue;
      const tile = mapToSoilTile(mx, my);
      if (soilTileInCropFieldBeds(tile.tx, tile.ty) || isHomeStarterSoilTile(tile.tx, tile.ty)) continue;
      tiles.push(tile);
    }
  }
  return tiles;
})();

/** A bare grass square, `at` of the way down the list: 0 the first, 1 the last. Never an index
 *  counted from a map that has since been redrawn. */
function grassTile(at = 0) {
  if (BARE_GRASS.length === 0) throw new Error("no bare grass on the Homestead");
  return BARE_GRASS[Math.round(at * (BARE_GRASS.length - 1))];
}

/** Map tiles that are plainly not grass, from art/stackacres-td/areas/rig/homestead.py:
 *  the north lane through the yard (farmyard tile 14, 7) and the middle of the pond
 *  (farmyard 7, 26), both pushed down the 38 rows the Crop Fields add above the yard. */
const ROAD_MAP_TILE = { mx: 14, my: 7 + 38 };
const POND_MAP_TILE = { mx: 7, my: 26 + 38 };

/** Well outside every district -- generously far, not just off one edge. */
const FAR_AWAY = { tx: 10_000, ty: 10_000 };

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresIntentsForTest();
});

describe("the free Homestead starter beds", () => {
  it("exist on a genuinely fresh profile, before any Gold is spent or the Crop Fields are unlocked", async () => {
    const token = randomUUID();
    await ensureProfile(token);

    const view = await readStackAcres(token, T0);

    expect(view.cropFieldsUnlocked).toBe(false);
    expect(view.soilTiles.filter((t) => t.origin === "starter")).toHaveLength(HOME_STARTER_TILE_COUNT);
  });

  it("let a genuinely new player till and plant a real crop with no Gold spent and nothing unlocked", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustStackAcresSeedStock(profile.id, "carrot", 1);
    const goldBefore = (await ensureProfile(token)).goldBalance;
    const starterBed = homeStarterSoilTiles()[0];

    const view = await stockStackAcres(token, { stock: "carrot", tile: starterBed }, T0);

    const planted = view.units.find((u) => u.stock === "carrot");
    expect(planted).toBeDefined();
    expect(planted?.soilSlot).toBe(starterBed.order);
    expect(view.cropFieldsUnlocked).toBe(false);
    expect((await ensureProfile(token)).goldBalance).toBe(goldBefore);
  });

  it("cannot be removed -- only a purchased bed can", async () => {
    const token = randomUUID();
    await ensureProfile(token);
    const starterBed = homeStarterSoilTiles()[0];

    await expect(removeStackAcresSoilTile(token, starterBed, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("lets a brand new player break ground in the Crop Fields with nothing bought", async () => {
    const token = randomUUID();
    await ensureProfile(token);

    const view = await placeStackAcresSoilTile(token, cropFieldTile(), T0);

    expect(view.soilTiles.some((t) => t.origin === "purchased")).toBe(true);
  });
});

describe("clearing the Crop Fields -- the first bed IS the unlock", () => {
  it("lays a bed out there with no unlock, no modal and no 15,000 Gold", async () => {
    const token = await funded();
    expect((await readStackAcres(token, T0)).cropFieldsUnlocked).toBe(false);
    const goldBefore = await balance(token);

    const view = await placeStackAcresSoilTile(token, cropFieldTile(), T0);

    expect(view.cropFieldsUnlocked).toBe(true);
    expect(await balance(token)).toBe(goldBefore);
  });

  it("sows a crop out there straight after, with nothing else unlocked", async () => {
    const token = await funded();
    const profile = await ensureProfile(token);
    await adjustStackAcresSeedStock(profile.id, "carrot", 1);
    const tile = cropFieldTile();
    await placeStackAcresSoilTile(token, tile, T0);

    const view = await stockStackAcres(token, { stock: "carrot", tile }, T0);

    expect(view.units.some((unit) => unit.stock === "carrot")).toBe(true);
  });

  it("keeps the Crop Fields once cleared, even if every bed is lifted again", async () => {
    const token = await funded();
    const tile = cropFieldTile();
    await placeStackAcresSoilTile(token, tile, T0);

    const view = await removeStackAcresSoilTile(token, tile, T0);

    expect(view.cropFieldsUnlocked).toBe(true);
  });
});

describe("placeStackAcresSoilTile: breaking ground is free", () => {
  it("lays a bed and moves no Gold", async () => {
    const token = await funded();
    const start = await balance(token);
    const { tx, ty } = cropFieldTile();

    const view = await placeStackAcresSoilTile(token, { tx, ty }, T0);

    expect(await balance(token)).toBe(start);
    expect(
      view.soilTiles.some((t) => t.tx === tx && t.ty === ty && t.origin === "purchased"),
    ).toBe(true);
  });

  it("lays more beds than a soil bag ever held", async () => {
    const token = await funded();
    for (let i = 0; i < 12; i += 1) {
      await placeStackAcresSoilTile(token, cropFieldTile(i), T0);
    }
    expect((await readStackAcres(token, T0)).soilTiles.filter((t) => t.origin === "purchased")).toHaveLength(12);
  });

  it("refuses a second bed on an occupied coordinate", async () => {
    const token = await funded();
    const { tx, ty } = cropFieldTile();
    await placeStackAcresSoilTile(token, { tx, ty }, T0);

    await expect(placeStackAcresSoilTile(token, { tx, ty }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    const view = await readStackAcres(token, T0);
    expect(view.soilTiles.filter((t) => t.tx === tx && t.ty === ty)).toHaveLength(1);
  });

  it("refuses a tile off the Homestead entirely", async () => {
    const token = await funded();
    const start = await balance(token);

    await expect(placeStackAcresSoilTile(token, FAR_AWAY, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(start);
  });

  it("records the bed as plain dirt", async () => {
    const token = await funded();
    const cell = cropFieldTile();

    const view = await placeStackAcresSoilTile(token, cell, T0);

    expect(view.soilTiles.find((t) => t.tx === cell.tx && t.ty === cell.ty)?.tier).toBe("dirt");
  });
});

describe("removeStackAcresSoilTile", () => {
  it("removes a purchased tile and refunds nothing", async () => {
    const token = await funded();
    const { tx, ty } = cropFieldTile();
    await placeStackAcresSoilTile(token, { tx, ty }, T0);
    const afterPlace = await balance(token);

    const view = await removeStackAcresSoilTile(token, { tx, ty }, T0);

    expect(await balance(token)).toBe(afterPlace);
    expect(view.soilTiles.some((tile) => tile.tx === tx && tile.ty === ty)).toBe(false);
  });

  it("refuses a coordinate with nothing on it", async () => {
    const token = await funded();
    await expect(
      removeStackAcresSoilTile(token, FAR_AWAY, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });

  it("takes the crop standing on the bed with it, no refund of its seed", async () => {
    const token = await sowingFarm();
    const { tx, ty } = cropFieldTile();
    await placeStackAcresSoilTile(token, { tx, ty }, T0);
    const crop = STACKACRES_CROPS[0];
    const sown = await stockStackAcres(token, { stock: crop, tile: { tx, ty } }, T0);
    const planted = sown.units.find((unit) => unit.stock === crop);
    expect(planted?.soilSlot).not.toBeNull();
    const afterSow = await balance(token);

    const view = await removeStackAcresSoilTile(token, { tx, ty }, T0);

    expect(view.soilTiles.some((tile) => tile.tx === tx && tile.ty === ty)).toBe(false);
    expect(view.units.some((unit) => unit.id === planted?.id)).toBe(false);
    // No Gold moves either way: the seed was already paid for at Ray's shop,
    // and lifting the bed refunds nothing back.
    expect(await balance(token)).toBe(afterSow);
  });

  it("leaves an unrelated crop alone when a different bed is lifted", async () => {
    const token = await sowingFarm();
    const bedA = cropFieldTile(0);
    const bedB = cropFieldTile(1);
    await placeStackAcresSoilTile(token, bedA, T0);
    await placeStackAcresSoilTile(token, bedB, T0);
    const crop = STACKACRES_CROPS[0];
    const sown = await stockStackAcres(token, { stock: crop, tile: bedA }, T0);
    const planted = sown.units.find((unit) => unit.stock === crop);

    const view = await removeStackAcresSoilTile(token, bedB, T0);

    expect(view.units.some((unit) => unit.id === planted?.id)).toBe(true);
  });

  // THE BUG THIS WHOLE SHAPE EXISTS FOR (2026-09-14). A slot used to be an
  // index into the ordered bed list, so lifting a bed slid every crop after
  // it one bed along -- pull a bed out at one end of the farm and a row of
  // lettuce at the other end rearranged itself. A slot is the bed's own
  // order now, so the survivors do not move.
  it("leaves every other crop standing on the same bed when one is lifted", async () => {
    const token = await sowingFarm();
    const beds = [cropFieldTile(0), cropFieldTile(1), cropFieldTile(2), cropFieldTile(3)];
    for (const bed of beds) await placeStackAcresSoilTile(token, bed, T0);

    // Three crops in a row, on the last three beds.
    const sownIds: string[] = [];
    for (let i = 1; i < beds.length; i += 1) {
      const crop = STACKACRES_CROPS[i % STACKACRES_CROPS.length];
      const sown = await stockStackAcres(token, { stock: crop, tile: beds[i] }, T0);
      const planted = sown.units.find((unit) => !sownIds.includes(unit.id) && unit.soilSlot !== null);
      expect(planted).toBeDefined();
      sownIds.push(planted!.id);
    }

    const where = (view: { units: readonly { id: string; soilSlot: number | null }[]; soilTiles: readonly SoilTile[] }) => {
      const soil = createSoilMap([...view.soilTiles]);
      return sownIds.map((id) => {
        const unit = view.units.find((u) => u.id === id);
        const tile = unit?.soilSlot == null ? null : soilSlotTile(soil, unit.soilSlot);
        return tile === null || tile === undefined ? null : { tx: tile.tx, ty: tile.ty };
      });
    };

    const before = where(await readStackAcres(token, T0));
    expect(before).toEqual([beds[1], beds[2], beds[3]].map(({ tx, ty }) => ({ tx, ty })));

    // Lift the FIRST bed -- the one every later slot used to be counted from,
    // and the one carrying no crop at all.
    const after = where(await removeStackAcresSoilTile(token, beds[0], T0));

    expect(after).toEqual(before);
  });
});

describe("moveStackAcresSoilTileGroup", () => {
  it("moves a bed to a bare coordinate and refunds/spends nothing", async () => {
    const token = await funded();
    const from = cropFieldTile();
    await placeStackAcresSoilTile(token, from, T0);
    const afterPlace = await balance(token);
    const to = { tx: from.tx + 1, ty: from.ty };

    const view = await moveStackAcresSoilTileGroup(token, { tx: from.tx, ty: from.ty, toTx: to.tx, toTy: to.ty }, T0);

    expect(view.soilTiles.some((tile) => tile.tx === from.tx && tile.ty === from.ty)).toBe(false);
    expect(view.soilTiles.some((tile) => tile.tx === to.tx && tile.ty === to.ty)).toBe(true);
    expect(await balance(token)).toBe(afterPlace);
  });

  it("carries the bed's crop with it -- same unit, same soilSlot, no removal", async () => {
    const token = await sowingFarm();
    const from = cropFieldTile();
    await placeStackAcresSoilTile(token, from, T0);
    const crop = STACKACRES_CROPS[0];
    const sown = await stockStackAcres(token, { stock: crop, tile: from }, T0);
    const planted = sown.units.find((unit) => unit.stock === crop);
    expect(planted?.soilSlot).not.toBeNull();
    const to = { tx: from.tx + 2, ty: from.ty + 3 };

    const view = await moveStackAcresSoilTileGroup(token, { tx: from.tx, ty: from.ty, toTx: to.tx, toTy: to.ty }, T0);

    const stillThere = view.units.find((unit) => unit.id === planted?.id);
    expect(stillThere).toBeDefined();
    // Same unit row, same slot -- moveStackAcresSoilTileGroup never touches
    // a unit at all, only the tile's own tx/ty (see its own header).
    expect(stillThere?.soilSlot).toBe(planted?.soilSlot);
  });

  it("moves the whole contiguous group by the same offset, not just the tapped tile", async () => {
    const token = await funded();
    const anchor = cropFieldTile();
    const neighbour = { tx: anchor.tx + 1, ty: anchor.ty };
    await placeStackAcresSoilTile(token, anchor, T0);
    await placeStackAcresSoilTile(token, neighbour, T0);
    const dx = 0;
    const dy = 4;

    const view = await moveStackAcresSoilTileGroup(
      token,
      { tx: anchor.tx, ty: anchor.ty, toTx: anchor.tx + dx, toTy: anchor.ty + dy },
      T0,
    );

    expect(view.soilTiles.some((t) => t.tx === anchor.tx && t.ty === anchor.ty)).toBe(false);
    expect(view.soilTiles.some((t) => t.tx === neighbour.tx && t.ty === neighbour.ty)).toBe(false);
    expect(view.soilTiles.some((t) => t.tx === anchor.tx + dx && t.ty === anchor.ty + dy)).toBe(true);
    expect(view.soilTiles.some((t) => t.tx === neighbour.tx + dx && t.ty === neighbour.ty + dy)).toBe(true);
  });

  it("refuses a seed coordinate with no bed", async () => {
    const token = await funded();
    await expect(
      moveStackAcresSoilTileGroup(token, { tx: FAR_AWAY.tx, ty: FAR_AWAY.ty, toTx: FAR_AWAY.tx + 1, toTy: FAR_AWAY.ty }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });

  it("refuses a destination already held by another bed", async () => {
    const token = await funded();
    // Three tiles apart, deliberately NOT touching -- adjacent beds would
    // form one contiguous group (see the "moves the whole contiguous group"
    // test above), and this test wants two genuinely separate ones.
    const bedA = cropFieldTile(0);
    const bedB = cropFieldTile(3);
    await placeStackAcresSoilTile(token, bedA, T0);
    await placeStackAcresSoilTile(token, bedB, T0);

    await expect(
      moveStackAcresSoilTileGroup(token, { tx: bedA.tx, ty: bedA.ty, toTx: bedB.tx, toTy: bedB.ty }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
    // Nothing moved -- both beds are exactly where they started.
    const view = await readStackAcres(token, T0);
    expect(view.soilTiles.some((t) => t.tx === bedA.tx && t.ty === bedA.ty)).toBe(true);
    expect(view.soilTiles.some((t) => t.tx === bedB.tx && t.ty === bedB.ty)).toBe(true);
  });

  it("refuses a destination outside the Crop Fields", async () => {
    const token = await funded();
    const from = cropFieldTile();
    await expect(
      moveStackAcresSoilTileGroup(token, { tx: from.tx, ty: from.ty, toTx: FAR_AWAY.tx, toTy: FAR_AWAY.ty }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });

  it("refuses tapping the same spot as the destination", async () => {
    const token = await funded();
    const from = cropFieldTile();
    await placeStackAcresSoilTile(token, from, T0);
    await expect(
      moveStackAcresSoilTileGroup(token, { tx: from.tx, ty: from.ty, toTx: from.tx, toTy: from.ty }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });
});

describe("SOIL_TILE lattice bounds check", () => {
  it("accepts a tile fully inside the Crop Fields and refuses one straddling its edge", async () => {
    const token = await funded();
    const inside = soilTileAt(CROP_FIELD_BEDS.x + SOIL_TILE, CROP_FIELD_BEDS.y + SOIL_TILE);
    await expect(placeStackAcresSoilTile(token, inside, T0)).resolves.toBeTruthy();
  });
});

describe("soil tiers", () => {
  // The one bed each test in this block places, so its tier is the whole
  // slot space and every sow in here lands on it.
  const CELL_A = cropFieldTile();

  // A crop needs a bed under it (2026-09-09): with every bed already
  // growing something -- Crop Fields or Homestead starter alike -- the sow
  // is refused outright, and the seed it would have spent stays on the
  // shelf, the same "a failed creation refunds" rule the insert path
  // already follows, applied one step earlier. A brand new farm is no
  // longer a case of "no bed anywhere" (that is the whole point of the free
  // Homestead starter beds), so this fills all six of those first.
  it("refuses a crop with no bed left anywhere, and keeps the seed", async () => {
    const token = await sowingFarm();
    for (let i = 0; i < HOME_STARTER_TILE_COUNT; i += 1) {
      await stockStackAcres(token, { stock: STACKACRES_CROPS[i] }, T0);
    }
    const before = (await readStackAcres(token, T0)).seedStock.corn;

    await expect(stockStackAcres(token, { stock: "corn" }, T0)).rejects.toThrow(/bed/);

    const after = await readStackAcres(token, T0);
    expect(after.units.filter((u) => u.stock === "corn")).toHaveLength(0);
    expect(after.seedStock.corn).toBe(before);
  });
});

describe("stockStackAcres — plants the bed the player actually tapped", () => {
  it("lands on the named tile rather than the lowest free slot", async () => {
    const token = await sowingFarm();
    const bedA = cropFieldTile(0);
    const bedB = cropFieldTile(1);
    const bedC = cropFieldTile(2);
    await placeStackAcresSoilTile(token, bedA, T0);
    await placeStackAcresSoilTile(token, bedB, T0);
    await placeStackAcresSoilTile(token, bedC, T0);

    // Fills the lowest free slot on the farm the ordinary way -- no tile
    // named. That is one of the free Homestead starter beds now (their
    // negative orders sort ahead of every purchased one -- see
    // lib/stackacres/soil.ts's own comment on `homeStarterSoilTiles`), not
    // bed A, so this only occupies a starter bed and leaves every Crop
    // Fields bed free for the real point of the test below.
    await stockStackAcres(token, { stock: "corn" }, T0);

    // Bed C named directly. This only proves anything if the crop lands on
    // C specifically, not whichever bed the lowest-free-slot fallback would
    // have picked.
    const view = await stockStackAcres(token, { stock: "corn", tile: bedC }, T0);
    const named = view.units.filter((u) => u.stock === "corn").at(-1)!;
    expect(named.soilSlot).toBe(2);
  });

  it("falls back to the lowest free slot when the named tile has no bed", async () => {
    const token = await sowingFarm();
    await placeStackAcresSoilTile(token, cropFieldTile(), T0);

    // FAR_AWAY names no bed at all -- a stale or bogus tap, not a refusal.
    // The lowest free slot on a fresh farm is one of the free Homestead
    // starter beds, ahead of the Crop Fields bed just placed.
    const view = await stockStackAcres(token, { stock: "corn", tile: FAR_AWAY }, T0);
    const unit = view.units.filter((u) => u.stock === "corn").at(-1)!;
    expect(unit.soilSlot).toBe(homeStarterSoilTiles()[0].order);
  });

  it("falls back to the lowest free slot when the named tile is already standing on", async () => {
    const token = await sowingFarm();
    const bedA = cropFieldTile(0);
    const bedB = cropFieldTile(1);
    await placeStackAcresSoilTile(token, bedA, T0);
    await placeStackAcresSoilTile(token, bedB, T0);

    await stockStackAcres(token, { stock: "corn", tile: bedA }, T0);
    // Naming bed A again -- something is already growing there, so this has
    // to fall through rather than double a crop onto one slot. The lowest
    // free slot left is a Homestead starter bed, ahead of bed B.
    const view = await stockStackAcres(token, { stock: "corn", tile: bedA }, T0);
    const second = view.units.filter((u) => u.stock === "corn").at(-1)!;
    expect(second.soilSlot).toBe(homeStarterSoilTiles()[0].order);
  });
});

describe("the hoe works on any grass on the Homestead", () => {
  it("lays a bed on bare grass and moves no Gold", async () => {
    const token = await funded();
    const goldBefore = await balance(token);
    const tile = grassTile();

    const view = await placeStackAcresSoilTile(token, tile, T0);

    expect(view.soilTiles.some((t) => t.tx === tile.tx && t.ty === tile.ty)).toBe(true);
    expect(await balance(token)).toBe(goldBefore);
  });

  it("works well away from where the paddocks used to be", async () => {
    // The first bare grass on the map is up in the treeline margin, the last
    // is down by the shore: nowhere near the two patches by the house.
    const token = await funded();
    for (const tile of [grassTile(0), grassTile(0.5), grassTile(1)]) {
      const view = await placeStackAcresSoilTile(token, tile, T0);
      expect(view.soilTiles.some((t) => t.tx === tile.tx && t.ty === tile.ty)).toBe(true);
    }
  });

  it("does NOT clear the Crop Fields -- that milestone is for ground broken out there", async () => {
    const token = await funded();

    const view = await placeStackAcresSoilTile(token, grassTile(), T0);

    expect(view.cropFieldsUnlocked).toBe(false);
  });

  it("takes a crop straight away, with no Crop Fields and nothing else unlocked", async () => {
    const token = await funded();
    const profile = await ensureProfile(token);
    await adjustStackAcresSeedStock(profile.id, "carrot", 1);
    const tile = grassTile();
    await placeStackAcresSoilTile(token, tile, T0);

    const view = await stockStackAcres(token, { stock: "carrot", tile }, T0);

    expect(view.units.some((u) => u.stock === "carrot")).toBe(true);
    expect(view.cropFieldsUnlocked).toBe(false);
  });

  it("can be lifted again like any bed the player laid", async () => {
    const token = await funded();
    const tile = grassTile();
    await placeStackAcresSoilTile(token, tile, T0);

    const view = await removeStackAcresSoilTile(token, tile, T0);

    expect(view.soilTiles.some((t) => t.tx === tile.tx && t.ty === tile.ty)).toBe(false);
  });

  it("refuses the road and the pond", async () => {
    const token = await funded();
    for (const { mx, my } of [ROAD_MAP_TILE, POND_MAP_TILE]) {
      expect(isHoeableMapTile(mx, my)).toBe(false);
      await expect(placeStackAcresSoilTile(token, mapToSoilTile(mx, my), T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
    }
  });

  it("refuses a square one of the six free starter beds already holds", async () => {
    // Those beds are never stored, so the database's one-bed-per-square rule
    // cannot see them. Without this refusal a dug bed would land on top of one.
    const token = await funded();
    const [starter] = homeStarterSoilTiles();

    await expect(placeStackAcresSoilTile(token, { tx: starter.tx, ty: starter.ty }, T0)).rejects.toMatchObject({
      status: 409,
    });
    const view = await readStackAcres(token, T0);
    expect(view.soilTiles.filter((t) => t.tx === starter.tx && t.ty === starter.ty)).toHaveLength(1);
  });
});

describe("the Crop Fields start overgrown", () => {
  beforeEach(() => {
    __resetStackAcresForTest();
    __resetStackAcresSoilTilesForTest();
  });

  const [first] = cropFieldObstaclePlacements();
  const square = mapToSoilTile(first.tx, first.ty);

  it("refuses to break a bed where something still stands", async () => {
    const token = await funded();
    await expect(placeStackAcresSoilTile(token, square, T0)).rejects.toThrow(OVERGROWN_SQUARE);
  });

  it("breaks the bed once that square is cleared, and the clearing pays the barn", async () => {
    const token = await funded();
    const obstacle = landObstacle(first.id)!;
    let result = null;
    for (let swing = 0; swing < LAND_OBSTACLE_DEFS[obstacle.kind].hits; swing += 1) {
      result = await workStackAcresLand(token, first.id, false, T0);
    }
    expect(result?.landCleared).toMatchObject({ ground: "cropfields", cleared: true, sectorOpened: false });
    const view = await placeStackAcresSoilTile(token, square, T0);
    expect(view.soilTiles.some((tile) => tile.tx === square.tx && tile.ty === square.ty)).toBe(true);
  });

  it("shows every piece of it in the farm snapshot", async () => {
    const token = await funded();
    const view = await readStackAcres(token, T0);
    const ids = view.landObstacles.filter((snapshot) => snapshot.ground === "cropfields").map((snapshot) => snapshot.id);
    expect(ids.sort()).toEqual(LAND_OBSTACLES.cropfields.map((obstacle) => obstacle.id).sort());
  });
});
