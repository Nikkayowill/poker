import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { CROP_FIELD_BEDS } from "@/lib/stackacres/world";
import { SOIL_TILE, SOIL_TILE_PRICE_GOLD, soilTileAt } from "@/lib/stackacres/soil";
import { SOIL_BAGS_PER_PURCHASE, soilTierPrice, type SoilTier } from "@/lib/stackacres/soil-tiers";
import { STACKACRES_CATALOGUE, STACKACRES_CROPS } from "@/lib/stackacres/catalogue";
import {
  __resetStackAcresSeedStockForTest,
  adjustStackAcresSeedStock,
} from "./stackacres-seed-store";
import {
  StackAcresRequestError,
  buyStackAcresSoil,
  placeStackAcresSoilTile,
  readStackAcres,
  removeStackAcresSoilTile,
  stockStackAcres,
} from "./stackacres-service";
import {
  __resetStackAcresForTest,
  recordStackAcresCropFieldsUnlocked,
} from "./stackacres-store";
import {
  __resetStackAcresSoilStockForTest,
  __resetStackAcresSoilTilesForTest,
  readStackAcresSoilStock,
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
  // The Crop Fields' own bed-tiling and crop-stocking routes are gated on the
  // standalone unlock now (lib/stackacres/crop-fields.ts) -- this file's own
  // tests all predate that gate and assume a farm ready to till/sow.
  await recordStackAcresCropFieldsUnlocked(profile.id, T0);
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
  __resetStackAcresSoilStockForTest();
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

/** Well outside every district -- generously far, not just off one edge. */
const FAR_AWAY = { tx: 10_000, ty: 10_000 };

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresSoilStockForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresIntentsForTest();
});

/** A funded farm holding `bags` of `tier`, ready to lay beds. Soil is paid for
 *  at Ray's shelf now, so every placement test needs stock first. */
async function stocked(tier: SoilTier = "dirt", bags = 4, gold = 500_000) {
  const token = await funded(gold);
  await buyStackAcresSoil(token, { tier, quantity: bags }, T0);
  return token;
}

