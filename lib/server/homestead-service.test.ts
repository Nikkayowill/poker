import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HomesteadRequestError,
  buyHomesteadFeed,
  buyHomesteadPlot,
  clearHomesteadPlot,
  collectHomestead,
  feedHomestead,
  readHomestead,
  stockHomestead,
} from "./homestead-service";
import {
  __homesteadHarvestsForTest,
  __resetHomesteadForTest,
  adjustHomesteadFeed,
  getHomesteadPlot,
  readHomesteadFeed,
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

// Passthrough by default; one test swaps stockHomesteadPlot's next call for a
// thrown error, standing in for the DB trigger raising (which the memory
// branch cannot do). Found in security review on the Mint: that throw once
// skipped the refund entirely.
vi.mock("./homestead-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./homestead-store")>();
  return { ...actual, stockHomesteadPlot: vi.fn(actual.stockHomesteadPlot) };
});

/**
 * The StackChips Homestead money contract, in memory mode.
 *
 * Nothing here can lose a stake, so there is no losing branch to check -- what
 * has to hold is exact and it all sits on the guards: the stake leaves exactly
 * once at stocking, the snapshotted payout is credited exactly once at
 * collection and never before readiness, feed is spent exactly once per
 * feeding, and every failure path either never debits or refunds.
 */

const T0 = new Date("2026-08-31T12:00:00.000Z");
const HEN = HOMESTEAD_CATALOGUE.hen;
const CATTLE = HOMESTEAD_CATALOGUE.cattle;
const SPROUT = HOMESTEAD_CATALOGUE.sprout;
const HEN_READY = new Date(T0.getTime() + HEN.durationMs);

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

beforeEach(() => {
  __resetHomesteadForTest();
  vi.mocked(stockHomesteadPlot).mockImplementation(
    vi.mocked(stockHomesteadPlot).getMockImplementation() ?? stockHomesteadPlot,
  );
});

describe("stocking", () => {
  it("debits the stake and snapshots payout and readiness onto the plot", async () => {
    const { token, id } = await funded();
    const before = await balance(token);

    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);

    expect(await balance(token)).toBe(before - HEN.stake);
    const row = await getHomesteadPlot(id, 1);
    expect(row?.status).toBe("working");
    expect(row?.stake).toBe(HEN.stake);
    expect(row?.payout).toBe(HEN.payout);
    expect(row?.readyAt).toBe(HEN_READY.toISOString());
  });

  it("marks an animal fed on arrival and leaves a crop with no feed clock", async () => {
    const { token, id } = await funded();

    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    await stockHomestead(token, { plotIndex: 2, stock: "sprout" }, T0);

    expect((await getHomesteadPlot(id, 1))?.lastFedAt).toBe(T0.toISOString());
    expect((await getHomesteadPlot(id, 2))?.lastFedAt).toBeNull();
  });

  it("refuses when the wallet cannot cover the stake, and takes nothing", async () => {
    const { token } = await funded(HEN.stake - 1);
    await expect(
      stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
    expect(await balance(token)).toBe(HEN.stake - 1);
  });

  it("refunds when the guarded write throws, standing in for the DB trigger", async () => {
    const { token } = await funded();
    const before = await balance(token);
    vi.mocked(stockHomesteadPlot).mockRejectedValueOnce(new Error("trigger said no"));

    await expect(stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0)).rejects.toThrow(
      "trigger said no",
    );
    expect(await balance(token)).toBe(before);
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

  it("never lets neglect cost Gold: the payout is untouched by feeding", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "cattle" }, T0);
    await adjustHomesteadFeed(id, 1);
    await feedHomestead(token, 1, new Date(hungryAt.getTime() + 5 * 60 * 60 * 1000));
    expect((await getHomesteadPlot(id, 1))?.payout).toBe(CATTLE.payout);
  });
});

