import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StackAcresRequestError,
  buyStackAcresFeed,
  buyStackAcresStock,
  clearStackAcresUnit,
  expandStackAcresCapacity,
  feedStackAcres,
  harvestStackAcres,
  readStackAcres,
  retireStackAcresStock,
  stockStackAcres,
  type StackAcresView,
} from "./stackacres-service";
import {
  __stackacresHarvestsForTest,
  __resetStackAcresForTest,
  adjustStackAcresFeed,
  createStackAcresUnit,
  getStackAcresUnit,
  listStackAcresUnits,
  readStackAcresExchanged,
  readStackAcresFeed,
  readStackAcresUpkeep,
  recordStackAcresUpkeep,
  reserveStackAcresExchange,
} from "./stackacres-store";
import { adjustGold, ensureProfile } from "./profile-store";
import {
  STACKACRES_BASE_CAP,
  STACKACRES_CATALOGUE,
  STACKACRES_FEED,
  STACKACRES_MAX_EXTRA_CAP,
  stackacresCapacityPrice,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import { stackacresStockPrice } from "@/lib/stackacres/market";
import {
  STACKACRES_GOLD_CEILING,
  stackacresExchangeDay,
} from "@/lib/stackacres/exchange";
import {
  STACKACRES_STOCK,
  STACKACRES_YIELDS,
  itemGoldValue,
  netPerCycle,
  yieldValue,
} from "@/lib/stackacres/items";
import { stackacresUpkeepFee } from "@/lib/stackacres/upkeep";

// Passthrough by default; one test swaps createStackAcresUnit's next call for
// a thrown error, standing in for the DB trigger raising (which the memory
// branch cannot do). Found in security review on the Mint: that throw once
// skipped the refund entirely.
vi.mock("./stackacres-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stackacres-store")>();
  return {
    ...actual,
    createStackAcresUnit: vi.fn(actual.createStackAcresUnit),
    getStackAcresUnit: vi.fn(actual.getStackAcresUnit),
    // Also a passthrough spy, so one test can hand back a row whose snapshot
    // disagrees with the live catalogue. Nothing else can make those two
    // differ, because the guarded write refuses to re-settle a working unit.
    // It is THIS one the harvest reads -- a sweep lists rows rather than
    // fetching them one at a time.
    listStackAcresUnits: vi.fn(actual.listStackAcresUnits),
  };
});

/**
 * The StackAcres money contract, in memory mode.
 *
 * ONE CURRENCY NOW. These tests used to guard a wall between two -- Bushels
 * inside the farm, Gold outside -- and several of them asserted a Gold balance
 * was *unchanged* across an action for exactly that reason. That wall is gone
 * with the currency, and what replaced it is the thing the wall was really
 * protecting: **the farm pays Gold in exactly one place, and that place is
 * bounded by a flat daily constant.** Five actions spend Gold; one pays it.
 * The direction of a new path is the question, not its existence -- see the
 * "currency wall" block near the bottom, which now holds that claim
 * structurally rather than by counting.
 *
 * Nothing here can lose a sowing, so there is no losing branch to check --
 * what has to hold is exact and it all sits on the guards: the seed leaves
 * exactly once at stocking, the snapshotted yield is paid exactly once at
 * harvest and never before readiness, feed is spent exactly once per
 * feeding, and every failure path either never debits or refunds.
 */

const T0 = new Date("2026-08-31T12:00:00.000Z");
const HEN = STACKACRES_CATALOGUE.hen;
const CATTLE = STACKACRES_CATALOGUE.cattle;
const SPROUT = STACKACRES_CATALOGUE.sprout;
const HEN_READY = new Date(T0.getTime() + HEN.durationMs);
const HEN_YIELD = STACKACRES_YIELDS.hen;

/**
 * A profile with Gold, which is now the only thing a farm needs. There is no
 * starting grant to trigger any more, so this no longer has to read the farm
 * before topping the purse up.
 */
