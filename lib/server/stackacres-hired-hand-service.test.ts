import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { STACKACRES_DAY_MS } from "@/lib/stackacres/clock";
import {
  HIRED_HAND_ALREADY,
  HIRED_HAND_BEDS_TO_HIRE,
  HIRED_HAND_CANT_PAY,
  HIRED_HAND_CHORES_EVERY_MS,
  HIRED_HAND_DAILY_WAGE,
  HIRED_HAND_NOT_ENOUGH_BEDS,
} from "@/lib/stackacres/hired-hand";
import { SOIL_TILE, soilTileAt } from "@/lib/stackacres/soil";
import { CROP_FIELD_BEDS } from "@/lib/stackacres/world";
import { adjustGold, ensureProfile } from "./profile-store";
import { __resetStackAcresHiredHandForTest, readStackAcresHiredHand } from "./stackacres-hired-hand-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { __resetStackAcresRevisionsForTest } from "./stackacres-revision-store";
import { __resetStackAcresSeedStockForTest, adjustStackAcresSeedStock, readStackAcresSeedStock } from "./stackacres-seed-store";
import {
  StackAcresRequestError,
  dismissStackAcresHand,
  hireStackAcresHand,
  readStackAcres,
  runStackAcresHiredHand,
  stockStackAcres,
} from "./stackacres-service";
import { __resetStackAcresSoilTilesForTest, placeStackAcresSoilTile } from "./stackacres-soil-store";
import {
  __resetStackAcresForTest,
  readStackAcresWater,
  recordStackAcresCropFieldsUnlocked,
} from "./stackacres-store";

// Noon on a game day boundary's far side, so a few passes never cross midnight by accident.
const T0 = new Date(Math.floor(Date.parse("2026-10-04T12:00:00.000Z") / STACKACRES_DAY_MS) * STACKACRES_DAY_MS + 60_000);
const PASS = HIRED_HAND_CHORES_EVERY_MS;
const at = (ms: number) => new Date(T0.getTime() + ms);

async function farm(gold: number, beds = HIRED_HAND_BEDS_TO_HIRE) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  await recordStackAcresCropFieldsUnlocked(profile.id, T0);
  await adjustStackAcresSeedStock(profile.id, "wheat", 100);
  const origin = soilTileAt(CROP_FIELD_BEDS.x + SOIL_TILE, CROP_FIELD_BEDS.y + SOIL_TILE);
  const tiles = Array.from({ length: beds }, (_, i) => ({ tx: origin.tx + (i % 3), ty: origin.ty + Math.floor(i / 3) }));
  for (const tile of tiles) await placeStackAcresSoilTile(profile.id, tile.tx, tile.ty);
  return { token, profileId: profile.id, tiles };
}

async function gold(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

async function refusal(promise: Promise<unknown>): Promise<StackAcresRequestError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(StackAcresRequestError);
  return error as StackAcresRequestError;
}

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresHiredHandForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresIntentsForTest();
  __resetStackAcresRevisionsForTest();
});

