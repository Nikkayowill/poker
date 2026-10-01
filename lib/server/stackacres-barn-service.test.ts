import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  BARN_CAPACITY_BONUS,
  BARN_COMFORT_MULTIPLIER,
  CARE_BONUS_CAP,
  CARE_GIFT_LADDER,
  animalNameFor,
  careYieldBonus,
} from "@/lib/stackacres/barn";
import {
  STACKACRES_BASE_CAP,
  STACKACRES_CATALOGUE,
  type StackAcresLivestock,
} from "@/lib/stackacres/catalogue";
import { MACHINE_CATALOGUE } from "@/lib/stackacres/machines";
import { STACKACRES_YIELDS } from "@/lib/stackacres/items";
import { SECTOR_LADDER } from "@/lib/stackacres/sectors";
import { hungryAtFor } from "@/lib/stackacres/units";
import {
  StackAcresRequestError,
  careForStackAcresAnimal,
  harvestStackAcres,
  readStackAcres,
  stockStackAcres,
  placeStackAcresMachine,
  type StackAcresActionResult,
} from "./stackacres-service";
import {
  __resetStackAcresForTest,
  feedStackAcresUnit,
  adjustStackAcresFeed,
  adjustStackAcresInventory,
  createStackAcresMachine,
  getStackAcresUnit,
  listStackAcresUnits,
  readStackAcresFeed,
  recordStackAcresCropFieldsUnlocked,
  recordStackAcresSectorCleared,
} from "./stackacres-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { __resetStackAcresRevisionsForTest } from "./stackacres-revision-store";
import { __resetStackAcresSoilTilesForTest } from "./stackacres-soil-store";
import { __resetStackAcresSeedStockForTest } from "./stackacres-seed-store";
import { adjustGold, ensureProfile } from "./profile-store";
import { __setTrowelCritChanceForTest } from "@/lib/stackacres/equipment";

// These tests assert exact harvest payouts, so the Trowel's luck is switched off here.
// The luck is tested in stackacres-service.test.ts.
__setTrowelCritChanceForTest(0);


/** Noon, so "a day later" never straddles a UTC boundary by accident. */
const T0 = new Date("2026-09-30T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** `days` days after T0, at the same time of day. */
function dayAfter(days: number, offsetMs = 0): Date {
  return new Date(T0.getTime() + days * DAY_MS + offsetMs);
}

async function funded(gold = 5_000_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  for (const sector of SECTOR_LADDER) await recordStackAcresSectorCleared(profile.id, sector, T0);
  await recordStackAcresCropFieldsUnlocked(profile.id, T0);
  // Enough feed that nothing here ever fails for want of a serving, and
  // enough timber for the Barn.
  await adjustStackAcresFeed(profile.id, 500);
  await adjustStackAcresInventory(profile.id, "wood", 1000);
  await adjustStackAcresInventory(profile.id, "stone", 1000);
  return { token, id: profile.id };
}

/** Buys one animal and hands back its unit id. */
async function stockAnimal(token: string, stock: StackAcresLivestock, now = T0) {
  const view = await stockStackAcres(token, { stock }, now);
  const unit = view.units.filter((candidate) => candidate.stock === stock).at(-1);
  if (!unit) throw new Error(`no ${stock} was stocked`);
  return unit.id;
}

/** Tends `unitId` every day from day 1 to day `days`, inclusive, keeping the
 *  whole farm fed as it goes so nothing starves or spoils mid-run. */
async function tendDaily(token: string, unitId: string, days: number) {
  const { id } = await ensureProfile(token);
  let last: StackAcresActionResult | null = null;
  for (let day = 1; day <= days; day += 1) {
    await keepFed(id, dayAfter(day));
    last = await careForStackAcresAnimal(token, unitId, dayAfter(day));
  }
  if (!last) throw new Error("tendDaily needs at least one day");
  return last;
}

/**
 * Feeds every working animal at the exact moment it went hungry, over and
 * over, up to `now` -- so `ready_at` never moves and no hen cycle spoils.
 * Straight into the store, not through `feedStackAcres`: keeping the animal
 * alive is this file's harness, not the thing under test, and it must not
 * spend servings the assertions are counting.
 */
async function keepFed(profileId: string, now: Date): Promise<void> {
  for (const row of await listStackAcresUnits(profileId)) {
    let current = row;
    for (let guard = 0; guard < 2000; guard += 1) {
      if (current.status !== "working") break;
      const hungryAt = hungryAtFor(current);
      if (!hungryAt || Date.parse(hungryAt) > now.getTime()) break;
      const fed = await feedStackAcresUnit(
        current,
        new Date(hungryAt),
        new Date(current.readyAt),
        null,
        0,
      );
      if (!fed) break;
      current = fed;
    }
  }
}

async function expectRefusal(run: () => Promise<unknown>): Promise<StackAcresRequestError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof StackAcresRequestError) return error;
    throw error;
  }
  throw new Error("expected that to be refused");
}

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresIntentsForTest();
  __resetStackAcresRevisionsForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresSeedStockForTest();
});

