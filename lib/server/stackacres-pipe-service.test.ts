import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { cropSpot, stockZone } from "@/lib/stackacres/world";
import { STACKACRES_CATALOGUE } from "@/lib/stackacres/catalogue";
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
  recordStackAcresSectorCleared,
} from "./stackacres-store";
import { __resetStackAcresPipesForTest } from "./stackacres-pipe-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { SECTOR_LADDER } from "@/lib/stackacres/sectors";
import { adjustGold, ensureProfile } from "./profile-store";

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
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/** Sows a cash_crop and returns its id plus the pipe tile it stands on. */
async function sowCropOnKnownTile(token: string) {
  const view = await stockStackAcres(token, { stock: "cash_crop" }, T0);
  const unit = view.units.filter((u) => u.stock === "cash_crop").at(-1);
  if (!unit) throw new Error("no cash_crop unit");
  const spot = cropSpot(stockZone("cash_crop"), unit.id);
  return { unitId: unit.id, tile: pipeTileAt(spot.x, spot.y), readyAt: unit.readyAt };
}

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresPipesForTest();
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
});

describe("irrigation keeps a connected crop growing", () => {
  it("a piped crop never reads dry, and losing no time either way", async () => {
    const { token } = await funded();
    const { unitId, tile, readyAt } = await sowCropOnKnownTile(token);
    // cash_crop: 90 min thirst window inside a 240 min cycle.
    const thirstMin = (STACKACRES_CATALOGUE.cash_crop.thirstMs ?? 0) / MIN;
    const durationMin = STACKACRES_CATALOGUE.cash_crop.durationMs / MIN;
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
