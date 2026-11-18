// Scratch reproduction for the S1 livestock findings. Not part of the patch.
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { STACKACRES_CATALOGUE } from "@/lib/stackacres/catalogue";
import { gameHourAt, isNightHour } from "@/lib/stackacres/clock";
import { isHerdMapTile } from "@/lib/stackacres/herd";
import { herdAway } from "@/lib/stackacres/herd-risk";
import { mapToSoilTile } from "@/lib/stackacres/hoeable";
import { dialogueNodeFor } from "@/lib/stackacres/story/dialogue";
import {
  buyStackAcresFeed,
  buyStackAcresGuardDog,
  feedStackAcres,
  harvestStackAcres,
  meetStackAcresTraveler,
  moveStackAcresSoilTileGroup,
  pickUpStackAcresAnimal,
  placeStackAcresAnimal,
  placeStackAcresFencePiece,
  placeStackAcresMachine,
  placeStackAcresSoilTile,
  readStackAcres,
  shipStackAcresLivestock,
  stockStackAcres,
  buyStackAcresStock,
} from "./stackacres-service";
import {
  __resetStackAcresForTest,
  adjustStackAcresFeed,
  adjustStackAcresInventory,
  feedStackAcresUnit,
  getStackAcresUnit,
  readStackAcresFeed,
  readStackAcresInventory,
} from "./stackacres-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { __resetStackAcresRevisionsForTest } from "./stackacres-revision-store";
import { __resetStackAcresSoilTilesForTest } from "./stackacres-soil-store";
import { __resetStackAcresFencesForTest } from "./stackacres-fence-store";
import { __resetStackAcresGuardDogsForTest } from "./stackacres-guard-dog-store";
import { __resetStackAcresClockForTest } from "./stackacres-clock-store";
import { __resetStackAcresSeedStockForTest } from "./stackacres-seed-store";
import { adjustGold, ensureProfile } from "./profile-store";

const T0 = new Date("2026-09-30T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresIntentsForTest();
  __resetStackAcresRevisionsForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresFencesForTest();
  __resetStackAcresGuardDogsForTest();
  __resetStackAcresClockForTest();
  __resetStackAcresSeedStockForTest();
});

async function funded(gold = 1_000_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  await adjustGold(profile.id, gold - profile.goldBalance);
  return { token, id: profile.id };
}

async function stockOne(token: string, stock: "hog" | "steer" | "pig" | "cattle" | "hen", at = T0): Promise<string> {
  const before = new Set((await readStackAcres(token, at)).units.map((unit) => unit.id));
  const view = await stockStackAcres(token, { stock }, at);
  const unit = view.units.find((candidate) => candidate.stock === stock && !before.has(candidate.id));
  if (!unit) throw new Error(`no ${stock}`);
  return unit.id;
}

async function topUp(profileId: string, unitId: string, at: Date): Promise<void> {
  const row = await getStackAcresUnit(profileId, unitId);
  if (!row) throw new Error("no such unit");
  const fed = await feedStackAcresUnit(row, at, new Date(row.readyAt), null, 0);
  if (!fed) throw new Error("could not top up");
}

function openSquares(count: number): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  for (let ty = 1; ty < 200 && out.length < count; ty += 1) {
    for (let tx = 1; tx < 200 && out.length < count; tx += 1) if (isHerdMapTile(tx, ty) && isHerdMapTile(tx + 1, ty)) out.push({ tx, ty });
  }
  return out;
}

const errorOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