describe("tending an animal", () => {
  it("names the animal it tended and starts its streak at one", async () => {
    const { token } = await funded();
    const unitId = await stockAnimal(token, "cattle");

    const result = await careForStackAcresAnimal(token, unitId, dayAfter(1));

    expect(result.cared?.unitId).toBe(unitId);
    expect(result.cared?.name).toBe(animalNameFor(unitId, "cattle"));
    expect(result.cared?.streak).toBe(1);
  });

  it("spends no Gold, no feed and no energy -- the whole point of it", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    const goldBefore = (await ensureProfile(token)).goldBalance;
    const feedBefore = await readStackAcresFeed(id);
    const energyBefore = (await readStackAcres(token, dayAfter(1))).energy;

    const after = await careForStackAcresAnimal(token, unitId, dayAfter(1));

    expect(after.profile.goldBalance).toBe(goldBefore);
    expect(await readStackAcresFeed(id)).toBe(feedBefore);
    expect(after.energy).toEqual(energyBefore);
  });

  it("moves no clock: a tend cannot ripen an animal or feed it", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    const before = await getStackAcresUnit(id, unitId);

    await careForStackAcresAnimal(token, unitId, dayAfter(1));

    const after = await getStackAcresUnit(id, unitId);
    expect(after?.readyAt).toBe(before?.readyAt);
    expect(after?.startedAt).toBe(before?.startedAt);
    expect(after?.lastFedAt).toBe(before?.lastFedAt);
  });

  it("refuses a crop -- a cabbage is not somebody", async () => {
    const { token } = await funded();
    const cattle = await stockAnimal(token, "cattle");
    const rows = await listStackAcresUnits((await ensureProfile(token)).id);
    expect(rows.some((row) => row.id === cattle)).toBe(true);

    const error = await expectRefusal(() =>
      careForStackAcresAnimal(token, randomUUID(), dayAfter(1)),
    );
    expect(error.status).toBe(404);
  });
});

describe("the duplicate guard", () => {
  it("refuses a second tend on the same day", async () => {
    const { token } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    await careForStackAcresAnimal(token, unitId, dayAfter(1));

    const error = await expectRefusal(() =>
      careForStackAcresAnimal(token, unitId, dayAfter(1, 60 * 1000)),
    );

    expect(error.status).toBe(409);
    expect(error.message).toContain(animalNameFor(unitId, "cattle"));
  });

  it("lets exactly one of two simultaneous tends through", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");

    const settled = await Promise.allSettled([
      careForStackAcresAnimal(token, unitId, dayAfter(1)),
      careForStackAcresAnimal(token, unitId, dayAfter(1)),
    ]);

    expect(settled.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const row = await getStackAcresUnit(id, unitId);
    expect(row?.careStreak).toBe(1);
    expect(row?.careBonus).toBe(0);
  });

  it("does not advance the streak on a refused duplicate", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    await tendDaily(token, unitId, 3);

    await expectRefusal(() => careForStackAcresAnimal(token, unitId, dayAfter(3, 60 * 1000)));

    expect((await getStackAcresUnit(id, unitId))?.careStreak).toBe(3);
  });

  it("lets the next day's tend through", async () => {
    const { token } = await funded();
    const unitId = await stockAnimal(token, "cattle");

    await careForStackAcresAnimal(token, unitId, dayAfter(1));
    const second = await careForStackAcresAnimal(token, unitId, dayAfter(2));

    expect(second.cared?.streak).toBe(2);
  });
});

describe("offline behaviour", () => {
  it("is derived when the player returns, not simulated while away", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    await tendDaily(token, unitId, 4);
    expect((await getStackAcresUnit(id, unitId))?.careStreak).toBe(4);

    // Away for a fortnight. Nothing runs; the row is exactly as it was left.
    const away = await getStackAcresUnit(id, unitId);
    expect(away?.careStreak).toBe(4);
    expect(away?.caredOn).toBe("2026-10-04");

    // The break is worked out at the moment they tend again.
    const back = await careForStackAcresAnimal(token, unitId, dayAfter(18));
    expect(back.cared?.streak).toBe(1);
  });

  it("keeps a streak across a gap of exactly one night", async () => {
    const { token } = await funded();
    const unitId = await stockAnimal(token, "cattle");

    await careForStackAcresAnimal(token, unitId, dayAfter(1, -11 * 60 * 60 * 1000));
    const next = await careForStackAcresAnimal(token, unitId, dayAfter(2, 11 * 60 * 60 * 1000));

    // Nearly 46 hours apart in wall-clock terms, but consecutive UTC days.
    expect(next.cared?.streak).toBe(2);
  });

  it("does not credit a bonus for days nobody was there", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");

    await careForStackAcresAnimal(token, unitId, dayAfter(30));

    const row = await getStackAcresUnit(id, unitId);
    expect(row?.careStreak).toBe(1);
    expect(row?.careBonus).toBe(0);
  });
});

