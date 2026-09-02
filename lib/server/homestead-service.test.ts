import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HomesteadRequestError,
  buyHomesteadFeed,
  buyHomesteadPlot,
  clearHomesteadPlot,
  collectHomestead,
  exchangeHomesteadBushels,
  feedHomestead,
  readHomestead,
  sellHomesteadProduce,
  stockHomestead,
} from "./homestead-service";
import {
  __homesteadHarvestsForTest,
  __resetHomesteadForTest,
  adjustHomesteadFeed,
  adjustHomesteadInventory,
  getHomesteadPlot,
  readHomesteadFeed,
  readHomesteadInventory,
  stockHomesteadPlot,
} from "./homestead-store";
import { adjustGold, ensureProfile } from "./profile-store";
import {
  HOMESTEAD_CATALOGUE,
  HOMESTEAD_FEED,
  HOMESTEAD_FREE_PLOTS,
  HOMESTEAD_PEN_CAP,
  homesteadPlotPrice,
} from "@/lib/homestead/catalogue";
import {
  HOMESTEAD_GOLD_CEILING,
  HOMESTEAD_MAX_EXCHANGE_BUSHELS,
  goldForBushels,
} from "@/lib/homestead/exchange";
import {
  BUSHELS,
  HOMESTEAD_ITEM_CATALOGUE,
  HOMESTEAD_STARTING_BUSHELS,
  HOMESTEAD_STOCK,
  HOMESTEAD_YIELDS,
  netPerCycle,
} from "@/lib/homestead/items";

// Passthrough by default; one test swaps stockHomesteadPlot's next call for a
// thrown error, standing in for the DB trigger raising (which the memory
// branch cannot do). Found in security review on the Mint: that throw once
// skipped the refund entirely.
vi.mock("./homestead-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./homestead-store")>();
  return {
    ...actual,
    stockHomesteadPlot: vi.fn(actual.stockHomesteadPlot),
    // Also a passthrough spy, so one test can hand back a row whose snapshot
    // disagrees with the live catalogue. Nothing else can make those two
    // differ, because the guarded write refuses to re-stock a working plot.
    getHomesteadPlot: vi.fn(actual.getHomesteadPlot),
  };
});

/**
 * The StackChips Homestead money contract, in memory mode.
 *
 * TWO CURRENCIES, and the single most important thing these tests hold is the
 * wall between them: **planting, feeding, clearing and harvesting must never
 * move Gold.** Gold enters the farm only when buying acreage and leaves it only
 * through phase 3's exchange window. Several tests below assert a Gold balance
 * is *unchanged* across an action for exactly that reason -- if one of those
 * starts failing, a Gold path has been added to the farm and that is the thing
 * to stop and look at, not the assertion.
 *
 * Nothing here can lose a planting, so there is no losing branch to check --
 * what has to hold is exact and it all sits on the guards: the seed leaves
 * exactly once at planting, the snapshotted yield lands exactly once at
 * harvest and never before readiness, feed is spent exactly once per feeding,
 * and every failure path either never debits or refunds.
 */

const T0 = new Date("2026-08-31T12:00:00.000Z");
const HEN = HOMESTEAD_CATALOGUE.hen;
const CATTLE = HOMESTEAD_CATALOGUE.cattle;
const SPROUT = HOMESTEAD_CATALOGUE.sprout;
const HEN_READY = new Date(T0.getTime() + HEN.durationMs);
const HEN_YIELD = HOMESTEAD_YIELDS.hen;

/**
 * A profile with Gold for acreage and Bushels for everything else. The read is
 * what triggers the one-time starting grant, so it happens before the top-up.
 */