describe("hiring Earl", () => {
  it("takes the first day's wage once and puts him on the farm", async () => {
    const { token } = await farm(1_000);
    const view = await hireStackAcresHand(token, T0);
    expect(view.hand).toMatchObject({ name: "Earl", wage: HIRED_HAND_DAILY_WAGE });
    expect(await gold(token)).toBe(1_000 - HIRED_HAND_DAILY_WAGE);
  });

  it("charges a double tap once", async () => {
    const { token } = await farm(1_000);
    const results = await Promise.allSettled([hireStackAcresHand(token, T0), hireStackAcresHand(token, T0)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await gold(token)).toBe(1_000 - HIRED_HAND_DAILY_WAGE);
  });

  it("won't sign on to a farm with too few beds, and takes nothing", async () => {
    const { token } = await farm(1_000, HIRED_HAND_BEDS_TO_HIRE - 1);
    expect((await refusal(hireStackAcresHand(token, T0))).message).toBe(HIRED_HAND_NOT_ENOUGH_BEDS);
    expect(await gold(token)).toBe(1_000);
  });

  it("wants his first day up front", async () => {
    const { token } = await farm(HIRED_HAND_DAILY_WAGE - 1);
    expect((await refusal(hireStackAcresHand(token, T0))).message).toBe(HIRED_HAND_CANT_PAY);
    expect((await readStackAcres(token, T0)).hand).toBeNull();
  });

  it("can't be hired twice", async () => {
    const { token } = await farm(1_000);
    await hireStackAcresHand(token, T0);
    expect((await refusal(hireStackAcresHand(token, T0))).message).toBe(HIRED_HAND_ALREADY);
    expect(await gold(token)).toBe(1_000 - HIRED_HAND_DAILY_WAGE);
  });
});

describe("Earl's wage", () => {
  it("is not charged again on the day he was hired", async () => {
    const { token } = await farm(1_000);
    await hireStackAcresHand(token, T0);
    const pass = await runStackAcresHiredHand(token, at(PASS));
    expect(pass.handChores.wagePaid).toBe(0);
    expect(await gold(token)).toBe(1_000 - HIRED_HAND_DAILY_WAGE);
  });

  it("is charged once on a new game day, however many tabs ask", async () => {
    const { token } = await farm(1_000);
    await hireStackAcresHand(token, T0);
    const nextDay = at(STACKACRES_DAY_MS);
    const passes = await Promise.all([runStackAcresHiredHand(token, nextDay), runStackAcresHiredHand(token, nextDay)]);
    expect(passes.map((pass) => pass.handChores.wagePaid).sort()).toEqual([0, HIRED_HAND_DAILY_WAGE]);
    expect(await gold(token)).toBe(1_000 - 2 * HIRED_HAND_DAILY_WAGE);
    await runStackAcresHiredHand(token, at(STACKACRES_DAY_MS + PASS));
    expect(await gold(token)).toBe(1_000 - 2 * HIRED_HAND_DAILY_WAGE);
  });

  it("bills one day after a long time away, not every day missed", async () => {
    const { token } = await farm(1_000);
    await hireStackAcresHand(token, T0);
    await runStackAcresHiredHand(token, at(30 * STACKACRES_DAY_MS));
    expect(await gold(token)).toBe(1_000 - 2 * HIRED_HAND_DAILY_WAGE);
  });

  it("quits when the wage can't be paid", async () => {
    const { token, profileId } = await farm(HIRED_HAND_DAILY_WAGE + 10);
    await hireStackAcresHand(token, T0);
    const pass = await runStackAcresHiredHand(token, at(STACKACRES_DAY_MS));
    expect(pass.handChores.quit).toBe(true);
    expect(pass.hand).toBeNull();
    expect(await readStackAcresHiredHand(profileId)).toBeNull();
    expect(await gold(token)).toBe(10);
  });

  it("stops costing anything once let go", async () => {
    const { token } = await farm(1_000);
    await hireStackAcresHand(token, T0);
    expect((await dismissStackAcresHand(token, T0)).hand).toBeNull();
    const pass = await runStackAcresHiredHand(token, at(STACKACRES_DAY_MS));
    expect(pass.handChores).toEqual({ watered: [], harvested: [], wagePaid: 0, quit: false });
    expect(await gold(token)).toBe(1_000 - HIRED_HAND_DAILY_WAGE);
  });
});

describe("Earl's chores", () => {
  it("waters sown seed from the well, never the player's can", async () => {
    const { token, profileId, tiles } = await farm(1_000);
    await stockStackAcres(token, { stock: "wheat", tile: tiles[0] }, T0);
    await hireStackAcresHand(token, T0);
    const can = await readStackAcresWater(profileId);
    const pass = await runStackAcresHiredHand(token, at(PASS));
    expect(pass.handChores.watered).toHaveLength(1);
    expect(pass.units.find((unit) => unit.id === pass.handChores.watered[0])?.isWatered).toBe(true);
    expect(await readStackAcresWater(profileId)).toBe(can);
  });

  it("brings in ripe wheat to the shelf", async () => {
    const { token, tiles } = await farm(1_000);
    await stockStackAcres(token, { stock: "wheat", tile: tiles[0] }, T0);
    await hireStackAcresHand(token, T0);
    await runStackAcresHiredHand(token, at(PASS));
    const before = (await readStackAcres(token, at(PASS))).inventory.wheat ?? 0;
    const pass = await runStackAcresHiredHand(token, at(PASS + 10 * 60_000));
    expect(pass.handChores.harvested).toHaveLength(1);
    expect(pass.inventory.wheat ?? 0).toBeGreaterThan(before);
  });

  it("sows each bed he picks again from the player's seed, and stops when it runs out", async () => {
    const { token, profileId, tiles } = await farm(1_000);
    await stockStackAcres(token, { stock: "wheat", tile: tiles[0] }, T0);
    await stockStackAcres(token, { stock: "wheat", tile: tiles[1] }, T0);
    await hireStackAcresHand(token, T0);
    await runStackAcresHiredHand(token, at(PASS));
    // Leave one seed: the first bed goes back in, the second waits for more.
    const held = (await readStackAcresSeedStock(profileId)).wheat ?? 0;
    await adjustStackAcresSeedStock(profileId, "wheat", 1 - held);
    const pass = await runStackAcresHiredHand(token, at(PASS + 10 * 60_000));
    expect(pass.handChores.harvested).toHaveLength(2);
    expect(pass.units.filter((unit) => unit.stock === "wheat")).toHaveLength(1);
    expect((await readStackAcresSeedStock(profileId)).wheat ?? 0).toBe(0);
    expect(await gold(token)).toBe(1_000 - HIRED_HAND_DAILY_WAGE);
  });

  it("takes one pass per interval", async () => {
    const { token, tiles } = await farm(1_000);
    for (const tile of tiles) await stockStackAcres(token, { stock: "wheat", tile }, T0);
    await hireStackAcresHand(token, T0);
    const passes = await Promise.all([runStackAcresHiredHand(token, at(PASS)), runStackAcresHiredHand(token, at(PASS))]);
    expect(passes.map((pass) => pass.handChores.watered.length).sort()).toEqual([0, 4]);
    expect((await runStackAcresHiredHand(token, at(PASS + 1_000))).handChores.watered).toHaveLength(0);
    expect((await runStackAcresHiredHand(token, at(2 * PASS))).handChores.watered).toHaveLength(2);
  });
});
