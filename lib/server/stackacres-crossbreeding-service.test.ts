import { beforeEach, describe, expect, it, vi } from "vitest";
import { STACKACRES_CATALOGUE } from "@/lib/stackacres/catalogue";
import {
  getCrossbreedBedPlotSnapshot,
  harvestCrossbreedBed,
  plantCrossbreedBed,
} from "./stackacres-crossbreeding-service";
import {
  __resetStackAcresCrossbreedForTest,
  getStackAcresCrossbreedPlot,
  readStackAcresCrossbreedInventory,
} from "./stackacres-crossbreeding-store";

const PROFILE = "profile-1";
const NOW = new Date("2026-09-05T00:00:00.000Z");

beforeEach(() => {
  __resetStackAcresCrossbreedForTest();
});

describe("plantCrossbreedBed", () => {
  it("snapshots readyAt from the catalogue's own durationMs", async () => {
    const plot = await plantCrossbreedBed(PROFILE, 0, 0, "sprout", NOW);
    expect(plot).not.toBeNull();
    expect(plot?.startedAt).toBe(NOW.toISOString());
    expect(Date.parse(plot!.readyAt) - NOW.getTime()).toBe(STACKACRES_CATALOGUE.sprout.durationMs);
  });

  it("refuses a second plant on an already-occupied cell", async () => {
    await plantCrossbreedBed(PROFILE, 1, 1, "sprout", NOW);
    const second = await plantCrossbreedBed(PROFILE, 1, 1, "cash_crop", NOW);
    expect(second).toBeNull();
  });

  it("throws for a coordinate outside the fixed 4x4 bed", async () => {
    await expect(plantCrossbreedBed(PROFILE, 4, 0, "sprout", NOW)).rejects.toThrow(/outside the bed/);
  });
});