async function funded(gold = 500_000, bushels = 100_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  await readHomestead(token, T0);
  const held = await readHomesteadInventory(profile.id);
  await adjustHomesteadInventory(profile.id, BUSHELS, bushels - (held[BUSHELS] ?? 0));
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

async function bushels(id: string): Promise<number> {
  return (await readHomesteadInventory(id))[BUSHELS] ?? 0;
}

async function held(id: string, item: string): Promise<number> {
  return (await readHomesteadInventory(id))[item] ?? 0;
}

beforeEach(() => {
  __resetHomesteadForTest();
  vi.mocked(stockHomesteadPlot).mockImplementation(
    vi.mocked(stockHomesteadPlot).getMockImplementation() ?? stockHomesteadPlot,
  );
  vi.mocked(getHomesteadPlot).mockImplementation(
    vi.mocked(getHomesteadPlot).getMockImplementation() ?? getHomesteadPlot,
  );
});

describe("the starting grant", () => {
  it("seeds a new farm once and never tops it up again", async () => {
    const token = randomUUID();
    const { id } = await ensureProfile(token);

    const first = await readHomestead(token, T0);
    expect(first.bushels).toBe(HOMESTEAD_STARTING_BUSHELS);

    // Spend it all, then read again: the primary key is the idempotency guard,
    // so an empty purse is not a new farm.
    await adjustHomesteadInventory(id, BUSHELS, -HOMESTEAD_STARTING_BUSHELS);
    const second = await readHomestead(token, T0);
    expect(second.bushels).toBe(0);
  });

  it("is enough to plant the cheapest tier several times over", async () => {
    expect(HOMESTEAD_STARTING_BUSHELS).toBeGreaterThanOrEqual(SPROUT.seedCost * 5);
  });
});

describe("planting", () => {
  it("debits Bushels and snapshots the yield and readiness onto the plot", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);

    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);

    expect(await bushels(id)).toBe(before - HEN.seedCost);
    const row = await getHomesteadPlot(id, 1);
    expect(row?.status).toBe("working");
    expect(row?.stake).toBe(HEN.seedCost);
    expect(row?.yieldQuantity).toBe(HEN_YIELD.quantity);
    expect(row?.readyAt).toBe(HEN_READY.toISOString());
  });

  it("never touches Gold", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await stockHomestead(token, { plotIndex: 1, stock: "cattle" }, T0);
    expect(await balance(token)).toBe(before);
  });

  it("marks an animal fed on arrival and leaves a crop with no feed clock", async () => {
    const { token, id } = await funded();

    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    await stockHomestead(token, { plotIndex: 2, stock: "sprout" }, T0);

    expect((await getHomesteadPlot(id, 1))?.lastFedAt).toBe(T0.toISOString());
    expect((await getHomesteadPlot(id, 2))?.lastFedAt).toBeNull();
  });

  it("refuses when the purse cannot cover the seed, and takes nothing", async () => {
    const { token, id } = await funded(500_000, HEN.seedCost - 1);
    await expect(
      stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
    expect(await bushels(id)).toBe(HEN.seedCost - 1);
  });

  it("refunds when the guarded write throws, standing in for the DB trigger", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);
    vi.mocked(stockHomesteadPlot).mockRejectedValueOnce(new Error("trigger said no"));

    await expect(stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0)).rejects.toThrow(
      "trigger said no",
    );
    expect(await bushels(id)).toBe(before);
  });

  it("counts crops and livestock against separate caps", async () => {
    const { token } = await funded();
    for (let plot = 1; plot <= HOMESTEAD_PEN_CAP; plot += 1) {
      await stockHomestead(token, { plotIndex: plot, stock: "hen" }, T0);
    }
    // The pen cap is full...
    await expect(
      stockHomestead(token, { plotIndex: HOMESTEAD_PEN_CAP + 1, stock: "hen" }, T0),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
    // ...but a field still goes in, because the tracks do not share a budget.
    await stockHomestead(token, { plotIndex: HOMESTEAD_PEN_CAP + 1, stock: "sprout" }, T0);
    const view = await readHomestead(token, T0);
    expect(view.plots.filter((plot) => plot.state === "working")).toHaveLength(
      HOMESTEAD_PEN_CAP + 1,
    );
  });
});

