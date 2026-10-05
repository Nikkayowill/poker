import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cropFieldObstaclePlacements } from "@/lib/stackacres/crop-field-obstacles";
import {
  ACRES,
  ACRE_NOT_YOURS,
  ACRE_TREELINE,
  ACRE_UPKEEP_GOLD,
  LOOSE_WILD_TILES,
  acreAtMapTile,
  acrePrice,
  type Acre,
} from "@/lib/stackacres/acres";
import { isHoeableMapTile, isWildMapTile, mapToSoilTile } from "@/lib/stackacres/hoeable";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "@/lib/stackacres/homestead-ground";
import { itemSellPrice } from "@/lib/stackacres/items";
import { stackacresExchangeDay } from "@/lib/stackacres/exchange";
import * as profileStore from "./profile-store";
import { adjustGold, ensureProfile, setUnlimitedGold } from "./profile-store";
import * as acreStore from "./stackacres-acre-store";
import { __grantStackAcresAcreForTest, __resetStackAcresAcresForTest } from "./stackacres-acre-store";
import { __resetStackAcresFencesForTest } from "./stackacres-fence-store";
import { __resetStackAcresSoilTilesForTest } from "./stackacres-soil-store";
import {
  StackAcresRequestError,
  buyStackAcresAcre,
  moveStackAcresSoilTileGroup,
  placeStackAcresFencePiece,
  placeStackAcresSoilTile,
  readStackAcres,
  sellStackAcresItem,
} from "./stackacres-service";
import {
  __resetStackAcresForTest,
  adjustStackAcresInventory,
  readStackAcresInventory,
  readStackAcresUpkeep,
} from "./stackacres-store";

const T0 = new Date("2026-10-01T12:00:00.000Z");

vi.mock("./profile-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("./profile-store")>();
  return { ...real, debitGoldByProfile: vi.fn(real.debitGoldByProfile) };
});
vi.mock("./stackacres-acre-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stackacres-acre-store")>();
  return { ...real, insertStackAcresAcre: vi.fn(real.insertStackAcresAcre) };
});
const REAL_PROFILES = await vi.importActual<typeof import("./profile-store")>("./profile-store");
const REAL_ACRES = await vi.importActual<typeof import("./stackacres-acre-store")>("./stackacres-acre-store");

async function player({ gold = 1_000_000, wood = 1_000, stone = 1_000 } = {}) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  await adjustGold(profile.id, gold - profile.goldBalance);
  if (wood) await adjustStackAcresInventory(profile.id, "wood", wood);
  if (stone) await adjustStackAcresInventory(profile.id, "stone", stone);
  return { token, id: profile.id };
}

async function purse(token: string, id: string) {
  const inventory = await readStackAcresInventory(id);
  return { gold: (await ensureProfile(token)).goldBalance, wood: inventory.wood ?? 0, stone: inventory.stone ?? 0 };
}

/** A wild tile in `acre` that nothing stands on, so a bed there is refused only for the deed. */
function clearTile(acre: Acre): { tx: number; ty: number } {
  const standing = new Set(cropFieldObstaclePlacements().map((p) => `${p.tx},${p.ty}`));
  for (let ty = acre.ty; ty < acre.ty + acre.height; ty += 1) {
    for (let tx = acre.tx; tx < acre.tx + acre.width; tx += 1) {
      if (isWildMapTile(tx, ty) && isHoeableMapTile(tx, ty) && !standing.has(`${tx},${ty}`)) return { tx, ty };
    }
  }
  throw new Error(`no clear wild tile in ${acre.id}`);
}

/** Open yard grass, nowhere near an acre. */
const YARD = (() => {
  for (let ty = 0; ty < HOMESTEAD_MAP_HEIGHT; ty += 1) {
    for (let tx = 0; tx < HOMESTEAD_MAP_WIDTH; tx += 1) {
      if (isHoeableMapTile(tx, ty) && !isWildMapTile(tx, ty) && !acreAtMapTile(tx, ty)) return { tx, ty };
    }
  }
  throw new Error("no yard");
})();

const [FIRST, SECOND] = ACRES;

