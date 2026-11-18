// S3-plumbing reproductions, against the real service and the memory store.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { adjustGold, ensureProfile } from "@/lib/server/profile-store";
import * as svc from "@/lib/server/stackacres-service";
import * as store from "@/lib/server/stackacres-store";
import { adjustStackAcresSeedStock, readStackAcresSeedStock, __resetStackAcresSeedStockForTest } from "@/lib/server/stackacres-seed-store";
import { readStackAcresFarmBoard, __resetStackAcresFarmBoardMemory } from "@/lib/server/stackacres-farm-board-store";
import { farmBoardPeriods } from "@/lib/server/stackacres-farm-board-service";
import { __resetStackAcresHiredHandForTest } from "@/lib/server/stackacres-hired-hand-store";
import { __resetStackAcresIntentsForTest } from "@/lib/server/stackacres-intent-store";
import { __resetStackAcresRevisionsForTest } from "@/lib/server/stackacres-revision-store";
import { __resetStackAcresSoilTilesForTest, placeStackAcresSoilTile } from "@/lib/server/stackacres-soil-store";
import { LAND_OBSTACLES } from "@/lib/stackacres/land-clearing";
import { WOOD_NODE_IDS } from "@/lib/stackacres/tree-nodes";
import { STACKACRES_DAY_MS } from "@/lib/stackacres/clock";
import { HIRED_HAND_BEDS_TO_HIRE, HIRED_HAND_CHORES_EVERY_MS } from "@/lib/stackacres/hired-hand";
import { SOIL_TILE, soilTileAt } from "@/lib/stackacres/soil";
import { CROP_FIELD_BEDS } from "@/lib/stackacres/world";

const NOW = new Date("2026-10-05T15:00:00.000Z");

beforeEach(() => {
  store.__resetStackAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresHiredHandForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresIntentsForTest();
  __resetStackAcresRevisionsForTest();
  __resetStackAcresFarmBoardMemory();
});

async function farmer() {
  const token = `tok-${randomUUID()}`;
  const profile = await ensureProfile(token);
  return { token, id: profile.id };
}

describe("C4-06", () => {
  it("6 swings at once at different obstacles", async () => {
    let refused = 0;
    const messages = new Set<string>();
    let roundless = 0;
    for (let round = 0; round < 5; round += 1) {
      const { token, id } = await farmer();
      const obs = LAND_OBSTACLES.cropfields.slice(round * 6, round * 6 + 6);
      const res = await Promise.allSettled(obs.map((o) => svc.workStackAcresLand(token, o.id, NOW)));
      for (const r of res) {
        if (r.status === "rejected") {
          refused += 1;
          messages.add(String((r.reason as Error).message));
          if (r.reason instanceof svc.StackAcresRequestError && !r.reason.round) roundless += 1;
        }
      }
      const landed = res.filter((r) => r.status === "fulfilled" && r.value.landCleared).length;
      const energy = (await store.readStackAcresEnergy(id))?.level;
      console.log(`round ${round}: landed ${landed}, energy ${energy}`);
    }
    console.log("C4-06 land refused", refused, [...messages], "roundless", roundless);
  });

  it("4 trees at once", async () => {
    let refused = 0;
    const messages = new Set<string>();
    for (let round = 0; round < 5; round += 1) {
      const { token } = await farmer();
      const res = await Promise.allSettled(WOOD_NODE_IDS.slice(0, 4).map((n) => svc.chopStackAcresWoodTree(token, n, NOW)));
      for (const r of res) if (r.status === "rejected") { refused += 1; messages.add(String((r.reason as Error).message)); }
    }
    console.log("C4-06 trees refused", refused, [...messages]);
  });
});

describe("C4-08", () => {
  it("replay drops sold and greet", async () => {
    const { token, id } = await farmer();
    await store.adjustStackAcresInventory(id, "wheat", 10);
    const key = randomUUID();
    const sell = () => svc.runStackAcresAction(token, key, "sell", () => svc.sellStackAcresItem(token, { item: "wheat", quantity: 2, buyer: "grain-elevator" }, NOW), NOW);
    const first = await sell();
    const second = await sell();
    console.log("C4-08 sell first.sold", JSON.stringify((first as Record<string, unknown>).sold), "second.sold", JSON.stringify((second as Record<string, unknown>).sold));
    const gkey = randomUUID();
    const greet = () => svc.runStackAcresAction(token, gkey, "greet-npc", () => svc.greetStackAcresNpc(token, "ray", NOW), NOW);
    const g1 = await greet();
    const g2 = await greet();
    console.log("C4-08 greet first", JSON.stringify((g1 as Record<string, unknown>).greet), "second", JSON.stringify((g2 as Record<string, unknown>).greet));
  });
});

