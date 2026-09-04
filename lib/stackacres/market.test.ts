import { describe, expect, it } from "vitest";
import {
  STACKACRES_CAPACITY_PRICE,
  STACKACRES_GOLD_PER_SEED_BUSHEL,
  STACKACRES_RETIRE_REFUND,
  goldStockRoundTrip,
  stackacresCapacityPrice,
  stackacresStockPrice,
} from "./market";
import { STACKACRES_CATALOGUE, STACKACRES_STOCK } from "./catalogue";
import { STACKACRES_GOLD_PER_BUSHEL } from "./exchange";
import { STACKACRES_ITEM_CATALOGUE, STACKACRES_YIELDS } from "./items";
import { stockZone, stocksInZone } from "./world";
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
 * Everything else here is shape: prices derive from one rule, capacity has a
 * Gold price for every kind, every stock lives in exactly one district.
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

describe("capacity prices", () => {
  it("give every stock kind a positive Gold price", () => {
    for (const stock of STACKACRES_STOCK) {
      expect(STACKACRES_CAPACITY_PRICE[stock]).toBeGreaterThan(0);
      expect(stackacresCapacityPrice(stock)).toBe(STACKACRES_CAPACITY_PRICE[stock]);
    }
  });
});

describe("districts", () => {
  it("give every district something to sell", () => {
    for (const zone of ZONE_IDS) {
      expect(stocksInZone(zone).length).toBeGreaterThan(0);
    }
  });

  it("sell every stock in exactly one district", () => {
    const counts = new Map<string, number>();
    for (const zone of ZONE_IDS) {
      for (const stock of stocksInZone(zone)) {
        counts.set(stock, (counts.get(stock) ?? 0) + 1);
      }
    }
    for (const stock of STACKACRES_STOCK) {
      expect(counts.get(stock)).toBe(1);
    }
    expect(counts.size).toBe(STACKACRES_STOCK.length);
  });

  it("agree with themselves about who keeps what", () => {
    for (const stock of STACKACRES_STOCK) {
      const zone = stockZone(stock);
      expect(stocksInZone(zone)).toContain(stock);
      for (const other of ZONE_IDS) {
        if (other !== zone) expect(stocksInZone(other)).not.toContain(stock);
      }
    }
  });

  it("keep cattle at the Ox Fields and pigs at the Wallow", () => {
    // The districts were built with their own scenery and blurbs before the
    // pens moved in; a mapping that ignores that would read as arbitrary.
    // Held so a future reshuffle has to be deliberate. The internal zone id
    // stays "wallow" even though the player-facing label is "The Fold" --
    // see zones.ts.
    expect(stockZone("cattle")).toBe("oxfields");
    expect(stockZone("pig")).toBe("wallow");
    expect(stockZone("cash_crop")).toBe("meadow");
    expect(stockZone("hen")).toBe("farmstead");
  });
});

describe("retiring", () => {
  it("refunds nothing", () => {
    // Stated as a test rather than left implied by an absent branch: a refund
    // would make owned stock somewhere to park Gold and take it back out,
    // which is the one shape the whole subsystem is built not to have.
    expect(STACKACRES_RETIRE_REFUND).toBe(0);
  });
});