describe("C2-03 / C3-03: milestones from animals", () => {
  it("a shipped hog takes the Sheep Pen milestone with it", async () => {
    const { token, id } = await funded();
    const fresh = await readStackAcres(token, T0);
    console.log("fresh sectors", fresh.sectors, "level", fresh.story.level, "pierre", fresh.story.travelers.pierre.unlocked);
    const bulkBefore = await errorOf(buyStackAcresFeed(token, { itemId: "bulk_shipment", quantity: 1 }, T0));
    console.log("bulk before:", (bulkBefore as Error | null)?.message ?? "ok");

    const hog = await stockOne(token, "hog");
    const withHog = await readStackAcres(token, T0);
    console.log("with hog sectors", withHog.sectors, "level", withHog.story.level, "pierre", withHog.story.travelers.pierre.unlocked);
    await meetStackAcresTraveler(token, "pierre", T0);
    const bulkWith = await errorOf(buyStackAcresFeed(token, { itemId: "bulk_shipment", quantity: 1 }, T0));
    console.log("bulk with hog:", (bulkWith as Error | null)?.message ?? "ok");

    const ready = new Date(T0.getTime() + STACKACRES_CATALOGUE.hog.durationMs);
    await topUp(id, hog, ready);
    await shipStackAcresLivestock(token, ready);
    const after = await readStackAcres(token, ready);
    console.log("after ship sectors", after.sectors, "level", after.story.level, "pierre", JSON.stringify(after.story.travelers.pierre));
    const bulkAfter = await errorOf(buyStackAcresFeed(token, { itemId: "bulk_shipment", quantity: 1 }, ready));
    console.log("bulk after ship:", (bulkAfter as Error | null)?.message ?? "ok");
    console.log("pierre bubble:", dialogueNodeFor("pierre", after.story.travelers.pierre).id);
    expect(after.sectors).not.toContain("wallow");
  });

  it("a collected sheep lease and a bought cow", async () => {
    const { token, id } = await funded();
    const sheep = await stockOne(token, "pig");
    const ready = new Date(T0.getTime() + STACKACRES_CATALOGUE.pig.durationMs);
    await topUp(id, sheep, ready);
    await harvestStackAcres(token, { unitIds: [sheep] }, ready);
    const after = await readStackAcres(token, ready);
    console.log("after sheep lease collect: sectors", after.sectors, "units", after.units.length);

    const cow = await buyStackAcresStock(token, { stock: "cattle" }, ready);
    console.log("bought cow: sectors", cow.sectors);
  });
});

describe("C2-04: the Barn makes a hog lighter", () => {
  for (const barn of [false, true]) {
    it(`hog fed at every hunger, barn=${barn}`, async () => {
      const { token, id } = await funded();
      if (barn) {
        await adjustStackAcresInventory(id, "wood", 40);
        await placeStackAcresMachine(token, "barn", T0);
      }
      await adjustStackAcresInventory(id, "cattle_feed", 20);
      const hog = await stockOne(token, "hog");
      const fedAt: number[] = [];
      let shipped: unknown = null;
      for (let m = 5; m <= 240 && !shipped; m += 5) {
        const at = new Date(T0.getTime() + m * MIN);
        const fed = await errorOf(feedStackAcres(token, hog, at));
        if (fed === null) fedAt.push(m);
        const view = await readStackAcres(token, at);
        const unit = view.units.find((candidate) => candidate.id === hog);
        if (unit?.state === "ready") {
          const result = await shipStackAcresLivestock(token, at);
          shipped = { m, ...result.shipped.animals[0] };
        }
      }
      console.log(`barn=${barn} fed at`, fedAt.join(","), "shipped", JSON.stringify(shipped));
    });
  }
});

describe("C3-02 / C3-09: away in daylight, pick-up brings it back", () => {
  it("a sheep set down by day is away at once and a pick-up brings it home", async () => {
    const { token, id } = await funded();
    const sheep = await stockOne(token, "pig");
    const [square] = openSquares(1);
    // A daytime moment on a UTC day this sheep rolls a loss.
    let at: Date | null = null;
    for (let n = 1; n < 120 && !at; n += 1) {
      const dayStart = Date.parse("2026-10-01T00:00:00Z") + n * DAY;
      if (herdAway([{ id: sheep, stock: "pig", mapTx: square.tx, mapTy: square.ty }], new Set(), dayStart).size === 0) continue;
      for (let ms = dayStart; ms < dayStart + DAY; ms += MIN) {
        if (!isNightHour(gameHourAt(ms, 0))) {
          at = new Date(ms);
          break;
        }
      }
    }
    if (!at) throw new Error("never away");
    const placed = await placeStackAcresAnimal(token, { unitId: sheep, ...square }, at);
    const unit = placed.units.find((candidate) => candidate.id === sheep);
    console.log("farm hour", gameHourAt(at.getTime(), 0).toFixed(2), "away right after placing:", unit?.away);
    const later = await readStackAcres(token, new Date(at.getTime() + 12 * HOUR));
    console.log("12 real hours later (~55 farm days):", later.units.find((candidate) => candidate.id === sheep)?.away);

    // Ready and fed, then collect is refused while away; pick it up and it collects.
    const ready = new Date(Math.max(at.getTime(), T0.getTime() + STACKACRES_CATALOGUE.pig.durationMs) + MIN);
    const sameDay = new Date(Math.min(ready.getTime(), Math.floor(at.getTime() / DAY) * DAY + DAY - MIN));
    await topUp(id, sheep, sameDay);
    const refused = await errorOf(harvestStackAcres(token, { unitIds: [sheep] }, sameDay));
    console.log("collect while away:", (refused as Error | null)?.message ?? "ok");
    const lifted = await pickUpStackAcresAnimal(token, { unitId: sheep }, sameDay);
    console.log("away after pick-up:", lifted.units.find((candidate) => candidate.id === sheep)?.away);
    const collected = await errorOf(harvestStackAcres(token, { unitIds: [sheep] }, sameDay));
    console.log("collect after pick-up:", (collected as Error | null)?.message ?? "ok");
  });
});