describe("placeStackAcresSoilTile — spends a bag, never Gold", () => {
  it("lays a bed, takes one bag off the shelf, and moves no Gold", async () => {
    const token = await stocked("dirt", 2);
    const start = await balance(token);
    const { tx, ty } = cropFieldTile();

    const view = await placeStackAcresSoilTile(token, { tx, ty }, T0);

    // Soil was paid for at the shop; laying it costs nothing further.
    expect(await balance(token)).toBe(start);
    expect(view.soilStock.dirt).toBe(1);
    expect(
      view.soilTiles.some((t) => t.tx === tx && t.ty === ty && t.origin === "purchased"),
    ).toBe(true);
  });

  it("refuses a second bed on an occupied coordinate and returns the bag", async () => {
    const token = await stocked("dirt", 2);
    const { tx, ty } = cropFieldTile();
    await placeStackAcresSoilTile(token, { tx, ty }, T0);
    const afterFirst = await balance(token);

    await expect(placeStackAcresSoilTile(token, { tx, ty }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    // One bed, not two -- the second bag never landed, and came back.
    const view = await readStackAcres(token, T0);
    expect(view.soilTiles.filter((t) => t.tx === tx && t.ty === ty)).toHaveLength(1);
    expect(await readStackAcresSoilStock((await ensureProfile(token)).id)).toEqual({ dirt: 1 });
    expect(await balance(token)).toBe(afterFirst);
  });

  it("refuses a bed of a different tier on an occupied coordinate and returns that bag too", async () => {
    const token = await funded();
    await buyStackAcresSoil(token, { tier: "dirt", quantity: 1 }, T0);
    await buyStackAcresSoil(token, { tier: "enriched", quantity: 1 }, T0);
    const { tx, ty } = cropFieldTile();
    await placeStackAcresSoilTile(token, { tx, ty, tier: "dirt" }, T0);
    const afterFirst = await balance(token);

    await expect(
      placeStackAcresSoilTile(token, { tx, ty, tier: "enriched" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    // Neither bag moved off the shelf into the wrong place: the dirt bag
    // spent on the bed that landed, the enriched one refunded untouched.
    expect(await readStackAcresSoilStock((await ensureProfile(token)).id)).toEqual({
      dirt: 0,
      enriched: 1,
    });
    expect(await balance(token)).toBe(afterFirst);
  });

  it("refuses with an empty shelf and points at the shop", async () => {
    const token = await funded();
    const start = await balance(token);
    const { tx, ty } = cropFieldTile();

    await expect(placeStackAcresSoilTile(token, { tx, ty }, T0)).rejects.toThrow(/Ray/);
    expect(await balance(token)).toBe(start);
  });

  it("refuses a tile outside the Crop Fields, and keeps the bag", async () => {
    const token = await stocked("dirt", 1);
    const start = await balance(token);

    await expect(placeStackAcresSoilTile(token, FAR_AWAY, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(start);
    expect(await readStackAcresSoilStock((await ensureProfile(token)).id)).toEqual({ dirt: 1 });
  });
});

describe("buyStackAcresSoil — Ray's shelf", () => {
  it("charges tier price x quantity and shelves the bags", async () => {
    const token = await funded();
    const start = await balance(token);

    const view = await buyStackAcresSoil(token, { tier: "enriched", quantity: 3 }, T0);

    expect(await balance(token)).toBe(start - soilTierPrice("enriched") * 3);
    expect(view.soilStock.enriched).toBe(3);
  });

  it("refuses when Gold is short and shelves nothing", async () => {
    const token = await funded(10);

    await expect(
      buyStackAcresSoil(token, { tier: "hydro", quantity: 1 }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(10);
    expect(await readStackAcresSoilStock((await ensureProfile(token)).id)).toEqual({});
  });

  // Every money-moving route needs an upper bound on a body-supplied quantity;
  // the Ante Up farming fix landed after finding routes bounded only by the
  // player's own balance.
  it("bounds the quantity a single purchase may name", async () => {
    const token = await funded();
    for (const quantity of [0, -5, SOIL_BAGS_PER_PURCHASE + 1]) {
      await expect(
        buyStackAcresSoil(token, { tier: "dirt", quantity }, T0),
      ).rejects.toBeInstanceOf(StackAcresRequestError);
    }
    expect(await readStackAcresSoilStock((await ensureProfile(token)).id)).toEqual({});
  });

  it("reads the price from the tier table, not the request", async () => {
    const token = await funded();
    const start = await balance(token);

    // An unknown tier degrades to the cheapest, so a hostile body under-buys.
    const view = await buyStackAcresSoil(token, { tier: "gold-plated", quantity: 1 }, T0);

    expect(await balance(token)).toBe(start - SOIL_TILE_PRICE_GOLD);
    expect(view.soilStock.dirt).toBe(1);
  });
});

describe("removeStackAcresSoilTile", () => {
  it("removes a purchased tile and refunds nothing", async () => {
    const token = await stocked("dirt", 1);
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
});

describe("SOIL_TILE lattice bounds check", () => {
  it("accepts a tile fully inside the Crop Fields and refuses one straddling its edge", async () => {
    const token = await stocked("dirt", 1);
    const inside = soilTileAt(CROP_FIELD_BEDS.x + SOIL_TILE, CROP_FIELD_BEDS.y + SOIL_TILE);
    await expect(placeStackAcresSoilTile(token, inside, T0)).resolves.toBeTruthy();
  });
});

describe("soil tiers", () => {
  // The one bed each test in this block places, so its tier is the whole
  // slot space and every sow in here lands on it.
  const CELL_A = cropFieldTile();

  it("lays each tier onto the map with its tier recorded", async () => {
    for (const tier of ["dirt", "enriched", "hydro"] as const) {
      __resetStackAcresSoilTilesForTest();
      __resetStackAcresSoilStockForTest();
      const token = await stocked(tier, 1);

      const view = await placeStackAcresSoilTile(token, { ...CELL_A, tier }, T0);

      expect(view.soilTiles.find((t) => t.tx === CELL_A.tx && t.ty === CELL_A.ty)?.tier).toBe(tier);
      expect(view.soilStock[tier] ?? 0).toBe(0);
    }
  });

  // The price comes from the tier table, never from the request body, so a
  // malformed or hostile tier can only ever under-buy.
  it("degrades an unknown tier to the plain bed, spending a plain bag", async () => {
    const token = await stocked("dirt", 1);

    const view = await placeStackAcresSoilTile(token, { ...CELL_A, tier: "gold-plated" }, T0);

    expect(view.soilTiles.find((t) => t.tx === CELL_A.tx && t.ty === CELL_A.ty)?.tier).toBe("dirt");
    expect(view.soilStock.dirt ?? 0).toBe(0);
  });

  // The whole point of Enriched. The shortened span is written into `ready_at`
  // at sow, so a later retune of the tier table cannot reach a crop already
  // in the ground.
  it("shortens a crop's cycle when it is sown into an enriched bed", async () => {
    const base = STACKACRES_CATALOGUE.corn.durationMs;

    // A plain dirt bed is the baseline -- a crop cannot be sown with no bed
    // at all any more (see the refusal test just below), so the comparison
    // is dirt against enriched rather than nothing against enriched.
    const plainToken = await sowingFarm();
    await buyStackAcresSoil(plainToken, { tier: "dirt", quantity: 1 }, T0);
    await placeStackAcresSoilTile(plainToken, { ...CELL_A, tier: "dirt" }, T0);
    const plain = (await stockStackAcres(plainToken, { stock: "corn" }, T0)).units
      .filter((u) => u.stock === "corn")
      .at(-1)!;
    expect(Date.parse(plain.readyAt) - T0.getTime()).toBe(base);
    expect(plain.soilSlot).toBe(0);

    const richToken = await sowingFarm();
    await buyStackAcresSoil(richToken, { tier: "enriched", quantity: 1 }, T0);
    await placeStackAcresSoilTile(richToken, { ...CELL_A, tier: "enriched" }, T0);
    const rich = (await stockStackAcres(richToken, { stock: "corn" }, T0)).units
      .filter((u) => u.stock === "corn")
      .at(-1)!;

    // The one bed on this farm, so slot 0 is CELL_A -- the enriched bed.
    expect(rich.soilSlot).toBe(0);
    expect(Date.parse(rich.readyAt) - T0.getTime()).toBe(Math.round(base * 0.8));
  });

  // A crop needs a bed under it (2026-09-09): with nothing tilled anywhere
  // the sow is refused outright, and the seed it would have spent stays on
  // the shelf -- the same "a failed creation refunds" rule the insert path
  // already follows, applied one step earlier.
  it("refuses a crop with no bed anywhere, and keeps the seed", async () => {
    const token = await sowingFarm();
    const before = (await readStackAcres(token, T0)).seedStock.corn;

    await expect(stockStackAcres(token, { stock: "corn" }, T0)).rejects.toThrow(/bed/);

    const after = await readStackAcres(token, T0);
    expect(after.units.filter((u) => u.stock === "corn")).toHaveLength(0);
    expect(after.seedStock.corn).toBe(before);
  });

  // Hydro waters its own tile, feeding the same `irrigated` flag a pipe does.
  // No pipe is placed here at all: that is the point.
  it("keeps a crop on a hydro bed watered with no pipe anywhere", async () => {
    const thirstMs = STACKACRES_CATALOGUE.corn.thirstMs ?? 0;
    const wellPastThirst = new Date(T0.getTime() + thirstMs * 1.5);

    // Dirt, so the dry half of this has a bed to stand on at all.
    const dryToken = await sowingFarm();
    await buyStackAcresSoil(dryToken, { tier: "dirt", quantity: 1 }, T0);
    await placeStackAcresSoilTile(dryToken, { ...CELL_A, tier: "dirt" }, T0);
    const dryId = (await stockStackAcres(dryToken, { stock: "corn" }, T0)).units
      .filter((u) => u.stock === "corn")
      .at(-1)!.id;
    const dried = (await readStackAcres(dryToken, wellPastThirst)).units.find((u) => u.id === dryId);
    expect(dried?.state).toBe("dry");

    const hydroToken = await sowingFarm();
    await buyStackAcresSoil(hydroToken, { tier: "hydro", quantity: 1 }, T0);
    await placeStackAcresSoilTile(hydroToken, { ...CELL_A, tier: "hydro" }, T0);
    const hydroId = (await stockStackAcres(hydroToken, { stock: "corn" }, T0)).units
      .filter((u) => u.stock === "corn")
      .at(-1)!.id;
    const still = (await readStackAcres(hydroToken, wellPastThirst)).units.find(
      (u) => u.id === hydroId,
    );
    expect(still?.state).toBe("working");
    expect(still?.isWatered).toBe(true);
  });
});

describe("stockStackAcres — plants the bed the player actually tapped", () => {
  it("lands on the named tile rather than the lowest free slot", async () => {
    const token = await sowingFarm();
    await buyStackAcresSoil(token, { tier: "dirt", quantity: 3 }, T0);
    const bedA = cropFieldTile(0);
    const bedB = cropFieldTile(1);
    const bedC = cropFieldTile(2);
    await placeStackAcresSoilTile(token, bedA, T0);
    await placeStackAcresSoilTile(token, bedB, T0);
    await placeStackAcresSoilTile(token, bedC, T0);

    // Fills bed A the ordinary way -- no tile named, lowest free slot wins.
    await stockStackAcres(token, { stock: "corn" }, T0);

    // Bed C named directly. The lowest free slot left is bed B's -- this
    // only proves anything if the crop lands on C, not B.
    const view = await stockStackAcres(token, { stock: "corn", tile: bedC }, T0);
    const named = view.units.filter((u) => u.stock === "corn").at(-1)!;
    expect(named.soilSlot).toBe(2);
  });

  it("falls back to the lowest free slot when the named tile has no bed", async () => {
    const token = await sowingFarm();
    await buyStackAcresSoil(token, { tier: "dirt", quantity: 1 }, T0);
    await placeStackAcresSoilTile(token, cropFieldTile(), T0);

    // FAR_AWAY names no bed at all -- a stale or bogus tap, not a refusal.
    const view = await stockStackAcres(token, { stock: "corn", tile: FAR_AWAY }, T0);
    const unit = view.units.filter((u) => u.stock === "corn").at(-1)!;
    expect(unit.soilSlot).toBe(0);
  });

  it("falls back to the lowest free slot when the named tile is already standing on", async () => {
    const token = await sowingFarm();
    await buyStackAcresSoil(token, { tier: "dirt", quantity: 2 }, T0);
    const bedA = cropFieldTile(0);
    const bedB = cropFieldTile(1);
    await placeStackAcresSoilTile(token, bedA, T0);
    await placeStackAcresSoilTile(token, bedB, T0);

    await stockStackAcres(token, { stock: "corn", tile: bedA }, T0);
    // Naming bed A again -- something is already growing there, so this has
    // to fall through rather than double a crop onto one slot.
    const view = await stockStackAcres(token, { stock: "corn", tile: bedA }, T0);
    const second = view.units.filter((u) => u.stock === "corn").at(-1)!;
    expect(second.soilSlot).toBe(1);
  });
});
