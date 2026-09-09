import { describe, expect, it } from "vitest";
import type { PlayerProfile } from "@/lib/profile/types";
import { STACKACRES_CATALOGUE } from "./catalogue";
import { stackacresStockPrice } from "./market";
import { HOME_SECTOR } from "./sectors";
import type { StackAcresUnitSnapshot } from "./units";
import { SYNERGY_PERKS } from "./synergy-perks";
import {
  predictStackAcresAction,
  resolveOptimisticOutcome,
  type FarmPredictContext,
} from "./optimistic-actions";

const NOW = new Date("2026-09-05T12:00:00.000Z");

function profile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return { id: "p1", goldBalance: 100_000, unlimitedGold: false, ...overrides } as PlayerProfile;
}

function unit(overrides: Partial<StackAcresUnitSnapshot> = {}): StackAcresUnitSnapshot {
  return {
    id: "unit-1",
    state: "hungry",
    stock: "hen",
    stake: 25,
    yieldQuantity: 4,
    startedAt: new Date(NOW.getTime() - 20 * 60 * 1000).toISOString(),
    readyAt: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
    progress: 1,
    hungryAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
    thirstyAt: null,
    isWatered: true,
    muckFee: null,
    permanent: false,
    housedIn: null,
    soilSlot: null,
    ...overrides,
  };
}

function ctx(overrides: Partial<FarmPredictContext> = {}): FarmPredictContext {
  const p = overrides.profile === undefined ? profile() : overrides.profile;
  return {
    profile: p,
    goldBalance: p?.goldBalance ?? 0,
    unlimitedGold: p?.unlimitedGold ?? false,
    units: [],
    feed: 5,
    capacity: {},
    seedStock: {},
    toolTier: "trowel",
    sectors: [HOME_SECTOR],
    upkeep: { plots: 0, fee: 0, paidToday: 0, due: 0 },
    influence: 0,
    contract: null,
    synergyUnlocked: [],
    synergyActive: [],
    farmhandSpeedMultiplier: 1,
    secrets: { held: {}, boostArmed: false },
    secretDonations: {} as FarmPredictContext["secretDonations"],
    merchantVisit: null,
    greenhouseBuilt: false,
    cropFieldsUnlocked: false,
    nowMs: NOW.getTime(),
    ...overrides,
  };
}

describe("predictStackAcresAction: feed/water/clear", () => {
  it("feeds a hungry unit and spends one serving", () => {
    const hen = unit({ state: "hungry" });
    const patch = predictStackAcresAction(
      { action: "feed", unitId: hen.id },
      ctx({ units: [hen], feed: 3 }),
    );
    expect(patch?.feed).toBe(2);
    expect(patch?.units?.[0].id).toBe(hen.id);
    expect(Date.parse(patch!.units![0].hungryAt!)).toBeGreaterThan(NOW.getTime());
  });

  it("refuses to feed with no servings in the barn", () => {
    const hen = unit({ state: "hungry" });
    const patch = predictStackAcresAction({ action: "feed", unitId: hen.id }, ctx({ units: [hen], feed: 0 }));
    expect(patch).toBeNull();
  });

  it("waters a dry crop without touching Gold", () => {
    const crop = unit({ id: "c1", stock: "carrot", state: "dry", thirstyAt: new Date(NOW.getTime() - 1000).toISOString() });
    const patch = predictStackAcresAction({ action: "water", unitId: crop.id }, ctx({ units: [crop] }));
    expect(patch?.units?.[0].id).toBe(crop.id);
    expect(patch?.profile).toBeUndefined();
  });

  it("clears a mucked unit and debits its fee", () => {
    const mucked = unit({ id: "m1", state: "mucked", muckFee: 200 });
    const patch = predictStackAcresAction(
      { action: "clear", unitId: mucked.id },
      ctx({ units: [mucked], profile: profile({ goldBalance: 1000 }) }),
    );
    expect(patch?.units).toEqual([]);
    expect(patch?.profile?.goldBalance).toBe(800);
  });

  it("refuses to clear without enough Gold for the fee", () => {
    const mucked = unit({ id: "m1", state: "mucked", muckFee: 200 });
    const patch = predictStackAcresAction(
      { action: "clear", unitId: mucked.id },
      ctx({ units: [mucked], profile: profile({ goldBalance: 50 }) }),
    );
    expect(patch).toBeNull();
  });

  it("an admin with unlimited Gold is never refused on a debit", () => {
    const mucked = unit({ id: "m1", state: "mucked", muckFee: 999_999 });
    const patch = predictStackAcresAction(
      { action: "clear", unitId: mucked.id },
      ctx({ units: [mucked], profile: profile({ goldBalance: 0, unlimitedGold: true }) }),
    );
    expect(patch?.profile?.goldBalance).toBe(0);
  });
});

