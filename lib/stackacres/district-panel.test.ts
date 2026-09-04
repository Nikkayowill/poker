import { describe, expect, it } from "vitest";
import { buyOptionsForZone, occupiedCountFor, unitRowAction } from "./district-panel";
import type { StackAcresUnitSnapshot } from "./units";

function unit(overrides: Partial<StackAcresUnitSnapshot> = {}): StackAcresUnitSnapshot {
  return {
    id: "u1",
    state: "working",
    stock: "hen",
    stake: 25,
    yieldQuantity: 4,
    startedAt: "2026-09-04T00:00:00.000Z",
    readyAt: "2026-09-04T00:15:00.000Z",
    progress: 0.2,
    hungryAt: null,
    thirstyAt: null,
    isWatered: true,
    muckFee: null,
    permanent: false,
    ...overrides,
  };
}

describe("unitRowAction", () => {
  it("a dry crop offers water, and can never be refused for want of a resource", () => {
    // Nothing in context can turn this into a disabled button: watering is
    // free, which is the one way it differs from feeding.
    expect(unitRowAction(unit({ state: "dry", stock: "sprout" }), { feed: 0, gold: 0 })).toEqual({
      kind: "water",
    });
    expect(unitRowAction(unit({ state: "dry", stock: "sprout" }), { feed: 99, gold: 99_999 })).toEqual({
      kind: "water",
    });
  });

  it("a ready unit offers collect", () => {
    expect(unitRowAction(unit({ state: "ready" }), { feed: 0, gold: 0 })).toEqual({ kind: "collect" });
  });

  it("a hungry unit offers feed, blocked without feed on hand", () => {
    expect(unitRowAction(unit({ state: "hungry" }), { feed: 0, gold: 0 })).toEqual({
      kind: "feed",
      disabled: true,
      reason: "No feed left in the barn.",
    });
    expect(unitRowAction(unit({ state: "hungry" }), { feed: 2, gold: 0 })).toEqual({
      kind: "feed",
      disabled: false,
      reason: null,
    });
  });

  it("a mucked unit offers clear, blocked without enough Gold", () => {
    const mucked = unit({ state: "mucked", muckFee: 22 });
    expect(unitRowAction(mucked, { feed: 0, gold: 10 })).toEqual({
      kind: "clear",
      fee: 22,
      disabled: true,
      reason: "Clearing costs 22 Gold.",
    });
    expect(unitRowAction(mucked, { feed: 0, gold: 22 })).toEqual({
      kind: "clear",
      fee: 22,
      disabled: false,
      reason: null,
    });
  });

  it("a permanent working unit offers retire; a growing seeded one offers nothing", () => {
    expect(unitRowAction(unit({ state: "working", permanent: true }), { feed: 0, gold: 0 })).toEqual({
      kind: "retire",
    });
    expect(unitRowAction(unit({ state: "working", permanent: false }), { feed: 0, gold: 0 })).toEqual({
      kind: "none",
    });
  });
});

describe("occupiedCountFor", () => {
  it("counts working, hungry AND mucked -- a mucked unit still holds its slot", () => {
    const units = [
      unit({ id: "a", state: "working" }),
      unit({ id: "b", state: "hungry" }),
      unit({ id: "c", state: "mucked", muckFee: 22 }),
      unit({ id: "d", stock: "cattle", state: "ready" }),
    ];
    expect(occupiedCountFor(units, "hen")).toBe(3);
    expect(occupiedCountFor(units, "cattle")).toBe(1);
  });
});

describe("buyOptionsForZone", () => {
  it("lists only the stock kinds that live in this district", () => {
    const options = buyOptionsForZone("farmstead", { units: [], gold: 1000, capacity: {} });
    expect(options.map((o) => o.stock)).toEqual(["hen"]);
  });

  it("caps at 3 by default and offers an expand option once full", () => {
    const units = [unit({ id: "a" }), unit({ id: "b" }), unit({ id: "c" })];
    const [hen] = buyOptionsForZone("farmstead", { units, gold: 1000, capacity: {} });
    expect(hen.owned).toBe(3);
    expect(hen.cap).toBe(3);
    expect(hen.atCap).toBe(true);
    expect(hen.expand).not.toBeNull();
  });

  it("never offers to expand a kind that isn't full yet", () => {
    // Caught by an actual browser run, not by a test: this used to check only
    // whether extra slots were maxed, so a brand-new farm with nothing owned
    // at all offered "Expand capacity" before the free cap was ever reached.
    const [emptyHen] = buyOptionsForZone("farmstead", { units: [], gold: 1000, capacity: {} });
    expect(emptyHen.atCap).toBe(false);
    expect(emptyHen.expand).toBeNull();

    const twoOwned = [unit({ id: "a" }), unit({ id: "b" })];
    const [almostFull] = buyOptionsForZone("farmstead", { units: twoOwned, gold: 1000, capacity: {} });
    expect(almostFull.atCap).toBe(false);
    expect(almostFull.expand).toBeNull();
  });

  it("a purchased extra slot raises the cap and clears atCap", () => {
    const units = [unit({ id: "a" }), unit({ id: "b" }), unit({ id: "c" })];
    const [hen] = buyOptionsForZone("farmstead", { units, gold: 1000, capacity: { hen: 1 } });
    expect(hen.cap).toBe(4);
    expect(hen.atCap).toBe(false);
    // Not offered again either -- the fourth slot the player just bought has
    // room in it, so there is nothing to expand yet.
    expect(hen.expand).toBeNull();
  });

  it("expand disappears once the extra-slot ceiling is reached, even while genuinely full", () => {
    const units = [unit({ id: "a" }), unit({ id: "b" }), unit({ id: "c" }), unit({ id: "d" }), unit({ id: "e" }), unit({ id: "f" })];
    const [hen] = buyOptionsForZone("farmstead", { units, gold: 0, capacity: { hen: 3 } });
    expect(hen.cap).toBe(6);
    expect(hen.atCap).toBe(true);
    expect(hen.expand).toBeNull();
  });

  it("seedReason names the Gold cost when short, and the cap when full", () => {
    const [short] = buyOptionsForZone("farmstead", { units: [], gold: 0, capacity: {} });
    expect(short.seedReason).toMatch(/Gold/);
    const units = [unit({ id: "a" }), unit({ id: "b" }), unit({ id: "c" })];
    const [full] = buyOptionsForZone("farmstead", { units, gold: 1000, capacity: {} });
    expect(full.seedReason).toMatch(/full/);
  });
});