describe("C3-06: the Silo never runs on a hand feed", () => {
  it("a hand feed pushes readyAt while the Silo sits full", async () => {
    const { token, id } = await funded();
    await adjustStackAcresInventory(id, "stone", 20);
    await placeStackAcresMachine(token, "feed_silo", T0);
    await adjustStackAcresFeed(id, 6);
    const sheep = await stockOne(token, "pig");
    const before = await getStackAcresUnit(id, sheep);
    const at = new Date(T0.getTime() + 3 * HOUR);
    const viewBefore = await readStackAcres(token, at);
    console.log("state at 3h:", viewBefore.units.find((u) => u.id === sheep)?.state, "silo left", viewBefore.machines.find((m) => m.kind === "feed_silo")?.autoFeedsLeft);
    await feedStackAcres(token, sheep, at);
    const after = await getStackAcresUnit(id, sheep);
    const view = await readStackAcres(token, at);
    console.log(
      "readyAt pushed by min:",
      (Date.parse(after!.readyAt) - Date.parse(before!.readyAt)) / MIN,
      "silo left",
      view.machines.find((m) => m.kind === "feed_silo")?.autoFeedsLeft,
    );
  });
});

describe("C2-11 / C3-11 / C3-12: what animals eat first", () => {
  it("a hog eats corn before cattle feed, and keeps eating past full weight", async () => {
    const { token, id } = await funded();
    await adjustStackAcresInventory(id, "corn", 12);
    await adjustStackAcresInventory(id, "cattle_feed", 8);
    await adjustStackAcresFeed(id, 10);
    const hog = await stockOne(token, "hog");
    for (let n = 1; n <= 8; n += 1) {
      const at = new Date(T0.getTime() + n * 30 * MIN);
      const result = await errorOf(feedStackAcres(token, hog, at));
      const inv = await readStackAcresInventory(id);
      const row = await getStackAcresUnit(id, hog);
      console.log(`hog feed #${n}`, (result as Error | null)?.message ?? "ok", "bonus", row?.feedBonus, "corn", inv.corn, "cattle_feed", inv.cattle_feed, "sack", await readStackAcresFeed(id));
    }
  });

  it("a hen eats wheat before the Feed Sack", async () => {
    const { token, id } = await funded();
    await adjustStackAcresInventory(id, "wheat", 3);
    await adjustStackAcresFeed(id, 6);
    const hen = await stockOne(token, "hen");
    await feedStackAcres(token, hen, new Date(T0.getTime() + 9 * MIN));
    console.log("hen: wheat", (await readStackAcresInventory(id)).wheat, "sack", await readStackAcresFeed(id));
  });
});

describe("C3-10: beds and fences under animals and dogs", () => {
  it("accepts a bed, a fence piece, a moved bed and a bed under the dog", async () => {
    const { token, id } = await funded();
    await adjustStackAcresInventory(id, "wood", 20);
    const [a, b, c, d, e] = openSquares(40).filter((_, i) => i % 6 === 0);
    const sheep = await stockOne(token, "pig");
    const sheep2 = await stockOne(token, "pig");
    const cow = await stockOne(token, "cattle");
    await placeStackAcresAnimal(token, { unitId: sheep, ...a }, T0);
    await placeStackAcresAnimal(token, { unitId: sheep2, ...b }, T0);
    await placeStackAcresAnimal(token, { unitId: cow, ...c }, T0);
    console.log("bed on a sheep:", ((await errorOf(placeStackAcresSoilTile(token, mapToSoilTile(a.tx, a.ty), T0))) as Error | null)?.message ?? "accepted");
    console.log("fence on a sheep:", ((await errorOf(placeStackAcresFencePiece(token, b, T0))) as Error | null)?.message ?? "accepted");
    const bed = mapToSoilTile(d.tx, d.ty);
    await placeStackAcresSoilTile(token, bed, T0);
    const to = mapToSoilTile(c.tx, c.ty);
    console.log("bed moved onto a cow:", ((await errorOf(moveStackAcresSoilTileGroup(token, { ...bed, toTx: to.tx, toTy: to.ty }, T0))) as Error | null)?.message ?? "accepted");
    await buyStackAcresGuardDog(token, e, T0);
    console.log("bed under the dog:", ((await errorOf(placeStackAcresSoilTile(token, mapToSoilTile(e.tx, e.ty), T0))) as Error | null)?.message ?? "accepted");
  });
});
