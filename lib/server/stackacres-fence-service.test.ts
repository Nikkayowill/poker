import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { FENCE_NEEDS_WOOD, FENCE_NOT_HERE, FENCE_WOOD_COST } from "@/lib/stackacres/fences";
import { isHoeableMapTile, mapToSoilTile } from "@/lib/stackacres/hoeable";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "@/lib/stackacres/homestead-ground";
import { ensureProfile } from "./profile-store";
import { __resetStackAcresFencesForTest } from "./stackacres-fence-store";
import { __resetStackAcresSoilTilesForTest } from "./stackacres-soil-store";
import {
  placeStackAcresFencePiece,
  placeStackAcresSoilTile,
  readStackAcres,
  removeStackAcresFencePiece,
} from "./stackacres-service";
import { __resetStackAcresForTest, adjustStackAcresInventory } from "./stackacres-store";

const T0 = new Date("2026-09-24T12:00:00.000Z");

/** Open grass, and a square that is not (the first of each on the map). */
function firstSquare(hoeable: boolean): { tx: number; ty: number } {
  for (let ty = 0; ty < HOMESTEAD_MAP_HEIGHT; ty += 1) {
    for (let tx = 0; tx < HOMESTEAD_MAP_WIDTH; tx += 1) {
      if (isHoeableMapTile(tx, ty) === hoeable && (hoeable || ty > 40)) return { tx, ty };
    }
  }
  throw new Error("no such square");
}
const GRASS = firstSquare(true);
const ROAD = firstSquare(false);

async function farmWithWood(wood: number) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  if (wood > 0) await adjustStackAcresInventory(profile.id, "wood", wood);
  return token;
}

describe("fences the player builds", () => {
  beforeEach(() => {
    __resetStackAcresForTest();
    __resetStackAcresSoilTilesForTest();
    __resetStackAcresFencesForTest();
  });

  it("puts a piece up for its Wood and gives the Wood back when it comes down", async () => {
    const token = await farmWithWood(5);
    const up = await placeStackAcresFencePiece(token, GRASS, T0);
    expect(up.fences).toContainEqual(GRASS);
    expect(up.inventory.wood).toBe(5 - FENCE_WOOD_COST);
    const down = await removeStackAcresFencePiece(token, GRASS, T0);
    expect(down.fences).toEqual([]);
    expect(down.inventory.wood).toBe(5);
  });

  it("pays nothing back for a piece that was never there", async () => {
    const token = await farmWithWood(5);
    const view = await removeStackAcresFencePiece(token, GRASS, T0);
    expect(view.inventory.wood).toBe(5);
  });

  it("refuses without the Wood, and off the grass", async () => {
    const poor = await farmWithWood(1);
    await expect(placeStackAcresFencePiece(poor, GRASS, T0)).rejects.toThrow(FENCE_NEEDS_WOOD);
    expect((await readStackAcres(poor, T0)).fences).toEqual([]);
    const rich = await farmWithWood(5);
    await expect(placeStackAcresFencePiece(rich, ROAD, T0)).rejects.toThrow(FENCE_NOT_HERE);
  });

  it("keeps fences and beds off each other's squares", async () => {
    const token = await farmWithWood(10);
    await placeStackAcresFencePiece(token, GRASS, T0);
    await expect(placeStackAcresSoilTile(token, mapToSoilTile(GRASS.tx, GRASS.ty), T0)).rejects.toThrow("fence");

    const next = { tx: GRASS.tx + 1, ty: GRASS.ty };
    await placeStackAcresSoilTile(token, mapToSoilTile(next.tx, next.ty), T0);
    await expect(placeStackAcresFencePiece(token, next, T0)).rejects.toThrow("bed");
  });
});
