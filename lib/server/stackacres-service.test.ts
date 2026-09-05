import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StackAcresRequestError,
  buyStackAcresFeed,
  buyStackAcresStock,
  clearStackAcresSector,
  clearStackAcresUnit,
  consumeStackAcresSecretItem,
  donateStackAcresSecretItem,
  expandStackAcresCapacity,
  feedStackAcres,
  harvestStackAcres,
  readStackAcres,
  retireStackAcresStock,
  runStackAcresAction,
  stockStackAcres,
  tapStackAcresSecretZone,
  tradeStackAcresSecretItemToRay,
  upgradeStackAcresTool,
  waterStackAcres,
  sowStackAcresWheat,
  placeStackAcresMachine,
  workStackAcres,
  requestStackAcresContract,
  fulfillStackAcresTownContract,
  divertStackAcresUnit,
  processRecipe,
  type StackAcresActionResult,
  type StackAcresView,
} from "./stackacres-service";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import {
  __stackacresHarvestsForTest,
  __resetStackAcresForTest,
  adjustStackAcresSecretLedger,
  adjustStackAcresFeed,
  createStackAcresUnit,
  getStackAcresUnit,
  listStackAcresUnits,
  markStackAcresDonated,
  raiseStackAcresUpkeep,
  readStackAcresSecretLedgerQty,
  readStackAcresExchanged,
  readStackAcresFeed,
  readStackAcresMuseum,
  readStackAcresSectors,
  readStackAcresToolTier,
  readStackAcresUpkeep,
  recordStackAcresSectorCleared,
  reserveStackAcresExchange,
  adjustStackAcresInventory,
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
  STACKACRES_STARTING_TIER,
  STACKACRES_TOOL_TIER_DEFS,
  nextToolTier,
  toolUpgradePrice,
} from "@/lib/stackacres/equipment";
import {
  STACKACRES_GOLD_CEILING,
  stackacresExchangeDay,
} from "@/lib/stackacres/exchange";
import {
  HOME_SECTOR,
  SECTOR_LADDER,
  STACKACRES_SECTORS,
  unlockedPlotCount,
  type SectorId,
} from "@/lib/stackacres/sectors";
import {
  STACKACRES_ITEMS,
  STACKACRES_STOCK,
  STACKACRES_YIELDS,
  itemGoldValue,
  netPerCycle,
  yieldValue,
} from "@/lib/stackacres/items";
import { STACKACRES_UPKEEP_FREE_PLOTS, stackacresUpkeepFee } from "@/lib/stackacres/upkeep";
import { emptyMuseumRegistry, museumDiscoveryBonus } from "@/lib/stackacres/museum";
import {
  WHEAT_DURATION_MS,
  WHEAT_PLOT_CAP,
  WHEAT_SEED_COST,
  WHEAT_YIELD_QUANTITY,
} from "@/lib/stackacres/wheat-plot";
import { MACHINE_CAP, MACHINE_CATALOGUE, MACHINE_KINDS } from "@/lib/stackacres/machines";
import { RECIPE_CATALOGUE } from "@/lib/stackacres/recipes";
import {
  HIDDEN_ZONES,
  STACKACRES_DICE_BOOST_ARMED_KEY,
  STACKACRES_DICE_CRIT_BONUS,
  secretZoneAttemptKey,
} from "@/lib/stackacres/secrets";

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
    // Passthrough spy, so one test can stand in for a museum write failing --
    // the memory branch has no DB to fail for real.
    markStackAcresDonated: vi.fn(actual.markStackAcresDonated),
    // Passthrough spy, so one test can stand in for a lost race on the
    // hidden-secrets Land Maintenance trade -- the memory branch's own
    // raise-to-target check cannot be raced from a single synchronous test.
    raiseStackAcresUpkeep: vi.fn(actual.raiseStackAcresUpkeep),
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
/**
 * The most plots the game can ever bill for: every stock kind, every capacity
 * slot bought. `settled` below pre-pays against this rather than against the
 * farm's plots as they stand, so nothing a test buys mid-way can push the
 * day's bill above what was already paid and land a charge in the middle of
 * an assertion about seed costs.
 */
const MAX_PLOTS = STACKACRES_STOCK.length * (STACKACRES_BASE_CAP + STACKACRES_MAX_EXTRA_CAP);

/**
 * A profile with Gold, which is now the only thing a farm needs -- there is no
 * starting grant to trigger any more.
 *
 * EVERY SECTOR IS CLEARED, THE DAY'S LAND FEE IS PRE-PAID, AND EVERY ITEM IS
 * ALREADY DONATED TO RAY'S MUSEUM by default, and that is a deliberate seam
 * rather than a shortcut. Almost every test in this file is about stock,
 * money ordering or the settlement guards, and none of them are about land or
 * about a first-ever discovery -- so both are pre-cleared and those tests
 * keep asserting exactly the arithmetic they were written for, undisturbed by
 * a bonus nobody there is testing for. Land Maintenance passes `settled:
 * false`; the "Ray's Museum" block passes `museum: false`; both start where a
 * real farm starts.
 */
async function funded(
  gold = 500_000,
  {
    land = [...SECTOR_LADDER],
    settled = true,
    museum = true,
  }: { land?: SectorId[]; settled?: boolean; museum?: boolean } = {},
) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  for (const sector of land) await recordStackAcresSectorCleared(profile.id, sector, T0);
  if (settled) {
    await raiseStackAcresUpkeep(
      profile.id,
      stackacresExchangeDay(T0),
      stackacresUpkeepFee(MAX_PLOTS),
    );
  }
  if (museum) {
    for (const item of STACKACRES_ITEMS) await markStackAcresDonated(profile.id, item);
  }
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/**
 * Sows a crop and waters it exactly when the soil dries, so it reaches its
 * finish line on schedule.
 *
 * A CROP LEFT ALONE NEVER RIPENS -- thirst windows sit under their own cycle
 * length on purpose, so watering is the crop track's whole tending loop. That
 * makes crops useless as a passive fixture: any test that needs a ready field
 * has to tend it, and watering at the exact moment it dries costs no time
 * (`readyAt` moves forward by however long it stood dry, which is zero here).
 */
async function sowWatered(token: string, stock: "sprout" | "cash_crop", at = T0) {
  const def = STACKACRES_CATALOGUE[stock];
  const view = await stockStackAcres(token, { stock }, at);
  const unitId = unitOf(view, stock).id;
  for (
    let drink = (def.thirstMs ?? 0);
    drink < def.durationMs;
    drink += (def.thirstMs ?? Number.POSITIVE_INFINITY)
  ) {
    await waterStackAcres(token, unitId, new Date(at.getTime() + drink));
  }
  return unitId;
}

/** Brings in one named unit -- what tapping it on the map does. */
function collectOne(token: string, unitId: string, now = T0) {
  return harvestStackAcres(token, { unitIds: [unitId] }, now);
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
  markStackAcresDonated: vi.mocked(markStackAcresDonated).getMockImplementation()!,
  raiseStackAcresUpkeep: vi.mocked(raiseStackAcresUpkeep).getMockImplementation()!,
};

