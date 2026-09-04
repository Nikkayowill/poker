import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StackAcresRequestError,
  buyStackAcresFeed,
  buyStackAcresStock,
  clearStackAcresUnit,
  collectStackAcres,
  exchangeStackAcresBushels,
  expandStackAcresCapacity,
  feedStackAcres,
  readStackAcres,
  retireStackAcresStock,
  sellStackAcresProduce,
  stockStackAcres,
  type StackAcresView,
} from "./stackacres-service";
import {
  __stackacresHarvestsForTest,
  __resetStackAcresForTest,
  adjustStackAcresFeed,
  adjustStackAcresInventory,
  createStackAcresUnit,
  getStackAcresUnit,
  markStackAcresDonated,
  readStackAcresFeed,
  readStackAcresInventory,
  readStackAcresMuseum,
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
  STACKACRES_MAX_EXCHANGE_BUSHELS,
  goldForBushels,
} from "@/lib/stackacres/exchange";
import {
  BUSHELS,
  STACKACRES_ITEM_CATALOGUE,
  STACKACRES_STARTING_BUSHELS,
  STACKACRES_STOCK,
  STACKACRES_YIELDS,
  netPerCycle,
} from "@/lib/stackacres/items";
import { emptyMuseumRegistry, museumDiscoveryBonus } from "@/lib/stackacres/museum";

// Passthrough by default; one test swaps createStackAcresUnit's next call for
// a thrown error, standing in for the DB trigger raising (which the memory
// branch cannot do). Found in security review on the Mint: that throw once
// skipped the refund entirely.
vi.mock("./stackacres-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stackacres-store")>();
  return {
    ...actual,
    createStackAcresUnit: vi.fn(actual.createStackAcresUnit),
    // Also a passthrough spy, so one test can hand back a row whose snapshot
    // disagrees with the live catalogue. Nothing else can make those two
    // differ, because the guarded write refuses to re-settle a working unit.
    getStackAcresUnit: vi.fn(actual.getStackAcresUnit),
    // Passthrough spy, so one test can stand in for a museum write failing --
    // the memory branch has no DB to fail for real.
    markStackAcresDonated: vi.fn(actual.markStackAcresDonated),
  };
});

/**
 * The StackAcres money contract, in memory mode.
 *
 * TWO CURRENCIES, and the single most important thing these tests hold is the
 * wall between them: **stocking, feeding, clearing and harvesting must never
 * move Gold.** Gold enters the farm only when expanding capacity or buying
 * stock outright, and leaves it only through the exchange window. Several
 * tests below assert a Gold balance is *unchanged* across an action for
 * exactly that reason -- if one of those starts failing, a Gold path has been
 * added to the farm and that is the thing to stop and look at, not the
 * assertion.
 *
 * Nothing here can lose a sowing, so there is no losing branch to check --
 * what has to hold is exact and it all sits on the guards: the seed leaves
 * exactly once at stocking, the snapshotted yield lands exactly once at
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
 * A profile with Gold for capacity/stock and Bushels for everything else.
 * The read is what triggers the one-time starting grant, so it happens
 * before the top-up.
 */
