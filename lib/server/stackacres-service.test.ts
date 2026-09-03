import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StackAcresRequestError,
  buyStackAcresFeed,
  buyStackAcresPlot,
  buyStackAcresStock,
  clearStackAcresPlot,
  collectStackAcres,
  exchangeStackAcresBushels,
  feedStackAcres,
  readStackAcres,
  retireStackAcresStock,
  sellStackAcresProduce,
  stockStackAcres,
} from "./stackacres-service";
import {
  __stackacresHarvestsForTest,
  __resetStackAcresForTest,
  adjustStackAcresFeed,
  adjustStackAcresInventory,
  getStackAcresPlot,
  readStackAcresFeed,
  readStackAcresInventory,
  stockStackAcresPlot,
} from "./stackacres-store";
import { adjustGold, ensureProfile } from "./profile-store";
import {
  STACKACRES_CATALOGUE,
  STACKACRES_FEED,
  STACKACRES_FREE_PLOTS,
  STACKACRES_PEN_CAP,
  stackacresPlotPrice,
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

// Passthrough by default; one test swaps stockStackAcresPlot's next call for a
// thrown error, standing in for the DB trigger raising (which the memory
// branch cannot do). Found in security review on the Mint: that throw once
// skipped the refund entirely.
vi.mock("./stackacres-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stackacres-store")>();
  return {
    ...actual,
    stockStackAcresPlot: vi.fn(actual.stockStackAcresPlot),
    // Also a passthrough spy, so one test can hand back a row whose snapshot
    // disagrees with the live catalogue. Nothing else can make those two
    // differ, because the guarded write refuses to re-stock a working plot.
    getStackAcresPlot: vi.fn(actual.getStackAcresPlot),
  };
});