describe("the production cap", () => {
  it("adds nothing to the batch for the first two days", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");

    await tendDaily(token, unitId, 2);

    expect((await getStackAcresUnit(id, unitId))?.careBonus).toBe(0);
  });

  it("never lets one cycle's care bonus pass the cap", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");

    // Thirty unbroken days on a 24h cycle, never collected: the most care
    // any single batch could possibly accumulate.
    await tendDaily(token, unitId, 30);

    expect((await getStackAcresUnit(id, unitId))?.careBonus).toBe(CARE_BONUS_CAP);
  });

  it("pays exactly the capped bonus as produce, and not a unit more", async () => {
    const { token, id } = await funded();
    // Cattle, not a hen: a hen voids a cycle it is hungry through
    // (`spoils`), which would make this a test about spoilage. Cattle freeze
    // and are kept fed by `tendDaily`, so the only thing moving the yield
    // here is care.
    const unitId = await stockAnimal(token, "cattle");
    await tendDaily(token, unitId, 8);
    const row = await getStackAcresUnit(id, unitId);
    expect(row?.careBonus).toBe(CARE_BONUS_CAP);
    expect(row?.feedBonus).toBe(0);

    const at = dayAfter(8, 60 * 1000);
    await keepFed(id, at);
    const collected = await harvestStackAcres(token, { unitIds: [unitId] }, at);

    const item = STACKACRES_YIELDS.cattle.item;
    const line = collected.harvest.tally.find((entry) => entry.item === item);
    expect(line).toBeDefined();
    const base = STACKACRES_YIELDS.cattle.quantity;
    const crit = collected.harvest.critBonus.find((entry) => entry.item === item)?.quantity ?? 0;
    // The exact claim, with a crit's own bonus (lib/stackacres/equipment.ts)
    // subtracted back out: care added the cap and not one unit more.
    expect(line!.quantity - crit).toBe(base + CARE_BONUS_CAP);
  });

  it("starts the bonus over when the cycle restarts, but keeps the streak", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    await tendDaily(token, unitId, 8);
    expect((await getStackAcresUnit(id, unitId))?.careBonus).toBe(CARE_BONUS_CAP);

    const at = dayAfter(8, 60 * 1000);
    await keepFed(id, at);
    await harvestStackAcres(token, { unitIds: [unitId] }, at);

    const after = await getStackAcresUnit(id, unitId);
    // A one-cycle animal either leaves outright on a clean collect or stays
    // as a mucked row. Only a row that actually restarted its cycle has a
    // new batch for the bonus to belong to.
    if (after?.status === "working") {
      // The bonus belonged to the batch just collected.
      expect(after.careBonus).toBe(0);
      // The habit is not punished for collecting.
      expect(after.careStreak).toBe(8);
    } else {
      // A mucked row keeps its counters untouched, exactly as `feedBonus`
      // already does -- it can never be collected again, so they are
      // unreachable either way.
      expect(after === null || after.status === "mucked").toBe(true);
    }
  });

  it("pays no Gold directly -- care reaches Gold only through a sale", async () => {
    const { token } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    const before = (await ensureProfile(token)).goldBalance;

    const after = await tendDaily(token, unitId, 10);

    expect(after.profile.goldBalance).toBe(before);
  });
});

describe("Ray's care gifts", () => {
  it("leaves a sack of feed on the streak that earns a rung", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    const before = await readStackAcresFeed(id);

    const third = await tendDaily(token, unitId, CARE_GIFT_LADDER[0].streak);

    expect(third.cared?.gift?.servings).toBe(CARE_GIFT_LADDER[0].servings);
    expect(await readStackAcresFeed(id)).toBe(before + CARE_GIFT_LADDER[0].servings);
  });

  it("hands each rung over exactly once for the life of the farm", async () => {
    const { token, id } = await funded();
    const first = await stockAnimal(token, "cattle");
    const second = await stockAnimal(token, "cattle");
    const before = await readStackAcresFeed(id);

    // Two different animals, each carried past the first rung.
    await tendDaily(token, first, 4);
    for (let day = 1; day <= 4; day += 1) {
      await careForStackAcresAnimal(token, second, dayAfter(day, 60 * 1000));
    }

    // One sack, not two: the rung is the farm's, not the animal's.
    expect(await readStackAcresFeed(id)).toBe(before + CARE_GIFT_LADDER[0].servings);
  });

  it("gives nothing on an ordinary tend", async () => {
    const { token } = await funded();
    const unitId = await stockAnimal(token, "cattle");

    const first = await careForStackAcresAnimal(token, unitId, dayAfter(1));

    expect(first.cared?.gift).toBeNull();
  });

  it("never pays Gold, only feed", async () => {
    const { token } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    const before = (await ensureProfile(token)).goldBalance;

    const earned = await tendDaily(token, unitId, CARE_GIFT_LADDER[0].streak);

    expect(earned.cared?.gift).not.toBeNull();
    expect(earned.profile.goldBalance).toBe(before);
  });
});