describe("C4-09", () => {
  it("GET stores the farm board, and so does a visitor read", async () => {
    const { token, id } = await farmer();
    await svc.readStackAcres(token, NOW);
    const stored = await Promise.all(farmBoardPeriods(NOW).map((p) => readStackAcresFarmBoard(id, p.kind, p.start)));
    console.log("C4-09 after owner GET, stored rows:", stored.map((r) => (r ? r.board.codes.join(",") : null)));
    const visited = await farmer();
    const profile = await ensureProfile(visited.token);
    await svc.readStackAcresViewByProfile(profile, NOW);
    const visitorStored = await Promise.all(farmBoardPeriods(NOW).map((p) => readStackAcresFarmBoard(visited.id, p.kind, p.start)));
    console.log("C4-09 after visitor read, stored rows:", visitorStored.map((r) => (r ? r.board.codes.join(",") : null)));
  });
});

describe("C3-04", () => {
  const T0 = new Date(Math.floor(Date.parse("2026-10-04T12:00:00.000Z") / STACKACRES_DAY_MS) * STACKACRES_DAY_MS + 60_000);
  const at = (ms: number) => new Date(T0.getTime() + ms);
  it("Earl stops at the first crop he has no seed for", async () => {
    const { token, id } = await farmer();
    await adjustGold(id, 1_000 - (await ensureProfile(token)).goldBalance);
    await store.recordStackAcresCropFieldsUnlocked(id, T0);
    await adjustStackAcresSeedStock(id, "wheat", 10);
    await adjustStackAcresSeedStock(id, "potato", 1);
    const origin = soilTileAt(CROP_FIELD_BEDS.x + SOIL_TILE, CROP_FIELD_BEDS.y + SOIL_TILE);
    const tiles = Array.from({ length: HIRED_HAND_BEDS_TO_HIRE }, (_, i) => ({ tx: origin.tx + (i % 3), ty: origin.ty + Math.floor(i / 3) }));
    for (const tile of tiles) await placeStackAcresSoilTile(id, tile.tx, tile.ty);
    await svc.stockStackAcres(token, { stock: "potato", tile: tiles[0] }, T0);
    await svc.stockStackAcres(token, { stock: "wheat", tile: tiles[1] }, T0);
    await svc.stockStackAcres(token, { stock: "wheat", tile: tiles[2] }, T0);
    await svc.hireStackAcresHand(token, T0);
    await svc.runStackAcresHiredHand(token, at(HIRED_HAND_CHORES_EVERY_MS));
    const pass = await svc.runStackAcresHiredHand(token, at(HIRED_HAND_CHORES_EVERY_MS + 10 * 60_000));
    console.log("C3-04 harvested", pass.handChores.harvested.length, "units after", pass.units.map((u) => u.stock), "seed", JSON.stringify(await readStackAcresSeedStock(id)));
  });
});

describe("C3-13", () => {
  it("empire wheat is hard-coded zero", async () => {
    const { token, id } = await farmer();
    await store.adjustStackAcresInventory(id, "wheat", 4);
    const view = await svc.readStackAcres(token, NOW);
    console.log("C3-13 inventory.wheat", view.inventory.wheat, "empire.wheat", view.empire.wheat);
  });
});

describe("C3-07", () => {
  it("seed refusal names Ray's shop", async () => {
    const { token, id } = await farmer();
    await store.recordStackAcresCropFieldsUnlocked(id, NOW);
    const origin = soilTileAt(CROP_FIELD_BEDS.x + SOIL_TILE, CROP_FIELD_BEDS.y + SOIL_TILE);
    await placeStackAcresSoilTile(id, origin.tx, origin.ty);
    const err = await svc.stockStackAcres(token, { stock: "wheat", tile: origin }, NOW).then(() => null, (e: unknown) => e);
    console.log("C3-07 refusal:", (err as Error | null)?.message);
  });
});
