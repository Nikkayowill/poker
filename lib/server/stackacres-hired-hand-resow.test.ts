import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { STACKACRES_DAY_MS } from "@/lib/stackacres/clock";
import { HIRED_HAND_BEDS_TO_HIRE, HIRED_HAND_CHORES_EVERY_MS } from "@/lib/stackacres/hired-hand";
import { SOIL_TILE, soilTileAt } from "@/lib/stackacres/soil";
import { CROP_FIELD_BEDS } from "@/lib/stackacres/world";
import { adjustGold, ensureProfile } from "./profile-store";
import { __resetStackAcresHiredHandForTest } from "./stackacres-hired-hand-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { __resetStackAcresRevisionsForTest } from "./stackacres-revision-store";
import { __resetStackAcresSeedStockForTest, adjustStackAcresSeedStock, readStackAcresSeedStock } from "./stackacres-seed-store";
import { hireStackAcresHand, readStackAcres, runStackAcresHiredHand, stockStackAcres } from "./stackacres-service";
import { __resetStackAcresSoilTilesForTest, placeStackAcresSoilTile } from "./stackacres-soil-store";
import { __resetStackAcresForTest, listStackAcresUnits, recordStackAcresCropFieldsUnlocked } from "./stackacres-store";

/**
 * The player sows a bed in the moment between Earl picking it and Earl
 * sowing it again. The seed-shelf read Earl makes right before each sow is
 * where that moment is, so this hooks it.
 */
const between = vi.hoisted(() => ({ run: null as null | (() => Promise<boolean>) }));

vi.mock("./stackacres-seed-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stackacres-seed-store")>();
  return {
    ...actual,
    readStackAcresSeedStock: async (profileId: string) => {
      const run = between.run;
      between.run = null;
      // Waits for the moment Earl has picked the beds and not yet sown them.
      if (run && !(await run())) between.run = run;
      return actual.readStackAcresSeedStock(profileId);
    },
  };
});

const T0 = new Date(Math.floor(Date.parse("2026-10-04T12:00:00.000Z") / STACKACRES_DAY_MS) * STACKACRES_DAY_MS + 60_000);
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(() => {
  between.run = null;
  __resetStackAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresHiredHandForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresIntentsForTest();
  __resetStackAcresRevisionsForTest();
});

describe("Earl sowing a bed again", () => {
  it("leaves a bed the player just sowed, and never spends a seed on another one", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 1_000 - profile.goldBalance);
    await recordStackAcresCropFieldsUnlocked(profile.id, T0);
    await adjustStackAcresSeedStock(profile.id, "wheat", 100);
    const origin = soilTileAt(CROP_FIELD_BEDS.x + SOIL_TILE, CROP_FIELD_BEDS.y + SOIL_TILE);
    const tiles = Array.from({ length: HIRED_HAND_BEDS_TO_HIRE }, (_, i) => ({ tx: origin.tx + (i % 3), ty: origin.ty + Math.floor(i / 3) }));
    for (const tile of tiles) await placeStackAcresSoilTile(profile.id, tile.tx, tile.ty);

    await stockStackAcres(token, { stock: "wheat", tile: tiles[0] }, T0);
    await stockStackAcres(token, { stock: "wheat", tile: tiles[1] }, T0);
    await hireStackAcresHand(token, T0);
    await runStackAcresHiredHand(token, at(HIRED_HAND_CHORES_EVERY_MS));

    const later = at(HIRED_HAND_CHORES_EVERY_MS + 10 * 60_000);
    between.run = async () => {
      if ((await listStackAcresUnits(profile.id)).some((unit) => unit.stock === "wheat")) return false;
      await stockStackAcres(token, { stock: "wheat", tile: tiles[0] }, later);
      return true;
    };
    const seedsBefore = (await readStackAcresSeedStock(profile.id)).wheat ?? 0;
    const pass = await runStackAcresHiredHand(token, later);
    expect(pass.handChores.harvested).toHaveLength(2);

    // The player's crop on the first bed and Earl's on the second: nothing on a third.
    const wheat = (await readStackAcres(token, later)).units.filter((unit) => unit.stock === "wheat");
    expect(wheat).toHaveLength(2);
    // One seed for the player's sow (read before the hook ran), one for Earl's.
    expect((await readStackAcresSeedStock(profile.id)).wheat ?? 0).toBe(seedsBefore - 2);
  });
});