describe("the Barn", () => {
  /** Places a Barn straight into the store -- placement pricing is the
   *  machine route's business, not this file's. */
  async function raiseBarn(profileId: string) {
    await createStackAcresMachine(profileId, "barn", T0);
  }

  it("widens every animal's hunger window rather than speeding it up", async () => {
    const { token, id } = await funded();
    await stockAnimal(token, "cattle");

    const before = await readStackAcres(token, T0);
    await raiseBarn(id);
    const after = await readStackAcres(token, T0);

    const hungryBefore = Date.parse(before.units[0].hungryAt!);
    const hungryAfter = Date.parse(after.units[0].hungryAt!);
    expect(hungryAfter).toBeGreaterThan(hungryBefore);
    // The cycle itself is untouched: comfort, never production.
    expect(after.units[0].readyAt).toBe(before.units[0].readyAt);
  });

  it("widens it by exactly the comfort multiplier", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    await raiseBarn(id);

    const row = (await getStackAcresUnit(id, unitId))!;
    const plain = Date.parse(hungryAtFor(row)!) - Date.parse(row.lastFedAt!);
    const comforted = Date.parse(hungryAtFor(row, BARN_COMFORT_MULTIPLIER)!) - Date.parse(row.lastFedAt!);

    expect(comforted).toBe(Math.round(plain * BARN_COMFORT_MULTIPLIER));
  });

  it("keeps an animal working past the plain hunger window", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    // Just past the catalogue's own window, comfortably inside the Barn's.
    const justHungry = new Date(T0.getTime() + STACKACRES_CATALOGUE.cattle.hungerMs! + 60 * 1000);

    expect((await readStackAcres(token, justHungry)).units[0].state).toBe("hungry");
    await raiseBarn(id);
    expect((await readStackAcres(token, justHungry)).units[0].state).toBe("working");
    expect(unitId).toBeTruthy();
  });

  it("grants free livestock slots on top of anything bought", async () => {
    const { token, id } = await funded();
    for (let bought = 0; bought < STACKACRES_BASE_CAP; bought += 1) {
      await stockAnimal(token, "cattle");
    }

    // Full without a Barn.
    const full = await expectRefusal(() => stockStackAcres(token, { stock: "cattle" }, T0));
    expect(full.status).toBe(409);
    expect(full.message).toContain("expand capacity");

    await raiseBarn(id);
    for (let extra = 0; extra < BARN_CAPACITY_BONUS; extra += 1) {
      await stockAnimal(token, "cattle");
    }

    const rows = await listStackAcresUnits(id);
    expect(rows.filter((row) => row.stock === "cattle")).toHaveLength(
      STACKACRES_BASE_CAP + BARN_CAPACITY_BONUS,
    );
  });

  it("is a Gold sink that costs real Gold and timber to raise", async () => {
    const { token } = await funded();
    const before = (await ensureProfile(token)).goldBalance;

    await placeStackAcresMachine(token, "barn", T0);

    expect((await ensureProfile(token)).goldBalance).toBe(before - MACHINE_CATALOGUE.barn.placeCost);
    expect(MACHINE_CATALOGUE.barn.placeCost).toBeGreaterThan(0);
    expect(MACHINE_CATALOGUE.barn.materials?.length).toBeGreaterThan(0);
  });
});

describe("what tending is worth, end to end", () => {
  it("turns a week of daily tends into capped extra produce and nothing else", async () => {
    const { token, id } = await funded();
    const unitId = await stockAnimal(token, "cattle");
    const goldBefore = (await ensureProfile(token)).goldBalance;

    for (let day = 1; day <= 7; day += 1) {
      const result = await careForStackAcresAnimal(token, unitId, dayAfter(day));
      expect(result.cared?.streak).toBe(day);
      expect(result.cared?.bonus).toBe(
        Math.min(
          CARE_BONUS_CAP,
          Array.from({ length: day }, (_, index) => careYieldBonus(index + 1)).reduce(
            (sum, step) => sum + step,
            0,
          ),
        ),
      );
    }

    const row = await getStackAcresUnit(id, unitId);
    expect(row?.careBonus).toBe(CARE_BONUS_CAP);
    // Gold moved only by Ray's feed gift, which is feed, not Gold.
    expect((await ensureProfile(token)).goldBalance).toBe(goldBefore);
  });
});