async function funded(gold = 500_000, bushels = 100_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  await readStackAcres(token, T0);
  const held = await readStackAcresInventory(profile.id);
  await adjustStackAcresInventory(profile.id, BUSHELS, bushels - (held[BUSHELS] ?? 0));
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

async function bushels(id: string): Promise<number> {
  return (await readStackAcresInventory(id))[BUSHELS] ?? 0;
}

async function held(id: string, item: string): Promise<number> {
  return (await readStackAcresInventory(id))[item] ?? 0;
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

beforeEach(() => {
  __resetStackAcresForTest();
  vi.mocked(createStackAcresUnit).mockImplementation(
    vi.mocked(createStackAcresUnit).getMockImplementation() ?? createStackAcresUnit,
  );
  vi.mocked(getStackAcresUnit).mockImplementation(
    vi.mocked(getStackAcresUnit).getMockImplementation() ?? getStackAcresUnit,
  );
  vi.mocked(markStackAcresDonated).mockImplementation(
    vi.mocked(markStackAcresDonated).getMockImplementation() ?? markStackAcresDonated,
  );
});

describe("the starting grant", () => {
  it("seeds a new farm once and never tops it up again", async () => {
    const token = randomUUID();
    const { id } = await ensureProfile(token);

    const first = await readStackAcres(token, T0);
    expect(first.bushels).toBe(STACKACRES_STARTING_BUSHELS);

    // Spend it all, then read again: the primary key is the idempotency guard,
    // so an empty purse is not a new farm.
    await adjustStackAcresInventory(id, BUSHELS, -STACKACRES_STARTING_BUSHELS);
    const second = await readStackAcres(token, T0);
    expect(second.bushels).toBe(0);
  });

  it("is enough to stock the cheapest tier several times over", async () => {
    expect(STACKACRES_STARTING_BUSHELS).toBeGreaterThanOrEqual(SPROUT.seedCost * 5);
  });
});

describe("stocking", () => {
  it("debits Bushels and snapshots the yield and readiness onto the unit", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);

    const view = await stockStackAcres(token, { stock: "hen" }, T0);

    expect(await bushels(id)).toBe(before - HEN.seedCost);
    const unit = unitOf(view, "hen");
    expect(unit.state).toBe("working");
    expect(unit.stake).toBe(HEN.seedCost);
    expect(unit.yieldQuantity).toBe(HEN_YIELD.quantity);
    expect(unit.readyAt).toBe(HEN_READY.toISOString());
  });

  it("never touches Gold", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await stockStackAcres(token, { stock: "cattle" }, T0);
    expect(await balance(token)).toBe(before);
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
    const { token, id } = await funded(500_000, HEN.seedCost - 1);
    await expect(stockStackAcres(token, { stock: "hen" }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await bushels(id)).toBe(HEN.seedCost - 1);
  });

  it("refunds when the guarded write throws, standing in for the DB trigger", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);
    vi.mocked(createStackAcresUnit).mockRejectedValueOnce(new Error("trigger said no"));

    await expect(stockStackAcres(token, { stock: "hen" }, T0)).rejects.toThrow("trigger said no");
    expect(await bushels(id)).toBe(before);
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

    await expect(collectStackAcres(token, unitId, wayLater)).rejects.toBeInstanceOf(
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
  it("puts the snapshotted yield in the bag exactly once", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;

    const result = await collectStackAcres(token, unitId, HEN_READY);
    expect(result.collected).toMatchObject({ item: HEN_YIELD.item, quantity: HEN_YIELD.quantity });
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);

    // A replay finds nothing to settle (the row is gone -- a clean collect
    // removes it) and yields nothing more.
    await expect(collectStackAcres(token, unitId, HEN_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);
  });

  it("pays no Gold and no Bushels -- produce only", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    // Pre-donate: this test is about the ONGOING harvest loop, not the
    // one-time "New Discovery!" bonus (see the "Ray's Museum" describe
    // block below), so a fresh museum registry must not leak a bonus into
    // this assertion.
    await markStackAcresDonated(id, HEN_YIELD.item);
    const goldBefore = await balance(token);
    const bushelsBefore = await bushels(id);

    await collectStackAcres(token, unitId, HEN_READY);

    expect(await balance(token)).toBe(goldBefore);
    expect(await bushels(id)).toBe(bushelsBefore);
  });

  it("yields what the ROW says, not what the catalogue says today", async () => {
    // The wagerLadder rule. A retune landing between stocking and harvest
    // must not change what the player agreed to, so the harvest reads the
    // snapshot. Standing in for that retune by editing the stored row
    // directly, which is the only way to make the two disagree.
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;

    const unit = await getStackAcresUnit(id, unitId);
    const retuned = HEN_YIELD.quantity + 2;
    vi.mocked(getStackAcresUnit).mockResolvedValueOnce({
      ...(unit as NonNullable<typeof unit>),
      yieldQuantity: retuned,
    });

    const result = await collectStackAcres(token, unitId, HEN_READY);
    expect(result.collected.quantity).toBe(retuned);
    expect(await held(id, HEN_YIELD.item)).toBe(retuned);
  });

  it("refuses before readiness", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;

    await expect(
      collectStackAcres(token, unitId, new Date(HEN_READY.getTime() - 1000)),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await held(id, HEN_YIELD.item)).toBe(0);
  });

  it("records the harvest in the ledger, valued in Bushels", async () => {
    const { token } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    await collectStackAcres(token, unitOf(view, "hen").id, HEN_READY);
    expect(__stackacresHarvestsForTest()).toHaveLength(1);
    expect(__stackacresHarvestsForTest()[0]).toMatchObject({
      stock: "hen",
      stake: HEN.seedCost,
      payout: STACKACRES_ITEM_CATALOGUE[HEN_YIELD.item].price * HEN_YIELD.quantity,
    });
  });

  it("sends a mucked unit to mucked with the tier's fee, and never withholds the produce", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;

    // Force the roll. It is the one piece of randomness in the feature and it
    // lives behind Math.random in exactly one function.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    let result;
    try {
      result = await collectStackAcres(token, unitId, HEN_READY);
    } finally {
      random.mockRestore();
    }
    expect(result.collected.mucked).toBe(true);

    // Yielded in full regardless: muck is a cost you choose to pay later,
    // never a deduction from what the unit already grew.
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);
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
      await collectStackAcres(token, unitId, HEN_READY);
    } finally {
      random.mockRestore();
    }
    expect(await getStackAcresUnit(id, unitId)).toBeNull();
  });
});