describe("hunger", () => {
  const hungryAt = new Date(T0.getTime() + (CATTLE.hungerMs ?? 0) + 1000);

  it("freezes a pen past its feed window instead of letting it finish", async () => {
    const { token } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "cattle" }, T0);

    // Well past readiness, but it went hungry long before that.
    const wayLater = new Date(T0.getTime() + CATTLE.durationMs + 60_000);
    const view = await readHomestead(token, wayLater);
    expect(view.plots[0].state).toBe("hungry");

    await expect(collectHomestead(token, 1, wayLater)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );
  });

  it("spends one serving and pushes readiness out by the time spent hungry", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "cattle" }, T0);
    await adjustHomesteadFeed(id, 2);

    const before = await getHomesteadPlot(id, 1);
    const fedAt = new Date(hungryAt.getTime() + 60_000);
    await feedHomestead(token, 1, fedAt);

    const after = await getHomesteadPlot(id, 1);
    const starved = fedAt.getTime() - (T0.getTime() + (CATTLE.hungerMs ?? 0));
    expect(Date.parse(after?.readyAt ?? "")).toBe(Date.parse(before?.readyAt ?? "") + starved);
    expect(after?.lastFedAt).toBe(fedAt.toISOString());
    expect(await readHomesteadFeed(id)).toBe(1);
  });

  it("refuses to feed with an empty barn, and spends nothing", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "cattle" }, T0);

    await expect(feedHomestead(token, 1, hungryAt)).rejects.toBeInstanceOf(HomesteadRequestError);
    expect(await readHomesteadFeed(id)).toBe(0);
  });

  it("never lets neglect cost produce: the snapshotted yield is untouched by feeding", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "cattle" }, T0);
    await adjustHomesteadFeed(id, 1);
    await feedHomestead(token, 1, new Date(hungryAt.getTime() + 5 * 60 * 60 * 1000));
    expect((await getHomesteadPlot(id, 1))?.yieldQuantity).toBe(HOMESTEAD_YIELDS.cattle.quantity);
  });
});

describe("harvesting", () => {
  it("puts the snapshotted yield in the bag exactly once", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);

    const result = await collectHomestead(token, 1, HEN_READY);
    expect(result.collected).toMatchObject({
      item: HEN_YIELD.item,
      quantity: HEN_YIELD.quantity,
    });
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);

    // A replay finds nothing to settle and yields nothing more.
    await expect(collectHomestead(token, 1, HEN_READY)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);
  });

  it("pays no Gold and no Bushels -- produce only", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    const goldBefore = await balance(token);
    const bushelsBefore = await bushels(id);

    await collectHomestead(token, 1, HEN_READY);

    expect(await balance(token)).toBe(goldBefore);
    expect(await bushels(id)).toBe(bushelsBefore);
  });

  it("yields what the ROW says, not what the catalogue says today", async () => {
    // The wagerLadder rule. A retune landing between planting and harvest must
    // not change what the player agreed to, so the harvest reads the snapshot.
    // Standing in for that retune by editing the stored row directly, which is
    // the only way to make the two disagree.
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);

    const plot = await getHomesteadPlot(id, 1);
    const retuned = HEN_YIELD.quantity + 2;
    vi.mocked(getHomesteadPlot).mockResolvedValueOnce({
      ...(plot as NonNullable<typeof plot>),
      yieldQuantity: retuned,
    });

    const result = await collectHomestead(token, 1, HEN_READY);
    expect(result.collected.quantity).toBe(retuned);
    expect(await held(id, HEN_YIELD.item)).toBe(retuned);
  });

  it("refuses before readiness", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);

    await expect(
      collectHomestead(token, 1, new Date(HEN_READY.getTime() - 1000)),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
    expect(await held(id, HEN_YIELD.item)).toBe(0);
  });

  it("records the harvest in the ledger, valued in Bushels", async () => {
    const { token } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    await collectHomestead(token, 1, HEN_READY);
    expect(__homesteadHarvestsForTest()).toHaveLength(1);
    expect(__homesteadHarvestsForTest()[0]).toMatchObject({
      stock: "hen",
      stake: HEN.seedCost,
      payout: HOMESTEAD_ITEM_CATALOGUE[HEN_YIELD.item].price * HEN_YIELD.quantity,
    });
  });

  it("sends a mucked plot to mucked with the tier's fee, and never withholds the produce", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);

    // Force the roll. It is the one piece of randomness in the feature and it
    // lives behind Math.random in exactly one function.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const result = await collectHomestead(token, 1, HEN_READY);
      expect(result.collected.mucked).toBe(true);
    } finally {
      random.mockRestore();
    }

    // Yielded in full regardless: muck is a cost you choose to pay later,
    // never a deduction from what the plot already grew.
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);
    const row = await getHomesteadPlot(id, 1);
    expect(row?.status).toBe("mucked");
    expect(row?.muckFee).toBe(HEN.muckFee);
  });

  it("leaves the plot empty when the roll comes up clean", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      await collectHomestead(token, 1, HEN_READY);
    } finally {
      random.mockRestore();
    }
    expect((await getHomesteadPlot(id, 1))?.status).toBe("empty");
  });
});

