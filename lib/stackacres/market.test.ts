import { describe, expect, it } from "vitest";
import {
  STACKACRES_GOLD_PER_SEED_BUSHEL,
  STACKACRES_PLOT_PRICE,
  STACKACRES_RETIRE_REFUND,
  STACKACRES_STALLS,
  STALL_LIST,
  goldStockRoundTrip,
  stackacresStockPrice,
  stallSelling,
  stallSells,
  stallShelf,
} from "./market";
import {
  STACKACRES_CATALOGUE,
  STACKACRES_FREE_PLOTS,
  STACKACRES_GRID_PLOTS,
  STACKACRES_STOCK,
  stackacresPlotPrice,
} from "./catalogue";
import { STACKACRES_GOLD_PER_BUSHEL } from "./exchange";
import { STACKACRES_ITEM_CATALOGUE, STACKACRES_YIELDS } from "./items";
import { ZONE_IDS } from "./zones";

/**
 * THE ONE TEST IN THIS FILE THAT IS ABOUT MONEY is "a round trip always
 * loses", and it is the reason the Gold market is allowed to exist at all.
 *
 * The service used to carry a rule saying no Gold -> Bushels path could ever
 * be added, on the grounds that a round trip would launder Gold through the
 * capped exchange window and back out. That reasoning is sound and it is
 * exactly what this asserts is impossible: buying stock with Gold and
 * liquidating everything it makes must return less Gold than it cost, on every
 * tier, with no tuning of the constants able to quietly break it.
 *
 * Everything else here is shape: prices derive from one rule, land is flat,
 * every stock is sold somewhere.
 */

describe("stock prices", () => {
  it("derive from the seed price by a single multiplier", () => {
    for (const stock of STACKACRES_STOCK) {
      expect(stackacresStockPrice(stock)).toBe(
        STACKACRES_CATALOGUE[stock].seedCost * STACKACRES_GOLD_PER_SEED_BUSHEL,
      );
    }
  });

  it("do not depend on how many you already own", () => {
    // The point of the rule, stated as a test because the previous design
    // scaled with ownership and made "how much is a cow" unanswerable without
    // knowing your own farm. A pure function of the stock cannot regress to
    // that without this failing to compile or failing here.
    const first = stackacresStockPrice("cattle");
    const later = stackacresStockPrice("cattle");
    expect(later).toBe(first);
    expect(first).toBe(60_000);
  });

  it("rank the tiers the same way the seed prices do", () => {
    const bySeed = [...STACKACRES_STOCK].sort(
      (a, b) => STACKACRES_CATALOGUE[a].seedCost - STACKACRES_CATALOGUE[b].seedCost,
    );
    const byGold = [...STACKACRES_STOCK].sort(
      (a, b) => stackacresStockPrice(a) - stackacresStockPrice(b),
    );
    expect(byGold).toEqual(bySeed);
  });
});

describe("the round trip", () => {
  it("always loses, on every tier", () => {
    for (const stock of STACKACRES_STOCK) {
      const produce = STACKACRES_YIELDS[stock];
      const grossBushels = produce.quantity * STACKACRES_ITEM_CATALOGUE[produce.item].price;
      const ratio = goldStockRoundTrip(stock, grossBushels, STACKACRES_GOLD_PER_BUSHEL);
      expect(ratio).toBeLessThan(1);
    }
  });

  it("loses by a wide enough margin that a retune cannot silently flip it", () => {
    // The closest tier to breaking even is the one to watch. A margin this
    // wide means the inbound rate would have to fall by more than an order of
    // magnitude, or the exchange rate rise by one, before a cycle paid for
    // itself outright -- either of which is a deliberate act, not a slip.
    const ratios = STACKACRES_STOCK.map((stock) => {
      const produce = STACKACRES_YIELDS[stock];
      const grossBushels = produce.quantity * STACKACRES_ITEM_CATALOGUE[produce.item].price;
      return goldStockRoundTrip(stock, grossBushels, STACKACRES_GOLD_PER_BUSHEL);
    });
    expect(Math.max(...ratios)).toBeLessThan(0.1);
  });

  it("is what the inbound rate being far above the outbound one buys", () => {
    expect(STACKACRES_GOLD_PER_SEED_BUSHEL).toBeGreaterThan(STACKACRES_GOLD_PER_BUSHEL);
  });
});

describe("land", () => {
  it("costs the same whichever plot it is", () => {
    const prices = [];
    for (let i = STACKACRES_FREE_PLOTS + 1; i <= STACKACRES_GRID_PLOTS; i += 1) {
      prices.push(stackacresPlotPrice(i));
    }
    expect(new Set(prices)).toEqual(new Set([STACKACRES_PLOT_PRICE]));
  });

  it("is free below the free-plot line and not for sale past the grid", () => {
    expect(stackacresPlotPrice(STACKACRES_FREE_PLOTS)).toBeNull();
    expect(stackacresPlotPrice(STACKACRES_GRID_PLOTS + 1)).toBeNull();
    expect(stackacresPlotPrice(1.5)).toBeNull();
  });
});

describe("the stalls", () => {
  it("give every district something to sell", () => {
    for (const zone of ZONE_IDS) {
      expect(STACKACRES_STALLS[zone].stock.length).toBeGreaterThan(0);
    }
  });

  it("sell every stock in the catalogue, at exactly one stall", () => {
    const counts = new Map<string, number>();
    for (const stall of STALL_LIST) {
      for (const stock of stall.stock) {
        counts.set(stock, (counts.get(stock) ?? 0) + 1);
      }
    }
    for (const stock of STACKACRES_STOCK) {
      expect(counts.get(stock)).toBe(1);
    }
    expect(counts.size).toBe(STACKACRES_STOCK.length);
  });

  it("agree with themselves about who sells what", () => {
    for (const stock of STACKACRES_STOCK) {
      const zone = stallSelling(stock);
      expect(stallSells(zone, stock)).toBe(true);
      for (const other of ZONE_IDS) {
        if (other !== zone) expect(stallSells(other, stock)).toBe(false);
      }
    }
  });

  it("put cattle out in the meadow and pigs in the wallow", () => {
    // The districts were built with their own scenery and blurbs before
    // anything was for sale in them; a shelf that ignores that would read as
    // arbitrary. Held so a future reshuffle has to be deliberate.
    expect(stallSelling("cattle")).toBe("meadow");
    expect(stallSelling("pig")).toBe("wallow");
    expect(stallSelling("cash_crop")).toBe("oxfields");
  });

  it("shows a shelf carrying both prices for the same animal", () => {
    const shelf = stallShelf("meadow");
    expect(shelf).toHaveLength(1);
    expect(shelf[0]).toMatchObject({
      stock: "cattle",
      price: 60_000,
      seedCost: STACKACRES_CATALOGUE.cattle.seedCost,
      animal: true,
    });
  });
});

describe("retiring", () => {
  it("refunds nothing", () => {
    // Stated as a test rather than left implied by an absent branch: a refund
    // would make a plot somewhere to park Gold and take it back out, which is
    // the one shape the whole subsystem is built not to have.
    expect(STACKACRES_RETIRE_REFUND).toBe(0);
  });
});
