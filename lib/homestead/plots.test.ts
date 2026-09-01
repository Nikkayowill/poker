import { describe, expect, it } from "vitest";
import { HOMESTEAD_CATALOGUE, HOMESTEAD_FREE_PLOTS, homesteadPlotPrice } from "./catalogue";
import {
  hungryAtFor,
  isHomesteadPlotHungry,
  isHomesteadPlotReady,
  toHomesteadPlotSnapshots,
  type HomesteadPlotRow,
} from "./plots";

const T0 = new Date("2026-08-31T12:00:00.000Z");
const CATTLE = HOMESTEAD_CATALOGUE.cattle;

function workingRow(over: Partial<HomesteadPlotRow> = {}): HomesteadPlotRow {
  return {
    plotIndex: 1,
    status: "working",
    stock: "cattle",
    stake: CATTLE.stake,
    payout: CATTLE.payout,
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
    const plots = toHomesteadPlotSnapshots([], T0);
    expect(plots).toHaveLength(16);
    for (let i = 0; i < HOMESTEAD_FREE_PLOTS; i += 1) {
      expect(plots[i].state).toBe("empty");
      expect(plots[i].unlockPrice).toBeNull();
    }
    expect(plots[HOMESTEAD_FREE_PLOTS].state).toBe("locked");
    expect(plots[HOMESTEAD_FREE_PLOTS].unlockPrice).toBe(homesteadPlotPrice(HOMESTEAD_FREE_PLOTS + 1));
  });

  it("marks exactly one locked plot buyable, the cheapest unowned one", () => {
    const plots = toHomesteadPlotSnapshots([], T0);
    expect(plots.filter((plot) => plot.purchasable)).toHaveLength(1);
    expect(plots.find((plot) => plot.purchasable)?.plotIndex).toBe(HOMESTEAD_FREE_PLOTS + 1);
  });

  it("surfaces a mucked plot with its fee and nothing else", () => {
    const [plot] = toHomesteadPlotSnapshots(
      [workingRow({ status: "mucked", stock: null, stake: null, payout: null, startedAt: null, readyAt: null, lastFedAt: null, muckFee: 100 })],
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
    expect(isHomesteadPlotReady(row, justBefore)).toBe(false);
  });

  it("is ready on the timestamp, given it has been fed", () => {
    const row = workingRow({ lastFedAt: new Date(T0.getTime() + CATTLE.durationMs).toISOString() });
    expect(isHomesteadPlotReady(row, new Date(Date.parse(row.readyAt as string)))).toBe(true);
  });

  it("is never ready while hungry, however long its timer says it ran", () => {
    // Fed once at T0 and never again: hungry long before the 24h cycle ends.
    const row = workingRow();
    const wayPast = new Date(T0.getTime() + CATTLE.durationMs + 60_000);
    expect(isHomesteadPlotHungry(row, wayPast)).toBe(true);
    expect(isHomesteadPlotReady(row, wayPast)).toBe(false);
    expect(toHomesteadPlotSnapshots([row], wayPast)[0].state).toBe("hungry");
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
    expect(isHomesteadPlotHungry(row, new Date(T0.getTime() + 99 * 60 * 60 * 1000))).toBe(false);
  });

  it("never falls due inside a Hen Coop's own cycle", () => {
    // The cheapest animal is deliberately fire-and-forget; if this ever fails,
    // the tier that new players start on has quietly grown a chore.
    const hen = HOMESTEAD_CATALOGUE.hen;
    expect(hen.hungerMs).not.toBeNull();
    expect(hen.hungerMs as number).toBeGreaterThan(hen.durationMs);
  });
});

describe("the catalogue's own arithmetic", () => {
  it("pays a flat bonus on every tier, never a multiple of the stake", () => {
    // What stops this being a money printer: the bonus cannot scale with how
    // much a player is able to stake.
    const bonuses = Object.values(HOMESTEAD_CATALOGUE).map((def) => def.payout - def.stake);
    expect(bonuses.every((bonus) => bonus > 0)).toBe(true);
    const ratios = Object.values(HOMESTEAD_CATALOGUE).map((def) => def.payout / def.stake);
    expect(Math.max(...ratios)).toBeLessThan(1.1);
  });

  it("doubles the acreage price per tile and sells nothing outside the grid", () => {
    expect(homesteadPlotPrice(HOMESTEAD_FREE_PLOTS)).toBeNull();
    expect(homesteadPlotPrice(17)).toBeNull();
    expect(homesteadPlotPrice(HOMESTEAD_FREE_PLOTS + 1)).toBe(2_500);
    expect(homesteadPlotPrice(HOMESTEAD_FREE_PLOTS + 2)).toBe(5_000);
  });
});