describe("selling produce", () => {
  async function withProduce() {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      await collectHomestead(token, 1, HEN_READY);
    } finally {
      random.mockRestore();
    }
    return { token, id };
  }

  it("swaps produce for Bushels at the catalogue price", async () => {
    const { token, id } = await withProduce();
    const before = await bushels(id);

    const result = await sellHomesteadProduce(token, { item: "eggs", quantity: 2 }, T0);

    expect(result.sold.bushels).toBe(HOMESTEAD_ITEM_CATALOGUE.eggs.price * 2);
    expect(await bushels(id)).toBe(before + HOMESTEAD_ITEM_CATALOGUE.eggs.price * 2);
    expect(await held(id, "eggs")).toBe(HEN_YIELD.quantity - 2);
  });

  it("never pays Gold", async () => {
    const { token } = await withProduce();
    const before = await balance(token);
    await sellHomesteadProduce(token, { item: "eggs", quantity: 1 }, T0);
    expect(await balance(token)).toBe(before);
  });

  it("refuses to sell more than is held, and takes nothing", async () => {
    const { token, id } = await withProduce();
    const before = await bushels(id);

    await expect(
      sellHomesteadProduce(token, { item: "eggs", quantity: HEN_YIELD.quantity + 1 }, T0),
    ).rejects.toBeInstanceOf(HomesteadRequestError);

    expect(await held(id, "eggs")).toBe(HEN_YIELD.quantity);
    expect(await bushels(id)).toBe(before);
  });

  it("refuses a nonsense quantity or an unknown item", async () => {
    const { token } = await withProduce();
    await expect(
      sellHomesteadProduce(token, { item: "eggs", quantity: 0 }, T0),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
    await expect(
      sellHomesteadProduce(token, { item: "gold", quantity: 1 }, T0),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
  });

  it("cannot be used to mint Bushels by selling the currency itself", async () => {
    // `bushels` shares the inventory table with produce, so the item guard is
    // the only thing standing between a sell request and infinite money.
    const { token } = await withProduce();
    await expect(
      sellHomesteadProduce(token, { item: BUSHELS, quantity: 1 }, T0),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
  });
});

describe("muck", () => {
  async function mucked() {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await collectHomestead(token, 1, HEN_READY);
    } finally {
      random.mockRestore();
    }
    return { token, id };
  }

  it("blocks planting until it is cleared", async () => {
    const { token } = await mucked();
    await expect(
      stockHomestead(token, { plotIndex: 1, stock: "hen" }, HEN_READY),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
  });

  it("charges the fee in Bushels and frees the plot", async () => {
    const { token, id } = await mucked();
    const before = await bushels(id);
    const gold = await balance(token);

    await clearHomesteadPlot(token, 1, HEN_READY);

    expect(await bushels(id)).toBe(before - HEN.muckFee);
    expect(await balance(token)).toBe(gold);
    expect((await getHomesteadPlot(id, 1))?.status).toBe("empty");
  });

  it("stays mucked when the fee cannot be paid, and takes nothing", async () => {
    const { token, id } = await mucked();
    await adjustHomesteadInventory(id, BUSHELS, -(await bushels(id)));

    await expect(clearHomesteadPlot(token, 1, HEN_READY)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );
    expect(await bushels(id)).toBe(0);
    expect((await getHomesteadPlot(id, 1))?.status).toBe("mucked");
  });

  it("keeps every tier's expected muck cost below what that tier earns", () => {
    // The arithmetic the fee exists to satisfy. A flat fee across tiers an
    // order of magnitude apart made the cheapest one permanently negative,
    // which is how this rule got written down.
    for (const stock of HOMESTEAD_STOCK) {
      const def = HOMESTEAD_CATALOGUE[stock];
      expect(def.muckFee * 0.2).toBeLessThan(netPerCycle(stock, def.seedCost));
    }
  });
});

describe("feed shipments", () => {
  it("debits Bushels and adds servings, leaving Gold alone", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);
    const gold = await balance(token);
    const sack = HOMESTEAD_FEED.feed_sack;

    await buyHomesteadFeed(token, "feed_sack", T0);

    expect(await bushels(id)).toBe(before - sack.cost);
    expect(await balance(token)).toBe(gold);
    expect(await readHomesteadFeed(id)).toBe(sack.servings);
  });

  it("refuses an unaffordable shipment and takes nothing", async () => {
    const { token, id } = await funded(500_000, 1);
    await expect(buyHomesteadFeed(token, "feed_sack", T0)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );
    expect(await bushels(id)).toBe(1);
    expect(await readHomesteadFeed(id)).toBe(0);
  });
});