async function funded(gold = 500_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/** Brings in one named unit -- what tapping it on the map does. */
function collectOne(token: string, unitId: string, now = T0) {
  return harvestStackAcres(token, { unitIds: [unitId] }, now);
}

/**
 * Settles today's Land Maintenance up front, so that a test about YIELD is
 * about yield. The fee applies to every harvest and would otherwise be a term
 * in every assertion in this file; it has its own block, where it is the
 * subject rather than the noise.
 */
async function prepayUpkeep(id: string, units: number, at: Date = T0) {
  await recordStackAcresUpkeep(id, stackacresExchangeDay(at), stackacresUpkeepFee(units));
}

/** Burns `gold` of today's allowance directly, standing in for a day already
 *  spent. How it was spent is not what the ceiling tests are about. */
async function burnAllowance(id: string, gold: number, at: Date = T0) {
  await reserveStackAcresExchange(
    id,
    stackacresExchangeDay(at),
    gold,
    STACKACRES_GOLD_CEILING,
  );
}

/** The most recently created unit of `stock` in a view -- reliable because
 *  listStackAcresUnits orders by createdAt ascending and every test here
 *  stocks one kind at a time. */
function unitOf(view: StackAcresView, stock: StackAcresStock) {
  const matches = view.units.filter((u) => u.stock === stock);
  const unit = matches[matches.length - 1];
  if (!unit) throw new Error(`No ${stock} unit in this view`);
  return unit;
}

/**
 * The real implementations, captured before any test can replace them.
 *
 * `vi.mocked(fn).mockImplementation(fn)` looks like a reset and is actually
 * infinite recursion -- the imported binding IS the spy, so the spy ends up
 * calling itself. That shipped here for one run and turned every later test in
 * the file into a stack overflow, which is a good reminder that a leaked mock
 * fails somewhere other than where it was set.
 */
const REAL = {
  createStackAcresUnit: vi.mocked(createStackAcresUnit).getMockImplementation()!,
  getStackAcresUnit: vi.mocked(getStackAcresUnit).getMockImplementation()!,
  listStackAcresUnits: vi.mocked(listStackAcresUnits).getMockImplementation()!,
};

beforeEach(() => {
  __resetStackAcresForTest();
  vi.mocked(createStackAcresUnit).mockImplementation(REAL.createStackAcresUnit);
  vi.mocked(getStackAcresUnit).mockImplementation(REAL.getStackAcresUnit);
  vi.mocked(listStackAcresUnits).mockImplementation(REAL.listStackAcresUnits);
});

describe("stocking", () => {
  it("debits Gold and snapshots the yield and readiness onto the unit", async () => {
    const { token } = await funded();
    const before = await balance(token);

    const view = await stockStackAcres(token, { stock: "hen" }, T0);

    expect(await balance(token)).toBe(before - HEN.seedCost);
    const unit = unitOf(view, "hen");
    expect(unit.state).toBe("working");
    expect(unit.stake).toBe(HEN.seedCost);
    expect(unit.yieldQuantity).toBe(HEN_YIELD.quantity);
    expect(unit.readyAt).toBe(HEN_READY.toISOString());
  });

  it("is a sink: seeding one cycle costs a fiftieth of owning the tier", async () => {
    // The two prices are the same purchase at different terms, and the gap
    // between them is what makes both worth offering. If seeding ever costs
    // near the outright price, the shelf has one real option on it.
    for (const stock of STACKACRES_STOCK) {
      expect(STACKACRES_CATALOGUE[stock].seedCost * 50).toBe(stackacresStockPrice(stock));
    }
  });

  it("marks an animal fed on arrival and leaves a crop with no feed clock", async () => {
    const { token } = await funded();

    const henView = await stockStackAcres(token, { stock: "hen" }, T0);
    const fieldView = await stockStackAcres(token, { stock: "sprout" }, T0);

    expect(unitOf(henView, "hen").hungryAt).not.toBeNull();
    const sprout = unitOf(fieldView, "sprout");
    expect(sprout.hungryAt).toBeNull();
  });

  it("refuses when the purse cannot cover the seed, and takes nothing", async () => {
    const { token } = await funded(HEN.seedCost - 1);
    await expect(stockStackAcres(token, { stock: "hen" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(HEN.seedCost - 1);
  });

  it("refunds when the guarded write throws, standing in for the DB trigger", async () => {
    const { token } = await funded();
    const before = await balance(token);
    vi.mocked(createStackAcresUnit).mockRejectedValueOnce(new Error("trigger said no"));

    await expect(stockStackAcres(token, { stock: "hen" }, T0)).rejects.toThrow("trigger said no");
    expect(await balance(token)).toBe(before);
  });

  it("counts each kind against its own cap, independent of the others", async () => {
    const { token } = await funded();
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    // The hen cap is full...
    await expect(stockStackAcres(token, { stock: "hen" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    // ...but a crop and an unrelated animal both still go in -- kinds do not
    // share a budget any more.
    await stockStackAcres(token, { stock: "sprout" }, T0);
    await stockStackAcres(token, { stock: "cattle" }, T0);
    const view = await readStackAcres(token, T0);
    expect(view.units.filter((u) => u.state === "working")).toHaveLength(STACKACRES_BASE_CAP + 2);
  });
});

describe("hunger", () => {
  const hungryAt = new Date(T0.getTime() + (CATTLE.hungerMs ?? 0) + 1000);

  it("freezes a pen past its feed window instead of letting it finish", async () => {
    const { token } = await funded();
    const view = await stockStackAcres(token, { stock: "cattle" }, T0);
    const unitId = unitOf(view, "cattle").id;

    // Well past readiness, but it went hungry long before that.
    const wayLater = new Date(T0.getTime() + CATTLE.durationMs + 60_000);
    const later = await readStackAcres(token, wayLater);
    expect(unitOf(later, "cattle").state).toBe("hungry");

    await expect(collectOne(token, unitId, wayLater)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("spends one serving and pushes readiness out by the time spent hungry", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "cattle" }, T0);
    const unitId = unitOf(view, "cattle").id;
    await adjustStackAcresFeed(id, 2);

    const before = await getStackAcresUnit(id, unitId);
    const fedAt = new Date(hungryAt.getTime() + 60_000);
    await feedStackAcres(token, unitId, fedAt);

    const after = await getStackAcresUnit(id, unitId);
    const starved = fedAt.getTime() - (T0.getTime() + (CATTLE.hungerMs ?? 0));
    expect(Date.parse(after?.readyAt ?? "")).toBe(Date.parse(before?.readyAt ?? "") + starved);
    expect(after?.lastFedAt).toBe(fedAt.toISOString());
    expect(await readStackAcresFeed(id)).toBe(1);
  });

  it("refuses to feed with an empty barn, and spends nothing", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "cattle" }, T0);
    const unitId = unitOf(view, "cattle").id;

    await expect(feedStackAcres(token, unitId, hungryAt)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await readStackAcresFeed(id)).toBe(0);
  });

  it("never lets neglect cost produce: the snapshotted yield is untouched by feeding", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "cattle" }, T0);
    const unitId = unitOf(view, "cattle").id;
    await adjustStackAcresFeed(id, 1);
    await feedStackAcres(token, unitId, new Date(hungryAt.getTime() + 5 * 60 * 60 * 1000));
    expect((await getStackAcresUnit(id, unitId))?.yieldQuantity).toBe(STACKACRES_YIELDS.cattle.quantity);
  });
});

describe("harvesting", () => {
  it("pays the snapshotted yield in Gold, in one step, exactly once", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    await prepayUpkeep(id, 1, HEN_READY);
    const before = await balance(token);

    const result = await collectOne(token, unitId, HEN_READY);
    expect(result.harvest.units).toBe(1);
    expect(result.harvest.tally).toEqual([
      { item: HEN_YIELD.item, quantity: HEN_YIELD.quantity },
    ]);
    expect(result.harvest.gold).toBe(yieldValue("hen"));
    expect(await balance(token)).toBe(before + yieldValue("hen"));

    // A replay finds nothing to settle (the row is gone -- a clean collect
    // removes it) and pays nothing more.
    await expect(collectOne(token, unitId, HEN_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before + yieldValue("hen"));
  });

  it("brings in every ready unit at once when no unit is named", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { stock: "hen" }, T0);
    await stockStackAcres(token, { stock: "hen" }, T0);
    await stockStackAcres(token, { stock: "cattle" }, T0);
    await prepayUpkeep(id, 3, HEN_READY);
    const before = await balance(token);

    // Only the hens are ready at HEN_READY; the cattle pen runs for a day.
    const result = await harvestStackAcres(token, {}, HEN_READY);
    expect(result.harvest.units).toBe(2);
    expect(result.harvest.gross).toBe(yieldValue("hen") * 2);
    expect(await balance(token)).toBe(before + result.harvest.gold);
    expect(result.units.filter((u) => u.stock === "cattle")).toHaveLength(1);
  });

  it("refuses when nothing at all is ready, and pays nothing", async () => {
    const { token } = await funded();
    await stockStackAcres(token, { stock: "cattle" }, T0);
    const before = await balance(token);
    await expect(harvestStackAcres(token, {}, HEN_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });

  it("yields what the ROW says, not what the catalogue says today", async () => {
    // The wagerLadder rule. A retune landing between stocking and harvest
    // must not change what the player agreed to, so the harvest reads the
    // snapshot. Standing in for that retune by editing the stored row
    // directly, which is the only way to make the two disagree.
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const before = await balance(token);

    const rows = await REAL.listStackAcresUnits(id);
    const retuned = HEN_YIELD.quantity + 2;
    // A sweep LISTS rows, so this is the seam -- once, so nothing leaks into
    // the view that is read after the settlement.
    vi.mocked(listStackAcresUnits).mockResolvedValueOnce(
      rows.map((row) => ({ ...row, yieldQuantity: retuned })),
    );

    const result = await collectOne(token, unitId, HEN_READY);

    expect(result.harvest.tally).toEqual([{ item: HEN_YIELD.item, quantity: retuned }]);
    expect(result.harvest.gross).toBe(itemGoldValue(HEN_YIELD.item) * retuned);
    expect(await balance(token)).toBe(before + result.harvest.gold);
  });

  it("refuses before readiness", async () => {
    const { token } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const before = await balance(token);

    await expect(
      collectOne(token, unitId, new Date(HEN_READY.getTime() - 1000)),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("records each unit in the ledger at its own gross, in Gold", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    await prepayUpkeep(id, 1, HEN_READY);
    await collectOne(token, unitOf(view, "hen").id, HEN_READY);
    expect(__stackacresHarvestsForTest()).toHaveLength(1);
    expect(__stackacresHarvestsForTest()[0]).toMatchObject({
      stock: "hen",
      stake: HEN.seedCost,
      payout: yieldValue("hen"),
    });
  });

  it("writes one ledger row per unit in a sweep, not one per sweep", async () => {
    const { token } = await funded();
    await stockStackAcres(token, { stock: "hen" }, T0);
    await stockStackAcres(token, { stock: "hen" }, T0);
    await harvestStackAcres(token, {}, HEN_READY);
    expect(__stackacresHarvestsForTest()).toHaveLength(2);
  });

  it("sends a mucked unit to mucked with the tier's fee, and never withholds the payment", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    await prepayUpkeep(id, 1, HEN_READY);
    const before = await balance(token);

    // Force the roll. It is the one piece of randomness in the feature and it
    // lives behind Math.random in exactly one function.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    let result;
    try {
      result = await collectOne(token, unitId, HEN_READY);
    } finally {
      random.mockRestore();
    }
    expect(result.harvest.mucked).toBe(1);

    // Paid in full regardless: muck is a cost you choose to pay later, never
    // a deduction from what the unit already grew.
    expect(await balance(token)).toBe(before + yieldValue("hen"));
    const unit = await getStackAcresUnit(id, unitId);
    expect(unit?.status).toBe("mucked");
    expect(unit?.muckFee).toBe(HEN.muckFee);
  });

  it("removes the unit outright when the roll comes up clean", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      await collectOne(token, unitId, HEN_READY);
    } finally {
      random.mockRestore();
    }
    expect(await getStackAcresUnit(id, unitId)).toBeNull();
  });

  it("answers a named unit with ITS reason, not with 'nothing is ready'", async () => {
    // A tap was aimed at that animal. "Nothing is ready" would be a lie about
    // it while a hen next door is standing gold.
    const { token } = await funded();
    await stockStackAcres(token, { stock: "hen" }, T0);
    const cattle = unitOf(await stockStackAcres(token, { stock: "cattle" }, T0), "cattle");

    await expect(collectOne(token, cattle.id, HEN_READY)).rejects.toMatchObject({
      message: "Not ready yet.",
    });
  });
});