describe("collecting", () => {
  it("credits the snapshotted payout exactly once", async () => {
    const { token } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    const staked = await balance(token);

    const result = await collectHomestead(token, 1, HEN_READY);
    expect(result.collected.payout).toBe(HEN.payout);
    expect(await balance(token)).toBe(staked + HEN.payout);

    // A replay finds nothing to settle and pays nothing more.
    await expect(collectHomestead(token, 1, HEN_READY)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );
    expect(await balance(token)).toBe(staked + HEN.payout);
  });

  it("refuses before readiness", async () => {
    const { token } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    const staked = await balance(token);

    await expect(
      collectHomestead(token, 1, new Date(HEN_READY.getTime() - 1000)),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
    expect(await balance(token)).toBe(staked);
  });

  it("records the collection in the ledger", async () => {
    const { token } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    await collectHomestead(token, 1, HEN_READY);
    expect(__homesteadHarvestsForTest()).toHaveLength(1);
    expect(__homesteadHarvestsForTest()[0]).toMatchObject({
      stock: "hen",
      stake: HEN.stake,
      payout: HEN.payout,
    });
  });

  it("sends a mucked plot to mucked with the tier's fee, and never blocks the payout", async () => {
    const { token, id } = await funded();
    await stockHomestead(token, { plotIndex: 1, stock: "hen" }, T0);
    const staked = await balance(token);

    // Force the roll. It is the one piece of randomness in the feature and it
    // lives behind Math.random in exactly one function.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const result = await collectHomestead(token, 1, HEN_READY);
      expect(result.collected.mucked).toBe(true);
    } finally {
      random.mockRestore();
    }

    // Paid in full regardless: muck is a cost you choose to pay later, never a
    // deduction from what the plot already earned.
    expect(await balance(token)).toBe(staked + HEN.payout);
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

  it("blocks stocking until it is cleared", async () => {
    const { token } = await mucked();
    await expect(
      stockHomestead(token, { plotIndex: 1, stock: "hen" }, HEN_READY),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
  });

  it("charges the fee and frees the plot", async () => {
    const { token, id } = await mucked();
    const before = await balance(token);

    await clearHomesteadPlot(token, 1, HEN_READY);

    expect(await balance(token)).toBe(before - HEN.muckFee);
    expect((await getHomesteadPlot(id, 1))?.status).toBe("empty");
  });

  it("stays mucked when the fee cannot be paid, and takes nothing", async () => {
    const { token, id } = await mucked();
    await adjustGold(id, -(await balance(token)));

    await expect(clearHomesteadPlot(token, 1, HEN_READY)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );
    expect(await balance(token)).toBe(0);
    expect((await getHomesteadPlot(id, 1))?.status).toBe("mucked");
  });

  it("keeps every tier's expected muck cost below what that tier earns", () => {
    // The arithmetic the fee exists to satisfy. A flat fee across tiers
    // spanning 500 to 50,000 Gold made the cheapest one permanently negative,
    // which is how this rule got written down.
    for (const def of Object.values(HOMESTEAD_CATALOGUE)) {
      const net = def.payout - def.stake;
      expect(def.muckFee * 0.2).toBeLessThan(net);
    }
  });
});

describe("feed shipments", () => {
  it("debits Gold and adds servings", async () => {
    const { token, id } = await funded();
    const before = await balance(token);
    const sack = HOMESTEAD_FEED.feed_sack;

    await buyHomesteadFeed(token, "feed_sack", T0);

    expect(await balance(token)).toBe(before - sack.cost);
    expect(await readHomesteadFeed(id)).toBe(sack.servings);
  });

  it("refuses an unaffordable shipment and takes nothing", async () => {
    const { token, id } = await funded(10);
    await expect(buyHomesteadFeed(token, "feed_sack", T0)).rejects.toBeInstanceOf(
      HomesteadRequestError,
    );
    expect(await balance(token)).toBe(10);
    expect(await readHomesteadFeed(id)).toBe(0);
  });
});

describe("acreage", () => {
  it("sells the next plot in ladder order and debits the price", async () => {
    const { token } = await funded();
    const index = HOMESTEAD_FREE_PLOTS + 1;
    const price = homesteadPlotPrice(index) as number;
    const before = await balance(token);

    await buyHomesteadPlot(token, index, T0);

    expect(await balance(token)).toBe(before - price);
  });

  it("refuses to skip ahead in the ladder", async () => {
    const { token } = await funded();
    await expect(
      buyHomesteadPlot(token, HOMESTEAD_FREE_PLOTS + 2, T0),
    ).rejects.toBeInstanceOf(HomesteadRequestError);
  });
});

describe("the free grid", () => {
  it("reads a pristine farm without creating any rows", async () => {
    const { token } = await funded();
    const view = await readHomestead(token, T0);
    expect(view.plots).toHaveLength(16);
    expect(view.plots.slice(0, HOMESTEAD_FREE_PLOTS).every((p) => p.state === "empty")).toBe(true);
    expect(view.plots[HOMESTEAD_FREE_PLOTS].state).toBe("locked");
    expect(view.feed).toBe(0);
  });

  it("prices a Sprout Row as the cheapest way in", async () => {
    const { token } = await funded(SPROUT.stake);
    await stockHomestead(token, { plotIndex: 1, stock: "sprout" }, T0);
    expect(await balance(token)).toBe(0);
  });
});