describe("acreage", () => {
  it("sells the next plot in ladder order and debits GOLD, the farm's one inlet", async () => {
    const { token, id } = await funded();
    const index = HOMESTEAD_FREE_PLOTS + 1;
    const price = homesteadPlotPrice(index) as number;
    const before = await balance(token);
    const purse = await bushels(id);

    await buyHomesteadPlot(token, index, T0);

    expect(await balance(token)).toBe(before - price);
    expect(await bushels(id)).toBe(purse);
  });

  it("refuses to skip ahead in the ladder", async () => {
    const { token } = await funded();
    await expect(
      buyHomesteadPlot(token, HOMESTEAD_FREE_PLOTS + 2, T0),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
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
  const MAX = HOMESTEAD_MAX_EXCHANGE_BUSHELS;

  it("takes Bushels and pays Gold at the posted rate", async () => {
    const { token, id } = await funded(1_000, 5_000);
    const purse = await bushels(id);

    const result = await exchangeHomesteadBushels(token, 100, T0);

    expect(result.exchanged).toEqual({ bushels: 100, gold: goldForBushels(100) });
    expect(await bushels(id)).toBe(purse - 100);
    expect(await balance(token)).toBe(1_000 + goldForBushels(100));
    expect(result.exchange.usedToday).toBe(goldForBushels(100));
    expect(result.exchange.remaining).toBe(HOMESTEAD_GOLD_CEILING - goldForBushels(100));
  });

  it("stops at the ceiling and says so, rather than paying a little more", async () => {
    const { token, id } = await funded(0, 100_000);
    await exchangeHomesteadBushels(token, MAX, T0);
    const afterCap = await bushels(id);

    await expect(exchangeHomesteadBushels(token, 1, T0)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );

    expect(await balance(token)).toBe(HOMESTEAD_GOLD_CEILING);
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
      Array.from({ length: 12 }, () => exchangeHomesteadBushels(token, chunk, T0)),
    );
    const paid = attempts.filter((a) => a.status === "fulfilled").length;

    expect(paid).toBeGreaterThan(0);
    expect(await balance(token)).toBe(goldForBushels(chunk) * paid);
    expect(await balance(token)).toBeLessThanOrEqual(HOMESTEAD_GOLD_CEILING);
    // Every refusal put its Bushels back, so the barn only ever paid for the
    // exchanges that actually happened.
    expect(await bushels(id)).toBe(purse - chunk * paid);
  });

  it("gives a sixteen-plot farm exactly the same daily Gold as a bare one", async () => {
    // The invariant, stated as a test. Land fills the day faster; it does not
    // make the day bigger. If this ever fails, the ceiling has started scaling
    // with something and the farm is a percentage faucet again.
    const bare = await funded(0, 100_000);
    const big = await funded(5_000_000, 1_000_000);
    for (let index = HOMESTEAD_FREE_PLOTS + 1; index <= HOMESTEAD_FREE_PLOTS + 6; index += 1) {
      await buyHomesteadPlot(big.token, index, T0);
    }
    const bigGoldBefore = await balance(big.token);

    await exchangeHomesteadBushels(bare.token, MAX, T0);
    await exchangeHomesteadBushels(big.token, MAX, T0);

    expect(await balance(bare.token)).toBe(HOMESTEAD_GOLD_CEILING);
    expect((await balance(big.token)) - bigGoldBefore).toBe(HOMESTEAD_GOLD_CEILING);
    await expect(exchangeHomesteadBushels(big.token, 1, T0)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );
  });

  it("refuses a single request larger than a whole day", async () => {
    const { token, id } = await funded(0, 1_000_000);
    const purse = await bushels(id);

    await expect(exchangeHomesteadBushels(token, MAX + 1, T0)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );

    expect(await balance(token)).toBe(0);
    expect(await bushels(id)).toBe(purse);
  });

  it("reopens at UTC midnight and not a moment before", async () => {
    const { token } = await funded(0, 100_000);
    const lastSecond = new Date("2026-08-31T23:59:59.999Z");
    const midnight = new Date("2026-09-01T00:00:00.000Z");

    await exchangeHomesteadBushels(token, MAX, T0);
    await expect(exchangeHomesteadBushels(token, 1, lastSecond)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );
    expect(await balance(token)).toBe(HOMESTEAD_GOLD_CEILING);

    await exchangeHomesteadBushels(token, MAX, midnight);
    expect(await balance(token)).toBe(HOMESTEAD_GOLD_CEILING * 2);
  });

  it("pays nothing and spends no allowance when the barn is short", async () => {
    const { token, id } = await funded(0, 10);

    await expect(exchangeHomesteadBushels(token, 500, T0)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );

    expect(await balance(token)).toBe(0);
    expect(await bushels(id)).toBe(10);
    // The refusal happened before the reservation, so the whole day is intact.
    expect((await readHomestead(token, T0)).exchange.remaining).toBe(HOMESTEAD_GOLD_CEILING);
  });

  it("refuses an amount that is not a whole positive number of Bushels", async () => {
    const { token, id } = await funded(0, 5_000);
    for (const amount of [0, -50, 12.5, Number.NaN]) {
      await expect(exchangeHomesteadBushels(token, amount, T0)).rejects.toBeInstanceOf(
        HomesteadRequestError,
      );
    }
    expect(await balance(token)).toBe(0);
    expect(await bushels(id)).toBe(5_000);
  });

  it("leaves produce alone -- it trades Bushels, not the barn", async () => {
    const { token, id } = await funded(0, 5_000);
    await adjustHomesteadInventory(id, "eggs", 12);

    await exchangeHomesteadBushels(token, 100, T0);

    expect(await held(id, "eggs")).toBe(12);
  });
});

/**
 * The other half of the invariant, and the one no behavioural test can reach:
 * there must be no way IN. A Gold -> Bushels path anywhere would make a round
 * trip through the capped window possible, and a round trip turns a ceiling
 * into a laundry.
 */
describe("the currency wall", () => {
  const SERVICE = readFileSync(join(process.cwd(), "lib/server/homestead-service.ts"), "utf8");
  const ROUTE = readFileSync(join(process.cwd(), "app/api/homestead/actions/route.ts"), "utf8");

  const calls = (source: string, fn: string) => source.split(`${fn}(`).length - 1;

  it("moves Gold in exactly two places, both of them known", async () => {
    // spendGoldByProfile: acreage, once. creditGoldByProfile: the acreage
    // refund, and the exchange payout. A third call site of either is a new
    // Gold path -- go and look at it rather than editing this number.
    expect(calls(SERVICE, "spendGoldByProfile")).toBe(1);
    expect(calls(SERVICE, "creditGoldByProfile")).toBe(2);
  });

  it("exposes no action that turns Gold into Bushels", () => {
    const actions = [...ROUTE.matchAll(/z\.literal\("([a-z-]+)"\)/g)].map((m) => m[1]).sort();
    // Adding an action means editing this list, which is the point: the
    // question to answer while doing it is "does this move Gold, and which
    // way". Nothing here may pay OUT Bushels for Gold.
    expect(actions).toEqual([
      "buy-feed",
      "buy-plot",
      "clear",
      "collect",
      "exchange",
      "feed",
      "sell",
      "stock",
    ]);
  });

  it("never credits Bushels for spending Gold", async () => {
    // The behavioural half of the same claim, on the one action that spends
    // Gold today: acreage is a sink, and buying it must not hand anything back.
    const { token, id } = await funded(500_000, 1_000);
    await buyHomesteadPlot(token, HOMESTEAD_FREE_PLOTS + 1, T0);
    expect(await bushels(id)).toBe(1_000);
  });
});

describe("the free grid", () => {
  it("reads a pristine farm without creating any plot rows", async () => {
    const token = randomUUID();
    const view = await readHomestead(token, T0);
    expect(view.plots).toHaveLength(16);
    expect(view.plots.slice(0, HOMESTEAD_FREE_PLOTS).every((p) => p.state === "empty")).toBe(true);
    expect(view.plots[HOMESTEAD_FREE_PLOTS].state).toBe("locked");
    expect(view.feed).toBe(0);
    expect(view.inventory).toEqual({});
  });

  it("prices a Sprout Row as the cheapest way in", async () => {
    const { token, id } = await funded(500_000, SPROUT.seedCost);
    await stockHomestead(token, { plotIndex: 1, stock: "sprout" }, T0);
    expect(await bushels(id)).toBe(0);
  });
});