/**
 * Bountiful Harvest, end to end. The arithmetic is pinned in
 * lib/stackacres/bounty.test.ts; what matters here is that a sweep actually
 * reaches the purse multiplied, and that a unit collected on its own cannot.
 */
describe("Bountiful Harvest", () => {
  it("pays Mono-cropping into the balance for three of a kind brought in together", async () => {
    const { token, id } = await funded();
    for (let i = 0; i < 3; i += 1) await stockStackAcres(token, { stock: "hen" }, T0);
    await prepayUpkeep(id, 3, HEN_READY);
    const before = await balance(token);

    const result = await harvestStackAcres(token, {}, HEN_READY);
    expect(result.harvest.bounty.kind).toBe("mono_crop");
    expect(result.harvest.bonus).toBeGreaterThan(0);
    expect(result.harvest.gold).toBe(Math.floor(yieldValue("hen") * 3 * 1.05));
    expect(await balance(token)).toBe(before + result.harvest.gold);
  });

  it("pays Crop Rotation for a balanced mix of fields and pens", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { stock: "hen" }, T0);
    await stockStackAcres(token, { stock: "hen" }, T0);
    await stockStackAcres(token, { stock: "sprout" }, T0);
    await stockStackAcres(token, { stock: "sprout" }, T0);
    await prepayUpkeep(id, 4, HEN_READY);

    const result = await harvestStackAcres(token, {}, HEN_READY);
    expect(result.harvest.bounty.kind).toBe("crop_rotation");
    expect(result.harvest.bonus).toBeGreaterThan(0);
  });

  /**
   * The whole reason the Harvest button exists as its own affordance. Three
   * hens taken one at a time are worth strictly less than the same three taken
   * together -- which is the incentive the feature is made of, and also the
   * proof that a synergy cannot be earned by accident.
   */
  it("cannot be earned one tap at a time", async () => {
    const { token, id } = await funded();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(unitOf(await stockStackAcres(token, { stock: "hen" }, T0), "hen").id);
    }
    await prepayUpkeep(id, 3, HEN_READY);
    const before = await balance(token);

    for (const unitId of ids) {
      const result = await collectOne(token, unitId, HEN_READY);
      expect(result.harvest.bounty.kind).toBeNull();
      expect(result.harvest.bonus).toBe(0);
    }
    expect(await balance(token)).toBe(before + yieldValue("hen") * 3);
    expect(await balance(token)).toBeLessThan(
      before + Math.floor(yieldValue("hen") * 3 * 1.05),
    );
  });
});