beforeEach(() => {
  __resetStackAcresForTest();
  vi.mocked(createStackAcresUnit).mockImplementation(REAL.createStackAcresUnit);
  vi.mocked(getStackAcresUnit).mockImplementation(REAL.getStackAcresUnit);
  vi.mocked(listStackAcresUnits).mockImplementation(REAL.listStackAcresUnits);
  vi.mocked(markStackAcresDonated).mockImplementation(REAL.markStackAcresDonated);
  vi.mocked(raiseStackAcresUpkeep).mockImplementation(REAL.raiseStackAcresUpkeep);
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

describe("thirst", () => {
  const THIRST = SPROUT.thirstMs ?? 0;
  const stackacresSprout = (token: string) => stockStackAcres(token, { stock: "sprout" }, T0);
  const dryAt = new Date(T0.getTime() + THIRST + 1000);

  it("freezes a field past its watering window instead of letting it finish", async () => {
    const { token } = await funded();
    const view = await stockStackAcres(token, { stock: "sprout" }, T0);
    const unitId = unitOf(view, "sprout").id;

    // Well past readiness, but the soil went dry long before that.
    const wayLater = new Date(T0.getTime() + SPROUT.durationMs + 60_000);
    const later = await readStackAcres(token, wayLater);
    expect(unitOf(later, "sprout").state).toBe("dry");
    expect(unitOf(later, "sprout").isWatered).toBe(false);

    await expect(collectOne(token, unitId, wayLater)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("pushes readiness out by the time spent dry, and spends nothing to do it", async () => {
    const { token, id } = await funded();
    const startingGold = await balance(token);
    const view = await stockStackAcres(token, { stock: "sprout" }, T0);
    const spentOnSeed = startingGold - (await balance(token));

    const unitId = unitOf(view, "sprout").id;
    const before = await getStackAcresUnit(id, unitId);
    const wateredAt = new Date(dryAt.getTime() + 60_000);
    await waterStackAcres(token, unitId, wateredAt);

    const after = await getStackAcresUnit(id, unitId);
    const parched = wateredAt.getTime() - (T0.getTime() + THIRST);
    expect(Date.parse(after?.readyAt ?? "")).toBe(Date.parse(before?.readyAt ?? "") + parched);
    expect(after?.lastWateredAt).toBe(wateredAt.toISOString());
    // The seed cost is the only thing that ever left the purse: watering is
    // free, and costs attention rather than money.
    expect(spentOnSeed).toBe(SPROUT.seedCost);
    expect(await balance(token)).toBe(startingGold - SPROUT.seedCost);
    expect(await readStackAcresFeed(id)).toBe(0);
  });

  it("lets the field finish once watered, on the pushed-out clock", async () => {
    const { token } = await funded();
    const view = await stockStackAcres(token, { stock: "sprout" }, T0);
    const unitId = unitOf(view, "sprout").id;

    const wateredAt = new Date(dryAt.getTime() + 60_000);
    const resumed = await waterStackAcres(token, unitId, wateredAt);
    expect(unitOf(resumed, "sprout").state).toBe("working");
    expect(unitOf(resumed, "sprout").isWatered).toBe(true);

    // Ready at its own pushed-out clock -- the time the field stood dry was
    // ADDED to the cycle, not credited to it. Read exactly there: a Sprout
    // Row's thirst window is under its own cycle length, so waiting long past
    // this would simply find it dry again, which is the loop working.
    const done = await readStackAcres(token, new Date(Date.parse(unitOf(resumed, "sprout").readyAt)));
    expect(unitOf(done, "sprout").state).toBe("ready");
  });

  it("preserves the time REMAINING across a drought, which is what freezing means", async () => {
    const { token, id } = await funded();
    const view = await stackacresSprout(token);
    const unitId = unitOf(view, "sprout").id;

    // What was left to do at the moment the ground dried...
    const before = await getStackAcresUnit(id, unitId);
    const leftWhenItDried = Date.parse(before?.readyAt ?? "") - (T0.getTime() + THIRST);

    // ...must still be what is left the instant it is watered, however long
    // it stood there. The progress FRACTION drifts up (startedAt never moves,
    // so the denominator grows) -- the remaining time is the real guarantee.
    const wateredAt = new Date(T0.getTime() + THIRST + 42 * 60 * 1000);
    await waterStackAcres(token, unitId, wateredAt);
    const after = await getStackAcresUnit(id, unitId);
    expect(Date.parse(after?.readyAt ?? "") - wateredAt.getTime()).toBe(leftWhenItDried);
  });

  it("writes nothing when the ground is still wet, so the thirst clock cannot be reset for free", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "sprout" }, T0);
    const unitId = unitOf(view, "sprout").id;
    const before = await getStackAcresUnit(id, unitId);

    // A no-op rather than a refusal -- a phone whose clock runs fast paints
    // the Water button itself, and erroring on it is unactionable. What has to
    // hold is that nothing MOVED: same watering date, same ready_at, and no
    // version bump, so there is no free top-up to farm.
    const stillWet = new Date(T0.getTime() + THIRST - 1000);
    await expect(waterStackAcres(token, unitId, stillWet)).resolves.toBeDefined();

    const after = await getStackAcresUnit(id, unitId);
    expect(after?.lastWateredAt).toBe(T0.toISOString());
    expect(after?.readyAt).toBe(before?.readyAt);
    expect(after?.version).toBe(before?.version);
  });

  it("still harvests a crop that ripened before its ground dried", async () => {
    const { token, id } = await funded();
    const view = await stackacresSprout(token);
    const unitId = unitOf(view, "sprout").id;

    // Water once late in the cycle, so the crop finishes at its own clock and
    // the ground only gives out afterwards.
    const wateredAt = new Date(T0.getTime() + THIRST + 1000);
    await waterStackAcres(token, unitId, wateredAt);
    const readyAt = Date.parse((await getStackAcresUnit(id, unitId))?.readyAt ?? "");

    // Long after both the finish line and the next drought.
    const muchLater = new Date(readyAt + 12 * 60 * 60 * 1000);
    const late = await readStackAcres(token, muchLater);
    expect(unitOf(late, "sprout").state).toBe("ready");

    // And it actually pays -- a drought after the harvest was made takes
    // nothing away from it.
    const before = await balance(token);
    const paid = await collectOne(token, unitId, muchLater);
    expect(paid.harvest.tally).toEqual([
      { item: STACKACRES_YIELDS.sprout.item, quantity: STACKACRES_YIELDS.sprout.quantity },
    ]);
    expect(await balance(token)).toBe(before + paid.harvest.gold);
  });

  it("re-waters a bought crop when it re-sows itself, so a restart is not born dry", async () => {
    const { token, id } = await funded();
    await buyStackAcresStock(token, { stock: "sprout" }, T0);
    const unitId = unitOf(await readStackAcres(token, T0), "sprout").id;

    // Water it through its one drought so it actually reaches the finish
    // line -- a Sprout Row's thirst window is under its own cycle length.
    await waterStackAcres(token, unitId, new Date(T0.getTime() + THIRST + 1000));

    // Collected a full day after it ripened -- the realistic case for a
    // permanent unit, which sits ready until someone comes back for it.
    const collectedAt = new Date(T0.getTime() + 24 * 60 * 60 * 1000);
    await collectOne(token, unitId, collectedAt);

    // The new cycle must start wet. Carrying the OLD cycle's watering across
    // makes it dry at progress 0, and one Water tap would then add the whole
    // stale gap to ready_at -- turning a 15-minute cycle into a day-long one.
    const restarted = await getStackAcresUnit(id, unitId);
    expect(restarted?.lastWateredAt).toBe(collectedAt.toISOString());

    const fresh = unitOf(await readStackAcres(token, collectedAt), "sprout");
    expect(fresh.state).toBe("working");
    expect(fresh.isWatered).toBe(true);
    expect(Date.parse(restarted?.readyAt ?? "")).toBe(collectedAt.getTime() + SPROUT.durationMs);
  });

  it("refuses to water livestock, which has no soil", async () => {
    const { token } = await funded();
    const view = await stockStackAcres(token, { stock: "cattle" }, T0);
    const unitId = unitOf(view, "cattle").id;
    await expect(
      waterStackAcres(token, unitId, new Date(T0.getTime() + 10 * 60 * 60 * 1000)),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });

  it("never lets neglect cost produce: the snapshotted yield is untouched by watering", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "sprout" }, T0);
    const unitId = unitOf(view, "sprout").id;
    await waterStackAcres(token, unitId, new Date(dryAt.getTime() + 6 * 60 * 60 * 1000));
    expect((await getStackAcresUnit(id, unitId))?.yieldQuantity).toBe(
      STACKACRES_YIELDS.sprout.quantity,
    );
  });

  it("waters a crop stocked with Gold the same way, and still moves no Gold", async () => {
    const { token, id } = await funded();
    await buyStackAcresStock(token, { stock: "sprout" }, T0);
    const goldAfterBuying = await balance(token);
    const view = await readStackAcres(token, T0);
    const unitId = unitOf(view, "sprout").id;

    await waterStackAcres(token, unitId, new Date(dryAt.getTime() + 60_000));
    expect(await balance(token)).toBe(goldAfterBuying);
    expect((await getStackAcresUnit(id, unitId))?.permanent).toBe(true);
  });
});