describe("Ray's Museum", () => {
  it("flags an item donated and pays the discovery bonus on its first-ever harvest", async () => {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const before = await bushels(id);

    const result = await collectStackAcres(token, unitId, HEN_READY);

    const bonus = museumDiscoveryBonus(HEN_YIELD.item, HEN_YIELD.quantity);
    expect(result.collected.discovery).toEqual({ item: HEN_YIELD.item, bonus });
    expect(await bushels(id)).toBe(before + bonus);
    expect(await readStackAcresMuseum(id)).toContain(HEN_YIELD.item);
    expect(result.museum[HEN_YIELD.item]).toBe(true);
  });

  it("never pays the bonus twice -- a duplicate harvest of the same item earns nothing extra", async () => {
    const { token, id } = await funded();
    await markStackAcresDonated(id, HEN_YIELD.item);

    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const before = await bushels(id);

    const result = await collectStackAcres(token, unitId, HEN_READY);

    expect(result.collected.discovery).toBeNull();
    // Produce still lands in full -- only the one-time bonus is withheld.
    expect(await bushels(id)).toBe(before);
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);
  });

  it("tracks each item independently -- donating one never flags another", async () => {
    const { token } = await funded();
    const hen = await stockStackAcres(token, { stock: "hen" }, T0);
    await collectStackAcres(token, unitOf(hen, "hen").id, HEN_READY);

    const registry = (await readStackAcres(token, HEN_READY)).museum;
    expect(registry[HEN_YIELD.item]).toBe(true);
    for (const item of Object.keys(registry) as (keyof typeof registry)[]) {
      if (item !== HEN_YIELD.item) expect(registry[item]).toBe(false);
    }
  });

  it("starts a fresh farm with nothing donated", async () => {
    const { token } = await funded();
    expect((await readStackAcres(token, T0)).museum).toEqual(emptyMuseumRegistry());
  });

  it("does not let a museum failure turn a settled harvest into an error", async () => {
    // The produce and the settlement are already durable by the time the
    // museum write runs -- same posture as yield_credit_failed just above
    // it in the service. A throw here must be swallowed, not surfaced.
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    vi.mocked(markStackAcresDonated).mockRejectedValueOnce(new Error("boom"));

    const result = await collectStackAcres(token, unitId, HEN_READY);

    expect(result.collected.discovery).toBeNull();
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);
  });
});

