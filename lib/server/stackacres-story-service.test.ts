import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { SOIL_TILE, soilTileAt } from "@/lib/stackacres/soil";
import { CROP_FIELD_BEDS } from "@/lib/stackacres/world";
import { ensureProfile } from "./profile-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { __resetStackAcresRevisionsForTest } from "./stackacres-revision-store";
import { __resetStackAcresSeedStockForTest, readStackAcresSeedStock } from "./stackacres-seed-store";
import {
  claimStackAcresStarterSeeds,
  meetStackAcresTraveler,
  readStackAcres,
  stockStackAcres,
  turnInStackAcresTravelerQuest,
  waterStackAcres,
} from "./stackacres-service";
import { __resetStackAcresSoilTilesForTest, placeStackAcresSoilTile } from "./stackacres-soil-store";
import { __resetStackAcresForTest, recordStackAcresCropFieldsUnlocked } from "./stackacres-store";

const T0 = new Date("2026-10-04T12:00:00.000Z");

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresIntentsForTest();
  __resetStackAcresRevisionsForTest();
});

/** A new farm that has done what Ray's welcome says: three beds sown with his wheat and watered. */
async function wateredThreeBeds() {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  await recordStackAcresCropFieldsUnlocked(profile.id, T0);
  await claimStackAcresStarterSeeds(token, T0);
  const origin = soilTileAt(CROP_FIELD_BEDS.x + SOIL_TILE, CROP_FIELD_BEDS.y + SOIL_TILE);
  for (let i = 0; i < 3; i += 1) {
    const tile = { tx: origin.tx + i * 2, ty: origin.ty };
    await placeStackAcresSoilTile(profile.id, tile.tx, tile.ty);
    await stockStackAcres(token, { stock: "wheat", tile }, T0);
  }
  for (const unit of (await readStackAcres(token, T0)).units) await waterStackAcres(token, unit.id, T0);
  return { token, profileId: profile.id };
}

describe("Ray's first quest", () => {
  it("counts the watering done before meeting him, and hands over a sack of wheat seed once", async () => {
    const { token, profileId } = await wateredThreeBeds();
    const seedBefore = (await readStackAcresSeedStock(profileId)).wheat ?? 0;

    const met = await meetStackAcresTraveler(token, "ray", T0);
    expect(met.story.travelers.ray.quest?.objectives).toEqual([expect.objectContaining({ have: 3, need: 3 })]);

    const turned = await turnInStackAcresTravelerQuest(token, "ray", undefined, T0);
    expect(turned.storyResult).toMatchObject({ traveler: "ray", outcome: "advanced", seeds: { crop: "wheat", quantity: 12 } });
    expect((await readStackAcresSeedStock(profileId)).wheat ?? 0).toBe(seedBefore + 12);

    // The next quest is not finished, so a second press is refused and gives nothing more.
    await expect(turnInStackAcresTravelerQuest(token, "ray", undefined, T0)).rejects.toThrow();
    expect((await readStackAcresSeedStock(profileId)).wheat ?? 0).toBe(seedBefore + 12);
  });
});