beforeEach(() => {
  vi.mocked(profileStore.debitGoldByProfile).mockImplementation(REAL_PROFILES.debitGoldByProfile);
  vi.mocked(acreStore.insertStackAcresAcre).mockImplementation(REAL_ACRES.insertStackAcresAcre);
  __resetStackAcresForTest();
  __resetStackAcresAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresFencesForTest();
});

describe("buying an acre", () => {
  it("takes the price in Gold, Wood and Stone and makes the acre theirs", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);

    const view = await buyStackAcresAcre(token, { acreId: FIRST.id }, T0);

    const price = acrePrice(0);
    const after = await purse(token, id);
    expect(after).toEqual({ gold: before.gold - price.gold, wood: before.wood - price.wood, stone: before.stone - price.stone });
    expect(view.acres.owned).toEqual([FIRST.id]);
    expect(view.acres.price).toEqual(acrePrice(1));
  });

  it("charges more for each acre after the first", async () => {
    const { token, id } = await player();
    await buyStackAcresAcre(token, { acreId: FIRST.id }, T0);
    const before = await purse(token, id);

    await buyStackAcresAcre(token, { acreId: SECOND.id }, T0);

    const price = acrePrice(1);
    expect(price.gold).toBeGreaterThan(acrePrice(0).gold);
    const after = await purse(token, id);
    expect(after).toEqual({ gold: before.gold - price.gold, wood: before.wood - price.wood, stone: before.stone - price.stone });
  });

  it("starts the next price off grandfathered acres too", async () => {
    const { token, id } = await player();
    __grantStackAcresAcreForTest(id, FIRST.id, "grandfathered");
    const before = await purse(token, id);

    await buyStackAcresAcre(token, { acreId: SECOND.id }, T0);

    expect((await purse(token, id)).gold).toBe(before.gold - acrePrice(1).gold);
  });

  it("refuses an acre that is not on the map, and takes nothing", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);
    await expect(buyStackAcresAcre(token, { acreId: "Z99" }, T0)).rejects.toThrow("Not a real acre.");
    expect(await purse(token, id)).toEqual(before);
  });

  it("refuses an acre they already own, and takes nothing", async () => {
    const { token, id } = await player();
    await buyStackAcresAcre(token, { acreId: FIRST.id }, T0);
    const before = await purse(token, id);
    const refusal = await buyStackAcresAcre(token, { acreId: FIRST.id }, T0).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(StackAcresRequestError);
    expect((refusal as StackAcresRequestError).status).toBe(409);
    expect(await purse(token, id)).toEqual(before);
  });

  it("takes nothing at all when the Wood is short", async () => {
    const { token, id } = await player({ wood: acrePrice(0).wood - 1 });
    const before = await purse(token, id);
    await expect(buyStackAcresAcre(token, { acreId: FIRST.id }, T0)).rejects.toThrow("Wood");
    expect(await purse(token, id)).toEqual(before);
    expect((await readStackAcres(token, T0)).acres.owned).toEqual([]);
  });

  it("takes nothing at all when the Stone is short, and puts the Wood back", async () => {
    const { token, id } = await player({ stone: acrePrice(0).stone - 1 });
    const before = await purse(token, id);
    await expect(buyStackAcresAcre(token, { acreId: FIRST.id }, T0)).rejects.toThrow("Stone");
    expect(await purse(token, id)).toEqual(before);
  });

  it("puts the Wood and Stone back when the Gold is short", async () => {
    const { token, id } = await player({ gold: acrePrice(0).gold - 1 });
    const before = await purse(token, id);
    await expect(buyStackAcresAcre(token, { acreId: FIRST.id }, T0)).rejects.toThrow("Gold");
    expect(await purse(token, id)).toEqual(before);
    expect((await readStackAcres(token, T0)).acres.owned).toEqual([]);
  });

  it("refunds everything when the write fails", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);
    vi.mocked(acreStore.insertStackAcresAcre).mockRejectedValueOnce(new Error("db down"));

    await expect(buyStackAcresAcre(token, { acreId: FIRST.id }, T0)).rejects.toThrow("db down");

    expect(await purse(token, id)).toEqual(before);
    expect((await readStackAcres(token, T0)).acres.owned).toEqual([]);
  });

  it("refunds everything when another tap already wrote the acre", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);
    vi.mocked(acreStore.insertStackAcresAcre).mockResolvedValueOnce("owned");

    await expect(buyStackAcresAcre(token, { acreId: FIRST.id }, T0)).rejects.toThrow("already own");

    expect(await purse(token, id)).toEqual(before);
  });

  it("charges one price when the same acre is bought twice at once", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);

    const results = await Promise.allSettled([
      buyStackAcresAcre(token, { acreId: FIRST.id }, T0),
      buyStackAcresAcre(token, { acreId: FIRST.id }, T0),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const price = acrePrice(0);
    expect(await purse(token, id)).toEqual({
      gold: before.gold - price.gold,
      wood: before.wood - price.wood,
      stone: before.stone - price.stone,
    });
  });

  it("never sells two acres at the first acre's price when both are bought at once", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);

    const results = await Promise.allSettled([
      buyStackAcresAcre(token, { acreId: FIRST.id }, T0),
      buyStackAcresAcre(token, { acreId: SECOND.id }, T0),
    ]);

    // One lands at the first price; the other read the same count and is turned away with everything back.
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(StackAcresRequestError);
    expect(((refused as PromiseRejectedResult).reason as StackAcresRequestError).status).toBe(409);
    const price = acrePrice(0);
    expect(await purse(token, id)).toEqual({
      gold: before.gold - price.gold,
      wood: before.wood - price.wood,
      stone: before.stone - price.stone,
    });
    expect((await readStackAcres(token, T0)).acres.owned).toHaveLength(1);
  });

  it("never charges an account with unlimited Gold, and still refunds only what moved", async () => {
    const { token, id } = await player({ gold: 0 });
    await setUnlimitedGold(id, true);
    const before = await purse(token, id);
    vi.mocked(acreStore.insertStackAcresAcre).mockRejectedValueOnce(new Error("db down"));

    await expect(buyStackAcresAcre(token, { acreId: FIRST.id }, T0)).rejects.toThrow("db down");

    expect(await purse(token, id)).toEqual(before);
  });
});