describe("harvestCrossbreedBed", () => {
  it("returns null for a plot id that does not exist", async () => {
    expect(await harvestCrossbreedBed(PROFILE, "ghost", NOW)).toBeNull();
  });

  it("returns null for a plot that has not ripened yet", async () => {
    const plot = await plantCrossbreedBed(PROFILE, 0, 0, "sprout", NOW);
    const stillGrowing = new Date(NOW.getTime() + STACKACRES_CATALOGUE.sprout.durationMs - 1);
    expect(await harvestCrossbreedBed(PROFILE, plot!.id, stillGrowing)).toBeNull();
  });

  it("harvests a lone ripe plot plainly when nothing qualifies to cross", async () => {
    const plot = await plantCrossbreedBed(PROFILE, 0, 0, "sprout", NOW);
    const ripe = new Date(NOW.getTime() + STACKACRES_CATALOGUE.sprout.durationMs);

    const roll = vi.spyOn(Math, "random").mockReturnValue(0); // would hit any real chance
    const settlement = await harvestCrossbreedBed(PROFILE, plot!.id, ripe);
    roll.mockRestore();

    expect(settlement).toEqual({ clearedPlotIds: [plot!.id], hybridItem: null, hybridQuantity: null });
    expect(await getStackAcresCrossbreedPlot(PROFILE, plot!.id)).toBeNull();
  });

  it("clears both rows and credits the hybrid on a successful cross", async () => {
    const a = await plantCrossbreedBed(PROFILE, 0, 0, "sprout", NOW);
    const b = await plantCrossbreedBed(PROFILE, 0, 1, "cash_crop", NOW);
    const ripeAt = new Date(
      NOW.getTime() + Math.max(STACKACRES_CATALOGUE.sprout.durationMs, STACKACRES_CATALOGUE.cash_crop.durationMs),
    );

    const roll = vi.spyOn(Math, "random").mockReturnValue(0); // guarantee the roll hits
    const settlement = await harvestCrossbreedBed(PROFILE, a!.id, ripeAt);
    roll.mockRestore();

    expect(settlement?.hybridItem).toBe("golden_maize");
    expect(settlement?.hybridQuantity).toBe(1);
    expect([...(settlement?.clearedPlotIds ?? [])].sort()).toEqual([a!.id, b!.id].sort());
    expect(await getStackAcresCrossbreedPlot(PROFILE, a!.id)).toBeNull();
    expect(await getStackAcresCrossbreedPlot(PROFILE, b!.id)).toBeNull();

    const inventory = await readStackAcresCrossbreedInventory(PROFILE);
    expect(inventory.golden_maize).toBe(1);
  });

  it("misses the roll and leaves the neighbor growing, crediting nothing", async () => {
    const a = await plantCrossbreedBed(PROFILE, 0, 0, "sprout", NOW);
    const b = await plantCrossbreedBed(PROFILE, 0, 1, "cash_crop", NOW);
    const ripeAt = new Date(
      NOW.getTime() + Math.max(STACKACRES_CATALOGUE.sprout.durationMs, STACKACRES_CATALOGUE.cash_crop.durationMs),
    );

    const roll = vi.spyOn(Math, "random").mockReturnValue(0.999); // guarantee the roll misses
    const settlement = await harvestCrossbreedBed(PROFILE, a!.id, ripeAt);
    roll.mockRestore();

    expect(settlement).toEqual({ clearedPlotIds: [a!.id], hybridItem: null, hybridQuantity: null });
    expect(await getStackAcresCrossbreedPlot(PROFILE, a!.id)).toBeNull();
    // The neighbor was never touched: still there, still growing.
    expect(await getStackAcresCrossbreedPlot(PROFILE, b!.id)).not.toBeNull();

    const inventory = await readStackAcresCrossbreedInventory(PROFILE);
    expect(inventory.golden_maize ?? 0).toBe(0);
  });

  it("accumulates a second hybrid credit onto the first player's running total", async () => {
    // First cross.
    const a1 = await plantCrossbreedBed(PROFILE, 0, 0, "sprout", NOW);
    const b1 = await plantCrossbreedBed(PROFILE, 0, 1, "cash_crop", NOW);
    const ripeAt = new Date(
      NOW.getTime() + Math.max(STACKACRES_CATALOGUE.sprout.durationMs, STACKACRES_CATALOGUE.cash_crop.durationMs),
    );
    let roll = vi.spyOn(Math, "random").mockReturnValue(0);
    await harvestCrossbreedBed(PROFILE, a1!.id, ripeAt);
    roll.mockRestore();

    // Second cross, different cells.
    const a2 = await plantCrossbreedBed(PROFILE, 2, 2, "sprout", NOW);
    const b2 = await plantCrossbreedBed(PROFILE, 2, 3, "cash_crop", NOW);
    roll = vi.spyOn(Math, "random").mockReturnValue(0);
    const settlement = await harvestCrossbreedBed(PROFILE, a2!.id, ripeAt);
    roll.mockRestore();

    expect(settlement?.hybridQuantity).toBe(2);
    void b1;
    void b2;
  });
});

describe("getCrossbreedBedPlotSnapshot", () => {
  it("returns null for an unknown plot", async () => {
    expect(await getCrossbreedBedPlotSnapshot(PROFILE, "ghost", NOW)).toBeNull();
  });

  it("reports readiness against the given clock without mutating anything", async () => {
    const plot = await plantCrossbreedBed(PROFILE, 3, 3, "cattle", NOW);
    const before = await getCrossbreedBedPlotSnapshot(PROFILE, plot!.id, NOW);
    expect(before).toEqual({ id: plot!.id, row: 3, col: 3, stock: "cattle", ready: false });

    const ripe = new Date(NOW.getTime() + STACKACRES_CATALOGUE.cattle.durationMs);
    const after = await getCrossbreedBedPlotSnapshot(PROFILE, plot!.id, ripe);
    expect(after?.ready).toBe(true);

    // Still there -- a snapshot read never harvests.
    expect(await getStackAcresCrossbreedPlot(PROFILE, plot!.id)).not.toBeNull();
  });
});