/**
 * Land Maintenance, end to end. The curve is pinned in
 * lib/stackacres/upkeep.test.ts; what matters here is that it is charged once
 * a day against a real harvest, and that it can never reach the wallet.
 */
describe("Land Maintenance", () => {
  it("comes out of the first harvest of the day, once", async () => {
    const { token, id } = await funded();
    for (let i = 0; i < 3; i += 1) await stockStackAcres(token, { stock: "hen" }, T0);
    const fee = stackacresUpkeepFee(3);
    const before = await balance(token);

    // Clean rolls throughout: a mucked unit keeps its slot, and this test
    // needs the cap free again to re-stock for the second harvest.
    const roll = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const first = await harvestStackAcres(token, {}, HEN_READY);
      expect(first.harvest.upkeep).toBe(fee);
      expect(await balance(token)).toBe(before + first.harvest.gold);
      expect(await readStackAcresUpkeep(id, stackacresExchangeDay(HEN_READY))).toBe(fee);

      // Same day, a second harvest: already paid, so nothing more is taken.
      for (let i = 0; i < 3; i += 1) await stockStackAcres(token, { stock: "hen" }, HEN_READY);
      const later = new Date(HEN_READY.getTime() + HEN.durationMs);
      const second = await harvestStackAcres(token, {}, later);
      expect(stackacresExchangeDay(later)).toBe(stackacresExchangeDay(HEN_READY));
      expect(second.harvest.upkeep).toBe(0);
    } finally {
      roll.mockRestore();
    }
  });

  it("charges again once the UTC day turns over", async () => {
    const { token } = await funded();
    await stockStackAcres(token, { stock: "hen" }, T0);
    await harvestStackAcres(token, {}, HEN_READY);

    const tomorrow = new Date(T0.getTime() + 24 * 60 * 60 * 1000);
    await stockStackAcres(token, { stock: "hen" }, tomorrow);
    const next = await harvestStackAcres(token, {}, new Date(tomorrow.getTime() + HEN.durationMs));
    expect(next.harvest.upkeep).toBeGreaterThan(0);
  });

  /**
   * THE SAFETY PROPERTY. A big estate's fee can exceed a small harvest, and
   * when it does the harvest goes to zero -- it never goes negative and it
   * never reaches into the balance. A fee that could debit the wallet would be
   * a sixth Gold path and a completely different feature.
   */
  it("can zero a harvest but can never debit the balance", async () => {
    const { token } = await funded();
    // A wide, cheap estate: many units (so the fee is large) whose combined
    // yield is small.
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "sprout" }, T0);
    }
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "cattle" }, T0);
    }
    const before = await balance(token);

    // Only the sprouts are ready; the cattle are counted for the fee and pay
    // nothing toward it.
    const ready = new Date(T0.getTime() + SPROUT.durationMs);
    const result = await harvestStackAcres(token, {}, ready);
    expect(stackacresUpkeepFee(STACKACRES_BASE_CAP * 2)).toBeGreaterThan(result.harvest.gross);
    expect(result.harvest.gold).toBe(0);
    expect(await balance(token)).toBe(before);
  });

  it("is assessed on every unit standing, mucked ones included", async () => {
    // A unit waiting to be cleared is still land being held. If this ever
    // stops counting them, muck becomes a way to hold land rent-free.
    const { token } = await funded();
    await stockStackAcres(token, { stock: "hen" }, T0);
    await stockStackAcres(token, { stock: "hen" }, T0);
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await harvestStackAcres(token, {}, HEN_READY);
    } finally {
      random.mockRestore();
    }
    const view = await readStackAcres(token, HEN_READY);
    expect(view.units.every((u) => u.state === "mucked")).toBe(true);
    expect(view.upkeep.units).toBe(2);
    expect(view.upkeep.fee).toBe(stackacresUpkeepFee(2));
  });
});