describe("building on wild ground", () => {
  it("refuses a bed on an acre they do not own, and says whose it is", async () => {
    const { token } = await player();
    const tile = clearTile(FIRST);
    const refusal = await placeStackAcresSoilTile(token, mapToSoilTile(tile.tx, tile.ty), T0).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(StackAcresRequestError);
    expect((refusal as StackAcresRequestError).message).toBe(ACRE_NOT_YOURS);
    expect((refusal as StackAcresRequestError).status).toBe(409);
    expect((await readStackAcres(token, T0)).soilTiles).toEqual([]);
  });

  it("lets them dig there once the acre is bought", async () => {
    const { token } = await player();
    const tile = clearTile(FIRST);
    await buyStackAcresAcre(token, { acreId: FIRST.id }, T0);
    const view = await placeStackAcresSoilTile(token, mapToSoilTile(tile.tx, tile.ty), T0);
    expect(view.soilTiles).toHaveLength(1);
    expect(view.cropFieldsUnlocked).toBe(true);
  });

  it("only opens the acre that was bought", async () => {
    const { token } = await player();
    await buyStackAcresAcre(token, { acreId: FIRST.id }, T0);
    const elsewhere = clearTile(SECOND);
    await expect(placeStackAcresSoilTile(token, mapToSoilTile(elsewhere.tx, elsewhere.ty), T0)).rejects.toThrow(ACRE_NOT_YOURS);
  });

  it("never asks for a deed on the yard", async () => {
    const { token } = await player();
    const view = await placeStackAcresSoilTile(token, mapToSoilTile(YARD.tx, YARD.ty), T0);
    expect(view.soilTiles).toHaveLength(1);
    expect(view.cropFieldsUnlocked).toBe(false);
  });

  it("refuses a fence on an acre they do not own, and takes no Wood", async () => {
    const { token, id } = await player();
    const tile = clearTile(FIRST);
    const before = await purse(token, id);
    await expect(placeStackAcresFencePiece(token, tile, T0)).rejects.toThrow(ACRE_NOT_YOURS);
    expect(await purse(token, id)).toEqual(before);
    expect((await readStackAcres(token, T0)).fences).toEqual([]);
  });

  it("puts a fence up on an acre they own", async () => {
    const { token } = await player();
    const tile = clearTile(FIRST);
    await buyStackAcresAcre(token, { acreId: FIRST.id }, T0);
    expect((await placeStackAcresFencePiece(token, tile, T0)).fences).toContainEqual(tile);
  });

  it("calls a wild tile in no acre the treeline, even to a farm that owns every acre", async () => {
    const { token, id } = await player();
    for (const acre of ACRES) __grantStackAcresAcreForTest(id, acre.id, "bought");
    const loose = LOOSE_WILD_TILES[0];
    await expect(placeStackAcresSoilTile(token, mapToSoilTile(loose.tx, loose.ty), T0)).rejects.toThrow(ACRE_TREELINE);
    await expect(placeStackAcresFencePiece(token, loose, T0)).rejects.toThrow(ACRE_TREELINE);
  });

  it("lets a grandfathered acre be built on without a purchase", async () => {
    const { token, id } = await player();
    const tile = clearTile(FIRST);
    __grantStackAcresAcreForTest(id, FIRST.id, "grandfathered");
    const view = await placeStackAcresSoilTile(token, mapToSoilTile(tile.tx, tile.ty), T0);
    expect(view.soilTiles).toHaveLength(1);
    expect(view.acres.owned).toEqual([FIRST.id]);
  });

  it("refuses to carry a bed group onto an acre they do not own", async () => {
    const { token } = await player();
    const home = mapToSoilTile(YARD.tx, YARD.ty);
    await placeStackAcresSoilTile(token, home, T0);
    const away = clearTile(FIRST);
    const target = mapToSoilTile(away.tx, away.ty);
    await expect(
      moveStackAcresSoilTileGroup(token, { tx: home.tx, ty: home.ty, toTx: target.tx, toTy: target.ty }, T0),
    ).rejects.toThrow(ACRE_NOT_YOURS);
    expect((await readStackAcres(token, T0)).soilTiles.map((tile) => `${tile.tx},${tile.ty}`)).toEqual([`${home.tx},${home.ty}`]);
  });
});