describe("predictStackAcresAction: buying and selling stock", () => {
  it("stocks a fresh crop, debiting the seed price and adding a working row", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "hen" },
      ctx({ profile: profile({ goldBalance: 10_000 }) }),
    );
    expect(patch?.profile?.goldBalance).toBe(10_000 - STACKACRES_CATALOGUE.hen.seedCost);
    expect(patch?.units).toHaveLength(1);
    expect(patch?.units?.[0].permanent).toBe(false);
    expect(patch?.units?.[0].state).toBe("working");
  });

  it("buys a unit outright at the outright price, permanent", () => {
    const price = stackacresStockPrice("hen");
    const patch = predictStackAcresAction(
      { action: "buy-stock", stock: "hen" },
      ctx({ profile: profile({ goldBalance: price }) }),
    );
    expect(patch?.profile?.goldBalance).toBe(0);
    expect(patch?.units?.[0].permanent).toBe(true);
  });

  it("refuses to stock without enough Gold", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "cattle" },
      ctx({ profile: profile({ goldBalance: 1 }) }),
    );
    expect(patch).toBeNull();
  });

  it("stocks a crop by spending a seed off the shelf, never Gold", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "corn" },
      ctx({ profile: profile({ goldBalance: 10_000 }), seedStock: { corn: 2 } }),
    );
    expect(patch?.profile).toBeUndefined();
    expect(patch?.seedStock).toEqual({ corn: 1 });
    expect(patch?.units).toHaveLength(1);
    expect(patch?.units?.[0].permanent).toBe(false);
  });

  it("refuses to stock a crop with no seed on the shelf", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "corn" },
      ctx({ profile: profile({ goldBalance: 10_000 }), seedStock: {} }),
    );
    expect(patch).toBeNull();
  });

  it("retires a permanent unit with no refund", () => {
    const owned = unit({ id: "o1", permanent: true, state: "working" });
    const patch = predictStackAcresAction(
      { action: "retire", unitId: owned.id },
      ctx({ units: [owned], profile: profile({ goldBalance: 500 }) }),
    );
    expect(patch?.units).toEqual([]);
    expect(patch?.profile).toBeUndefined();
  });

  it("refuses to retire a unit that was never bought outright", () => {
    const sown = unit({ id: "s1", permanent: false, state: "working" });
    const patch = predictStackAcresAction({ action: "retire", unitId: sown.id }, ctx({ units: [sown] }));
    expect(patch).toBeNull();
  });
});

describe("predictStackAcresAction: collect", () => {
  it("removes a ready one-cycle unit, moving no Gold", () => {
    const ready = unit({ id: "r1", state: "ready", permanent: false });
    const patch = predictStackAcresAction(
      { action: "collect", unitIds: [ready.id] },
      ctx({ units: [ready] }),
    );
    expect(patch?.units).toEqual([]);
    expect(patch?.profile).toBeUndefined();
  });

  it("restarts a ready permanent unit instead of removing it", () => {
    const ready = unit({ id: "r1", state: "ready", permanent: true });
    const patch = predictStackAcresAction(
      { action: "collect", unitIds: [ready.id] },
      ctx({ units: [ready] }),
    );
    expect(patch?.units).toHaveLength(1);
    expect(patch?.units?.[0].id).toBe(ready.id);
    expect(patch?.units?.[0].state).toBe("working");
    expect(patch?.units?.[0].progress).toBe(0);
  });

  it("a whole-farm sweep (no unitIds) takes every ready unit", () => {
    const a = unit({ id: "a", state: "ready" });
    const b = unit({ id: "b", state: "ready" });
    const stillGrowing = unit({ id: "c", state: "working" });
    const patch = predictStackAcresAction({ action: "collect" }, ctx({ units: [a, b, stillGrowing] }));
    expect(patch?.units).toEqual([stillGrowing]);
  });

  it("refuses when nothing named is actually ready", () => {
    const growing = unit({ id: "g1", state: "working" });
    const patch = predictStackAcresAction(
      { action: "collect", unitIds: [growing.id] },
      ctx({ units: [growing] }),
    );
    expect(patch).toBeNull();
  });
});