describe("muck", () => {
  async function mucked() {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await collectOne(token, unitId, HEN_READY);
    } finally {
      random.mockRestore();
    }
    return { token, id, unitId };
  }

  it("still occupies its kind's cap until cleared -- muck cannot be skipped by buying fresh", async () => {
    const { token } = await mucked();
    for (let i = 0; i < STACKACRES_BASE_CAP - 1; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    // One mucked hen plus two fresh ones already fills the cap of 3.
    await expect(stockStackAcres(token, { stock: "hen" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("charges the fee in Gold and removes the unit", async () => {
    const { token, id, unitId } = await mucked();
    const before = await balance(token);

    await clearStackAcresUnit(token, unitId, HEN_READY);

    expect(await balance(token)).toBe(before - HEN.muckFee);
    expect(await getStackAcresUnit(id, unitId)).toBeNull();
  });

  it("stays mucked when the fee cannot be paid, and takes nothing", async () => {
    const { token, id, unitId } = await mucked();
    await adjustGold(id, -(await balance(token)));

    await expect(clearStackAcresUnit(token, unitId, HEN_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(0);
    expect((await getStackAcresUnit(id, unitId))?.status).toBe("mucked");
  });

  it("keeps every tier's expected muck cost below what that tier earns", () => {
    // The arithmetic the fee exists to satisfy. A flat fee across tiers an
    // order of magnitude apart made the cheapest one permanently negative,
    // which is how this rule got written down.
    for (const stock of STACKACRES_STOCK) {
      const def = STACKACRES_CATALOGUE[stock];
      expect(def.muckFee * 0.2).toBeLessThan(netPerCycle(stock, def.seedCost));
    }
  });
});

describe("feed shipments", () => {
  it("debits Gold and adds servings", async () => {
    const { token, id } = await funded();
    const before = await balance(token);
    const sack = STACKACRES_FEED.feed_sack;

    await buyStackAcresFeed(token, "feed_sack", T0);

    expect(await balance(token)).toBe(before - sack.cost);
    expect(await readStackAcresFeed(id)).toBe(sack.servings);
  });

  it("refuses an unaffordable shipment and takes nothing", async () => {
    const { token, id } = await funded(1);
    await expect(buyStackAcresFeed(token, "feed_sack", T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(1);
    expect(await readStackAcresFeed(id)).toBe(0);
  });
});

describe("expanding capacity", () => {
  it("buys one extra slot at the flat per-kind price, and is a pure sink", async () => {
    const { token } = await funded();
    const price = stackacresCapacityPrice("hen");
    const before = await balance(token);

    await expandStackAcresCapacity(token, "hen", T0);

    expect(await balance(token)).toBe(before - price);
  });

  it("raises that kind's cap by exactly one, and no other kind's", async () => {
    const { token } = await funded();
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    await expect(stockStackAcres(token, { stock: "hen" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    await expandStackAcresCapacity(token, "hen", T0);
    await stockStackAcres(token, { stock: "hen" }, T0); // now fits

    // Cattle never had anything to do with the hen cap.
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "cattle" }, T0);
    }
    await expect(stockStackAcres(token, { stock: "cattle" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("charges the same price for the first extra slot as any other, up to the ceiling", async () => {
    const { token } = await funded();
    const before = await balance(token);
    for (let i = 0; i < STACKACRES_MAX_EXTRA_CAP; i += 1) {
      await expandStackAcresCapacity(token, "hen", T0);
    }
    const spent = before - (await balance(token));
    expect(spent).toBe(stackacresCapacityPrice("hen") * STACKACRES_MAX_EXTRA_CAP);
  });

  it("refuses past the extra-slot ceiling, and charges nothing", async () => {
    const { token } = await funded();
    for (let i = 0; i < STACKACRES_MAX_EXTRA_CAP; i += 1) {
      await expandStackAcresCapacity(token, "hen", T0);
    }
    const before = await balance(token);

    await expect(expandStackAcresCapacity(token, "hen", T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });

  it("refuses when the purse cannot cover it, and takes nothing", async () => {
    const price = stackacresCapacityPrice("cattle");
    const { token } = await funded(price - 1);
    const before = await balance(token);

    await expect(expandStackAcresCapacity(token, "cattle", T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });
});

/**
 * THE VALVE. Everything above this point SPENDS Gold; a harvest is the one
 * thing in the feature that pays it, and the tests below are mostly here to
 * fail loudly if the property that makes that safe erodes: **the farm's
 * maximum Gold output is a flat daily constant.**
 *
 * A failure in this block is not a broken test, it is a faucet.
 */
/**
 * The daily allowance: the valve the old exchange window stood in front of.
 * The window is gone; every property below survived it, because none of them
 * was ever about the window.
 *
 * THE FARM IS DELIBERATELY BUILT OF CROPS HERE. Livestock eat, and a Cattle
 * Pen goes hungry (8h) long before it ripens (24h), so a pen left alone never
 * becomes ready at all -- which is the mechanic working, and makes livestock
 * useless for a test about ceilings.
 *
 * The day is filled with `burnAllowance` rather than by harvesting toward it.
 * Reaching 15,000 legitimately takes a maxed estate and many cycles; HOW the
 * day was spent is not what any of this is about, and a test that spent forty
 * lines getting there would be testing the fixture.
 */
describe("the daily allowance", () => {
  const CROP_READY = new Date(T0.getTime() + SPROUT.durationMs);

  it("records a harvest against today's allowance", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { stock: "sprout" }, T0);
    await prepayUpkeep(id, 1, CROP_READY);

    const result = await harvestStackAcres(token, {}, CROP_READY);

    expect(result.harvest.gold).toBeGreaterThan(0);
    expect(result.exchange.usedToday).toBe(result.harvest.gold);
    expect(result.exchange.remaining).toBe(STACKACRES_GOLD_CEILING - result.harvest.gold);
    expect(await readStackAcresExchanged(id, stackacresExchangeDay(T0))).toBe(
      result.harvest.gold,
    );
  });

  /**
   * The refusal is the whole feature, and the ORDER of it is what makes it
   * bearable: nothing settles, so the crops are still standing and still ready
   * after midnight. A ceiling that ate a harvest to enforce itself would be
   * worse than no ceiling.
   */
  it("refuses a harvest the day cannot cover, and leaves every crop standing", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { stock: "sprout" }, T0);
    await prepayUpkeep(id, 1, CROP_READY);
    await burnAllowance(id, STACKACRES_GOLD_CEILING);
    const before = await balance(token);

    await expect(harvestStackAcres(token, {}, CROP_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(before);
    const view = await readStackAcres(token, CROP_READY);
    expect(view.units.filter((u) => u.state === "ready")).toHaveLength(1);
    expect(view.exchange.remaining).toBe(0);
  });

  it("refuses rather than paying a part of a sweep, when only part of it fits", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { stock: "sprout" }, T0);
    await prepayUpkeep(id, 1, CROP_READY);
    // One Gold short of what a single Sprout Row is worth.
    await burnAllowance(id, STACKACRES_GOLD_CEILING - (yieldValue("sprout") - 1));
    const before = await balance(token);

    await expect(harvestStackAcres(token, {}, CROP_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });

  it("still pays right up to the last Gold of the day", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { stock: "sprout" }, T0);
    await prepayUpkeep(id, 1, CROP_READY);
    await burnAllowance(id, STACKACRES_GOLD_CEILING - yieldValue("sprout"));
    const before = await balance(token);

    const result = await harvestStackAcres(token, {}, CROP_READY);

    expect(result.harvest.gold).toBe(yieldValue("sprout"));
    expect(await balance(token)).toBe(before + yieldValue("sprout"));
    expect(result.exchange.remaining).toBe(0);
  });

  it("holds the ceiling when a dozen harvests race for the last of it", async () => {
    // The memory store cannot deadlock the way Postgres serializes, but it can
    // still interleave the reservation and the settlement across awaits --
    // which is exactly the shape of the bug this guards. Against a real
    // database the guarantee is the RPC's row lock; see the migration.
    const { token, id } = await funded();
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "sprout" }, T0);
    }
    await prepayUpkeep(id, STACKACRES_BASE_CAP, CROP_READY);
    const before = await balance(token);

    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => harvestStackAcres(token, {}, CROP_READY)),
    );
    expect(attempts.some((a) => a.status === "fulfilled")).toBe(true);

    // Every unit settled at most once, and the day was charged exactly what
    // was actually paid -- which is what the release path exists to keep true.
    const paid = (await balance(token)) - before;
    expect(paid).toBeLessThanOrEqual(yieldValue("sprout") * STACKACRES_BASE_CAP * 1.3);
    expect(await readStackAcresExchanged(id, stackacresExchangeDay(T0))).toBe(paid);
    const view = await readStackAcres(token, CROP_READY);
    expect(view.units.filter((u) => u.state === "ready")).toHaveLength(0);
  });

  /**
   * THE INVARIANT, stated as a test. Owning more fills the day faster; it does
   * not make the day bigger. If this ever fails, the ceiling has started
   * scaling with something and the farm is a percentage faucet again.
   */
  it("gives a farm full of stock exactly the same daily ceiling as a bare one", async () => {
    const bare = await funded();
    const big = await funded(5_000_000);
    for (const stock of STACKACRES_STOCK) {
      for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
        await stockStackAcres(big.token, { stock }, T0);
      }
    }

    expect((await readStackAcres(bare.token, T0)).exchange.ceiling).toBe(STACKACRES_GOLD_CEILING);
    expect((await readStackAcres(big.token, T0)).exchange.ceiling).toBe(STACKACRES_GOLD_CEILING);

    // And the big farm is refused at the same wall, not a wider one. The
    // maintenance is prepaid so the refusal is the ceiling's doing: an estate
    // this wide has a fee larger than one round of crops, and a harvest worth
    // nothing reserves nothing and so is never refused at all.
    await prepayUpkeep(big.id, STACKACRES_STOCK.length * STACKACRES_BASE_CAP, CROP_READY);
    await burnAllowance(big.id, STACKACRES_GOLD_CEILING);
    await expect(harvestStackAcres(big.token, {}, CROP_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("reopens at UTC midnight and not a moment before", async () => {
    const { token, id } = await funded();
    const day = stackacresExchangeDay(T0);
    await stockStackAcres(token, { stock: "sprout" }, T0);
    await prepayUpkeep(id, 1, CROP_READY);
    await harvestStackAcres(token, {}, CROP_READY);
    expect(await readStackAcresExchanged(id, day)).toBeGreaterThan(0);

    const lastSecond = new Date("2026-08-31T23:59:59.999Z");
    expect((await readStackAcres(token, lastSecond)).exchange.usedToday).toBeGreaterThan(0);

    const midnight = new Date("2026-09-01T00:00:00.000Z");
    expect(await readStackAcresExchanged(id, stackacresExchangeDay(midnight))).toBe(0);
    expect((await readStackAcres(token, midnight)).exchange.remaining).toBe(
      STACKACRES_GOLD_CEILING,
    );
  });

  it("spends no allowance on a harvest that refused", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { stock: "cattle" }, T0);

    await expect(harvestStackAcres(token, {}, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await readStackAcresExchanged(id, stackacresExchangeDay(T0))).toBe(0);
    expect((await readStackAcres(token, T0)).exchange.remaining).toBe(STACKACRES_GOLD_CEILING);
  });

  /**
   * A harvest whose whole value is eaten by Land Maintenance reserves NOTHING.
   * That matters twice: the RPC raises on a non-positive reservation, so a
   * zero would be an error rather than a no-op; and no Gold actually left the
   * farm, so charging the day for it would be a silent tax on the allowance.
   */
  it("spends no allowance when maintenance eats the whole harvest", async () => {
    const { token, id } = await funded();
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "sprout" }, T0);
    }
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "cattle" }, T0);
    }

    const result = await harvestStackAcres(token, {}, CROP_READY);

    expect(result.harvest.gold).toBe(0);
    expect(await readStackAcresExchanged(id, stackacresExchangeDay(T0))).toBe(0);
  });
});

/**
 * THE ONE CLAIM THIS WHOLE FILE EXISTS TO HOLD: **StackAcres pays Gold out in
 * exactly one place, and that place is bounded by a flat daily constant.**
 *
 * It used to be held by counting call sites of `creditGoldByProfile`, which
 * worked while there were three of them and stopped working the moment the
 * farm went single-currency: every spend path gained a refund, and a refund is
 * a credit. Counting would now mean editing a number every time a refund is
 * added, which trains exactly the reflex the test is meant to prevent.
 *
 * So the service routes every refund through one `refundGold` helper, and the
 * claim becomes structural: `creditGoldByProfile` may appear TWICE -- once
 * inside that helper, once as the harvest payout. A third occurrence is a new
 * faucet, and no amount of new refunds can move the number.
 *
 * Spends are deliberately NOT pinned to a count. A new sink is a sink; the
 * direction is the invariant, not the arity.
 */
describe("the currency wall", () => {
  const SERVICE = readFileSync(join(process.cwd(), "lib/server/stackacres-service.ts"), "utf8");
  const ROUTE = readFileSync(join(process.cwd(), "app/api/stackacres/actions/route.ts"), "utf8");

  const calls = (source: string, fn: string) => source.split(`${fn}(`).length - 1;

  it("credits Gold in exactly two places: the refund helper, and the payout", async () => {
    // If this is 3, go and look at the new one and ask the only question that
    // matters: which DIRECTION does it move Gold? A refund belongs inside
    // `refundGold`. A credit that is not a refund is a faucet, and that is the
    // change to stop over.
    expect(calls(SERVICE, "creditGoldByProfile")).toBe(2);
    // One of the two is the helper, whose whole body is that call.
    expect(SERVICE).toContain("async function refundGold(");
    // And the other is the harvest, which is the only payout there may be.
    expect(SERVICE).toContain("paid = await creditGoldByProfile(profile.id, gold)");
  });

  it("spends Gold freely, which is the direction that is allowed", async () => {
    expect(calls(SERVICE, "spendGoldByProfile")).toBeGreaterThan(1);
  });

  it("exposes exactly one action that pays Gold out", () => {
    const actions = [...ROUTE.matchAll(/z\.literal\("([a-z-]+)"\)/g)].map((m) => m[1]).sort();
    // Adding an action means editing this list, which is the point: the
    // question to answer while doing it is "does this move Gold, and which
    // way".
    expect(actions).toEqual([
      "buy-feed",
      "buy-stock",
      "clear",
      "collect",
      "expand-capacity",
      "feed",
      "retire",
      "stock",
    ]);

    // The claim that actually matters, held separately from the list so it
    // cannot be lost in a rename: `collect` is the only action that pays a
    // player Gold. Everything else on that list either spends it or moves no
    // money at all.
    const paysGold = ["collect"];
    expect(actions).toEqual(expect.arrayContaining(paysGold));
    expect(ROUTE).toContain("harvestStackAcres(token, { unitIds: action.unitIds })");
  });

  it("hands back no Gold at all for spending Gold", async () => {
    // The behavioural half of the same claim, on one action that spends Gold:
    // capacity is a pure sink and must not credit a single piece back.
    const { token } = await funded(500_000);
    const price = stackacresCapacityPrice("hen");
    await expandStackAcresCapacity(token, "hen", T0);
    expect(await balance(token)).toBe(500_000 - price);
  });
});

describe("a pristine farm", () => {
  it("reads with no units at all, until something is bought", async () => {
    const token = randomUUID();
    const view = await readStackAcres(token, T0);
    expect(view.units).toEqual([]);
    expect(view.feed).toBe(0);
    expect(view.capacity).toEqual({});
    // No land, so nothing to maintain, and a full day's allowance untouched.
    expect(view.upkeep).toMatchObject({ units: 0, fee: 0, due: 0 });
    expect(view.exchange.remaining).toBe(STACKACRES_GOLD_CEILING);
  });
});

/**
 * BOUGHT STOCK. The Gold market added a second way for Gold to enter the farm,
 * and these hold the two things that make it safe: the Gold genuinely leaves
 * the purse (and comes back on every failure path), and buying an animal
 * never pays anybody anything.
 *
 * The wall the rest of this file guards still stands and is asserted here
 * from the other side: bought stock pays through the same flat daily ceiling
 * a sown one does. It is the reliable way to REACH that ceiling, never a way
 * past it.
 */
describe("buying stock outright", () => {
  it("charges the listed price and creates the unit already working", async () => {
    const { token } = await funded();
    const before = await balance(token);

    const view = await buyStackAcresStock(token, { stock: "hen" }, T0);

    expect(await balance(token)).toBe(before - stackacresStockPrice("hen"));
    const unit = unitOf(view, "hen");
    expect(unit.state).toBe("working");
    expect(unit.permanent).toBe(true);
  });

  it("charges the outright price, not the one-cycle seed price", async () => {
    // The two prices are the same animal on different terms, and with one
    // currency they finally sit on the same shelf -- so the thing worth
    // asserting is that buying charges the BIG one.
    const { token } = await funded();
    const before = await balance(token);
    await buyStackAcresStock(token, { stock: "cattle" }, T0);
    expect(await balance(token)).toBe(before - stackacresStockPrice("cattle"));
    expect(stackacresStockPrice("cattle")).toBeGreaterThan(CATTLE.seedCost);
  });

  it("refuses when the purse is short, and charges nothing", async () => {
    const { token } = await funded(stackacresStockPrice("cattle") - 1);
    const before = await balance(token);

    await expect(buyStackAcresStock(token, { stock: "cattle" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(before);
    expect((await readStackAcres(token, T0)).units).toEqual([]);
  });

  it("refunds the Gold when the database refuses outright", async () => {
    // Stands in for the cap trigger raising, which the memory branch cannot
    // do. The same gap once skipped a refund entirely on the seeding path.
    const { token } = await funded();
    const before = await balance(token);
    vi.mocked(createStackAcresUnit).mockRejectedValueOnce(new Error("trigger said no"));

    await expect(buyStackAcresStock(token, { stock: "cattle" }, T0)).rejects.toThrow(
      "trigger said no",
    );

    expect(await balance(token)).toBe(before);
  });

  it("counts against the same cap a sowing does, without charging", async () => {
    const { token } = await funded();
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await buyStackAcresStock(token, { stock: "hen" }, T0);
    }
    const before = await balance(token);

    await expect(buyStackAcresStock(token, { stock: "hen" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(before);
  });
});

describe("collecting from bought stock", () => {
  it("re-sows itself instead of being removed", async () => {
    const { token } = await funded();
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;

    const view = await collectOne(token, unitId, HEN_READY);

    const unit = unitOf(view, "hen");
    expect(unit.id).toBe(unitId);
    expect(unit.state).toBe("working");
    expect(unit.permanent).toBe(true);
    expect(unit.startedAt).toBe(HEN_READY.toISOString());
    expect(unit.readyAt).toBe(new Date(HEN_READY.getTime() + HEN.durationMs).toISOString());
  });

  it("pays the same as a sown unit would", async () => {
    const { token } = await funded();
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;

    const result = await collectOne(token, unitId, HEN_READY);

    expect(result.harvest.tally).toEqual([
      { item: HEN_YIELD.item, quantity: HEN_YIELD.quantity },
    ]);
    expect(result.harvest.gross).toBe(yieldValue("hen"));
  });

  it("never mucks, however the dice fall", async () => {
    // Muck is the cost of turning ground over between sowings and a bought
    // animal is never between sowings. Forced to the worst roll so this is
    // not passing by luck.
    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const { token } = await funded();
      const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
      const unitId = unitOf(bought, "hen").id;
      const view = await collectOne(token, unitId, HEN_READY);
      expect(view.harvest.mucked).toBe(0);
      expect(unitOf(view, "hen").state).not.toBe("mucked");
    } finally {
      roll.mockRestore();
    }
  });

  it("pays through the same daily ceiling a sown unit does", async () => {
    // Bought stock is the reliable way to reach the ceiling; it is not a way
    // past it. That distinction is the Gold market's whole safety argument.
    const { token, id } = await funded();
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;
    const before = await balance(token);

    const result = await collectOne(token, unitId, HEN_READY);

    expect(await balance(token)).toBe(before + result.harvest.gold);
    expect(await readStackAcresExchanged(id, stackacresExchangeDay(HEN_READY))).toBe(
      result.harvest.gold,
    );
  });

  it("keeps a sown unit disappearing exactly as it always did", async () => {
    const roll = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const { token, id } = await funded();
      const sown = await stockStackAcres(token, { stock: "hen" }, T0);
      const unitId = unitOf(sown, "hen").id;
      await collectOne(token, unitId, HEN_READY);
      expect(await getStackAcresUnit(id, unitId)).toBeNull();
    } finally {
      roll.mockRestore();
    }
  });
});

describe("the harvest ledger", () => {
  it("flags a bought unit, so its notional seed cost is not read as a real one", async () => {
    // `stake` on a bought unit is the catalogue's one-cycle seed price and
    // NOBODY PAID IT -- the unit was bought outright, at fifty times that.
    // The column cannot be 0 (it
    // carries check (stake > 0)), so the flag is the only thing standing
    // between an economy dashboard and a systematic understatement of what
    // the farm nets.
    const { token } = await funded();
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    await collectOne(token, unitOf(bought, "hen").id, HEN_READY);

    const [entry] = __stackacresHarvestsForTest();
    expect(entry.permanent).toBe(true);
    expect(entry.stake).toBe(HEN.seedCost);
  });

  it("leaves a sown unit unflagged, because its seed cost was real", async () => {
    const { token } = await funded();
    const sown = await stockStackAcres(token, { stock: "hen" }, T0);
    await collectOne(token, unitOf(sown, "hen").id, HEN_READY);

    const [entry] = __stackacresHarvestsForTest();
    expect(entry.permanent).toBe(false);
    expect(entry.stake).toBe(HEN.seedCost);
  });
});

describe("retiring bought stock", () => {
  it("removes the unit and refunds nothing", async () => {
    const { token } = await funded();
    const bought = await buyStackAcresStock(token, { stock: "cattle" }, T0);
    const unitId = unitOf(bought, "cattle").id;
    const spent = await balance(token);

    const view = await retireStackAcresStock(token, unitId, T0);

    expect(view.units.some((u) => u.id === unitId)).toBe(false);
    expect(await balance(token)).toBe(spent);
  });

  it("frees a slot for a fresh unit of the SAME kind", async () => {
    const { token } = await funded();
    let last;
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      last = await buyStackAcresStock(token, { stock: "hen" }, T0);
    }
    await expect(buyStackAcresStock(token, { stock: "hen" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    await retireStackAcresStock(token, unitOf(last as StackAcresView, "hen").id, T0);

    const view = await buyStackAcresStock(token, { stock: "hen" }, T0);
    expect(unitOf(view, "hen").state).toBe("working");
  });

  it("will not touch a unit that was sown for one cycle", async () => {
    // A sowing has its seed already sunk into it and a harvest coming;
    // retiring is for bought stock only.
    const { token } = await funded();
    const sown = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(sown, "hen").id;

    await expect(retireStackAcresStock(token, unitId, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect((await readStackAcres(token, T0)).units.find((u) => u.id === unitId)?.state).toBe(
      "working",
    );
  });

  it("will not touch a unit id that does not exist", async () => {
    const { token } = await funded();
    await expect(retireStackAcresStock(token, randomUUID(), T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });
});
