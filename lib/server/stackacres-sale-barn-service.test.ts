import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STACKACRES_BASE_CAP, STACKACRES_CATALOGUE, STACKACRES_MARKET_ANIMALS } from "@/lib/stackacres/catalogue";
import { isHerdMapTile } from "@/lib/stackacres/herd";
import { herdAway } from "@/lib/stackacres/herd-risk";
import { MARKET_ANIMAL_NOT_COLLECTED } from "@/lib/stackacres/sale-barn";
import {
  StackAcresRequestError,
  buyStackAcresStock,
  feedStackAcres,
  harvestStackAcres,
  placeStackAcresAnimal,
  readStackAcres,
  shipStackAcresLivestock,
  stockStackAcres,
} from "./stackacres-service";
import * as store from "./stackacres-store";
import {
  __resetStackAcresForTest,
  adjustStackAcresInventory,
  feedStackAcresUnit,
  getStackAcresUnit,
  listStackAcresUnits,
} from "./stackacres-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { __resetStackAcresRevisionsForTest } from "./stackacres-revision-store";
import { __resetStackAcresSoilTilesForTest } from "./stackacres-soil-store";
import { adjustGold, ensureProfile } from "./profile-store";

const T0 = new Date("2026-09-30T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const HOG = STACKACRES_CATALOGUE.hog;

async function funded(gold = 1_000_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

async function goldOf(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/** Leases one hog at `at` and hands back its row id. */
async function buyHog(token: string, at = T0): Promise<string> {
  const before = new Set((await readStackAcres(token, at)).units.map((unit) => unit.id));
  const view = await stockStackAcres(token, { stock: "hog" }, at);
  const unit = view.units.find((candidate) => candidate.stock === "hog" && !before.has(candidate.id));
  if (!unit) throw new Error("no hog was stocked");
  return unit.id;
}

/** Feeds the hog straight in the store at `at` so it is not hungry, leaving `ready_at` alone. */
async function topUp(profileId: string, unitId: string, at: Date): Promise<void> {
  const row = await getStackAcresUnit(profileId, unitId);
  if (!row) throw new Error("no such unit");
  const fed = await feedStackAcresUnit(row, at, new Date(row.readyAt), null, 0);
  if (!fed) throw new Error("could not top up");
}

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresIntentsForTest();
  __resetStackAcresRevisionsForTest();
  __resetStackAcresSoilTilesForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buying a feeder at the sale barn", () => {
  it("leases a hog for its feeder price and never sells one outright", async () => {
    const { token } = await funded();
    const before = await goldOf(token);
    await buyHog(token);
    expect(await goldOf(token)).toBe(before - HOG.seedCost);

    const outright = await buyStackAcresStock(token, { stock: "hog" }, T0).catch((error: unknown) => error);
    expect(outright).toBeInstanceOf(StackAcresRequestError);
    expect(await goldOf(token)).toBe(before - HOG.seedCost);
  });

  it("snapshots the hog's starting weight as its yield", async () => {
    const { token, id } = await funded();
    const unitId = await buyHog(token);
    const row = await getStackAcresUnit(id, unitId);
    expect(row?.yieldQuantity).toBe(STACKACRES_MARKET_ANIMALS.hog.baseWeight);
  });

  it("refuses a fourth hog at the cap without taking Gold", async () => {
    const { token } = await funded();
    for (let n = 0; n < STACKACRES_BASE_CAP; n += 1) await buyHog(token);
    const before = await goldOf(token);
    const refusal = await stockStackAcres(token, { stock: "hog" }, T0).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(StackAcresRequestError);
    expect((refusal as StackAcresRequestError).status).toBe(409);
    expect(await goldOf(token)).toBe(before);
  });

  it("refunds the feeder price when the database turns the hog away at the cap", async () => {
    const { token, id } = await funded();
    const before = await goldOf(token);
    // The advisory-locked trigger is the real cap. A race past the friendly check
    // reaches it after the debit, and it raises.
    vi.spyOn(store, "createStackAcresUnit").mockRejectedValueOnce(
      new Error("StackAcres cap reached: 3 of 3 hog already occupied"),
    );
    const refusal = await stockStackAcres(token, { stock: "hog" }, T0).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(Error);
    expect(await goldOf(token)).toBe(before);
    expect((await listStackAcresUnits(id)).filter((unit) => unit.stock === "hog")).toHaveLength(0);
  });
});

describe("collecting from a hog", () => {
  it("is refused, and Harvest-all leaves the hog standing", async () => {
    const { token, id } = await funded();
    const unitId = await buyHog(token);
    const ready = new Date(T0.getTime() + HOG.durationMs);
    await topUp(id, unitId, ready);

    const refusal = await harvestStackAcres(token, { unitIds: [unitId] }, ready).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(StackAcresRequestError);
    expect((refusal as StackAcresRequestError).message).toBe(MARKET_ANIMAL_NOT_COLLECTED);

    const all = await harvestStackAcres(token, {}, ready).catch((error: unknown) => error);
    expect(all).toBeInstanceOf(StackAcresRequestError);
    expect(await getStackAcresUnit(id, unitId)).not.toBeNull();
  });
});

describe("feeding a hog", () => {
  it("puts on one weight per serving of corn, up to the cap", async () => {
    const { token, id } = await funded();
    await adjustStackAcresInventory(id, "corn", 20);
    const unitId = await buyHog(token);
    const hunger = HOG.hungerMs ?? 0;
    // Fed each time it goes hungry, five times: one more than the cap.
    for (let n = 1; n <= 5; n += 1) await feedStackAcres(token, unitId, new Date(T0.getTime() + n * hunger));
    const row = await getStackAcresUnit(id, unitId);
    expect(row?.feedBonus).toBe(STACKACRES_MARKET_ANIMALS.hog.maxFeedWeight);
    expect((await readStackAcres(token, T0)).units.find((unit) => unit.id === unitId)?.feedBonus).toBe(4);
  });
});

describe("shipping to market", () => {
  it("pays weight times price once, net of upkeep, and takes the hog off the farm", async () => {
    const { token, id } = await funded();
    const unitId = await buyHog(token);
    const ready = new Date(T0.getTime() + HOG.durationMs);
    await topUp(id, unitId, ready);
    const before = await goldOf(token);

    const result = await shipStackAcresLivestock(token, ready);
    expect(result.shipped.animals).toEqual([{ unitId, stock: "hog", weight: 6, gold: 600 }]);
    expect(result.shipped.gold).toBe(600);
    expect(await goldOf(token)).toBe(before + result.shipped.paid);
    expect(await getStackAcresUnit(id, unitId)).toBeNull();
  });

  it("never pays twice for the same animals when two shipments race", async () => {
    const { token, id } = await funded();
    const hogs = [await buyHog(token), await buyHog(token)];
    const ready = new Date(T0.getTime() + HOG.durationMs);
    for (const unitId of hogs) await topUp(id, unitId, ready);
    const before = await goldOf(token);

    const results = await Promise.allSettled([shipStackAcresLivestock(token, ready), shipStackAcresLivestock(token, ready)]);
    const shipped = results.flatMap((result) => (result.status === "fulfilled" ? [result.value.shipped] : []));
    const sold = shipped.flatMap((load) => load.animals.map((animal) => animal.unitId));
    expect(sold.sort()).toEqual([...hogs].sort());
    expect(shipped.reduce((total, load) => total + load.gold, 0)).toBe(1_200);
    expect(await goldOf(token)).toBe(before + shipped.reduce((total, load) => total + load.paid, 0));

    // And a third shipment afterwards has nothing left to sell.
    const again = await shipStackAcresLivestock(token, ready).catch((error: unknown) => error);
    expect(again).toBeInstanceOf(StackAcresRequestError);
    expect(await goldOf(token)).toBe(before + shipped.reduce((total, load) => total + load.paid, 0));
  });

  it("leaves a hungry hog on the farm", async () => {
    const { token, id } = await funded();
    const fed = await buyHog(token);
    const hungry = await buyHog(token);
    const ready = new Date(T0.getTime() + HOG.durationMs);
    await topUp(id, fed, ready);

    const result = await shipStackAcresLivestock(token, ready);
    expect(result.shipped.animals.map((animal) => animal.unitId)).toEqual([fed]);
    expect(await getStackAcresUnit(id, hungry)).not.toBeNull();
  });

  it("leaves a hog that wandered off in the night on the farm", async () => {
    const { token, id } = await funded();
    const unitId = await buyHog(token);
    const square = openSquare();
    await placeStackAcresAnimal(token, { unitId, tx: square.tx, ty: square.ty }, T0);

    // The first whole day this hog, loose in the open, is away.
    let night: Date | null = null;
    for (let n = 1; n < 60 && !night; n += 1) {
      const at = new Date(T0.getTime() + n * DAY);
      if (herdAway([{ id: unitId, stock: "hog", mapTx: square.tx, mapTy: square.ty }], new Set(), at.getTime()).size) night = at;
    }
    if (!night) throw new Error("never away in 60 nights");
    await topUp(id, unitId, night);

    const refusal = await shipStackAcresLivestock(token, night).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(StackAcresRequestError);
    expect((refusal as StackAcresRequestError).message).toBe("Nothing is ready to sell yet.");
    expect(await getStackAcresUnit(id, unitId)).not.toBeNull();
  });
});

/** Any square in the yard an animal may stand on. */
function openSquare(): { tx: number; ty: number } {
  for (let ty = 1; ty < 200; ty += 1) {
    for (let tx = 1; tx < 200; tx += 1) if (isHerdMapTile(tx, ty)) return { tx, ty };
  }
  throw new Error("no open square");
}