/**
 * The StackAcres money contract, in memory mode.
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
const HEN = STACKACRES_CATALOGUE.hen;
const CATTLE = STACKACRES_CATALOGUE.cattle;
const SPROUT = STACKACRES_CATALOGUE.sprout;
const HEN_READY = new Date(T0.getTime() + HEN.durationMs);
const HEN_YIELD = STACKACRES_YIELDS.hen;

/**
 * A profile with Gold for acreage and Bushels for everything else. The read is
 * what triggers the one-time starting grant, so it happens before the top-up.
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

beforeEach(() => {
  __resetStackAcresForTest();
  vi.mocked(stockStackAcresPlot).mockImplementation(
    vi.mocked(stockStackAcresPlot).getMockImplementation() ?? stockStackAcresPlot,
  );
  vi.mocked(getStackAcresPlot).mockImplementation(
    vi.mocked(getStackAcresPlot).getMockImplementation() ?? getStackAcresPlot,
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

  it("is enough to plant the cheapest tier several times over", async () => {
    expect(STACKACRES_STARTING_BUSHELS).toBeGreaterThanOrEqual(SPROUT.seedCost * 5);
  });
});

describe("planting", () => {
  it("debits Bushels and snapshots the yield and readiness onto the plot", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);

    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);

    expect(await bushels(id)).toBe(before - HEN.seedCost);
    const row = await getStackAcresPlot(id, 1);
    expect(row?.status).toBe("working");
    expect(row?.stake).toBe(HEN.seedCost);
    expect(row?.yieldQuantity).toBe(HEN_YIELD.quantity);
    expect(row?.readyAt).toBe(HEN_READY.toISOString());
  });

  it("never touches Gold", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await stockStackAcres(token, { plotIndex: 1, stock: "cattle" }, T0);
    expect(await balance(token)).toBe(before);
  });

  it("marks an animal fed on arrival and leaves a crop with no feed clock", async () => {
    const { token, id } = await funded();

    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);
    await stockStackAcres(token, { plotIndex: 2, stock: "sprout" }, T0);

    expect((await getStackAcresPlot(id, 1))?.lastFedAt).toBe(T0.toISOString());
    expect((await getStackAcresPlot(id, 2))?.lastFedAt).toBeNull();
  });

  it("refuses when the purse cannot cover the seed, and takes nothing", async () => {
    const { token, id } = await funded(500_000, HEN.seedCost - 1);
    await expect(
      stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await bushels(id)).toBe(HEN.seedCost - 1);
  });

  it("refunds when the guarded write throws, standing in for the DB trigger", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);
    vi.mocked(stockStackAcresPlot).mockRejectedValueOnce(new Error("trigger said no"));

    await expect(stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0)).rejects.toThrow(
      "trigger said no",
    );
    expect(await bushels(id)).toBe(before);
  });

  it("counts crops and livestock against separate caps", async () => {
    const { token } = await funded();
    for (let plot = 1; plot <= STACKACRES_PEN_CAP; plot += 1) {
      await stockStackAcres(token, { plotIndex: plot, stock: "hen" }, T0);
    }
    // The pen cap is full...
    await expect(
      stockStackAcres(token, { plotIndex: STACKACRES_PEN_CAP + 1, stock: "hen" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
    // ...but a field still goes in, because the tracks do not share a budget.
    await stockStackAcres(token, { plotIndex: STACKACRES_PEN_CAP + 1, stock: "sprout" }, T0);
    const view = await readStackAcres(token, T0);
    expect(view.plots.filter((plot) => plot.state === "working")).toHaveLength(
      STACKACRES_PEN_CAP + 1,
    );
  });
});

describe("hunger", () => {
  const hungryAt = new Date(T0.getTime() + (CATTLE.hungerMs ?? 0) + 1000);

  it("freezes a pen past its feed window instead of letting it finish", async () => {
    const { token } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "cattle" }, T0);

    // Well past readiness, but it went hungry long before that.
    const wayLater = new Date(T0.getTime() + CATTLE.durationMs + 60_000);
    const view = await readStackAcres(token, wayLater);
    expect(view.plots[0].state).toBe("hungry");

    await expect(collectStackAcres(token, 1, wayLater)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });

  it("spends one serving and pushes readiness out by the time spent hungry", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "cattle" }, T0);
    await adjustStackAcresFeed(id, 2);

    const before = await getStackAcresPlot(id, 1);
    const fedAt = new Date(hungryAt.getTime() + 60_000);
    await feedStackAcres(token, 1, fedAt);

    const after = await getStackAcresPlot(id, 1);
    const starved = fedAt.getTime() - (T0.getTime() + (CATTLE.hungerMs ?? 0));
    expect(Date.parse(after?.readyAt ?? "")).toBe(Date.parse(before?.readyAt ?? "") + starved);
    expect(after?.lastFedAt).toBe(fedAt.toISOString());
    expect(await readStackAcresFeed(id)).toBe(1);
  });

  it("refuses to feed with an empty barn, and spends nothing", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "cattle" }, T0);

    await expect(feedStackAcres(token, 1, hungryAt)).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await readStackAcresFeed(id)).toBe(0);
  });

  it("never lets neglect cost produce: the snapshotted yield is untouched by feeding", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "cattle" }, T0);
    await adjustStackAcresFeed(id, 1);
    await feedStackAcres(token, 1, new Date(hungryAt.getTime() + 5 * 60 * 60 * 1000));
    expect((await getStackAcresPlot(id, 1))?.yieldQuantity).toBe(STACKACRES_YIELDS.cattle.quantity);
  });
});

describe("harvesting", () => {
  it("puts the snapshotted yield in the bag exactly once", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);

    const result = await collectStackAcres(token, 1, HEN_READY);
    expect(result.collected).toMatchObject({
      item: HEN_YIELD.item,
      quantity: HEN_YIELD.quantity,
    });
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);

    // A replay finds nothing to settle and yields nothing more.
    await expect(collectStackAcres(token, 1, HEN_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);
  });

  it("pays no Gold and no Bushels -- produce only", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);
    const goldBefore = await balance(token);
    const bushelsBefore = await bushels(id);

    await collectStackAcres(token, 1, HEN_READY);

    expect(await balance(token)).toBe(goldBefore);
    expect(await bushels(id)).toBe(bushelsBefore);
  });

  it("yields what the ROW says, not what the catalogue says today", async () => {
    // The wagerLadder rule. A retune landing between planting and harvest must
    // not change what the player agreed to, so the harvest reads the snapshot.
    // Standing in for that retune by editing the stored row directly, which is
    // the only way to make the two disagree.
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);

    const plot = await getStackAcresPlot(id, 1);
    const retuned = HEN_YIELD.quantity + 2;
    vi.mocked(getStackAcresPlot).mockResolvedValueOnce({
      ...(plot as NonNullable<typeof plot>),
      yieldQuantity: retuned,
    });

    const result = await collectStackAcres(token, 1, HEN_READY);
    expect(result.collected.quantity).toBe(retuned);
    expect(await held(id, HEN_YIELD.item)).toBe(retuned);
  });

  it("refuses before readiness", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);

    await expect(
      collectStackAcres(token, 1, new Date(HEN_READY.getTime() - 1000)),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await held(id, HEN_YIELD.item)).toBe(0);
  });

  it("records the harvest in the ledger, valued in Bushels", async () => {
    const { token } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);
    await collectStackAcres(token, 1, HEN_READY);
    expect(__stackacresHarvestsForTest()).toHaveLength(1);
    expect(__stackacresHarvestsForTest()[0]).toMatchObject({
      stock: "hen",
      stake: HEN.seedCost,
      payout: STACKACRES_ITEM_CATALOGUE[HEN_YIELD.item].price * HEN_YIELD.quantity,
    });
  });

  it("sends a mucked plot to mucked with the tier's fee, and never withholds the produce", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);

    // Force the roll. It is the one piece of randomness in the feature and it
    // lives behind Math.random in exactly one function.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const result = await collectStackAcres(token, 1, HEN_READY);
      expect(result.collected.mucked).toBe(true);
    } finally {
      random.mockRestore();
    }

    // Yielded in full regardless: muck is a cost you choose to pay later,
    // never a deduction from what the plot already grew.
    expect(await held(id, HEN_YIELD.item)).toBe(HEN_YIELD.quantity);
    const row = await getStackAcresPlot(id, 1);
    expect(row?.status).toBe("mucked");
    expect(row?.muckFee).toBe(HEN.muckFee);
  });

  it("leaves the plot empty when the roll comes up clean", async () => {
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      await collectStackAcres(token, 1, HEN_READY);
    } finally {
      random.mockRestore();
    }
    expect((await getStackAcresPlot(id, 1))?.status).toBe("empty");
  });
});

describe("selling produce", () => {
  async function withProduce() {
    const { token, id } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      await collectStackAcres(token, 1, HEN_READY);
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
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await collectStackAcres(token, 1, HEN_READY);
    } finally {
      random.mockRestore();
    }
    return { token, id };
  }

  it("blocks planting until it is cleared", async () => {
    const { token } = await mucked();
    await expect(
      stockStackAcres(token, { plotIndex: 1, stock: "hen" }, HEN_READY),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });

  it("charges the fee in Bushels and frees the plot", async () => {
    const { token, id } = await mucked();
    const before = await bushels(id);
    const gold = await balance(token);

    await clearStackAcresPlot(token, 1, HEN_READY);

    expect(await bushels(id)).toBe(before - HEN.muckFee);
    expect(await balance(token)).toBe(gold);
    expect((await getStackAcresPlot(id, 1))?.status).toBe("empty");
  });

  it("stays mucked when the fee cannot be paid, and takes nothing", async () => {
    const { token, id } = await mucked();
    await adjustStackAcresInventory(id, BUSHELS, -(await bushels(id)));

    await expect(clearStackAcresPlot(token, 1, HEN_READY)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await bushels(id)).toBe(0);
    expect((await getStackAcresPlot(id, 1))?.status).toBe("mucked");
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

describe("acreage", () => {
  it("sells the next plot in ladder order and debits GOLD, the farm's one inlet", async () => {
    const { token, id } = await funded();
    const index = STACKACRES_FREE_PLOTS + 1;
    const price = stackacresPlotPrice(index) as number;
    const before = await balance(token);
    const purse = await bushels(id);

    await buyStackAcresPlot(token, index, T0);

    expect(await balance(token)).toBe(before - price);
    expect(await bushels(id)).toBe(purse);
  });

  it("sells a plot with a gap beneath it", async () => {
    // This used to assert the opposite: buying out of order was refused,
    // because the price doubled per tile and skipping ahead would leave a
    // cheap tile unbought under a dear one. The price is flat now, so there is
    // nothing for an order to protect and the rule was removed. What has to
    // stay true is that ownership may be discontiguous without anything
    // downstream mis-reading it -- the snapshot walk in plots.ts assumed
    // contiguity when it picked the single "next purchasable" tile.
    const { token } = await funded();
    const skipped = STACKACRES_FREE_PLOTS + 1;
    const bought = STACKACRES_FREE_PLOTS + 2;

    const view = await buyStackAcresPlot(token, bought, T0);

    expect(view.plots[bought - 1].state).toBe("empty");
    expect(view.plots[skipped - 1].state).toBe("locked");
    expect(view.plots[skipped - 1].purchasable).toBe(true);
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

  it("gives a sixteen-plot farm exactly the same daily Gold as a bare one", async () => {
    // The invariant, stated as a test. Land fills the day faster; it does not
    // make the day bigger. If this ever fails, the ceiling has started scaling
    // with something and the farm is a percentage faucet again.
    const bare = await funded(0, 100_000);
    const big = await funded(5_000_000, 1_000_000);
    for (let index = STACKACRES_FREE_PLOTS + 1; index <= STACKACRES_FREE_PLOTS + 6; index += 1) {
      await buyStackAcresPlot(big.token, index, T0);
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
 * UPDATED when the Gold market shipped. A Gold -> stock -> Bushels path now
 * exists, and the reasoning above is why it is safe rather than why it is
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
    // spendGoldByProfile: acreage, and stock bought outright. Two SINKS.
    // creditGoldByProfile: the acreage refund, the two refund paths in
    // buyStackAcresStock, and the exchange payout -- so three refunds and one
    // payout, and a refund can never hand back more than was just taken.
    //
    // A new call site of either is a new Gold path. Go and look at it rather
    // than editing these numbers, and ask the only question that matters:
    // which DIRECTION does it move Gold? A new spend is a sink. A new credit
    // that is not a refund is a faucet, and that is the change to stop over.
    expect(calls(SERVICE, "spendGoldByProfile")).toBe(2);
    expect(calls(SERVICE, "creditGoldByProfile")).toBe(4);
  });

  it("exposes exactly one action that pays Gold out", () => {
    const actions = [...ROUTE.matchAll(/z\.literal\("([a-z-]+)"\)/g)].map((m) => m[1]).sort();
    // Adding an action means editing this list, which is the point: the
    // question to answer while doing it is "does this move Gold, and which
    // way".
    expect(actions).toEqual([
      "buy-feed",
      "buy-plot",
      "buy-stock",
      "clear",
      "collect",
      "exchange",
      "feed",
      "retire",
      "sell",
      "stock",
    ]);

    // The claim that actually matters, held separately from the list so it
    // cannot be lost in a rename: `exchange` is the only action that pays a
    // player Gold. `buy-plot` and `buy-stock` spend it; everything else moves
    // Bushels or produce, neither of which leaves the farm.
    const paysGold = ["exchange"];
    const spendsGold = ["buy-plot", "buy-stock"];
    for (const action of actions) {
      if (paysGold.includes(action) || spendsGold.includes(action)) continue;
      expect(SERVICE.includes(`"${action}"`)).toBe(false);
    }
    expect(actions).toEqual(expect.arrayContaining([...paysGold, ...spendsGold]));
  });

  it("never credits Bushels for spending Gold", async () => {
    // The behavioural half of the same claim, on the one action that spends
    // Gold today: acreage is a sink, and buying it must not hand anything back.
    const { token, id } = await funded(500_000, 1_000);
    await buyStackAcresPlot(token, STACKACRES_FREE_PLOTS + 1, T0);
    expect(await bushels(id)).toBe(1_000);
  });
});

describe("the free grid", () => {
  it("reads a pristine farm without creating any plot rows", async () => {
    const token = randomUUID();
    const view = await readStackAcres(token, T0);
    expect(view.plots).toHaveLength(16);
    expect(view.plots.slice(0, STACKACRES_FREE_PLOTS).every((p) => p.state === "empty")).toBe(true);
    expect(view.plots[STACKACRES_FREE_PLOTS].state).toBe("locked");
    expect(view.feed).toBe(0);
    expect(view.inventory).toEqual({});
  });

  it("prices a Sprout Row as the cheapest way in", async () => {
    const { token, id } = await funded(500_000, SPROUT.seedCost);
    await stockStackAcres(token, { plotIndex: 1, stock: "sprout" }, T0);
    expect(await bushels(id)).toBe(0);
  });
});

/**
 * BOUGHT STOCK. The Gold market added a second way for Gold to enter the farm,
 * and these hold the two things that makes safe: the Gold genuinely leaves the
 * purse (and comes back on every failure path), and buying an animal never
 * pays anybody anything.
 *
 * The wall the rest of this file guards still stands and is asserted here from
 * the other side: collecting from bought stock must not move Gold either. The
 * ONLY action that credits Gold is the exchange window.
 */