describe("what holding acres costs", () => {
  const DAY = stackacresExchangeDay(T0);

  it("adds a flat fee for each bought acre to the day's bill", async () => {
    const { token } = await player();
    expect((await readStackAcres(token, T0)).upkeep.fee).toBe(0);
    await buyStackAcresAcre(token, { acreId: FIRST.id }, T0);
    expect((await readStackAcres(token, T0)).upkeep.fee).toBe(ACRE_UPKEEP_GOLD);
    await buyStackAcresAcre(token, { acreId: SECOND.id }, T0);
    expect((await readStackAcres(token, T0)).upkeep.fee).toBe(2 * ACRE_UPKEEP_GOLD);
  });

  it("does not bill ground a farm already used", async () => {
    const { token, id } = await player();
    __grantStackAcresAcreForTest(id, FIRST.id, "grandfathered");
    expect((await readStackAcres(token, T0)).upkeep.fee).toBe(0);
  });

  it("is skimmed off a sale like the rest of land upkeep, and never taken from a wallet", async () => {
    const { token, id } = await player();
    await buyStackAcresAcre(token, { acreId: FIRST.id }, T0);
    await buyStackAcresAcre(token, { acreId: SECOND.id }, T0);
    const fee = 2 * ACRE_UPKEEP_GOLD;
    const eggPrice = itemSellPrice("eggs");
    const quantity = Math.ceil((fee * 2) / eggPrice);
    await adjustStackAcresInventory(id, "eggs", quantity);
    const before = (await ensureProfile(token)).goldBalance;
    expect(await readStackAcresUpkeep(id, DAY)).toBe(0);

    const sold = await sellStackAcresItem(token, { buyer: "general-store", item: "eggs", quantity }, T0);

    expect(await readStackAcresUpkeep(id, DAY)).toBe(fee);
    expect((await ensureProfile(token)).goldBalance).toBe(before + sold.sold.gold - fee);
  });
});