describe("selling produce", () => {
  async function withProduce() {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      await collectStackAcres(token, unitId, HEN_READY);
    } finally {
      random.mockRestore();
    }
    return { token, id };
  }

  it("swaps produce for Bushels at the catalogue price", async () => {
    const { token, id } = await withProduce();
    const before = await bushels(id);

    const result = await sellStackAcresProduce(token, { item: "eggs", quantity: 2 }, T0);

    expect(result.sold.bushels).toBe(STACKACRES_ITEM_CATALOGUE.eggs.price * 2);
    expect(await bushels(id)).toBe(before + STACKACRES_ITEM_CATALOGUE.eggs.price * 2);
    expect(await held(id, "eggs")).toBe(HEN_YIELD.quantity - 2);
  });

  it("never pays Gold", async () => {
    const { token } = await withProduce();
    const before = await balance(token);
    await sellStackAcresProduce(token, { item: "eggs", quantity: 1 }, T0);
    expect(await balance(token)).toBe(before);
  });

  it("refuses to sell more than is held, and takes nothing", async () => {
    const { token, id } = await withProduce();
    const before = await bushels(id);

    await expect(
      sellStackAcresProduce(token, { item: "eggs", quantity: HEN_YIELD.quantity + 1 }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await held(id, "eggs")).toBe(HEN_YIELD.quantity);
    expect(await bushels(id)).toBe(before);
  });

  it("refuses a nonsense quantity or an unknown item", async () => {
    const { token } = await withProduce();
    await expect(
      sellStackAcresProduce(token, { item: "eggs", quantity: 0 }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
    await expect(
      sellStackAcresProduce(token, { item: "gold", quantity: 1 }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });

  it("cannot be used to mint Bushels by selling the currency itself", async () => {
    // `bushels` shares the inventory table with produce, so the item guard is
    // the only thing standing between a sell request and infinite money.
    const { token } = await withProduce();
    await expect(
      sellStackAcresProduce(token, { item: BUSHELS, quantity: 1 }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });
});

describe("muck", () => {
  async function mucked() {
    const { token, id } = await funded();
    const view = await stockStackAcres(token, { stock: "hen" }, T0);
    const unitId = unitOf(view, "hen").id;
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await collectStackAcres(token, unitId, HEN_READY);
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

  it("charges the fee in Bushels and removes the unit", async () => {
    const { token, id, unitId } = await mucked();
    const before = await bushels(id);
    const gold = await balance(token);

    await clearStackAcresUnit(token, unitId, HEN_READY);

    expect(await bushels(id)).toBe(before - HEN.muckFee);
    expect(await balance(token)).toBe(gold);
    expect(await getStackAcresUnit(id, unitId)).toBeNull();
  });

  it("stays mucked when the fee cannot be paid, and takes nothing", async () => {
    const { token, id, unitId } = await mucked();
    await adjustStackAcresInventory(id, BUSHELS, -(await bushels(id)));

    await expect(clearStackAcresUnit(token, unitId, HEN_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await bushels(id)).toBe(0);
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
  it("debits Bushels and adds servings, leaving Gold alone", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);
    const gold = await balance(token);
    const sack = STACKACRES_FEED.feed_sack;

    await buyStackAcresFeed(token, "feed_sack", T0);

    expect(await bushels(id)).toBe(before - sack.cost);
    expect(await balance(token)).toBe(gold);
    expect(await readStackAcresFeed(id)).toBe(sack.servings);
  });

  it("refuses an unaffordable shipment and takes nothing", async () => {
    const { token, id } = await funded(500_000, 1);
    await expect(buyStackAcresFeed(token, "feed_sack", T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await bushels(id)).toBe(1);
    expect(await readStackAcresFeed(id)).toBe(0);
  });
});

describe("expanding capacity", () => {
  it("buys one extra slot at the flat per-kind price and debits GOLD, the farm's own inlet", async () => {
    const { token, id } = await funded();
    const price = stackacresCapacityPrice("hen");
    const before = await balance(token);
    const purse = await bushels(id);

    await expandStackAcresCapacity(token, "hen", T0);

    expect(await balance(token)).toBe(before - price);
    expect(await bushels(id)).toBe(purse);
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
 * THE VALVE. Everything above this point moves Bushels and produce, neither of
 * which is money; this is the one function in the feature that pays real Gold,
 * and the tests below are mostly here to fail loudly if the property that makes
 * it safe erodes: **the farm's maximum Gold output is a flat daily constant.**
 *
 * A failure in this block is not a broken test, it is a faucet.
 */
describe("the exchange window", () => {
  const MAX = STACKACRES_MAX_EXCHANGE_BUSHELS;

  it("takes Bushels and pays Gold at the posted rate", async () => {
    const { token, id } = await funded(1_000, 5_000);
    const purse = await bushels(id);

    const result = await exchangeStackAcresBushels(token, 100, T0);

    expect(result.exchanged).toEqual({ bushels: 100, gold: goldForBushels(100) });
    expect(await bushels(id)).toBe(purse - 100);
    expect(await balance(token)).toBe(1_000 + goldForBushels(100));
    expect(result.exchange.usedToday).toBe(goldForBushels(100));
    expect(result.exchange.remaining).toBe(STACKACRES_GOLD_CEILING - goldForBushels(100));
  });

  it("stops at the ceiling and says so, rather than paying a little more", async () => {
    const { token, id } = await funded(0, 100_000);
    await exchangeStackAcresBushels(token, MAX, T0);
    const afterCap = await bushels(id);

    await expect(exchangeStackAcresBushels(token, 1, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(STACKACRES_GOLD_CEILING);
    // Rule 1's refund half: the refused Bushel is still in the barn.
    expect(await bushels(id)).toBe(afterCap);
  });

  it("holds the ceiling when a dozen requests race for the last of it", async () => {
    // The memory store cannot deadlock the way Postgres serializes, but it can
    // still interleave the debit and the reservation across awaits -- which is
    // exactly the shape of the bug this guards. Against a real database the
    // guarantee is the RPC's row lock; see the migration.
    const { token, id } = await funded(0, 100_000);
    const chunk = Math.floor(MAX / 4);
    const purse = await bushels(id);

    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => exchangeStackAcresBushels(token, chunk, T0)),
    );
    const paid = attempts.filter((a) => a.status === "fulfilled").length;

    expect(paid).toBeGreaterThan(0);
    expect(await balance(token)).toBe(goldForBushels(chunk) * paid);
    expect(await balance(token)).toBeLessThanOrEqual(STACKACRES_GOLD_CEILING);
    // Every refusal put its Bushels back, so the barn only ever paid for the
    // exchanges that actually happened.
    expect(await bushels(id)).toBe(purse - chunk * paid);
  });

  it("gives a farm full of stock exactly the same daily Gold as a bare one", async () => {
    // The invariant, stated as a test. Owning more fills the day faster; it
    // does not make the day bigger. If this ever fails, the ceiling has
    // started scaling with something and the farm is a percentage faucet
    // again.
    const bare = await funded(0, 100_000);
    const big = await funded(5_000_000, 1_000_000);
    for (const stock of STACKACRES_STOCK) {
      for (let i = 0; i < STACKACRES_BASE_CAP; i += 1) {
        await stockStackAcres(big.token, { stock }, T0);
      }
    }
    const bigGoldBefore = await balance(big.token);

    await exchangeStackAcresBushels(bare.token, MAX, T0);
    await exchangeStackAcresBushels(big.token, MAX, T0);

    expect(await balance(bare.token)).toBe(STACKACRES_GOLD_CEILING);
    expect((await balance(big.token)) - bigGoldBefore).toBe(STACKACRES_GOLD_CEILING);
    await expect(exchangeStackAcresBushels(big.token, 1, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("refuses a single request larger than a whole day", async () => {
    const { token, id } = await funded(0, 1_000_000);
    const purse = await bushels(id);

    await expect(exchangeStackAcresBushels(token, MAX + 1, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(0);
    expect(await bushels(id)).toBe(purse);
  });

  it("reopens at UTC midnight and not a moment before", async () => {
    const { token } = await funded(0, 100_000);
    const lastSecond = new Date("2026-08-31T23:59:59.999Z");
    const midnight = new Date("2026-09-01T00:00:00.000Z");

    await exchangeStackAcresBushels(token, MAX, T0);
    await expect(exchangeStackAcresBushels(token, 1, lastSecond)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(STACKACRES_GOLD_CEILING);

    await exchangeStackAcresBushels(token, MAX, midnight);
    expect(await balance(token)).toBe(STACKACRES_GOLD_CEILING * 2);
  });

  it("pays nothing and spends no allowance when the barn is short", async () => {
    const { token, id } = await funded(0, 10);

    await expect(exchangeStackAcresBushels(token, 500, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(0);
    expect(await bushels(id)).toBe(10);
    // The refusal happened before the reservation, so the whole day is intact.
    expect((await readStackAcres(token, T0)).exchange.remaining).toBe(STACKACRES_GOLD_CEILING);
  });

  it("refuses an amount that is not a whole positive number of Bushels", async () => {
    const { token, id } = await funded(0, 5_000);
    for (const amount of [0, -50, 12.5, Number.NaN]) {
      await expect(exchangeStackAcresBushels(token, amount, T0)).rejects.toBeInstanceOf(
        StackAcresRequestError,
      );
    }
    expect(await balance(token)).toBe(0);
    expect(await bushels(id)).toBe(5_000);
  });

  it("leaves produce alone -- it trades Bushels, not the barn", async () => {
    const { token, id } = await funded(0, 5_000);
    await adjustStackAcresInventory(id, "eggs", 12);

    await exchangeStackAcresBushels(token, 100, T0);

    expect(await held(id, "eggs")).toBe(12);
  });
});

/**
 * The other half of the invariant, and the one no behavioural test can reach:
 * there must be no way IN. A Gold -> Bushels path anywhere would make a round
 * trip through the capped window possible, and a round trip turns a ceiling
 * into a laundry.
 *
 * A Gold -> stock -> Bushels path exists (buy outright, then sell what it
 * yields), and the reasoning below is why it is safe rather than why it is
 * forbidden: it is priced at 100 Gold per Bushel of seed against an exchange
 * that pays 2, so the round trip loses on every tier (market.test.ts holds
 * that) and the ceiling is untouched. The invariant these tests defend is
 * therefore the DIRECTION, not the count -- Gold may be spent here freely, and
 * may be paid out only by the exchange window under its flat daily ceiling.
 */
describe("the currency wall", () => {
  const SERVICE = readFileSync(join(process.cwd(), "lib/server/stackacres-service.ts"), "utf8");
  const ROUTE = readFileSync(join(process.cwd(), "app/api/stackacres/actions/route.ts"), "utf8");

  const calls = (source: string, fn: string) => source.split(`${fn}(`).length - 1;

  it("moves Gold in exactly the places we know about", async () => {
    // spendGoldByProfile: expanding capacity, and stock bought outright. Two
    // SINKS. creditGoldByProfile: the capacity refund, the one refund path in
    // buyStackAcresStock, and the exchange payout -- so two refunds and one
    // payout, and a refund can never hand back more than was just taken.
    //
    // A new call site of either is a new Gold path. Go and look at it rather
    // than editing these numbers, and ask the only question that matters:
    // which DIRECTION does it move Gold? A new spend is a sink. A new credit
    // that is not a refund is a faucet, and that is the change to stop over.
    expect(calls(SERVICE, "spendGoldByProfile")).toBe(2);
    expect(calls(SERVICE, "creditGoldByProfile")).toBe(3);
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
      "exchange",
      "expand-capacity",
      "feed",
      "retire",
      "sell",
      "stock",
    ]);

    // The claim that actually matters, held separately from the list so it
    // cannot be lost in a rename: `exchange` is the only action that pays a
    // player Gold. `expand-capacity` and `buy-stock` spend it; everything
    // else moves Bushels or produce, neither of which leaves the farm.
    const paysGold = ["exchange"];
    const spendsGold = ["expand-capacity", "buy-stock"];
    for (const action of actions) {
      if (paysGold.includes(action) || spendsGold.includes(action)) continue;
      expect(SERVICE.includes(`"${action}"`)).toBe(false);
    }
    expect(actions).toEqual(expect.arrayContaining([...paysGold, ...spendsGold]));
  });

  it("never credits Bushels for spending Gold", async () => {
    // The behavioural half of the same claim, on one action that spends Gold
    // today: capacity is a sink, and buying it must not hand anything back.
    const { token, id } = await funded(500_000, 1_000);
    await expandStackAcresCapacity(token, "hen", T0);
    expect(await bushels(id)).toBe(1_000);
  });
});

describe("a pristine farm", () => {
  it("reads with no units at all, until something is bought", async () => {
    const token = randomUUID();
    const view = await readStackAcres(token, T0);
    expect(view.units).toEqual([]);
    expect(view.feed).toBe(0);
    expect(view.inventory).toEqual({});
    expect(view.capacity).toEqual({});
  });
});

/**
 * BOUGHT STOCK. The Gold market added a second way for Gold to enter the farm,
 * and these hold the two things that make it safe: the Gold genuinely leaves
 * the purse (and comes back on every failure path), and buying an animal
 * never pays anybody anything.
 *
 * The wall the rest of this file guards still stands and is asserted here
 * from the other side: collecting from bought stock must not move Gold
 * either. The ONLY action that credits Gold is the exchange window.
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

  it("spends no Bushels: the Gold price is the OTHER way to get one", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);
    await buyStackAcresStock(token, { stock: "cattle" }, T0);
    expect(await bushels(id)).toBe(before);
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
    // do. The same gap once skipped a refund entirely on the Bushel path.
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

    const view = await collectStackAcres(token, unitId, HEN_READY);

    const unit = unitOf(view, "hen");
    expect(unit.id).toBe(unitId);
    expect(unit.state).toBe("working");
    expect(unit.permanent).toBe(true);
    expect(unit.startedAt).toBe(HEN_READY.toISOString());
    expect(unit.readyAt).toBe(new Date(HEN_READY.getTime() + HEN.durationMs).toISOString());
  });

  it("yields the same produce a sown unit would", async () => {
    const { token, id } = await funded();
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;

    const before = await held(id, HEN_YIELD.item);
    await collectStackAcres(token, unitId, HEN_READY);

    expect(await held(id, HEN_YIELD.item)).toBe(before + HEN_YIELD.quantity);
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
      const view = await collectStackAcres(token, unitId, HEN_READY);
      expect(view.collected.mucked).toBe(false);
      expect(unitOf(view, "hen").state).not.toBe("mucked");
    } finally {
      roll.mockRestore();
    }
  });

  it("still moves no Gold, which is the wall this whole file guards", async () => {
    const { token } = await funded();
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    const unitId = unitOf(bought, "hen").id;
    const before = await balance(token);

    await collectStackAcres(token, unitId, HEN_READY);

    expect(await balance(token)).toBe(before);
  });

  it("keeps a sown unit disappearing exactly as it always did", async () => {
    const roll = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const { token, id } = await funded();
      const sown = await stockStackAcres(token, { stock: "hen" }, T0);
      const unitId = unitOf(sown, "hen").id;
      await collectStackAcres(token, unitId, HEN_READY);
      expect(await getStackAcresUnit(id, unitId)).toBeNull();
    } finally {
      roll.mockRestore();
    }
  });
});

describe("the harvest ledger", () => {
  it("flags a bought unit, so its notional seed cost is not read as a real one", async () => {
    // `stake` on a bought unit is the catalogue's Bushel price and NOBODY PAID
    // IT -- the unit was bought once, in Gold. The column cannot be 0 (it
    // carries check (stake > 0)), so the flag is the only thing standing
    // between an economy dashboard and a systematic understatement of what
    // the farm nets.
    const { token } = await funded();
    const bought = await buyStackAcresStock(token, { stock: "hen" }, T0);
    await collectStackAcres(token, unitOf(bought, "hen").id, HEN_READY);

    const [entry] = __stackacresHarvestsForTest();
    expect(entry.permanent).toBe(true);
    expect(entry.stake).toBe(HEN.seedCost);
  });

  it("leaves a sown unit unflagged, because its seed cost was real", async () => {
    const { token } = await funded();
    const sown = await stockStackAcres(token, { stock: "hen" }, T0);
    await collectStackAcres(token, unitOf(sown, "hen").id, HEN_READY);

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

  it("will not touch a unit that was sown with Bushels", async () => {
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
