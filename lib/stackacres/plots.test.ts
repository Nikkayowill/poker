import { describe, expect, it } from "vitest";
import { STACKACRES_CATALOGUE, STACKACRES_FREE_PLOTS, stackacresPlotPrice } from "./catalogue";
import { STACKACRES_STOCK, STACKACRES_YIELDS, netPerCycle, yieldValue } from "./items";
import {
  hungryAtFor,
  isStackAcresPlotHungry,
  isStackAcresPlotReady,
  toStackAcresPlotSnapshots,
  type StackAcresPlotRow,
} from "./plots";

const T0 = new Date("2026-08-31T12:00:00.000Z");
const CATTLE = STACKACRES_CATALOGUE.cattle;

function workingRow(over: Partial<StackAcresPlotRow> = {}): StackAcresPlotRow {
  return {
    plotIndex: 1,
    status: "working",
    stock: "cattle",
    stake: CATTLE.seedCost,
    yieldQuantity: STACKACRES_YIELDS.cattle.quantity,
    startedAt: T0.toISOString(),
    readyAt: new Date(T0.getTime() + CATTLE.durationMs).toISOString(),
    lastFedAt: T0.toISOString(),
    muckFee: null,
    version: 1,
    ...over,
  };
}

describe("the grid", () => {
  it("gives free plots and a locked ladder when nothing is owned", () => {
    const plots = toStackAcresPlotSnapshots([], T0);
    expect(plots).toHaveLength(16);
    for (let i = 0; i < STACKACRES_FREE_PLOTS; i += 1) {
      expect(plots[i].state).toBe("empty");
      expect(plots[i].unlockPrice).toBeNull();
    }
    expect(plots[STACKACRES_FREE_PLOTS].state).toBe("locked");
    expect(plots[STACKACRES_FREE_PLOTS].unlockPrice).toBe(stackacresPlotPrice(STACKACRES_FREE_PLOTS + 1));
  });

  it("marks exactly one locked plot buyable, the cheapest unowned one", () => {
    const plots = toStackAcresPlotSnapshots([], T0);
    expect(plots.filter((plot) => plot.purchasable)).toHaveLength(1);
    expect(plots.find((plot) => plot.purchasable)?.plotIndex).toBe(STACKACRES_FREE_PLOTS + 1);
  });

  it("surfaces a mucked plot with its fee and nothing else", () => {
    const [plot] = toStackAcresPlotSnapshots(
      [workingRow({ status: "mucked", stock: null, stake: null, yieldQuantity: null, startedAt: null, readyAt: null, lastFedAt: null, muckFee: 100 })],
      T0,
    );
    expect(plot.state).toBe("mucked");
    expect(plot.muckFee).toBe(100);
    expect(plot.purchasable).toBe(false);
  });
});

describe("readiness", () => {
  it("is not ready before its own timestamp", () => {
    const row = workingRow();
    const justBefore = new Date(Date.parse(row.readyAt as string) - 1000);
    expect(isStackAcresPlotReady(row, justBefore)).toBe(false);
  });

  it("is ready on the timestamp, given it has been fed", () => {
    const row = workingRow({ lastFedAt: new Date(T0.getTime() + CATTLE.durationMs).toISOString() });
    expect(isStackAcresPlotReady(row, new Date(Date.parse(row.readyAt as string)))).toBe(true);
  });

  it("is never ready while hungry, however long its timer says it ran", () => {
    // Fed once at T0 and never again: hungry long before the 24h cycle ends.
    const row = workingRow();
    const wayPast = new Date(T0.getTime() + CATTLE.durationMs + 60_000);
    expect(isStackAcresPlotHungry(row, wayPast)).toBe(true);
    expect(isStackAcresPlotReady(row, wayPast)).toBe(false);
    expect(toStackAcresPlotSnapshots([row], wayPast)[0].state).toBe("hungry");
  });
});

describe("hunger", () => {
  it("falls due one hunger window after the last feed", () => {
    const row = workingRow();
    expect(hungryAtFor(row)).toBe(new Date(T0.getTime() + (CATTLE.hungerMs ?? 0)).toISOString());
  });

  it("never falls due for a crop, which does not eat", () => {
    const row = workingRow({ stock: "sprout", lastFedAt: null });
    expect(hungryAtFor(row)).toBeNull();
    expect(isStackAcresPlotHungry(row, new Date(T0.getTime() + 99 * 60 * 60 * 1000))).toBe(false);
  });

  it("never falls due inside a Hen Coop's own cycle", () => {
    // The cheapest animal is deliberately fire-and-forget; if this ever fails,
    // the tier that new players start on has quietly grown a chore.
    const hen = STACKACRES_CATALOGUE.hen;
    expect(hen.hungerMs).not.toBeNull();
    expect(hen.hungerMs as number).toBeGreaterThan(hen.durationMs);
  });
});

describe("the catalogue's own arithmetic", () => {
  it("leaves every tier worth planting, and none of them a Gold path", () => {
    // Bushels, not Gold, so a multiple here is not a money printer the way it
    // was -- but a tier that costs more than it yields is a trap, and a tier
    // that yields wildly more than the rest is where a grinder would live.
    for (const stock of STACKACRES_STOCK) {
      const def = STACKACRES_CATALOGUE[stock];
      expect(netPerCycle(stock, def.seedCost)).toBeGreaterThan(0);
    }
    const ratios = STACKACRES_STOCK.map(
      (stock) => yieldValue(stock) / STACKACRES_CATALOGUE[stock].seedCost,
    );
    expect(Math.max(...ratios)).toBeLessThan(2.5);
  });

  it("keeps the expected muck cost at 40% of what the plot earned, on every tier", () => {
    // The rule the flat-fee version of this got wrong: a single fee across
    // tiers an order of magnitude apart makes the cheapest one permanently
    // negative.
    for (const stock of STACKACRES_STOCK) {
      const def = STACKACRES_CATALOGUE[stock];
      const net = netPerCycle(stock, def.seedCost);
      expect(def.muckFee).toBeGreaterThanOrEqual(net * 2 - 1);
      expect(def.muckFee).toBeLessThanOrEqual(net * 2 + 1);
    }
  });

  it("doubles the acreage price per tile and sells nothing outside the grid", () => {
    expect(stackacresPlotPrice(STACKACRES_FREE_PLOTS)).toBeNull();
    expect(stackacresPlotPrice(17)).toBeNull();
    expect(stackacresPlotPrice(STACKACRES_FREE_PLOTS + 1)).toBe(2_500);
    expect(stackacresPlotPrice(STACKACRES_FREE_PLOTS + 2)).toBe(5_000);
  });
});
