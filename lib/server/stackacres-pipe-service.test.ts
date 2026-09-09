import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { cropSpot, CROP_FIELD_BEDS, growAreaBounds, stockZone } from "@/lib/stackacres/world";
import { STACKACRES_CATALOGUE, STACKACRES_CROPS } from "@/lib/stackacres/catalogue";
import {
  __resetStackAcresSeedStockForTest,
  adjustStackAcresSeedStock,
} from "./stackacres-seed-store";
import { pipeKey, pipeTileAt, PIPE_NEIGHBORS } from "@/lib/stackacres/irrigation";
import {
  PIPE_PLACE_COST,
  StackAcresRequestError,
  placeStackAcresPipeTile,
  readStackAcres,
  removeStackAcresPipeTile,
  stockStackAcres,
} from "./stackacres-service";
import {
  __resetStackAcresForTest,
  recordStackAcresCropFieldsUnlocked,
  recordStackAcresSectorCleared,
} from "./stackacres-store";
import { __resetStackAcresPipesForTest } from "./stackacres-pipe-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { SECTOR_LADDER } from "@/lib/stackacres/sectors";
import { adjustGold, ensureProfile } from "./profile-store";
import { createSoilMap, mergeSoilTiles } from "@/lib/stackacres/soil";

const T0 = new Date("2026-08-31T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

async function funded(gold = 500_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  for (const sector of SECTOR_LADDER) {
    await recordStackAcresSectorCleared(profile.id, sector, T0);
  }
  // Corn is zoned to the Farmstead now (2026-09-08 district merge) and its
  // real gate is the standalone Crop Fields unlock, not a sector.
  await recordStackAcresCropFieldsUnlocked(profile.id, T0);
  // Ray's seed shelf gates planting a crop now -- see the 2026-09-07 seed
  // inventory pass. This file's own corn-sowing helper predates that gate.
  for (const crop of STACKACRES_CROPS) await adjustStackAcresSeedStock(profile.id, crop, 1000);
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/**
 * Sows a corn and returns its id plus the pipe tile it stands on.
 *
 * RESOLVES THE SPOT THE WAY THE FARM DRAWS IT -- through the soil map and the
 * crop's own fixed slot. This used to call `cropSpot(zone, unit.id)` with no
 * placement, which is the hash-SCATTER fallback, and it passed only because
 * the service resolved it the same wrong way: both agreed on a point the crop
 * is not drawn at. Now that `irrigableCrops` measures reach from the bed the
 * crop actually stands on, this helper has to as well, or it places the pipe
 * somewhere the plant isn't.
 */
async function sowCropOnKnownTile(token: string) {
  const view = await stockStackAcres(token, { stock: "corn" }, T0);
  const unit = view.units.filter((u) => u.stock === "corn").at(-1);
  if (!unit) throw new Error("no corn unit");
  const soil = createSoilMap(mergeSoilTiles(CROP_FIELD_BEDS, view.soilTiles));
  const spot = cropSpot(stockZone("corn"), unit.id, {
    soil,
    rank: 0,
    slot: unit.soilSlot,
  });
  return { unitId: unit.id, tile: pipeTileAt(spot.x, spot.y), readyAt: unit.readyAt };
}

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresPipesForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresIntentsForTest();
});

