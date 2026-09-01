import { describe, expect, it } from "vitest";
import { MINT_FREE_PLOTS, MINT_GRID_PLOTS, mintPlotPrice } from "./nodes";
import { isMintPlotRipe, toMintPlotSnapshots, type MintPlotRow } from "./plots";

const T0 = new Date("2026-08-31T12:00:00.000Z");

function growingRow(plotIndex: number, plantedAt: Date, maturesAt: Date): MintPlotRow {
  return {
    plotIndex,
    status: "growing",
    nodeType: "hen",
    stake: 1000,
    payout: 1050,
    plantedAt: plantedAt.toISOString(),
    maturesAt: maturesAt.toISOString(),
    version: 2,
  };
}

function emptyRow(plotIndex: number): MintPlotRow {
  return {
    plotIndex,
    status: "empty",
    nodeType: null,
    stake: null,
    payout: null,
    plantedAt: null,
    maturesAt: null,
    version: 1,
  };
}

describe("the plot ladder", () => {
  it("gives the free plots and out-of-grid indexes no price", () => {
    for (let index = 1; index <= MINT_FREE_PLOTS; index += 1) expect(mintPlotPrice(index)).toBeNull();
    expect(mintPlotPrice(MINT_GRID_PLOTS + 1)).toBeNull();
    expect(mintPlotPrice(0)).toBeNull();
  });

  it("doubles per tile from 2,500 up to the last tile", () => {
    expect(mintPlotPrice(MINT_FREE_PLOTS + 1)).toBe(2_500);
    expect(mintPlotPrice(MINT_FREE_PLOTS + 2)).toBe(5_000);
    expect(mintPlotPrice(MINT_GRID_PLOTS)).toBe(2_500 * 2 ** (MINT_GRID_PLOTS - MINT_FREE_PLOTS - 1));
  });
});

describe("the empty treasury", () => {
  it("renders free plots empty and the rest locked, with one purchasable", () => {
    const plots = toMintPlotSnapshots([], T0);
    expect(plots).toHaveLength(MINT_GRID_PLOTS);
    for (const plot of plots.slice(0, MINT_FREE_PLOTS)) {
      expect(plot.state).toBe("empty");
      expect(plot.unlockPrice).toBeNull();
    }
    for (const plot of plots.slice(MINT_FREE_PLOTS)) {
      expect(plot.state).toBe("locked");
      expect(plot.unlockPrice).toBe(mintPlotPrice(plot.plotIndex));
    }
    expect(plots.filter((plot) => plot.purchasable).map((plot) => plot.plotIndex)).toEqual([
      MINT_FREE_PLOTS + 1,
    ]);
  });

  it("moves the purchasable marker past owned plots", () => {
    const plots = toMintPlotSnapshots([emptyRow(MINT_FREE_PLOTS + 1)], T0);
    expect(plots[MINT_FREE_PLOTS].state).toBe("empty");
    expect(plots.filter((plot) => plot.purchasable).map((plot) => plot.plotIndex)).toEqual([
      MINT_FREE_PLOTS + 2,
    ]);
  });
});

describe("growth", () => {
  const matures = new Date(T0.getTime() + 15 * 60 * 1000);

  it("is growing with a fractional percentage mid-timer", () => {
    const now = new Date(T0.getTime() + 6 * 60 * 1000);
    const [plot] = toMintPlotSnapshots([growingRow(1, T0, matures)], now);
    expect(plot.state).toBe("growing");
    expect(plot.growthPercent).toBeCloseTo(0.4, 5);
    expect(plot.nodeType).toBe("hen");
    expect(plot.payout).toBe(1050);
  });

  it("turns ripe at exactly the maturity instant, not one tick before", () => {
    const row = growingRow(1, T0, matures);
    const justBefore = new Date(matures.getTime() - 1);
    const atMaturity = new Date(matures.getTime());

    expect(isMintPlotRipe(row, justBefore)).toBe(false);
    expect(toMintPlotSnapshots([row], justBefore)[0].state).toBe("growing");

    expect(isMintPlotRipe(row, atMaturity)).toBe(true);
    const [ripe] = toMintPlotSnapshots([row], atMaturity);
    expect(ripe.state).toBe("ripe");
    expect(ripe.growthPercent).toBe(1);
  });

  it("never reports an empty or absent plot as ripe", () => {
    expect(isMintPlotRipe(emptyRow(1), new Date(matures.getTime() + 1))).toBe(false);
    const [unplanted] = toMintPlotSnapshots([emptyRow(1)], T0);
    expect(unplanted.state).toBe("empty");
    expect(unplanted.growthPercent).toBeNull();
  });
});