describe("predictStackAcresAction: the rest of the shop", () => {
  it("expands capacity for one stock kind", () => {
    const patch = predictStackAcresAction(
      { action: "expand-capacity", stock: "hen" },
      ctx({ profile: profile({ goldBalance: 50_000 }), capacity: { hen: 1 } }),
    );
    expect(patch?.capacity).toEqual({ hen: 2 });
    expect(patch?.profile?.goldBalance).toBeLessThan(50_000);
  });

  it("upgrades the tool one rung and refuses at the top", () => {
    const patch = predictStackAcresAction(
      { action: "upgrade-tool" },
      ctx({ profile: profile({ goldBalance: 1_000_000 }), toolTier: "trowel" }),
    );
    expect(patch?.tool).toBe("iron-shovel");

    const atTop = predictStackAcresAction(
      { action: "upgrade-tool" },
      ctx({ profile: profile({ goldBalance: 1_000_000 }), toolTier: "golden-spade" }),
    );
    expect(atTop).toBeNull();
  });

  it("unlocks a synergy perk once, never twice", () => {
    const archetype = Object.keys(SYNERGY_PERKS)[0] as keyof typeof SYNERGY_PERKS;
    const patch = predictStackAcresAction(
      { action: "unlock-synergy-perk", archetype },
      ctx({ profile: profile({ goldBalance: 1_000_000 }) }),
    );
    expect(patch?.synergy?.unlocked).toEqual([archetype]);

    const already = predictStackAcresAction(
      { action: "unlock-synergy-perk", archetype },
      ctx({ profile: profile({ goldBalance: 1_000_000 }), synergyUnlocked: [archetype] }),
    );
    expect(already).toBeNull();
  });

  it("activates a perk into the next open slot only", () => {
    const archetype = Object.keys(SYNERGY_PERKS)[0] as keyof typeof SYNERGY_PERKS;
    const patch = predictStackAcresAction(
      { action: "activate-synergy-perk", archetype, slot: 0 },
      ctx({ synergyUnlocked: [archetype] }),
    );
    expect(patch?.synergy?.active).toEqual([archetype]);

    // Skipping ahead to slot 1 with nothing in slot 0 is refused.
    const skip = predictStackAcresAction(
      { action: "activate-synergy-perk", archetype, slot: 1 },
      ctx({ synergyUnlocked: [archetype] }),
    );
    expect(skip).toBeNull();
  });

  it("donates a held secret item exactly once", () => {
    const patch = predictStackAcresAction(
      { action: "donate-secret-item", itemId: "lucky_poker_dice" },
      ctx({ secrets: { held: { lucky_poker_dice: 1 }, boostArmed: false } }),
    );
    expect(patch?.secrets?.held.lucky_poker_dice).toBeUndefined();
    expect(patch?.secretDonations?.lucky_poker_dice).toBe(true);
  });

  it("refuses to consume a second boost while one is already armed", () => {
    const patch = predictStackAcresAction(
      { action: "consume-secret-item", itemId: "lucky_poker_dice" },
      ctx({ secrets: { held: { lucky_poker_dice: 1 }, boostArmed: true } }),
    );
    expect(patch).toBeNull();
  });

  it("builds the Greenhouse once", () => {
    const patch = predictStackAcresAction({ action: "build-greenhouse" }, ctx());
    expect(patch?.greenhouseBuilt).toBe(true);
    expect(predictStackAcresAction({ action: "build-greenhouse" }, ctx({ greenhouseBuilt: true }))).toBeNull();
  });
});

describe("predictStackAcresAction: dice rolls stay unpredicted", () => {
  it.each([
    { action: "tap-secret-zone", zoneId: "wishing-well" } as const,
    { action: "request-contract" } as const,
    { action: "work" } as const,
  ])("returns null for %o", (body) => {
    expect(predictStackAcresAction(body, ctx())).toBeNull();
  });
});

describe("resolveOptimisticOutcome", () => {
  it("reconciles on success", () => {
    expect(resolveOptimisticOutcome({ ok: true, hasJsonBody: true })).toBe("reconcile");
  });
  it("restores then overlays the refusal's own round on a clean refusal", () => {
    expect(resolveOptimisticOutcome({ ok: false, hasJsonBody: true })).toBe("restore-refusal");
  });
  it("restores and refetches when the outcome is unknown", () => {
    expect(resolveOptimisticOutcome({ ok: false, hasJsonBody: false })).toBe("restore-and-refetch");
  });
});