describe("placeStackAcresPipeTile — money ordering", () => {
  it("spends Gold for a well and a pipe, and reports the layout", async () => {
    const { token } = await funded(10_000);
    const start = await balance(token);

    await placeStackAcresPipeTile(token, { tx: 0, ty: 0, kind: "well" }, T0);
    const view = await placeStackAcresPipeTile(token, { tx: 1, ty: 0, kind: "pipe" }, T0);

    expect(await balance(token)).toBe(start - PIPE_PLACE_COST.well - PIPE_PLACE_COST.pipe);
    const byKey = new Map(view.irrigation.map((n) => [pipeKey(n.tx, n.ty), n]));
    expect(byKey.get("0:0")?.kind).toBe("well");
    expect(byKey.get("0:0")?.hydrated).toBe(true);
    expect(byKey.get("1:0")?.kind).toBe("pipe");
    expect(byKey.get("1:0")?.hydrated).toBe(true);
    expect(byKey.get("1:0")?.mask).toBe(0b1000); // W link back to the well
  });

  it("refunds when the one well slot is already taken", async () => {
    const { token } = await funded(10_000);
    await placeStackAcresPipeTile(token, { tx: 0, ty: 0, kind: "well" }, T0);
    const afterFirst = await balance(token);

    await expect(
      placeStackAcresPipeTile(token, { tx: 5, ty: 5, kind: "well" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(afterFirst);
  });

  it("refuses when Gold is short and moves nothing", async () => {
    const { token } = await funded(10);
    await expect(
      placeStackAcresPipeTile(token, { tx: 0, ty: 0, kind: "well" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await balance(token)).toBe(10);
  });

  // Henhaven, Oxfields and Wallow are GROW_AREA entries the same as any
  // other district, but irrigation stays out of a pen -- see
  // stackacres-service.ts's own comment on `placeStackAcresPipeTile` for why
  // this has to be an authoritative, pre-debit check rather than trusting
  // the client's own `pipeLayableWorldTile`/`pipeExtraActions` gate.
  it("refuses a pipe or a well inside a pen, and spends nothing", async () => {
    const { token } = await funded(10_000);
    const start = await balance(token);
    const bounds = growAreaBounds("henhaven");
    const tile = pipeTileAt(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

    await expect(
      placeStackAcresPipeTile(token, { ...tile, kind: "pipe" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
    await expect(
      placeStackAcresPipeTile(token, { ...tile, kind: "well" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(start);
  });
});

describe("irrigation keeps a connected crop growing", () => {
  it("a piped crop never reads dry, and losing no time either way", async () => {
    const { token } = await funded();
    const { unitId, tile, readyAt } = await sowCropOnKnownTile(token);
    // corn: 90 min thirst window inside a 240 min cycle.
    const thirstMin = (STACKACRES_CATALOGUE.corn.thirstMs ?? 0) / MIN;
    const durationMin = STACKACRES_CATALOGUE.corn.durationMs / MIN;
    expect(thirstMin).toBe(90);
    expect(durationMin).toBe(240);

    // Well one tile north of the crop, pipe on the crop's own tile.
    const wellTile = { tx: tile.tx + PIPE_NEIGHBORS[0].tx, ty: tile.ty + PIPE_NEIGHBORS[0].ty };
    await placeStackAcresPipeTile(token, { ...wellTile, kind: "well" }, T0);
    await placeStackAcresPipeTile(token, { tx: tile.tx, ty: tile.ty, kind: "pipe" }, T0);

    // 130 min: well past the 90 min thirst window a bare crop would freeze
    // at, still inside the 240 min cycle.
    const irrigatedView = await readStackAcres(token, at(130 * MIN));
    const irrigatedCrop = irrigatedView.units.find((u) => u.id === unitId);
    expect(irrigatedCrop?.state).toBe("working");
    expect(irrigatedCrop?.isWatered).toBe(true);
    expect(irrigatedCrop?.readyAt).toBe(readyAt); // no time credited or lost

    // Pull the pipe at 130 min: the crop freezes from HERE, not retroactively
    // to when the soil first ran dry (40 min).
    await removeStackAcresPipeTile(token, { tx: tile.tx, ty: tile.ty }, at(130 * MIN));

    // 225 min: a fresh 90 min drought after the pipe left (130 + 90 = 220),
    // still before the 240 min finish line -- so the crop is genuinely dry
    // and frozen, not ripe.
    const driedView = await readStackAcres(token, at(225 * MIN));
    const driedCrop = driedView.units.find((u) => u.id === unitId);
    expect(driedCrop?.state).toBe("dry");
    // ready_at STILL never jumped: irrigation credited nothing, and the
    // drought clock only started when the pipe left.
    expect(driedCrop?.readyAt).toBe(readyAt);
  });
});
