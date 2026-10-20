import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { isHoeableMapTile, isWildMapTile, mapToSoilTile } from "@/lib/stackacres/hoeable";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "@/lib/stackacres/homestead-ground";
import { STACKACRES_EQUIPMENT_DEFS, TRACTOR_NEEDED, TRACTOR_ROW_NOT_STRAIGHT, tilesAhead } from "@/lib/stackacres/tractor";
import { adjustGold, ensureProfile } from "./profile-store";
import { __resetStackAcresEquipmentForTest } from "./stackacres-equipment-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { __resetStackAcresSoilTilesForTest } from "./stackacres-soil-store";
import {
  StackAcresRequestError,
  buyStackAcresEquipment,
  placeStackAcresSoilRow,
  readStackAcres,
} from "./stackacres-service";
import { __resetStackAcresForTest, adjustStackAcresInventory } from "./stackacres-store";

const T0 = new Date("2026-10-02T12:00:00.000Z");
const TRACTOR = STACKACRES_EQUIPMENT_DEFS.tractor;

/** Six bare yard squares in a row, read off the real map so a redrawn yard cannot leave this digging a road. */
const YARD_ROW = (() => {
  const yard = (mx: number, my: number) => isHoeableMapTile(mx, my) && !isWildMapTile(mx, my);
  for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my++) {
    for (let mx = 0; mx + 6 <= HOMESTEAD_MAP_WIDTH; mx++) {
      if ([0, 1, 2, 3, 4, 5].every((dx) => yard(mx + dx, my))) return tilesAhead(mapToSoilTile(mx, my), "right", 6);
    }
  }
  throw new Error("no six bare yard squares in a row on the Homestead");
})();

async function farm(gold: number, metal: number) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  if (metal > 0) await adjustStackAcresInventory(profile.id, "metal", metal);
  return { token, profileId: profile.id };
}

async function purse(token: string) {
  const view = await readStackAcres(token, T0);
  return { gold: view.profile.goldBalance, metal: view.inventory.metal ?? 0, equipment: view.equipment };
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
  __resetStackAcresEquipmentForTest();
  __resetStackAcresIntentsForTest();
});

describe("buying the tractor", () => {
  it("takes 12,000 Gold and 8 Metal once and parks it on the farm", async () => {
    const { token } = await farm(20_000, 10);
    const view = await buyStackAcresEquipment(token, "tractor", T0);
    expect(view.boughtEquipment).toBe("tractor");
    expect(view.equipment).toEqual(["tractor"]);
    expect(await purse(token)).toEqual({ gold: 20_000 - TRACTOR.gold, metal: 10 - TRACTOR.metal, equipment: ["tractor"] });
  });

  it("charges a double tap once and gives the second one's Gold and Metal back", async () => {
    const { token } = await farm(40_000, 20);
    const results = await Promise.allSettled([
      buyStackAcresEquipment(token, "tractor", T0),
      buyStackAcresEquipment(token, "tractor", T0),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused && refused.status === "rejected" ? refused.reason : null).toBeInstanceOf(StackAcresRequestError);
    expect(await purse(token)).toEqual({ gold: 40_000 - TRACTOR.gold, metal: 20 - TRACTOR.metal, equipment: ["tractor"] });

    const again = await refusal(buyStackAcresEquipment(token, "tractor", T0));
    expect(again.status).toBe(409);
    expect((await purse(token)).gold).toBe(40_000 - TRACTOR.gold);
  });

  it("takes nothing when the Metal is short", async () => {
    const { token } = await farm(20_000, TRACTOR.metal - 1);
    await refusal(buyStackAcresEquipment(token, "tractor", T0));
    expect(await purse(token)).toEqual({ gold: 20_000, metal: TRACTOR.metal - 1, equipment: [] });
  });

  it("gives the Metal back when the Gold is short", async () => {
    const { token } = await farm(TRACTOR.gold - 1, 10);
    await refusal(buyStackAcresEquipment(token, "tractor", T0));
    expect(await purse(token)).toEqual({ gold: TRACTOR.gold - 1, metal: 10, equipment: [] });
  });

  it("does not sell the combine yet", async () => {
    const { token } = await farm(100_000, 50);
    expect((await refusal(buyStackAcresEquipment(token, "combine", T0))).status).toBe(400);
  });
});

describe("hoeing a row from the tractor", () => {
  it("is refused without a tractor, and digs nothing", async () => {
    const { token } = await farm(0, 0);
    const error = await refusal(placeStackAcresSoilRow(token, { tiles: YARD_ROW }, T0));
    expect(error.status).toBe(403);
    expect(error.message).toBe(TRACTOR_NEEDED);
    expect((await readStackAcres(token, T0)).soilTiles).toHaveLength(0);
  });

  it("refuses beds that are not one straight row", async () => {
    const { token } = await farm(20_000, 8);
    await buyStackAcresEquipment(token, "tractor", T0);
    const bent = [YARD_ROW[0], YARD_ROW[1], { tx: YARD_ROW[2].tx, ty: YARD_ROW[2].ty + 1 }];
    const gappy = [YARD_ROW[0], YARD_ROW[2]];
    for (const tiles of [bent, gappy]) {
      const error = await refusal(placeStackAcresSoilRow(token, { tiles }, T0));
      expect(error.status).toBe(400);
      expect(error.message).toBe(TRACTOR_ROW_NOT_STRAIGHT);
    }
    expect((await readStackAcres(token, T0)).soilTiles).toHaveLength(0);
  });

  it("digs the whole row, skipping a bed that is already there", async () => {
    const { token } = await farm(20_000, 8);
    await buyStackAcresEquipment(token, "tractor", T0);
    await placeStackAcresSoilRow(token, { tiles: YARD_ROW.slice(2, 4) }, T0);
    const view = await placeStackAcresSoilRow(token, { tiles: YARD_ROW }, T0);
    const dug = view.soilTiles.map((tile) => `${tile.tx},${tile.ty}`).sort();
    expect(dug).toEqual(YARD_ROW.map((tile) => `${tile.tx},${tile.ty}`).sort());
  });

  it("is refused when every bed in the row is already dug", async () => {
    const { token } = await farm(20_000, 8);
    await buyStackAcresEquipment(token, "tractor", T0);
    await placeStackAcresSoilRow(token, { tiles: YARD_ROW }, T0);
    expect((await refusal(placeStackAcresSoilRow(token, { tiles: YARD_ROW }, T0))).status).toBe(409);
  });
});