describe("buying stock outright", () => {
  it("charges the listed price and stands the animal on the plot", async () => {
    const { token } = await funded();
    const before = await balance(token);

    const view = await buyStackAcresStock(token, { plotIndex: 1, stock: "hen" }, T0);

    expect(await balance(token)).toBe(before - stackacresStockPrice("hen"));
    const plot = view.plots[0];
    expect(plot.state).toBe("working");
    expect(plot.stock).toBe("hen");
    expect(plot.permanent).toBe(true);
  });

  it("spends no Bushels: the seed price is the OTHER way to get one", async () => {
    const { token, id } = await funded();
    const before = await bushels(id);
    await buyStackAcresStock(token, { plotIndex: 1, stock: "cattle" }, T0);
    expect(await bushels(id)).toBe(before);
  });

  it("refuses when the purse is short, and charges nothing", async () => {
    const { token } = await funded(stackacresStockPrice("cattle") - 1);
    const before = await balance(token);

    await expect(
      buyStackAcresStock(token, { plotIndex: 1, stock: "cattle" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(before);
    expect((await readStackAcres(token, T0)).plots[0].state).toBe("empty");
  });

  it("refunds the Gold when the guarded write is lost", async () => {
    const { token } = await funded();
    const before = await balance(token);
    vi.mocked(stockStackAcresPlot).mockResolvedValueOnce(null);

    await expect(
      buyStackAcresStock(token, { plotIndex: 1, stock: "cattle" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(before);
  });

  it("refunds the Gold when the database refuses outright", async () => {
    // Stands in for the cap trigger raising, which the memory branch cannot
    // do. The same gap once skipped a refund entirely on the Bushel path.
    const { token } = await funded();
    const before = await balance(token);
    vi.mocked(stockStackAcresPlot).mockRejectedValueOnce(new Error("trigger said no"));

    await expect(buyStackAcresStock(token, { plotIndex: 1, stock: "cattle" }, T0)).rejects.toThrow(
      "trigger said no",
    );

    expect(await balance(token)).toBe(before);
  });

  it("counts against the same pen cap a planting does, without charging", async () => {
    const { token } = await funded();
    for (let i = 1; i <= STACKACRES_PEN_CAP; i += 1) {
      await buyStackAcresStock(token, { plotIndex: i, stock: "hen" }, T0);
    }
    const before = await balance(token);

    await expect(
      buyStackAcresStock(token, { plotIndex: STACKACRES_PEN_CAP + 1, stock: "hen" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(before);
  });

  it("will not stand stock on a plot that is not owned yet", async () => {
    const { token } = await funded();
    const locked = STACKACRES_FREE_PLOTS + 1;
    const before = await balance(token);

    await expect(
      buyStackAcresStock(token, { plotIndex: locked, stock: "hen" }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(before);
  });
});

describe("collecting from bought stock", () => {
  it("re-sows itself instead of emptying the plot", async () => {
    const { token } = await funded();
    await buyStackAcresStock(token, { plotIndex: 1, stock: "hen" }, T0);

    const view = await collectStackAcres(token, 1, HEN_READY);

    const plot = view.plots[0];
    expect(plot.state).toBe("working");
    expect(plot.stock).toBe("hen");
    expect(plot.permanent).toBe(true);
    expect(plot.startedAt).toBe(HEN_READY.toISOString());
    expect(plot.readyAt).toBe(new Date(HEN_READY.getTime() + HEN.durationMs).toISOString());
  });

  it("yields the same produce a sown plot would", async () => {
    const { token, id } = await funded();
    await buyStackAcresStock(token, { plotIndex: 1, stock: "hen" }, T0);

    const before = await held(id, HEN_YIELD.item);
    await collectStackAcres(token, 1, HEN_READY);

    expect(await held(id, HEN_YIELD.item)).toBe(before + HEN_YIELD.quantity);
  });

  it("never mucks, however the dice fall", async () => {
    // Muck is the cost of turning a field over between plantings and a bought
    // animal is never between plantings. Forced to the worst roll so this is
    // not passing by luck.
    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const { token } = await funded();
      await buyStackAcresStock(token, { plotIndex: 1, stock: "hen" }, T0);
      const view = await collectStackAcres(token, 1, HEN_READY);
      expect(view.collected.mucked).toBe(false);
      expect(view.plots[0].state).not.toBe("mucked");
    } finally {
      roll.mockRestore();
    }
  });

  it("still moves no Gold, which is the wall this whole file guards", async () => {
    const { token } = await funded();
    await buyStackAcresStock(token, { plotIndex: 1, stock: "hen" }, T0);
    const before = await balance(token);

    await collectStackAcres(token, 1, HEN_READY);

    expect(await balance(token)).toBe(before);
  });

  it("keeps a sown plot emptying exactly as it always did", async () => {
    const roll = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const { token } = await funded();
      await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);
      const view = await collectStackAcres(token, 1, HEN_READY);
      expect(view.plots[0].state).toBe("empty");
      expect(view.plots[0].permanent).toBe(false);
    } finally {
      roll.mockRestore();
    }
  });
});

describe("the harvest ledger", () => {
  it("flags a bought plot, so its notional seed cost is not read as a real one", async () => {
    // `stake` on a bought plot is the catalogue's Bushel price and NOBODY PAID
    // IT -- the plot was bought once, in Gold. The column cannot be 0 (it
    // carries check (stake > 0)), so the flag is the only thing standing
    // between an economy dashboard and a systematic understatement of what the
    // farm nets.
    const { token } = await funded();
    await buyStackAcresStock(token, { plotIndex: 1, stock: "hen" }, T0);
    await collectStackAcres(token, 1, HEN_READY);

    const [entry] = __stackacresHarvestsForTest();
    expect(entry.permanent).toBe(true);
    expect(entry.stake).toBe(HEN.seedCost);
  });

  it("leaves a sown plot unflagged, because its seed cost was real", async () => {
    const { token } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);
    await collectStackAcres(token, 1, HEN_READY);

    const [entry] = __stackacresHarvestsForTest();
    expect(entry.permanent).toBe(false);
    expect(entry.stake).toBe(HEN.seedCost);
  });
});

describe("retiring bought stock", () => {
  it("frees the plot and refunds nothing", async () => {
    const { token } = await funded();
    await buyStackAcresStock(token, { plotIndex: 1, stock: "cattle" }, T0);
    const spent = await balance(token);

    const view = await retireStackAcresStock(token, 1, T0);

    expect(view.plots[0].state).toBe("empty");
    expect(view.plots[0].permanent).toBe(false);
    expect(await balance(token)).toBe(spent);
  });

  it("lets a capped player swap what they keep", async () => {
    const { token } = await funded();
    for (let i = 1; i <= STACKACRES_PEN_CAP; i += 1) {
      await buyStackAcresStock(token, { plotIndex: i, stock: "hen" }, T0);
    }
    await retireStackAcresStock(token, 1, T0);

    const view = await buyStackAcresStock(token, { plotIndex: 1, stock: "cattle" }, T0);
    expect(view.plots[0].stock).toBe("cattle");
  });

  it("will not touch a plot that was sown with Bushels", async () => {
    // A planting has its seed already sunk into it and a harvest coming;
    // retiring is for bought stock only.
    const { token } = await funded();
    await stockStackAcres(token, { plotIndex: 1, stock: "hen" }, T0);

    await expect(retireStackAcresStock(token, 1, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect((await readStackAcres(token, T0)).plots[0].state).toBe("working");
  });

  it("will not touch an empty plot", async () => {
    const { token } = await funded();
    await expect(retireStackAcresStock(token, 1, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
  });
});

describe("buying land", () => {
  it("sells any locked plot, in any order", async () => {
    // The ladder used to force strict order because the price doubled. Buying
    // the last tile first is the whole point of flattening it.
    const { token } = await funded();
    const last = 16;
    const before = await balance(token);

    const view = await buyStackAcresPlot(token, last, T0);

    expect(await balance(token)).toBe(before - (stackacresPlotPrice(last) ?? 0));
    expect(view.plots[last - 1].state).toBe("empty");
    // The tile below it is still locked and still for sale.
    expect(view.plots[last - 2].state).toBe("locked");
    expect(view.plots[last - 2].purchasable).toBe(true);
  });

  it("charges the same for the first bought plot as the last", async () => {
    const { token } = await funded();
    const first = STACKACRES_FREE_PLOTS + 1;

    const beforeCheap = await balance(token);
    await buyStackAcresPlot(token, first, T0);
    const cheap = beforeCheap - (await balance(token));

    const beforeDear = await balance(token);
    await buyStackAcresPlot(token, 16, T0);
    const dear = beforeDear - (await balance(token));

    expect(cheap).toBe(dear);
  });

  it("still refuses to sell the same plot twice", async () => {
    const { token } = await funded();
    const index = STACKACRES_FREE_PLOTS + 1;
    await buyStackAcresPlot(token, index, T0);
    const before = await balance(token);

    await expect(buyStackAcresPlot(token, index, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(before);
  });
});