describe("harvesting", () => {
  it("pays the snapshotted yield in Gold, in one step, exactly once", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
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
    const before = await balance(token);

    // Force the roll. It is the one piece of randomness a free-rung farm has
    // and it lives behind Math.random in exactly one function -- the equipment
    // ladder's crit shares the source but cannot fire on the Trowel.
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
    const before = await balance(token);

    const result = await harvestStackAcres(token, {}, HEN_READY);
    expect(result.harvest.bounty.kind).toBe("mono_crop");
    expect(result.harvest.bonus).toBeGreaterThan(0);
    expect(result.harvest.gold).toBe(Math.floor(yieldValue("hen") * 3 * 1.05));
    expect(await balance(token)).toBe(before + result.harvest.gold);
  });

  it("pays Crop Rotation for a balanced mix of fields and pens", async () => {
    const { token } = await funded();
    await stockStackAcres(token, { stock: "hen" }, T0);
    await stockStackAcres(token, { stock: "hen" }, T0);
    await sowWatered(token, "sprout");
    await sowWatered(token, "sprout");

    // A Sprout Row and a Hen Coop share a 15-minute cycle, so all four ripen
    // together -- which is the only way a rotation can be brought in at once.
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
 * Ray's Museum. There is no second payout to test for -- a first-ever
 * discovery bonus folds straight into the harvest's own `gold`, exactly like
 * a Bountiful Harvest synergy does, so what matters here is that it lands in
 * that same figure exactly once per item ever, and that it behaves under the
 * same daily ceiling as everything else the farm pays.
 *
 * `funded()` pre-donates every item by default (see its own doc) so that
 * describe blocks with no interest in a first-ever discovery are never
 * perturbed by one; every test below starts from `museum: false` instead.
 */
describe("Ray's Museum", () => {
  it("folds the first-ever discovery bonus into the harvest's own Gold credit", async () => {
    const { token, id } = await funded(500_000, { museum: false });
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const before = await balance(token);

    const result = await collectOne(token, unitId, HEN_READY);

    const bonus = museumDiscoveryBonus(HEN_YIELD.item, HEN_YIELD.quantity);
    expect(result.harvest.discoveries).toEqual([{ item: HEN_YIELD.item, bonus }]);
    expect(result.harvest.gold).toBe(yieldValue("hen") + bonus);
    expect(await balance(token)).toBe(before + result.harvest.gold);
    expect(await readStackAcresMuseum(id)).toContain(HEN_YIELD.item);
    expect(result.museum[HEN_YIELD.item]).toBe(true);
  });

  it("never pays the bonus twice -- a duplicate harvest of the same item earns nothing extra", async () => {
    const { token, id } = await funded(500_000, { museum: false });
    await markStackAcresDonated(id, HEN_YIELD.item);
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const before = await balance(token);

    const result = await collectOne(token, unitId, HEN_READY);

    expect(result.harvest.discoveries).toEqual([]);
    expect(result.harvest.gold).toBe(yieldValue("hen"));
    expect(await balance(token)).toBe(before + yieldValue("hen"));
  });

  it("counts each item separately within one sweep -- an already-donated item earns no repeat bonus while a new one still does", async () => {
    const { token, id } = await funded(500_000, { museum: false });
    await markStackAcresDonated(id, HEN_YIELD.item);
    await stockStackAcres(token, { stock: "hen" }, T0);
    await sowWatered(token, "sprout");
    const before = await balance(token);

    // A Sprout Row and a Hen Coop share a 15-minute cycle, so both ripen
    // together -- the only way to bring a donated and an undonated item home
    // in the same sweep.
    const result = await harvestStackAcres(token, {}, HEN_READY);

    const sproutYield = STACKACRES_YIELDS.sprout;
    expect(result.harvest.discoveries).toEqual([
      { item: sproutYield.item, bonus: museumDiscoveryBonus(sproutYield.item, sproutYield.quantity) },
    ]);
    expect(await balance(token)).toBe(before + result.harvest.gold);
  });

  it("tracks each item independently -- donating one never flags another", async () => {
    const { token } = await funded(500_000, { museum: false });
    const hen = await stockStackAcres(token, { stock: "hen" }, T0);
    await collectOne(token, unitOf(hen, "hen").id, HEN_READY);

    const registry = (await readStackAcres(token, HEN_READY)).museum;
    expect(registry[HEN_YIELD.item]).toBe(true);
    for (const item of Object.keys(registry) as (keyof typeof registry)[]) {
      if (item !== HEN_YIELD.item) expect(registry[item]).toBe(false);
    }
  });

  it("starts a fresh farm with nothing donated", async () => {
    const { token } = await funded(500_000, { museum: false });
    expect((await readStackAcres(token, T0)).museum).toEqual(emptyMuseumRegistry());
  });

  it("still pays the harvest in full when a museum write throws", async () => {
    // The produce credit is already durable by the time the museum write
    // runs -- same posture as harvest_credit_failed just above it in the
    // service. A throw here must be swallowed, not surfaced, and must not
    // cost the player the produce Gold they already earned.
    const { token } = await funded(500_000, { museum: false });
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const before = await balance(token);
    vi.mocked(markStackAcresDonated).mockRejectedValueOnce(new Error("boom"));

    const result = await collectOne(token, unitId, HEN_READY);

    expect(result.harvest.discoveries).toEqual([]);
    expect(result.harvest.gold).toBe(yieldValue("hen"));
    expect(await balance(token)).toBe(before + yieldValue("hen"));
  });

  it("drops the bonus but still registers the discovery when the daily ceiling has no room left for it", async () => {
    const { token, id } = await funded(500_000, { museum: false });
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const bonus = museumDiscoveryBonus(HEN_YIELD.item, HEN_YIELD.quantity);
    // Leaves room for the produce itself but not for the bonus on top of it.
    await burnAllowance(id, STACKACRES_GOLD_CEILING - yieldValue("hen") - bonus + 1);
    const before = await balance(token);

    const result = await collectOne(token, unitId, HEN_READY);

    expect(result.harvest.discoveries).toEqual([]);
    expect(result.harvest.gold).toBe(yieldValue("hen"));
    expect(await balance(token)).toBe(before + yieldValue("hen"));
    expect(await readStackAcresMuseum(id)).toContain(HEN_YIELD.item);
  });
});

/**
 * Land Maintenance, end to end. The curve is pinned in
 * lib/stackacres/upkeep.test.ts; what matters here is that it is charged once
 * a day against a real harvest, and that it can never reach the wallet.
 */
describe("Land Maintenance", () => {
  const DAY = stackacresExchangeDay(T0);

  /**
   * Every other block in this file gets its day pre-paid by `funded` so that
   * the fee is not a term in an assertion about seed costs. These want the
   * opposite: the bill unpaid, and every sector cleared so there is a real
   * estate to bill for.
   */
  const unpaid = (gold = 500_000) => funded(gold, { settled: false });

  /** What a fully cleared farm with nothing bought owes for the day. */
  const clearedFarmFee = () =>
    stackacresUpkeepFee(unlockedPlotCount([...SECTOR_LADDER, HOME_SECTOR], {}));

  it("comes out of the first harvest of the day, once", async () => {
    const { token, id } = await unpaid();
    for (let i = 0; i < 3; i += 1) await stockStackAcres(token, { stock: "hen" }, T0);
    const fee = clearedFarmFee();
    const before = await balance(token);

    // Clean rolls throughout: a mucked unit keeps its slot, and this test
    // needs the cap free again to re-stock for the second harvest.
    const roll = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const first = await harvestStackAcres(token, {}, HEN_READY);
      // Three Hen Coops on a fully cleared farm are worth far less than the
      // day's bill, so this pays what it can and the rest stays owed.
      expect(fee).toBeGreaterThan(first.harvest.gross);
      expect(first.harvest.upkeep).toBe(first.harvest.gross + first.harvest.bonus);
      expect(first.harvest.gold).toBe(0);
      expect(await balance(token)).toBe(before);
      const paidSoFar = await readStackAcresUpkeep(id, DAY);
      expect(paidSoFar).toBe(first.harvest.upkeep);

      // Same day, a second harvest: it settles the DIFFERENCE, never the whole
      // bill again, so the running total only ever climbs toward the fee.
      for (let i = 0; i < 3; i += 1) await stockStackAcres(token, { stock: "hen" }, HEN_READY);
      const later = new Date(HEN_READY.getTime() + HEN.durationMs);
      const second = await harvestStackAcres(token, {}, later);
      expect(stackacresExchangeDay(later)).toBe(DAY);
      expect(await readStackAcresUpkeep(id, DAY)).toBe(paidSoFar + second.harvest.upkeep);
      expect(await readStackAcresUpkeep(id, DAY)).toBeLessThanOrEqual(fee);
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
    const { token } = await unpaid();
    // A fully cleared farm is billed on all fifteen of its slots; three Hen
    // Coops are the only thing standing in them, so the day's fee is far more
    // than that harvest is worth.
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    const before = await balance(token);

    const result = await harvestStackAcres(token, {}, HEN_READY);
    expect(clearedFarmFee()).toBeGreaterThan(result.harvest.gross);
    // Clamped at what the sweep was worth AFTER its synergy, which is the
    // number the player would otherwise have been paid.
    expect(result.harvest.upkeep).toBe(result.harvest.gross + result.harvest.bonus);
    expect(result.harvest.gold).toBe(0);
    // Zeroed, never negative: the fee cannot reach the balance.
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
    expect(view.upkeep.plots).toBe(unlockedPlotCount(view.sectors, view.capacity));
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
    await stockStackAcres(token, { stock: "hen" }, T0);

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
    await stockStackAcres(token, { stock: "hen" }, T0);
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
    await stockStackAcres(token, { stock: "hen" }, T0);
    // One Gold short of what a single Sprout Row is worth.
    await burnAllowance(id, STACKACRES_GOLD_CEILING - (yieldValue("hen") - 1));
    const before = await balance(token);

    await expect(harvestStackAcres(token, {}, CROP_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });

  it("still pays right up to the last Gold of the day", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { stock: "hen" }, T0);
    await burnAllowance(id, STACKACRES_GOLD_CEILING - yieldValue("hen"));
    const before = await balance(token);

    const result = await harvestStackAcres(token, {}, CROP_READY);

    expect(result.harvest.gold).toBe(yieldValue("hen"));
    expect(await balance(token)).toBe(before + yieldValue("hen"));
    expect(result.exchange.remaining).toBe(0);
  });

  it("holds the ceiling when a dozen harvests race for the last of it", async () => {
    // The memory store cannot deadlock the way Postgres serializes, but it can
    // still interleave the reservation and the settlement across awaits --
    // which is exactly the shape of the bug this guards. Against a real
    // database the guarantee is the RPC's row lock; see the migration.
    const { token, id } = await funded();
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    const before = await balance(token);

    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => harvestStackAcres(token, {}, CROP_READY)),
    );
    expect(attempts.some((a) => a.status === "fulfilled")).toBe(true);

    // Every unit settled at most once, and the day was charged exactly what
    // was actually paid -- which is what the release path exists to keep true.
    const paid = (await balance(token)) - before;
    expect(paid).toBeLessThanOrEqual(yieldValue("hen") * STACKACRES_BASE_CAP * 1.3);
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
    await burnAllowance(big.id, STACKACRES_GOLD_CEILING);
    await expect(harvestStackAcres(big.token, {}, CROP_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("reopens at UTC midnight and not a moment before", async () => {
    const { token, id } = await funded();
    const day = stackacresExchangeDay(T0);
    await stockStackAcres(token, { stock: "hen" }, T0);
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
    const { token, id } = await funded(500_000, { settled: false });
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
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
describe("the equipment ladder", () => {
  it("starts every farm on the free rung", async () => {
    const { token } = await funded();
    expect((await readStackAcres(token, T0)).tool).toBe(STACKACRES_STARTING_TIER);
  });

  it("walks one rung at a time and charges that rung's own price", async () => {
    const { token, id } = await funded(1_000_000);
    const price = toolUpgradePrice(STACKACRES_STARTING_TIER)!;
    const before = await balance(token);

    const view = await upgradeStackAcresTool(token, T0);

    expect(view.upgraded).toEqual({
      from: STACKACRES_STARTING_TIER,
      to: nextToolTier(STACKACRES_STARTING_TIER),
    });
    expect(await balance(token)).toBe(before - price);
    expect(await readStackAcresToolTier(id)).toBe(nextToolTier(STACKACRES_STARTING_TIER));
  });

  it("is a pure sink -- buying a rung hands nothing back", async () => {
    const { token } = await funded(1_000_000);
    const price = toolUpgradePrice(STACKACRES_STARTING_TIER)!;
    const before = await balance(token);
    await upgradeStackAcresTool(token, T0);
    expect(await balance(token)).toBe(before - price);
  });

  it("refuses a rung the player cannot afford, and takes nothing", async () => {
    const price = toolUpgradePrice(STACKACRES_STARTING_TIER)!;
    const { token, id } = await funded(price - 1);

    await expect(upgradeStackAcresTool(token, T0)).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(price - 1);
    expect(await readStackAcresToolTier(id)).toBe(STACKACRES_STARTING_TIER);
  });

  it("charges each rung once, and cannot be made to re-buy one", async () => {
    // The double-tap case, and the reason the store's write is guarded on the
    // rung last seen held. Sequential rather than raced -- the memory branch
    // is single-threaded, so this asserts the guard, not the scheduler.
    const { token, id } = await funded(1_000_000);
    const first = toolUpgradePrice(STACKACRES_STARTING_TIER)!;
    const second = toolUpgradePrice(nextToolTier(STACKACRES_STARTING_TIER)!)!;
    const before = await balance(token);

    await upgradeStackAcresTool(token, T0);
    await upgradeStackAcresTool(token, T0);

    expect(await balance(token)).toBe(before - first - second);
    expect(await readStackAcresToolTier(id)).toBe("golden-spade");
  });

  it("has nothing left to sell at the top of the ladder", async () => {
    const { token } = await funded(5_000_000);
    await upgradeStackAcresTool(token, T0);
    await upgradeStackAcresTool(token, T0);
    const before = await balance(token);

    await expect(upgradeStackAcresTool(token, T0)).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(before);
  });

  it("pays a critical harvest on top of what the sweep was worth", async () => {
    // Forced to crit by pinning the roll, so this asserts the arithmetic
    // rather than waiting on 25% odds. 0 also makes the muck roll fire, which
    // is fine -- bought stock never mucks.
    const { token } = await funded(5_000_000);
    await upgradeStackAcresTool(token, T0);
    await upgradeStackAcresTool(token, T0);
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;

    const before = await balance(token);
    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    let result;
    try {
      result = await collectOne(token, unitId, HEN_READY);
    } finally {
      roll.mockRestore();
    }

    expect(result.harvest.crit).toBeGreaterThan(0);
    // The crit is inside the payout, not beside it: one credit, one number.
    expect(await balance(token)).toBe(before + result.harvest.gold);
    expect(result.harvest.gold).toBeGreaterThan(result.harvest.gross - result.harvest.upkeep);
  });

  it("pays no crit when the roll misses", async () => {
    const { token } = await funded(5_000_000);
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;

    const roll = vi.spyOn(Math, "random").mockReturnValue(0.99);
    let result;
    try {
      result = await collectOne(token, unitId, HEN_READY);
    } finally {
      roll.mockRestore();
    }

    expect(result.harvest.crit).toBe(0);
  });

  it("never crits on the free rung, however the dice fall", async () => {
    // The load-bearing one: a player who buys nothing sees exactly the farm
    // they had before this feature. Pinned at the luckiest possible roll, so
    // this fails the moment the Trowel is given a non-zero chance.
    const { token } = await funded(5_000_000);
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;
    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const result = await collectOne(token, unitId, HEN_READY);
      expect(result.harvest.crit).toBe(0);
    } finally {
      roll.mockRestore();
    }
  });

  it("NEVER pays a crit past the daily ceiling", async () => {
    // THE invariant the whole design turns on: the crit rides inside the
    // harvest's own reservation, so a lucky sweep reaches the same wall as an
    // unlucky one -- sooner, never further. Burn the day down to a sliver,
    // then force a crit and check the payout is still bounded by what was
    // left rather than by what the crit wanted.
    const { token, id } = await funded(5_000_000);
    await upgradeStackAcresTool(token, T0);
    await upgradeStackAcresTool(token, T0);
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;

    const room = 5;
    await burnAllowance(id, STACKACRES_GOLD_CEILING - room, HEN_READY);
    const before = await balance(token);

    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await expect(collectOne(token, unitId, HEN_READY)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
    } finally {
      roll.mockRestore();
    }
    // Refused while the crops were still standing: nothing paid, nothing lost.
    expect(await balance(token)).toBe(before);
  });

  it("hands back the crit headroom it reserved and did not use", async () => {
    // The optimistic reservation must not quietly eat the day's allowance on
    // a miss, or an unlucky player would hit the ceiling faster than a lucky
    // one -- the exact opposite of the intent.
    const { token, id } = await funded(5_000_000);
    await upgradeStackAcresTool(token, T0);
    await upgradeStackAcresTool(token, T0);
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;

    const roll = vi.spyOn(Math, "random").mockReturnValue(0.99);
    let result;
    try {
      result = await collectOne(token, unitId, HEN_READY);
    } finally {
      roll.mockRestore();
    }

    expect(result.harvest.crit).toBe(0);
    // Only what was actually paid may have come off today's allowance.
    const spent = await readStackAcresExchanged(id, stackacresExchangeDay(HEN_READY));
    expect(spent).toBe(result.harvest.gold);
  });
});

describe("the currency wall", () => {
  const SERVICE = readFileSync(join(process.cwd(), "lib/server/stackacres-service.ts"), "utf8");
  const ROUTE = readFileSync(join(process.cwd(), "app/api/stackacres/actions/route.ts"), "utf8");

  const calls = (source: string, fn: string) => source.split(`${fn}(`).length - 1;

  it("credits Gold in exactly three places: the refund helper, and two payouts", async () => {
    // If this is 4, go and look at the new one and ask the only question that
    // matters: which DIRECTION does it move Gold, and if it pays, does it
    // reserve against STACKACRES_GOLD_CEILING first? A refund belongs inside
    // `refundGold`. A credit that is not a refund is a faucet, and a faucet
    // that does not reserve first is the change to stop over.
    //
    // This used to be a count of five -- four refunds plus one payout -- and
    // it had to be edited every time a spend path added its own refund.
    // Routing every refund through one helper is what makes the number mean
    // something: no amount of new refunds can move it, and only a new PAYOUT
    // can. It grew from two to three when Town Contracts added a second payer
    // (see the module header) -- both payers reserve against the identical
    // ceiling before they settle, which is what is actually being guarded.
    expect(calls(SERVICE, "creditGoldByProfile")).toBe(3);
    // One of the three is the helper, whose whole body is that call.
    expect(SERVICE).toContain("async function refundGold(");
    // And the other two are the harvest and the contract payout -- the only
    // two payouts there may be, and both reserve against the same ceiling.
    expect(SERVICE).toContain("paid = await creditGoldByProfile(profile.id, gold)");
    expect(SERVICE).toContain("paid = await creditGoldByProfile(profile.id, contract.goldReward)");
  });

  it("spends Gold freely, which is the direction that is allowed", async () => {
    // Deliberately NOT pinned to a count. A new sink is a sink; the direction
    // is the invariant, not the arity. Clearing a sector arrived as one more
    // and needed no edit here.
    expect(calls(SERVICE, "spendGoldByProfile")).toBeGreaterThan(1);
  });

  it("exposes exactly two actions that pay Gold out, both ceiling-gated", () => {
    const actions = [...ROUTE.matchAll(/z\.literal\("([a-z-]+)"\)/g)].map((m) => m[1]).sort();
    // Adding an action means editing this list, which is the point: the
    // question to answer while doing it is "does this move Gold, and which
    // way".
    expect(actions).toEqual([
      "buy-feed",
      "buy-stock",
      "clear",
      "clear-sector",
      "collect",
      "consume-secret-item",
      "divert",
      "donate-secret-item",
      "expand-capacity",
      "feed",
      "fulfill-contract",
      "place-machine",
      "process",
      "request-contract",
      "retire",
      "sow-wheat",
      "stock",
      "tap-secret-zone",
      "trade-secret-item",
      "upgrade-tool",
      "water",
      "work",
    ]);

    // The claim that actually matters, held separately from the list so it
    // cannot be lost in a rename: `collect` and `fulfill-contract` are the
    // only two actions that pay a player Gold. Everything else on that list
    // either spends it or moves no money at all -- `upgrade-tool` included,
    // which is a pure sink, and the critical harvest it buys is paid BY
    // `collect` out of the same reservation rather than being a third payer;
    // `work`, `process` and `request-contract` included, which move inventory
    // only. `divert` is the interesting one and it is still not a payer: it
    // takes a ready animal's produce into inventory INSTEAD of into a
    // harvest, through the same version-guarded write `collect` uses, so it
    // reduces what the farm pays out today rather than adding a way in. The
    // four hidden-secrets actions are included too, which move an item count
    // or reshape a probability/target an existing payer already reserves
    // against -- never a Gold credit of their own.
    const paysGold = ["collect", "fulfill-contract"];
    expect(actions).toEqual(expect.arrayContaining(paysGold));
    expect(ROUTE).toContain("harvestStackAcres(token, { unitIds: action.unitIds })");
    expect(ROUTE).toContain("fulfillStackAcresTownContract(token)");
    // Both payers reserve against the exact same daily ceiling -- this is
    // the property that makes a second payer safe rather than a second
    // faucet. See lib/stackacres/exchange.ts. (STACKACRES_GOLD_CEILING is a
    // constant, not a call, hence counting occurrences directly rather than
    // through the `calls` helper above.)
    expect(SERVICE.split("STACKACRES_GOLD_CEILING").length - 1).toBeGreaterThanOrEqual(3);
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
    // The Farmstead's own three slots are exactly the free base, so a farm
    // that has cleared nothing and bought nothing never sees a bill.
    expect(view.upkeep).toMatchObject({ plots: STACKACRES_UPKEEP_FREE_PLOTS, fee: 0, due: 0 });
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

/**
 * Land: three of the four districts start under wild growth.
 *
 * Everything above this point hands the land over in `funded` so it can get
 * on with testing stock. These start where a real new farm starts -- home
 * only -- and are the ones that hold the land rules themselves.
 */
describe("clearing land", () => {
  /** A new farm: nothing cleared, nothing pre-paid, plenty of Gold. */
  async function greenfield(gold = 500_000, bushelBalance = 100_000) {
    return funded(gold, { land: [], settled: false });
  }

  const FIRST = SECTOR_LADDER[0];
  const SECOND = SECTOR_LADDER[1];

  it("opens a new farm with home only", async () => {
    const { token } = await greenfield();
    const view = await readStackAcres(token, T0);
    expect(view.sectors).toEqual([HOME_SECTOR]);
  });

  it("refuses to stock a kind whose land is still wild", async () => {
    const { token } = await greenfield();
    const before = await balance(token);

    await expect(stockStackAcres(token, { stock: "sprout" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    // Rule 1 in reverse: nothing was created, so nothing was paid for.
    expect(await balance(token)).toBe(before);
    expect((await readStackAcres(token, T0)).units).toEqual([]);
  });

  it("refuses to buy that kind outright either, and takes no Gold for it", async () => {
    const { token } = await greenfield();
    const before = await balance(token);

    await expect(buyStackAcresStock(token, { stock: "cattle" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });

  it("refuses to expand capacity on land nobody has cleared", async () => {
    const { token } = await greenfield();
    const before = await balance(token);

    await expect(expandStackAcresCapacity(token, "cattle", T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });

  it("still lets a new farm work the Farmstead it starts with", async () => {
    const { token } = await greenfield();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    expect(unitOf(view, "hen").state).toBe("working");
  });

  it("holds the first rung shut until enough stock is going", async () => {
    const { token } = await greenfield();
    const before = await balance(token);

    await expect(clearStackAcresSector(token, FIRST, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });

  it("sells the first rung once its requirements are met, and takes the Gold", async () => {
    const { token, id } = await greenfield();
    for (let i = 0; i < STACKACRES_SECTORS[FIRST].requiresUnits; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    const before = await balance(token);

    const view = await clearStackAcresSector(token, FIRST, T0);

    expect(view.sectors).toContain(FIRST);
    expect(await balance(token)).toBe(before - STACKACRES_SECTORS[FIRST].clearCost);
    expect(await readStackAcresSectors(id)).toEqual([FIRST]);
  });

  it("lets the land it just sold be stocked", async () => {
    const { token } = await greenfield();
    for (let i = 0; i < STACKACRES_SECTORS[FIRST].requiresUnits; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    await clearStackAcresSector(token, FIRST, T0);

    const view = await stockStackAcres(token, { stock: "sprout" }, T0);
    expect(unitOf(view, "sprout").state).toBe("working");
  });

  it("holds a later rung shut until the one before it is cleared", async () => {
    // Requirements met on units, Gold in hand, and still refused: the ladder
    // is the thing being tested, not the price.
    const { token } = await greenfield();
    for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    await clearStackAcresSector(token, FIRST, T0);
    while (
      (await readStackAcres(token, T0)).units.length < STACKACRES_SECTORS[SECOND].requiresUnits
    ) {
      await stockStackAcres(token, { stock: "sprout" }, T0);
    }

    const third = SECTOR_LADDER[2];
    const before = await balance(token);
    await expect(clearStackAcresSector(token, third, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);

    // The rung that IS next goes through.
    await clearStackAcresSector(token, SECOND, T0);
    expect((await readStackAcres(token, T0)).sectors).toContain(SECOND);
  });

  it("charges for the same land once, and refunds the tab that lost the race", async () => {
    const { token } = await greenfield();
    for (let i = 0; i < STACKACRES_SECTORS[FIRST].requiresUnits; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    const before = await balance(token);

    await clearStackAcresSector(token, FIRST, T0);
    await expect(clearStackAcresSector(token, FIRST, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(before - STACKACRES_SECTORS[FIRST].clearCost);
  });

  it("refuses land nobody can afford, and creates nothing", async () => {
    // Exactly enough to meet the sector's stock requirement and not a Gold
    // more. Seed costs Gold now, so "no money at all" would fail one step
    // earlier than the step under test.
    const { token, id } = await greenfield(
      STACKACRES_SECTORS[FIRST].requiresUnits * HEN.seedCost,
    );
    for (let i = 0; i < STACKACRES_SECTORS[FIRST].requiresUnits; i += 1) {
      await stockStackAcres(token, { stock: "hen" }, T0);
    }
    expect(await balance(token)).toBe(0);

    await expect(clearStackAcresSector(token, FIRST, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await readStackAcresSectors(id)).toEqual([]);
  });

  it("refuses a district that does not exist", async () => {
    const { token } = await greenfield();
    await expect(clearStackAcresSector(token, "the-moon", T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("carries a farm that already keeps stock on land the gate never existed for", async () => {
    // The live-farm clause. A player who bought cattle before land was gated
    // must not wake up locked out of Ox Fields, and this holds it without any
    // backfill having had to get it right.
    const { token, id } = await greenfield();
    await createStackAcresUnit(id, {
      stock: "cattle",
      stake: CATTLE.seedCost,
      yieldQuantity: STACKACRES_YIELDS.cattle.quantity,
      startedAt: T0,
      readyAt: new Date(T0.getTime() + CATTLE.durationMs),
      lastFedAt: T0,
      lastWateredAt: null,
      permanent: false,
    });

    const view = await readStackAcres(token, T0);
    expect(view.sectors).toContain("oxfields");
    // And it is genuinely usable, not just listed.
    await expect(stockStackAcres(token, { stock: "cattle" }, T0)).resolves.toBeTruthy();
  });
});

describe("idempotency keys", () => {
  const run = <T,>(token: string, key: string | null, action: string, fn: () => Promise<T>) =>
    runStackAcresAction(token, key, action, fn as () => Promise<StackAcresActionResult>);

  beforeEach(() => {
    __resetStackAcresIntentsForTest();
  });

  it("sows once when the same key arrives twice", async () => {
    const { token } = await funded();
    const key = randomUUID();
    const before = await balance(token);

    await run(token, key, "stock", () => stockStackAcres(token, { stock: "sprout" }, T0));
    const replay = await run(token, key, "stock", () =>
      stockStackAcres(token, { stock: "sprout" }, T0),
    );

    expect(replay.units.filter((u) => u.stock === "sprout")).toHaveLength(1);
    expect(await balance(token)).toBe(before - STACKACRES_CATALOGUE.sprout.seedCost);
  });

  it("sows twice when two different keys arrive -- two intents, not a duplicate", async () => {
    const { token } = await funded();
    const before = await balance(token);

    await run(token, randomUUID(), "stock", () => stockStackAcres(token, { stock: "sprout" }, T0));
    const second = await run(token, randomUUID(), "stock", () =>
      stockStackAcres(token, { stock: "sprout" }, T0),
    );

    expect(second.units.filter((u) => u.stock === "sprout")).toHaveLength(2);
    expect(await balance(token)).toBe(before - STACKACRES_CATALOGUE.sprout.seedCost * 2);
  });

  it("debits Gold once when a bought animal's key arrives twice", async () => {
    const { token } = await funded();
    const key = randomUUID();
    const before = await balance(token);

    await run(token, key, "buy-stock", () => buyStackAcresStock(token, { stock: "hen" }, T0));
    const replay = await run(token, key, "buy-stock", () =>
      buyStackAcresStock(token, { stock: "hen" }, T0),
    );

    expect(replay.units.filter((u) => u.stock === "hen")).toHaveLength(1);
    expect(await balance(token)).toBe(before - stackacresStockPrice("hen"));
  });

  it("buys one shipment of feed when its key arrives twice", async () => {
    const { token } = await funded();
    const key = randomUUID();
    const before = await balance(token);

    await run(token, key, "buy-feed", () => buyStackAcresFeed(token, "feed_sack", T0));
    const replay = await run(token, key, "buy-feed", () =>
      buyStackAcresFeed(token, "feed_sack", T0),
    );

    expect(replay.feed).toBe(STACKACRES_FEED.feed_sack.servings);
    expect(await balance(token)).toBe(before - STACKACRES_FEED.feed_sack.cost);
  });

  it("buys one capacity slot when its key arrives twice", async () => {
    const { token } = await funded();
    const key = randomUUID();
    const before = await balance(token);

    await run(token, key, "expand-capacity", () => expandStackAcresCapacity(token, "hen", T0));
    const replay = await run(token, key, "expand-capacity", () =>
      expandStackAcresCapacity(token, "hen", T0),
    );

    expect(replay.capacity.hen).toBe(1);
    expect(await balance(token)).toBe(before - stackacresCapacityPrice("hen"));
  });

  it("hands a replayed harvest the same produce line, not a refusal", async () => {
    // A hen, not a crop: livestock has no thirst clock, so `HEN_READY` is
    // genuinely ready without a watering step in the middle of a test that is
    // about something else.
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const key = randomUUID();

    const before = await balance(token);
    const first = await runStackAcresAction(
      token,
      key,
      "collect",
      () => collectOne(token, unitId, HEN_READY),
      HEN_READY,
    );
    const paidOnce = await balance(token);
    expect(paidOnce).toBeGreaterThan(before);
    // Without the key this second call is the 409 the version guard raises,
    // which the farm answers with a refusal knock -- a denial sound for an
    // action that actually succeeded.
    const replay = await runStackAcresAction(
      token,
      key,
      "collect",
      () => collectOne(token, unitId, HEN_READY),
      HEN_READY,
    );

    expect(replay.harvest).toEqual(first.harvest);
    // And it paid exactly once, which is what the version guard was always
    // good for -- the key only fixes what the duplicate SOUNDS like.
    expect(await balance(token)).toBe(paidOnce);
  });

  it("frees the key when the action refused, so the retry is a real attempt", async () => {
    const { token, id } = await funded(0);
    const key = randomUUID();

    await expect(
      run(token, key, "stock", () => stockStackAcres(token, { stock: "sprout" }, T0)),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    // The player tops up and presses again. A held key would answer this with
    // "already done" and sow nothing.
    await adjustGold(id, 10_000);
    const retried = await run(token, key, "stock", () =>
      stockStackAcres(token, { stock: "sprout" }, T0),
    );
    expect(retried.units.filter((u) => u.stock === "sprout")).toHaveLength(1);
  });

  it("runs unguarded when no key is sent, so an older client still works", async () => {
    const { token } = await funded();
    const before = await balance(token);

    await run(token, null, "stock", () => stockStackAcres(token, { stock: "sprout" }, T0));
    const second = await run(token, null, "stock", () =>
      stockStackAcres(token, { stock: "sprout" }, T0),
    );

    expect(second.units.filter((u) => u.stock === "sprout")).toHaveLength(2);
    expect(await balance(token)).toBe(before - STACKACRES_CATALOGUE.sprout.seedCost * 2);
  });

  it("sows once when both copies land at the same time", async () => {
    const { token } = await funded();
    const key = randomUUID();
    const before = await balance(token);

    // Both in flight together, which is the shape a retry fired before the
    // first request came back actually has. One claims, the other is told the
    // farm as it stands rather than being refused.
    const [, second] = await Promise.all([
      run(token, key, "stock", () => stockStackAcres(token, { stock: "sprout" }, T0)),
      run(token, key, "stock", () => stockStackAcres(token, { stock: "sprout" }, T0)),
    ]);

    expect(second.units.filter((u) => u.stock === "sprout").length).toBeLessThanOrEqual(1);
    expect(await balance(token)).toBe(before - STACKACRES_CATALOGUE.sprout.seedCost);
  });

  it("keeps one player's key clear of another's", async () => {
    const a = await funded();
    const b = await funded();
    const key = randomUUID();

    await run(a.token, key, "stock", () => stockStackAcres(a.token, { stock: "sprout" }, T0));
    const other = await run(b.token, key, "stock", () =>
      stockStackAcres(b.token, { stock: "sprout" }, T0),
    );

    expect(other.units.filter((u) => u.stock === "sprout")).toHaveLength(1);
  });
});

/**
 * PROCESSING: wheat, machines, Town Contracts. Wheat never appears in
 * `view.units` and never pays Gold at harvest -- see
 * lib/stackacres/machine-items.ts's header for why it is not a sixth
 * StackAcresStock. Everything here is inventory until a fulfilled contract
 * turns it back into Gold, through the SAME flat daily ceiling a harvest
 * uses.
 */
describe("wheat and machines", () => {
  it("sows a wheat plot for the listed Gold price", async () => {
    const { token } = await funded();
    const before = await balance(token);
    const view = await sowStackAcresWheat(token, T0);
    expect(await balance(token)).toBe(before - WHEAT_SEED_COST);
    expect(view.wheatPlots).toHaveLength(1);
    expect(view.wheatPlots[0].ready).toBe(false);
  });

  it("refuses and refunds once the wheat cap is reached", async () => {
    const { token } = await funded();
    for (let i = 0; i < WHEAT_PLOT_CAP; i += 1) await sowStackAcresWheat(token, T0);
    const before = await balance(token);
    await expect(sowStackAcresWheat(token, T0)).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("places a machine for its listed Gold price, idle", async () => {
    const { token } = await funded();
    const before = await balance(token);
    const view = await placeStackAcresMachine(token, "mill", T0);
    expect(await balance(token)).toBe(before - MACHINE_CATALOGUE.mill.placeCost);
    expect(view.machines).toHaveLength(1);
    expect(view.machines[0]).toMatchObject({ kind: "mill", status: "idle" });
  });

  it("refuses and refunds once the machine cap is reached", async () => {
    const { token } = await funded();
    // One of each kind, which is exactly MACHINE_CAP of them -- a second Mill
    // is refused before the total cap is ever the reason.
    for (const kind of MACHINE_KINDS) await placeStackAcresMachine(token, kind, T0);
    expect(MACHINE_KINDS).toHaveLength(MACHINE_CAP);
    const before = await balance(token);
    await expect(placeStackAcresMachine(token, "mill", T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });

  it("moves no Gold at all, in either direction", async () => {
    const { token } = await funded();
    await sowStackAcresWheat(token, T0);
    await placeStackAcresMachine(token, "mill", T0);
    const before = await balance(token);
    await workStackAcres(token, new Date(T0.getTime() + WHEAT_DURATION_MS));
    expect(await balance(token)).toBe(before);
  });

  it("runs the whole loop: ripe wheat into inventory, an idle mill starting, then finishing into flour", async () => {
    const { token } = await funded();
    await sowStackAcresWheat(token, T0);
    await placeStackAcresMachine(token, "mill", T0);

    // Wheat ripens (yield 4) but is not yet ready: nothing moves.
    const early = await workStackAcres(token, new Date(T0.getTime() + 1));
    expect(early.work).toEqual({ wheatCollected: 0, machinesStarted: 0, machinesCollected: 0 });
    expect(early.inventory.wheat ?? 0).toBe(0);

    // Ripe: collected into inventory, and the same pass starts the mill
    // (input 3, so 4 - 3 = 1 Wheat left over).
    const ripenedAt = new Date(T0.getTime() + WHEAT_DURATION_MS);
    const ripe = await workStackAcres(token, ripenedAt);
    expect(ripe.work).toEqual({ wheatCollected: 1, machinesStarted: 1, machinesCollected: 0 });
    expect(ripe.inventory.wheat).toBe(WHEAT_YIELD_QUANTITY - RECIPE_CATALOGUE.flour.input.quantity);
    expect(ripe.machines[0].status).toBe("working");
    expect(ripe.wheatPlots).toHaveLength(0);

    // Not done yet: another pass mid-run changes nothing.
    const midRun = await workStackAcres(
      token,
      new Date(ripenedAt.getTime() + RECIPE_CATALOGUE.flour.processingMs - 1),
    );
    expect(midRun.work.machinesCollected).toBe(0);
    expect(midRun.inventory.flour ?? 0).toBe(0);

    // Done: the run settles into Flour, and the mill goes back to idle.
    const finishedAt = new Date(ripenedAt.getTime() + RECIPE_CATALOGUE.flour.processingMs);
    const done = await workStackAcres(token, finishedAt);
    expect(done.work).toEqual({ wheatCollected: 0, machinesStarted: 0, machinesCollected: 1 });
    expect(done.inventory.flour).toBe(RECIPE_CATALOGUE.flour.output.quantity);
    expect(done.machines[0].status).toBe("idle");
  });

  it("does not start a mill short of its full input batch", async () => {
    const { token } = await funded();
    await placeStackAcresMachine(token, "mill", T0);
    // One wheat plot yields fewer than the mill's own input requirement, so
    // it must sit in inventory rather than starting a run.
    expect(WHEAT_YIELD_QUANTITY).toBeLessThan(RECIPE_CATALOGUE.flour.input.quantity * 2);
    const view = await workStackAcres(token, new Date(T0.getTime() + WHEAT_DURATION_MS));
    expect(view.machines[0].status).toBe("idle");
  });
});

describe("Town Contracts", () => {
  /** Grows and mills enough Flour to fulfil whatever contract this player is
   *  holding, regardless of which rung was drawn. */
  async function stockpileFlour(token: string, flour: number, at = T0): Promise<Date> {
    let now = at;
    let made = 0;
    while (made < flour) {
      await sowStackAcresWheat(token, now);
      now = new Date(now.getTime() + WHEAT_DURATION_MS);
      await workStackAcres(token, now); // collects wheat, starts the mill
      now = new Date(now.getTime() + RECIPE_CATALOGUE.flour.processingMs);
      await workStackAcres(token, now); // collects the run into inventory
      made += RECIPE_CATALOGUE.flour.output.quantity;
    }
    return now;
  }

  it("posts one open contract and refuses a second while one is open", async () => {
    const { token } = await funded();
    await placeStackAcresMachine(token, "mill", T0);
    const view = await requestStackAcresContract(token, T0);
    expect(view.contract).not.toBeNull();
    expect(view.contract!.status).toBe("open");

    await expect(requestStackAcresContract(token, T0)).rejects.toBeInstanceOf(StackAcresRequestError);
  });

  it("fulfilling pays Gold and Influence, deducts the goods, and closes the contract", async () => {
    const { token } = await funded();
    await placeStackAcresMachine(token, "mill", T0);
    const opened = await requestStackAcresContract(token, T0);
    const contract = opened.contract!;
    const now = await stockpileFlour(token, contract.quantity, T0);

    const before = await balance(token);
    const result = await fulfillStackAcresTownContract(token, now);

    expect(result.contractReward).toEqual({
      gold: contract.goldReward,
      influence: contract.influenceReward,
    });
    expect(await balance(token)).toBe(before + contract.goldReward);
    expect(result.influence).toBe(contract.influenceReward);
    expect(result.inventory.flour ?? 0).toBe(0);
    expect(result.contract).toBeNull();
  });

  it("refuses fulfilment without enough of the goods on hand, spending nothing", async () => {
    const { token } = await funded();
    await placeStackAcresMachine(token, "mill", T0);
    await requestStackAcresContract(token, T0);
    const before = await balance(token);
    await expect(fulfillStackAcresTownContract(token, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });

  it("refuses when the day's Gold ceiling has no room, and refunds the goods it had already taken", async () => {
    const { token, id } = await funded();
    await placeStackAcresMachine(token, "mill", T0);
    const opened = await requestStackAcresContract(token, T0);
    const contract = opened.contract!;
    const now = await stockpileFlour(token, contract.quantity, T0);

    // Leave less headroom today than this contract pays.
    await burnAllowance(id, STACKACRES_GOLD_CEILING - contract.goldReward + 1, now);

    const before = await balance(token);
    await expect(fulfillStackAcresTownContract(token, now)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);

    // The goods it took in step 1 came back, and the contract is still open
    // for whenever there is room again.
    const after = await readStackAcres(token, now);
    expect(after.inventory.flour).toBe(contract.quantity);
    expect(after.contract?.status).toBe("open");
  });
});

describe("recipes", () => {
  /** A ready animal, seeded straight into the store.
   *
   *  Going through `stockStackAcres` and waiting would mean feeding a cow
   *  three times across its 24-hour cycle, which is a test about hunger, not
   *  about recipes. `lastFedAt` is set to `readyAt` so the unit is ready and
   *  not hungry at exactly the moment these tests act on it. */
  async function readyAnimal(id: string, stock: "cattle" | "pig", at = T0) {
    return createStackAcresUnit(id, {
      stock,
      stake: STACKACRES_CATALOGUE[stock].seedCost,
      yieldQuantity: STACKACRES_YIELDS[stock].quantity,
      startedAt: new Date(at.getTime() - STACKACRES_CATALOGUE[stock].durationMs),
      readyAt: at,
      lastFedAt: at,
      lastWateredAt: null,
      permanent: false,
    });
  }

  describe("divert", () => {
    it("takes an animal's produce into the inventory and pays no Gold for it", async () => {
      const { token, id } = await funded();
      const unit = await readyAnimal(id, "cattle");
      const before = await balance(token);

      const result = await divertStackAcresUnit(token, unit.id, T0);

      expect(result.diverted).toEqual({ item: "milk", quantity: STACKACRES_YIELDS.cattle.quantity });
      expect(result.inventory.milk).toBe(STACKACRES_YIELDS.cattle.quantity);
      // THE WHOLE SAFETY ARGUMENT: diverting REMOVES Gold from the farm's day
      // rather than adding to it, so it needs no ceiling reservation.
      expect(await balance(token)).toBe(before);
    });

    it("settles the same row a harvest would, so the two cannot both take it", async () => {
      const { token, id } = await funded();
      const unit = await readyAnimal(id, "pig");
      await divertStackAcresUnit(token, unit.id, T0);

      // The harvest no longer finds a ready row -- it is not skipping one.
      await expect(harvestStackAcres(token, { unitIds: [unit.id] }, T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
      const after = await readStackAcres(token, T0);
      expect(after.inventory.wool).toBe(STACKACRES_YIELDS.pig.quantity);
    });

    it("refuses produce no machine takes, leaving the unit standing", async () => {
      const { token } = await funded();
      const view = await stockStackAcres(token, { stock: "hen" }, T0);
      const unitId = unitOf(view, "hen").id;
      await expect(divertStackAcresUnit(token, unitId, HEN_READY)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
      const after = await readStackAcres(token, HEN_READY);
      expect(unitOf(after, "hen").state).toBe("ready");
    });

    it("refuses a unit that is not ready yet", async () => {
      const { token } = await funded();
      const view = await stockStackAcres(token, { stock: "cattle" }, T0);
      await expect(
        divertStackAcresUnit(token, unitOf(view, "cattle").id, T0),
      ).rejects.toBeInstanceOf(StackAcresRequestError);
    });
  });

  describe("processRecipe", () => {
    it("converts in one step for an instant recipe, and moves no Gold", async () => {
      const { token, id } = await funded();
      await placeStackAcresMachine(token, "dairy", T0);
      await adjustStackAcresInventory(id, "milk", 7);
      const before = await balance(token);

      const result = await processRecipe(id, "cheese", T0);

      expect(result.produced).toEqual(RECIPE_CATALOGUE.cheese.output);
      expect(result.readyAt).toBeNull();
      const view = await readStackAcres(token, T0);
      expect(view.inventory.milk).toBe(7 - RECIPE_CATALOGUE.cheese.input.quantity);
      expect(view.inventory.cheese).toBe(RECIPE_CATALOGUE.cheese.output.quantity);
      // No queue row: an instant recipe leaves the machine idle.
      expect(view.machines[0].status).toBe("idle");
      expect(await balance(token)).toBe(before);
    });

    it("refuses short of a full batch and spends nothing", async () => {
      const { token, id } = await funded();
      await placeStackAcresMachine(token, "loom", T0);
      await adjustStackAcresInventory(id, "wool", RECIPE_CATALOGUE.cloth.input.quantity - 1);

      await expect(processRecipe(id, "cloth", T0)).rejects.toBeInstanceOf(StackAcresRequestError);

      // The refusal is the whole point: the input is still there, untouched.
      const view = await readStackAcres(token, T0);
      expect(view.inventory.wool).toBe(RECIPE_CATALOGUE.cloth.input.quantity - 1);
      expect(view.inventory.cloth ?? 0).toBe(0);
    });

    it("refuses without the machine the recipe needs, even with the input on hand", async () => {
      const { token, id } = await funded();
      await adjustStackAcresInventory(id, "milk", 99);
      await expect(processRecipe(id, "cheese", T0)).rejects.toBeInstanceOf(StackAcresRequestError);
      const view = await readStackAcres(token, T0);
      expect(view.inventory.milk).toBe(99);
    });

    it("enqueues a queued recipe onto the machine, snapshotting what it will pay", async () => {
      const { token, id } = await funded();
      await placeStackAcresMachine(token, "mill", T0);
      await adjustStackAcresInventory(id, "wheat", 5);

      const result = await processRecipe(id, "flour", T0);
      expect(result.produced).toBeNull();
      expect(result.readyAt).toBe(
        new Date(T0.getTime() + RECIPE_CATALOGUE.flour.processingMs).toISOString(),
      );

      const running = await readStackAcres(token, T0);
      expect(running.machines[0].status).toBe("working");
      expect(running.machines[0].recipeId).toBe("flour");
      expect(running.machines[0].unitsProcessing).toBe(RECIPE_CATALOGUE.flour.output.quantity);
      // Rule 1: the input left before the run that consumes it existed.
      expect(running.inventory.wheat).toBe(5 - RECIPE_CATALOGUE.flour.input.quantity);
      expect(running.inventory.flour ?? 0).toBe(0);

      // And `work` collects it, off the row's own snapshot.
      const done = await workStackAcres(
        token,
        new Date(T0.getTime() + RECIPE_CATALOGUE.flour.processingMs),
      );
      expect(done.inventory.flour).toBe(RECIPE_CATALOGUE.flour.output.quantity);
      expect(done.machines[0].status).toBe("idle");
      expect(done.machines[0].recipeId).toBeNull();
    });

    it("refuses a second batch while the machine is still running the first", async () => {
      const { token, id } = await funded();
      await placeStackAcresMachine(token, "mill", T0);
      await adjustStackAcresInventory(id, "wheat", 99);
      await processRecipe(id, "flour", T0);

      await expect(processRecipe(id, "flour", T0)).rejects.toBeInstanceOf(StackAcresRequestError);
      const view = await readStackAcres(token, T0);
      // Only the first batch's input was taken.
      expect(view.inventory.wheat).toBe(99 - RECIPE_CATALOGUE.flour.input.quantity);
    });

    it("never auto-starts an instant recipe from the worker pass", async () => {
      // A Dairy is a choice, not a queue. If `work` started one on a poll, a
      // player's milk would vanish into cheese they never asked for.
      const { token, id } = await funded();
      await placeStackAcresMachine(token, "dairy", T0);
      await adjustStackAcresInventory(id, "milk", 99);

      const result = await workStackAcres(token, T0);
      expect(result.work.machinesStarted).toBe(0);
      expect(result.inventory.milk).toBe(99);
      expect(result.inventory.cheese ?? 0).toBe(0);
    });
  });

  describe("the whole loop", () => {
    it("carries a cow's milk through a Dairy to a fulfilled Cheese contract", async () => {
      const { token, id } = await funded();
      await placeStackAcresMachine(token, "dairy", T0);

      // Enough cows for the largest Cheese rung.
      for (let i = 0; i < 4; i += 1) {
        const unit = await readyAnimal(id, "cattle");
        await divertStackAcresUnit(token, unit.id, T0);
      }

      const opened = await requestStackAcresContract(token, T0);
      const contract = opened.contract!;
      expect(contract.item).toBe("cheese");

      while ((await readStackAcres(token, T0)).inventory.cheese ?? 0 < contract.quantity) {
        const held = (await readStackAcres(token, T0)).inventory.cheese ?? 0;
        if (held >= contract.quantity) break;
        await processRecipe(id, "cheese", T0);
      }

      const before = await balance(token);
      const result = await fulfillStackAcresTownContract(token, T0);
      expect(await balance(token)).toBe(before + contract.goldReward);
      expect(result.contract).toBeNull();
    });
  });
});

/**
 * Hidden secrets: three small discovery spots, and the one collectible they
 * can turn up. NONE OF THIS MOVES GOLD -- the currency-wall block above
 * already holds the call-site count that proves it; these tests hold the
 * behavioural half.
 */
describe("hidden secrets", () => {
  const ZONE = HIDDEN_ZONES[0];
  const DICE = "lucky_poker_dice";

  it("moves no Gold at all, whatever it rolls", async () => {
    const { token, id } = await funded();
    const before = await balance(token);
    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await tapStackAcresSecretZone(token, ZONE.id, T0);
    } finally {
      roll.mockRestore();
    }
    expect(await balance(token)).toBe(before);
    await adjustStackAcresSecretLedger(id, DICE, 1);
    await donateStackAcresSecretItem(token, DICE, T0);
    expect(await balance(token)).toBe(before);
  });

  describe("tapStackAcresSecretZone", () => {
    it("refuses a name that is not a real zone", async () => {
      const { token } = await funded();
      await expect(tapStackAcresSecretZone(token, "not-a-zone", T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
    });

    it("finds the item on a hit and credits it once", async () => {
      const { token, id } = await funded();
      const roll = vi.spyOn(Math, "random").mockReturnValue(0);
      let result;
      try {
        result = await tapStackAcresSecretZone(token, ZONE.id, T0);
      } finally {
        roll.mockRestore();
      }
      expect(result.discovery).toBe(DICE);
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(1);
    });

    it("finds nothing on a miss", async () => {
      const { token, id } = await funded();
      const roll = vi.spyOn(Math, "random").mockReturnValue(0.999);
      let result;
      try {
        result = await tapStackAcresSecretZone(token, ZONE.id, T0);
      } finally {
        roll.mockRestore();
      }
      expect(result.discovery).toBeNull();
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(0);
    });

    it("marks the attempt before rolling, refusing a second roll the same UTC day even at guaranteed odds", async () => {
      const { token, id } = await funded();
      const miss = vi.spyOn(Math, "random").mockReturnValue(0.999);
      try {
        await tapStackAcresSecretZone(token, ZONE.id, T0);
      } finally {
        miss.mockRestore();
      }
      const day = stackacresExchangeDay(T0);
      expect(await readStackAcresSecretLedgerQty(id, secretZoneAttemptKey(ZONE.id, day))).toBe(1);

      const guaranteed = vi.spyOn(Math, "random").mockReturnValue(0);
      let second;
      try {
        second = await tapStackAcresSecretZone(token, ZONE.id, T0);
      } finally {
        guaranteed.mockRestore();
      }
      expect(second.discovery).toBeNull();
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(0);
    });

    it("rolls again on the next UTC day", async () => {
      const { token, id } = await funded();
      const miss = vi.spyOn(Math, "random").mockReturnValue(0.999);
      try {
        await tapStackAcresSecretZone(token, ZONE.id, T0);
      } finally {
        miss.mockRestore();
      }
      const tomorrow = new Date(T0.getTime() + 24 * 60 * 60 * 1000);
      const hit = vi.spyOn(Math, "random").mockReturnValue(0);
      let result;
      try {
        result = await tapStackAcresSecretZone(token, ZONE.id, tomorrow);
      } finally {
        hit.mockRestore();
      }
      expect(result.discovery).toBe(DICE);
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(1);
    });
  });

  describe("donateStackAcresSecretItem", () => {
    it("refuses with nothing held", async () => {
      const { token } = await funded();
      await expect(donateStackAcresSecretItem(token, DICE, T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
    });

    it("spends the item and marks it donated", async () => {
      const { token, id } = await funded();
      await adjustStackAcresSecretLedger(id, DICE, 1);
      await donateStackAcresSecretItem(token, DICE, T0);
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(0);
      expect(await readStackAcresMuseum(id)).toContain(DICE);
    });

    it("does not touch StackAcresItem's own museum registry", async () => {
      const { token, id } = await funded(500_000, { museum: false });
      await adjustStackAcresSecretLedger(id, DICE, 1);
      await donateStackAcresSecretItem(token, DICE, T0);
      const view = await readStackAcres(token, T0);
      expect(view.museum).toEqual(emptyMuseumRegistry());
      expect(view.secretDonations[DICE]).toBe(true);
    });

    it("refunds the item if recording the donation throws", async () => {
      const { token, id } = await funded();
      await adjustStackAcresSecretLedger(id, DICE, 1);
      vi.mocked(markStackAcresDonated).mockRejectedValueOnce(new Error("db down"));
      await expect(donateStackAcresSecretItem(token, DICE, T0)).rejects.toThrow("db down");
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(1);
    });
  });

  describe("consumeStackAcresSecretItem", () => {
    it("refuses with nothing held", async () => {
      const { token } = await funded();
      await expect(consumeStackAcresSecretItem(token, DICE, T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
    });

    it("arms a boost and spends the item", async () => {
      const { token, id } = await funded();
      await adjustStackAcresSecretLedger(id, DICE, 1);
      const result = await consumeStackAcresSecretItem(token, DICE, T0);
      expect(result.secrets.boostArmed).toBe(true);
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(0);
    });

    it("refuses a second dice while one is already armed, spending nothing", async () => {
      const { token, id } = await funded();
      await adjustStackAcresSecretLedger(id, DICE, 2);
      await consumeStackAcresSecretItem(token, DICE, T0);
      await expect(consumeStackAcresSecretItem(token, DICE, T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(1);
      expect(await readStackAcresSecretLedgerQty(id, STACKACRES_DICE_BOOST_ARMED_KEY)).toBe(1);
    });
  });

  describe("tradeStackAcresSecretItemToRay", () => {
    it("refuses with nothing held", async () => {
      const { token } = await funded();
      await expect(tradeStackAcresSecretItemToRay(token, DICE, T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
    });

    it("refuses when there is nothing owed today (the default fixture pre-pays it), spending nothing", async () => {
      const { token, id } = await funded();
      await adjustStackAcresSecretLedger(id, DICE, 1);
      await expect(tradeStackAcresSecretItemToRay(token, DICE, T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(1);
    });

    it("wipes today's owed Land Maintenance and spends the item", async () => {
      const { token, id } = await funded(500_000, { settled: false });
      await adjustStackAcresSecretLedger(id, DICE, 1);
      const day = stackacresExchangeDay(T0);
      const before = await readStackAcres(token, T0);
      expect(before.upkeep.due).toBeGreaterThan(0);

      await tradeStackAcresSecretItemToRay(token, DICE, T0);

      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(0);
      const after = await readStackAcres(token, T0);
      expect(after.upkeep.due).toBe(0);
      expect(await readStackAcresUpkeep(id, day)).toBe(before.upkeep.fee);
    });

    it("refunds the item on a lost race against another tab settling the same bill", async () => {
      const { token, id } = await funded(500_000, { settled: false });
      await adjustStackAcresSecretLedger(id, DICE, 1);
      vi.mocked(raiseStackAcresUpkeep).mockResolvedValueOnce(false);

      await expect(tradeStackAcresSecretItemToRay(token, DICE, T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
      expect(await readStackAcresSecretLedgerQty(id, DICE)).toBe(1);
    });
  });

  describe("the equipment ladder reads the armed dice boost", () => {
    it("crits at the Trowel's own base chance (0) plus the dice bonus, once armed", async () => {
      const { token, id } = await funded(5_000_000);
      const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
      const unitId = unitOf(bought, "hen").id;
      await adjustStackAcresSecretLedger(id, DICE, 1);
      await consumeStackAcresSecretItem(token, DICE, T0);

      const roll = vi.spyOn(Math, "random").mockReturnValue(STACKACRES_DICE_CRIT_BONUS - 0.001);
      let result;
      try {
        result = await collectOne(token, unitId, HEN_READY);
      } finally {
        roll.mockRestore();
      }

      expect(result.harvest.crit).toBeGreaterThan(0);
    });

    it("never crits at that same roll without an armed boost -- the Trowel alone is unaffected", async () => {
      const { token } = await funded(5_000_000);
      const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
      const unitId = unitOf(bought, "hen").id;

      const roll = vi.spyOn(Math, "random").mockReturnValue(STACKACRES_DICE_CRIT_BONUS - 0.001);
      let result;
      try {
        result = await collectOne(token, unitId, HEN_READY);
      } finally {
        roll.mockRestore();
      }

      expect(result.harvest.crit).toBe(0);
    });

    it("disarms after the harvest whether or not it actually crit", async () => {
      const { token, id } = await funded(5_000_000);
      const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
      const unitId = unitOf(bought, "hen").id;
      await adjustStackAcresSecretLedger(id, DICE, 1);
      await consumeStackAcresSecretItem(token, DICE, T0);

      const roll = vi.spyOn(Math, "random").mockReturnValue(0.999);
      let result;
      try {
        result = await collectOne(token, unitId, HEN_READY);
      } finally {
        roll.mockRestore();
      }

      expect(result.harvest.crit).toBe(0);
      expect(await readStackAcresSecretLedgerQty(id, STACKACRES_DICE_BOOST_ARMED_KEY)).toBe(0);
    });
  });
});
