import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { SOIL_TILE, soilTileAt } from "@/lib/stackacres/soil";
import { CROP_FIELD_BEDS } from "@/lib/stackacres/world";
import { adjustGold, ensureProfile } from "./profile-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { __resetStackAcresRevisionsForTest } from "./stackacres-revision-store";
import { __resetStackAcresSeedStockForTest, adjustStackAcresSeedStock, readStackAcresSeedStock } from "./stackacres-seed-store";
import { readStackAcres, stockStackAcres } from "./stackacres-service";
import { __resetStackAcresSoilTilesForTest, placeStackAcresSoilTile } from "./stackacres-soil-store";
import { __resetStackAcresForTest, recordStackAcresCropFieldsUnlocked } from "./stackacres-store";

const T0 = new Date("2026-10-05T12:00:00.000Z");

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresIntentsForTest();
  __resetStackAcresRevisionsForTest();
});

describe("two sows racing for the last free bed", () => {
  it("plants one crop in the bed and gives the other seed back, never one in the grass", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 1_000 - profile.goldBalance);
    await recordStackAcresCropFieldsUnlocked(profile.id, T0);
    await adjustStackAcresSeedStock(profile.id, "wheat", 10);
    const bed = soilTileAt(CROP_FIELD_BEDS.x + SOIL_TILE, CROP_FIELD_BEDS.y + SOIL_TILE);
    await placeStackAcresSoilTile(profile.id, bed.tx, bed.ty);

    const results = await Promise.allSettled([
      stockStackAcres(token, { stock: "wheat" }, T0),
      stockStackAcres(token, { stock: "wheat" }, T0),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const wheat = (await readStackAcres(token, T0)).units.filter((unit) => unit.stock === "wheat");
    expect(wheat).toHaveLength(1);
    expect((await readStackAcresSeedStock(profile.id)).wheat).toBe(9);
  });
});
