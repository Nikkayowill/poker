import { cropFieldObstaclePlacements } from "./crop-field-obstacles";
import { isWildMapTile, mapToSoilTile } from "./hoeable";
import { isFenceableMapTile } from "./fences";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "./homestead-ground";
import { describe, expect, it } from "vitest";
import type { PlayerProfile } from "@/lib/profile/types";
import { STACKACRES_CATALOGUE } from "./catalogue";
import { stackacresStockPrice } from "./market";
import { HOME_SECTOR } from "./sectors";
import type { StackAcresUnitSnapshot } from "./units";
import { WATER_CAPACITY } from "./water-can";
import { SYNERGY_PERKS } from "./synergy-perks";
import { MACHINE_CATALOGUE } from "./machines";
import { RECIPE_CATALOGUE } from "./recipes";
import { STACKACRES_FEED } from "./catalogue";
import { toolUpgradePrice } from "./equipment";
import { applyInfluenceDiscount } from "./influence-tiers";
import {
  LAND_OBSTACLES,
  LAND_OBSTACLE_DEFS,
  LAND_SWING_ENERGY,
  landObstacleSnapshot,
} from "./land-clearing";
import {
  createsStackAcresUnit,
  isOptimisticUnitId,
  predictStackAcresAction,
  resolveOptimisticOutcome,
  unitIdsIn,
  withResolvedUnitIds,
  type FarmPredictContext,
  type MachineView,
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
    seed: false,
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
    water: WATER_CAPACITY,
    energy: { level: 100, updatedAt: NOW.toISOString() },
    capacity: {},
    seedStock: {},
    toolTier: "trowel",
    cutters: ["scythe"],
    sectors: [HOME_SECTOR],
    upkeep: { plots: 0, fee: 0, paidToday: 0, due: 0 },
    influence: 0,
    contract: null,
    synergyUnlocked: [],
    synergyActive: [],
    farmhandSpeedMultiplier: 1,
    secrets: { held: {}, boostArmed: false },
    secretDonations: {} as FarmPredictContext["secretDonations"],
    greenhouseBuilt: false,
    cropFieldsUnlocked: false,
    soilTiles: [],
    forageNodes: [],
    landObstacles: [],
    fences: [],
    inventory: {},
    wheatPlots: [],
    machines: [],
    nowMs: NOW.getTime(),
    ...overrides,
  };
}

function machine(overrides: Partial<MachineView> = {}): MachineView {
  return {
    id: "mill-1",
    kind: "mill",
    status: "idle",
    startedAt: null,
    readyAt: null,
    recipeId: null,
    unitsProcessing: 0,
    done: false,
    progress: null,
    autoFeedsLeft: null,
    standingRecipe: null,
    kitchenSince: null,
    canStart: false,
    ...overrides,
  };
}

describe("predictStackAcresAction: the processing track", () => {
  it("places a machine: debits its price, adds an idle row, keeps the open contract", () => {
    const contract = { id: "c1", status: "open" } as FarmPredictContext["contract"];
    const patch = predictStackAcresAction(
      { action: "place-machine", kind: "dairy" },
      ctx({ profile: profile({ goldBalance: 1000 }), contract, inventory: { milk: 3 } }),
    );
    expect(patch?.profile?.goldBalance).toBe(1000 - MACHINE_CATALOGUE.dairy.placeCost);
    expect(patch?.machines?.map((m) => m.kind)).toEqual(["dairy"]);
    // Re-derived off the shelf: three Milk is one Cheese batch.
    expect(patch?.machines?.[0].canStart).toBe(true);
    expect(patch?.contract).toBe(contract);
  });

  it("refuses a second machine of the same kind", () => {
    const patch = predictStackAcresAction(
      { action: "place-machine", kind: "mill" },
      ctx({ machines: [machine({ kind: "mill" })] }),
    );
    expect(patch).toBeNull();
  });

  it("runs an instant recipe through the shelf in one step", () => {
    const patch = predictStackAcresAction(
      { action: "process", recipe: "cheese" },
      ctx({ machines: [machine({ id: "d1", kind: "dairy", canStart: true })], inventory: { milk: 4 } }),
    );
    expect(patch?.inventory).toEqual({ milk: 1, cheese: 1 });
    expect(patch?.machines?.[0].status).toBe("idle");
    expect(patch?.machines?.[0].canStart).toBe(false);
  });

  it("queues a Mill run: the wheat leaves now, the row becomes the queue entry", () => {
    const patch = predictStackAcresAction(
      { action: "process", recipe: "flour" },
      ctx({ machines: [machine({ id: "m1", kind: "mill", canStart: true })], inventory: { wheat: 3 } }),
    );
    expect(patch?.inventory).toEqual({ wheat: 0 });
    const mill = patch?.machines?.[0];
    expect(mill?.status).toBe("working");
    expect(mill?.recipeId).toBe("flour");
    expect(mill?.unitsProcessing).toBe(RECIPE_CATALOGUE.flour.output.quantity);
    expect(Date.parse(mill!.readyAt!)).toBe(NOW.getTime() + RECIPE_CATALOGUE.flour.processingMs);
  });

  it("refuses a recipe with no idle machine of its kind or too little input", () => {
    expect(
      predictStackAcresAction({ action: "process", recipe: "cheese" }, ctx({ inventory: { milk: 9 } })),
    ).toBeNull();
    const busy = machine({ id: "m1", kind: "mill", status: "working" });
    expect(
      predictStackAcresAction({ action: "process", recipe: "flour" }, ctx({ machines: [busy], inventory: { wheat: 9 } })),
    ).toBeNull();
    expect(
      predictStackAcresAction(
        { action: "process", recipe: "cloth" },
        ctx({ machines: [machine({ id: "l1", kind: "loom" })], inventory: { wool: 3 } }),
      ),
    ).toBeNull();
  });

  it("sells: the goods leave the shelf at once, the Gold waits for the server", () => {
    const contract = { id: "c1", status: "open" } as FarmPredictContext["contract"];
    const patch = predictStackAcresAction(
      { action: "sell", item: "eggs", quantity: 3 },
      ctx({ inventory: { eggs: 5, milk: 2 }, contract }),
    );
    expect(patch?.inventory).toEqual({ eggs: 2, milk: 2 });
    expect(patch?.profile).toBeUndefined();
    // Goes through the processing patch, so the open contract is kept.
    expect(patch?.contract).toBe(contract);
  });

  it("refuses to sell more than the shelf holds", () => {
    expect(
      predictStackAcresAction({ action: "sell", item: "cake", quantity: 2 }, ctx({ inventory: { cake: 1 } })),
    ).toBeNull();
    expect(predictStackAcresAction({ action: "sell", item: "milk", quantity: 1 }, ctx())).toBeNull();
  });

  it("bakes a Cake on an idle Dairy, spending every input at once", () => {
    const patch = predictStackAcresAction(
      { action: "process", recipe: "cake" },
      ctx({ machines: [machine({ id: "d1", kind: "dairy" })], inventory: { eggs: 2, milk: 1, flour: 1 } }),
    );
    expect(patch?.inventory).toEqual({ eggs: 0, milk: 0, flour: 0, cake: 1 });
  });

  it("leaves work and the vat to the server", () => {
    const vatCtx = ctx({ machines: [machine({ id: "v1", kind: "vat" })], inventory: { cheese: 4 } });
    expect(predictStackAcresAction({ action: "work" }, vatCtx)).toBeNull();
    expect(predictStackAcresAction({ action: "seal-vat" }, vatCtx)).toBeNull();
    expect(predictStackAcresAction({ action: "collect-vat" }, vatCtx)).toBeNull();
  });
});

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

  it("spends one unit from the watering can", () => {
    const crop = unit({ id: "c1", stock: "carrot", state: "dry", thirstyAt: new Date(NOW.getTime() - 1000).toISOString() });
    const patch = predictStackAcresAction({ action: "water", unitId: crop.id }, ctx({ units: [crop], water: 4 }));
    expect(patch?.water).toBe(3);
  });

  it("refuses to water from an empty can", () => {
    const crop = unit({ id: "c1", stock: "carrot", state: "dry", thirstyAt: new Date(NOW.getTime() - 1000).toISOString() });
    expect(predictStackAcresAction({ action: "water", unitId: crop.id }, ctx({ units: [crop], water: 0 }))).toBeNull();
  });

  it("waters a whole group in one patch when unitIds names more than one", () => {
    const a = unit({ id: "c1", stock: "carrot", state: "dry", thirstyAt: new Date(NOW.getTime() - 1000).toISOString() });
    const b = unit({ id: "c2", stock: "carrot", state: "dry", thirstyAt: new Date(NOW.getTime() - 1000).toISOString() });
    const c = unit({ id: "c3", stock: "carrot", state: "dry", thirstyAt: new Date(NOW.getTime() - 1000).toISOString() });
    const patch = predictStackAcresAction(
      { action: "water", unitId: a.id, unitIds: [a.id, b.id, c.id] },
      ctx({ units: [a, b, c], water: 10 }),
    );
    expect(patch?.water).toBe(7);
    // All three moved past their old, already-dry thirstyAt.
    for (const before of [a, b, c]) {
      const after = patch?.units?.find((u) => u.id === before.id);
      expect(Date.parse(after?.thirstyAt ?? "")).toBeGreaterThan(NOW.getTime());
    }
  });

  it("clamps a group water to however much water is actually left", () => {
    const a = unit({ id: "c1", stock: "carrot", state: "dry", thirstyAt: new Date(NOW.getTime() - 1000).toISOString() });
    const b = unit({ id: "c2", stock: "carrot", state: "dry", thirstyAt: new Date(NOW.getTime() - 1000).toISOString() });
    const c = unit({ id: "c3", stock: "carrot", state: "dry", thirstyAt: new Date(NOW.getTime() - 1000).toISOString() });
    const patch = predictStackAcresAction(
      { action: "water", unitId: a.id, unitIds: [a.id, b.id, c.id] },
      ctx({ units: [a, b, c], water: 2 }),
    );
    expect(patch?.water).toBe(0);
    // A watered crop's thirstyAt moves into the future; only 2 of the 3
    // targets actually got poured on before the can ran dry.
    const stillDue = patch?.units?.filter((u) => Date.parse(u.thirstyAt ?? "") <= NOW.getTime()) ?? [];
    expect(stillDue).toHaveLength(1);
  });

  it("fills the can at the well, and guesses nothing for a can already full", () => {
    expect(predictStackAcresAction({ action: "draw-water" }, ctx({ water: 2 }))?.water).toBe(WATER_CAPACITY);
    expect(predictStackAcresAction({ action: "draw-water" }, ctx({ water: WATER_CAPACITY }))).toBeNull();
  });

  it("feeds a pen's hungry animals soonest-hungry first, one serving each", () => {
    const early = unit({ id: "h1", stock: "hen", state: "hungry", hungryAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() });
    const late = unit({ id: "h2", stock: "hen", state: "hungry", hungryAt: new Date(NOW.getTime() - 60_000).toISOString() });
    const fed = unit({ id: "h3", stock: "hen", state: "working" });
    const cow = unit({ id: "c1", stock: "cattle", state: "hungry" });
    const patch = predictStackAcresAction(
      { action: "feed-pen", zone: "henhaven" },
      ctx({ units: [late, fed, early, cow], feed: 1 }),
    );
    expect(patch?.feed).toBe(0);
    const byId = new Map(patch!.units!.map((u) => [u.id, u]));
    expect(Date.parse(byId.get("h1")!.hungryAt!)).toBeGreaterThan(NOW.getTime());
    // Out of feed after the first, and the fed hen and the cow in another pen
    // are left exactly as they were.
    expect(byId.get("h2")).toBe(late);
    expect(byId.get("h3")).toBe(fed);
    expect(byId.get("c1")).toBe(cow);
  });

  it("guesses nothing for a pen with no feed left or nobody hungry", () => {
    const hen = unit({ id: "h1", stock: "hen", state: "hungry" });
    expect(predictStackAcresAction({ action: "feed-pen", zone: "henhaven" }, ctx({ units: [hen], feed: 0 }))).toBeNull();
    expect(predictStackAcresAction({ action: "feed-pen", zone: "oxfields" }, ctx({ units: [hen], feed: 3 }))).toBeNull();
  });

  it("feeds hens Wheat first, then the Feed Sack, the same as the server", () => {
    const h1 = unit({ id: "h1", stock: "hen", state: "hungry", hungryAt: new Date(NOW.getTime() - 3 * 60_000).toISOString() });
    const h2 = unit({ id: "h2", stock: "hen", state: "hungry", hungryAt: new Date(NOW.getTime() - 2 * 60_000).toISOString() });
    const h3 = unit({ id: "h3", stock: "hen", state: "hungry", hungryAt: new Date(NOW.getTime() - 60_000).toISOString() });
    const patch = predictStackAcresAction(
      { action: "feed-pen", zone: "henhaven" },
      ctx({ units: [h1, h2, h3], feed: 1, inventory: { wheat: 1 } }),
    );
    // One Wheat, one Feed Sack serving, and the third hen goes without.
    expect(patch?.inventory?.wheat).toBe(0);
    expect(patch?.feed).toBe(0);
    const byId = new Map(patch!.units!.map((u) => [u.id, u]));
    expect(byId.get("h3")).toBe(h3);

    const single = predictStackAcresAction({ action: "feed", unitId: "h1" }, ctx({ units: [h1], feed: 0, inventory: { wheat: 2 } }));
    expect(single?.inventory?.wheat).toBe(1);
    expect(single?.feed).toBe(0);
  });

  it("feeds hens Spinach before Wheat, Lettuce and Cabbage", () => {
    const h1 = unit({ id: "h1", stock: "hen", state: "hungry", hungryAt: new Date(NOW.getTime() - 2 * 60_000).toISOString() });
    const h2 = unit({ id: "h2", stock: "hen", state: "hungry", hungryAt: new Date(NOW.getTime() - 60_000).toISOString() });
    const patch = predictStackAcresAction(
      { action: "feed-pen", zone: "henhaven" },
      ctx({ units: [h1, h2], feed: 0, inventory: { spinach: 1, lettuce: 3, cabbage: 1 } }),
    );
    expect(patch?.inventory).toMatchObject({ spinach: 0, lettuce: 2, cabbage: 1 });
    expect(patch?.feed).toBe(0);
  });

  it("spends a Radish on a baited cast and never guesses the fish", () => {
    const patch = predictStackAcresAction({ action: "catch-fish", bait: true }, ctx({ inventory: { radish: 2 } }));
    expect(patch?.inventory?.radish).toBe(1);
    expect(patch?.energy?.level).toBe(95);
    expect(patch?.inventory?.bluegill ?? 0).toBe(0);
    expect(predictStackAcresAction({ action: "catch-fish", bait: true }, ctx({ inventory: {} }))).toBeNull();
  });

  it("eats Bread for 20 energy and refuses when there is none or energy is full", () => {
    const hungry = { level: 30, updatedAt: NOW.toISOString() };
    const patch = predictStackAcresAction({ action: "eat", item: "bread" }, ctx({ energy: hungry, inventory: { bread: 2 } }));
    expect(patch?.energy?.level).toBe(50);
    expect(patch?.inventory?.bread).toBe(1);
    expect(predictStackAcresAction({ action: "eat", item: "bread" }, ctx({ energy: hungry, inventory: {} }))).toBeNull();
    expect(predictStackAcresAction({ action: "eat", item: "cake" }, ctx({ inventory: { cake: 1 } }))).toBeNull();
  });

  it("spends 5 energy on a landed cast and guesses nothing when too tired", () => {
    expect(predictStackAcresAction({ action: "catch-fish", bait: false }, ctx())?.energy?.level).toBe(95);
    expect(
      predictStackAcresAction({ action: "catch-fish", bait: false }, ctx({ energy: { level: 4, updatedAt: NOW.toISOString() } })),
    ).toBeNull();
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

  /** One plain bed, so an open-air crop has ground to stand on. */
  const ONE_BED = [{ tx: 0, ty: 0, order: 0, origin: "purchased" as const }];

  it("stocks a crop by spending a seed off the shelf, never Gold", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "corn" },
      ctx({ profile: profile({ goldBalance: 10_000 }), seedStock: { corn: 2 }, soilTiles: ONE_BED }),
    );
    expect(patch?.profile).toBeUndefined();
    expect(patch?.seedStock).toEqual({ corn: 1 });
    expect(patch?.units).toHaveLength(1);
    expect(patch?.units?.[0].permanent).toBe(false);
  });

  it("refuses to stock a crop with no seed on the shelf", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "corn" },
      ctx({ profile: profile({ goldBalance: 10_000 }), seedStock: {}, soilTiles: ONE_BED }),
    );
    expect(patch).toBeNull();
  });

  // The server refuses a crop with no free bed anywhere (2026-09-09), so a
  // sprout flashed here would only be yanked back a beat later.
  it("guesses nothing for a crop when no bed is free", () => {
    const bare = predictStackAcresAction(
      { action: "stock", stock: "corn" },
      ctx({ profile: profile({ goldBalance: 10_000 }), seedStock: { corn: 2 } }),
    );
    expect(bare).toBeNull();

    const standing = unit({ id: "c1", stock: "corn", state: "working", soilSlot: 0 });
    const full = predictStackAcresAction(
      { action: "stock", stock: "corn" },
      ctx({
        profile: profile({ goldBalance: 10_000 }),
        seedStock: { corn: 2 },
        soilTiles: ONE_BED,
        units: [standing],
      }),
    );
    expect(full).toBeNull();
  });

  // Regression: before this, a crop always guessed `soilSlot: null` and
  // scattered in the Crop Fields until the response landed, then visibly
  // jumped to its real tile -- see the "stock" case's own comment.
  it("plants a crop on the exact bed tapped, not scattered, when that bed is free", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "corn", tx: 0, ty: 0 },
      ctx({ profile: profile({ goldBalance: 10_000 }), seedStock: { corn: 2 }, soilTiles: ONE_BED }),
    );
    expect(patch?.units?.[0].soilSlot).toBe(0);
  });

  it("guesses nothing for a tapped bed that is already taken", () => {
    const standing = unit({ id: "c1", stock: "corn", state: "working", soilSlot: 0 });
    const twoBeds = [...ONE_BED, { tx: 1, ty: 0, order: 1, origin: "purchased" as const }];
    const patch = predictStackAcresAction(
      { action: "stock", stock: "corn", tx: 0, ty: 0 },
      ctx({
        profile: profile({ goldBalance: 10_000 }),
        seedStock: { corn: 2 },
        soilTiles: twoBeds,
        units: [standing],
      }),
    );
    expect(patch?.units?.[1].soilSlot).toBeNull();
  });

  it("predicts 75% of the grow time on an enriched bed and spends the enrichment", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "corn", tx: 0, ty: 0 },
      ctx({
        profile: profile({ goldBalance: 10_000 }),
        seedStock: { corn: 2 },
        soilTiles: [{ ...ONE_BED[0], enriched: true }],
      }),
    );
    const sown = patch?.units?.[0];
    expect(Date.parse(sown?.readyAt ?? "") - Date.parse(sown?.startedAt ?? "")).toBe(
      Math.round(STACKACRES_CATALOGUE.corn.durationMs * 0.75),
    );
    expect(patch?.soilTiles?.[0].enriched).toBe(false);
  });

  it("marks a bean's bed enriched when the bean is collected", () => {
    const bean = unit({ id: "b1", stock: "green_bean", state: "ready", soilSlot: 0 });
    const patch = predictStackAcresAction(
      { action: "collect", unitIds: ["b1"] },
      ctx({ soilTiles: ONE_BED, units: [bean] }),
    );
    expect(patch?.soilTiles?.[0].enriched).toBe(true);
  });

  it("still guesses a Greenhouse crop with no bed -- it stands on the glasshouse grid", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "corn", inGreenhouse: true },
      ctx({ profile: profile({ goldBalance: 10_000 }), seedStock: { corn: 2 }, greenhouseBuilt: true }),
    );
    expect(patch?.units).toHaveLength(1);
  });

  // Buying a crop outright plants it too, so the same bed rule applies.
  it("guesses nothing for a crop bought outright when no bed is free", () => {
    const price = stackacresStockPrice("corn");
    const bare = predictStackAcresAction(
      { action: "buy-stock", stock: "corn" },
      ctx({ profile: profile({ goldBalance: price }) }),
    );
    expect(bare).toBeNull();

    const patch = predictStackAcresAction(
      { action: "buy-stock", stock: "corn" },
      ctx({ profile: profile({ goldBalance: price }), soilTiles: ONE_BED }),
    );
    expect(patch?.units?.[0].permanent).toBe(true);
  });

  it("guesses nothing for a tier-1 crop, which is never sold outright", () => {
    // A free bed and Gold to spare, so neither of those is what refuses it --
    // tier 1 is simply off the outright shelf, and the server says so.
    const patch = predictStackAcresAction(
      { action: "buy-stock", stock: "carrot" },
      ctx({ profile: profile({ goldBalance: 100_000 }), soilTiles: ONE_BED }),
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

describe("predictStackAcresAction: laying a soil tile", () => {
  // The first square out in the wild land with no overgrowth dealt onto it, off the real map.
  const inFields = (() => {
    const standing = new Set(cropFieldObstaclePlacements().map((p) => `${p.tx},${p.ty}`));
    for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my++) {
      for (let mx = 0; mx < HOMESTEAD_MAP_WIDTH; mx++) {
        if (isWildMapTile(mx, my) && !standing.has(`${mx},${my}`)) return mapToSoilTile(mx, my);
      }
    }
    throw new Error("no clear wild square on the Homestead");
  })();

  it("lays the bed, and clears the Crop Fields with it", () => {
    const patch = predictStackAcresAction(
      { action: "place-soil-tile", tx: inFields.tx, ty: inFields.ty },
      ctx(),
    );
    expect(patch?.soilTiles).toHaveLength(1);
    // Breaking the first ground out there IS the unlock, so the browser shows
    // it straight away rather than waiting for the round trip.
    expect(patch?.cropFieldsUnlocked).toBe(true);
  });

  it("does not claim the Crop Fields for a bed laid in the yard", () => {
    const yard = (() => {
      for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my++) {
        for (let mx = 0; mx < HOMESTEAD_MAP_WIDTH; mx++) {
          if (isFenceableMapTile(mx, my) && !isWildMapTile(mx, my)) return mapToSoilTile(mx, my);
        }
      }
      throw new Error("no yard grass on the Homestead");
    })();
    const patch = predictStackAcresAction({ action: "place-soil-tile", tx: yard.tx, ty: yard.ty }, ctx());
    expect(patch?.soilTiles).toHaveLength(1);
    expect(patch?.cropFieldsUnlocked).toBe(false);
  });

  it("refuses a coordinate that already has a bed", () => {
    const bed = { tx: inFields.tx, ty: inFields.ty, order: 0, origin: "purchased" as const };
    expect(
      predictStackAcresAction(
        { action: "place-soil-tile", tx: inFields.tx, ty: inFields.ty },
        ctx({ soilTiles: [bed] }),
      ),
    ).toBeNull();
  });
});

describe("predictStackAcresAction: the Crop Fields' overgrowth", () => {
  const [first] = cropFieldObstaclePlacements();
  const square = mapToSoilTile(first.tx, first.ty);

  it("does not flash a bed where something still stands", () => {
    expect(predictStackAcresAction({ action: "place-soil-tile", ...square }, ctx())).toBeNull();
  });

  it("breaks the bed once that obstacle is down", () => {
    const obstacle = LAND_OBSTACLES.cropfields.find((o) => o.id === first.id)!;
    const down = landObstacleSnapshot(obstacle, { hitsRemaining: 0, clearedAt: NOW.toISOString() });
    const patch = predictStackAcresAction({ action: "place-soil-tile", ...square }, ctx({ landObstacles: [down] }));
    expect(patch?.soilTiles).toHaveLength(1);
  });
});

describe("predictStackAcresAction: removing a soil tile", () => {
  const bedA = { tx: 0, ty: 0, order: 0, origin: "purchased" as const };
  const bedB = { tx: 1, ty: 0, order: 1, origin: "purchased" as const };

  it("drops the tile and refuses on bare ground", () => {
    const patch = predictStackAcresAction(
      { action: "remove-soil-tile", tx: 0, ty: 0 },
      ctx({ soilTiles: [bedA] }),
    );
    expect(patch?.soilTiles).toEqual([]);
    expect(predictStackAcresAction({ action: "remove-soil-tile", tx: 9, ty: 9 }, ctx({ soilTiles: [bedA] }))).toBeNull();
  });

  it("takes the crop standing on that tile with it, and leaves an unrelated one alone", () => {
    const onBedA = unit({ id: "crop-a", stock: "corn", soilSlot: 0 });
    const onBedB = unit({ id: "crop-b", stock: "wheat", soilSlot: 1 });
    const patch = predictStackAcresAction(
      { action: "remove-soil-tile", tx: 0, ty: 0 },
      ctx({ soilTiles: [bedA, bedB], units: [onBedA, onBedB] }),
    );
    expect(patch?.soilTiles).toEqual([bedB]);
    expect(patch?.units).toEqual([onBedB]);
  });

  it("does not touch the unit list when the lifted bed was bare", () => {
    const elsewhere = unit({ id: "crop-b", stock: "wheat", soilSlot: 1 });
    const patch = predictStackAcresAction(
      { action: "remove-soil-tile", tx: 0, ty: 0 },
      ctx({ soilTiles: [bedA, bedB], units: [elsewhere] }),
    );
    expect(patch?.units).toBeUndefined();
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

  it("removes a crop that ripened on this device's clock since the list last moved", () => {
    // The last response said "working"; its readyAt has passed since.
    const ripened = unit({ id: "c1", stock: "carrot", state: "working", progress: 0.9, hungryAt: null });
    const stillGrowing = unit({
      id: "c2",
      stock: "carrot",
      state: "working",
      hungryAt: null,
      readyAt: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    const tapped = predictStackAcresAction(
      { action: "collect", unitIds: [ripened.id] },
      ctx({ units: [ripened, stillGrowing] }),
    );
    expect(tapped?.units).toEqual([stillGrowing]);
    const sweep = predictStackAcresAction({ action: "collect" }, ctx({ units: [ripened, stillGrowing] }));
    expect(sweep?.units).toEqual([stillGrowing]);
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

  /**
   * The three purchases Town Favor discounts have to predict the SAME number
   * the server charges, or a farm past rung 1 watches its Gold drop too far
   * and snap back on its commonest purchases. Pinned against
   * applyInfluenceDiscount itself rather than a literal, so the ladder can be
   * retuned without editing arithmetic into this file.
   */
  describe("Town Favor discounted purchases predict what the server charges", () => {
    const RICH = 1_000_000;

    it("discounts a tool upgrade", () => {
      const listed = toolUpgradePrice("trowel");
      expect(listed).not.toBeNull();
      const patch = predictStackAcresAction(
        { action: "upgrade-tool" },
        ctx({ profile: profile({ goldBalance: RICH }), toolTier: "trowel", influence: 300 }),
      );
      expect(patch?.profile?.goldBalance).toBe(RICH - applyInfluenceDiscount(listed!, 300));
    });

    it("discounts the feed unit before multiplying by quantity", () => {
      const item = STACKACRES_FEED.feed_sack;
      const patch = predictStackAcresAction(
        { action: "buy-feed", itemId: "feed_sack", quantity: 3 },
        ctx({ profile: profile({ goldBalance: RICH }), influence: 300 }),
      );
      // buyStackAcresFeed's own order: floor the unit, then multiply.
      expect(patch?.profile?.goldBalance).toBe(RICH - applyInfluenceDiscount(item.cost, 300) * 3);
    });

    it("leaves a stake alone -- sowing a cycle is not shopping", () => {
      const patch = predictStackAcresAction(
        { action: "stock", stock: "hen" },
        ctx({
          profile: profile({ goldBalance: RICH }),
          influence: 750,
          capacity: { hen: 4 },
          sectors: [HOME_SECTOR],
        }),
      );
      // Full seedCost, undiscounted, at the top rung of the ladder.
      expect(patch?.profile?.goldBalance).toBe(RICH - STACKACRES_CATALOGUE.hen.seedCost);
    });
  });

  it("buys the Mower once and leaves the spade alone", () => {
    const patch = predictStackAcresAction(
      { action: "buy-cutter", cutter: "mower" },
      ctx({ profile: profile({ goldBalance: 1_000_000 }) }),
    );
    expect(patch?.cutters).toEqual(["scythe", "mower"]);
    expect(patch?.tool).toBeUndefined();
    expect(patch?.profile?.goldBalance).toBeLessThan(1_000_000);

    const again = predictStackAcresAction(
      { action: "buy-cutter", cutter: "mower" },
      ctx({ profile: profile({ goldBalance: 1_000_000 }), cutters: ["scythe", "mower"] }),
    );
    expect(again).toBeNull();
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

describe("provisional unit ids", () => {
  it("tells an id this browser invented from one the server issued", () => {
    const patch = predictStackAcresAction(
      { action: "stock", stock: "hen" },
      ctx({ profile: profile({ goldBalance: 10_000 }) }),
    );
    const planted = patch?.units?.at(-1);
    expect(planted).toBeDefined();
    expect(isOptimisticUnitId(planted!.id)).toBe(true);
    expect(isOptimisticUnitId("6d3a1f2e-0b4c-4a7f-9c11-2f8e5d6b7a90")).toBe(false);
  });

  it("names the two actions that make a unit", () => {
    expect(createsStackAcresUnit({ action: "stock", stock: "hen" })).toBe(true);
    expect(createsStackAcresUnit({ action: "buy-stock", stock: "hen" })).toBe(true);
    expect(createsStackAcresUnit({ action: "water", unitId: "u1" })).toBe(false);
  });

  it("reads every unit id an action names", () => {
    expect(unitIdsIn({ action: "feed", unitId: "u1" })).toEqual(["u1"]);
    expect(unitIdsIn({ action: "water", unitId: "u1", unitIds: ["u1", "u2"] })).toEqual(["u1", "u1", "u2"]);
    expect(unitIdsIn({ action: "collect" })).toEqual([]);
    expect(unitIdsIn({ action: "draw-water" })).toEqual([]);
  });
});

describe("withResolvedUnitIds", () => {
  const swap = (id: string) => (id === "provisional" ? "real" : id);

  it("re-points a single-target action", () => {
    expect(withResolvedUnitIds({ action: "water", unitId: "provisional" }, swap)).toEqual({
      action: "water",
      unitId: "real",
    });
    expect(withResolvedUnitIds({ action: "clear", unitId: "provisional" }, swap)).toEqual({
      action: "clear",
      unitId: "real",
    });
  });

  it("refuses a single-target action whose unit never resolved", () => {
    expect(withResolvedUnitIds({ action: "feed", unitId: "provisional" }, () => null)).toBeNull();
  });

  it("waters what it can when only part of a block resolved", () => {
    expect(
      withResolvedUnitIds(
        { action: "water", unitId: "u1", unitIds: ["u1", "u2", "provisional"] },
        (id) => (id === "provisional" ? null : id),
      ),
    ).toEqual({ action: "water", unitId: "u1", unitIds: ["u1", "u2"] });
  });

  it("drops the group when it wears down to one crop, since the route takes two or more", () => {
    expect(
      withResolvedUnitIds({ action: "water", unitId: "u1", unitIds: ["u1", "provisional"] }, (id) =>
        id === "provisional" ? null : id,
      ),
    ).toEqual({ action: "water", unitId: "u1" });
  });

  it("stands a group drop on a surviving crop when its own anchor fell away", () => {
    expect(
      withResolvedUnitIds({ action: "water", unitId: "provisional", unitIds: ["provisional", "u2", "u3"] }, (id) =>
        id === "provisional" ? null : id,
      ),
    ).toEqual({ action: "water", unitId: "u2", unitIds: ["u2", "u3"] });
  });

  it("keeps a whole-farm collect exactly as it was", () => {
    expect(withResolvedUnitIds({ action: "collect" }, swap)).toEqual({ action: "collect" });
  });

  it("refuses a collect with nothing left to bring in", () => {
    expect(withResolvedUnitIds({ action: "collect", unitIds: ["provisional"] }, () => null)).toBeNull();
  });

  it("leaves an action that names no unit alone", () => {
    expect(withResolvedUnitIds({ action: "draw-water" }, swap)).toEqual({ action: "draw-water" });
  });
});

describe("clearing land", () => {
  const tree = LAND_OBSTACLES.wallow.find((obstacle) => obstacle.kind === "tree")!;
  const def = LAND_OBSTACLE_DEFS.tree;

  /** Every obstacle on the Fold down except `standing`. */
  function foldAllButOne(standingId: string) {
    return LAND_OBSTACLES.wallow.map((obstacle) =>
      obstacle.id === standingId
        ? landObstacleSnapshot(obstacle, { hitsRemaining: 1, clearedAt: null })
        : landObstacleSnapshot(obstacle, { hitsRemaining: 0, clearedAt: NOW.toISOString() }),
    );
  }

  it("spends energy, pays the barn and counts the swing down", () => {
    const patch = predictStackAcresAction(
      { action: "work-land", obstacleId: tree.id },
      ctx({ energy: { level: 50, updatedAt: NOW.toISOString() } }),
    );
    expect(patch?.energy?.level).toBe(50 - LAND_SWING_ENERGY);
    expect(patch?.inventory?.wood).toBe(def.perHit);
    const guessed = patch?.landObstacles?.find((obstacle) => obstacle.id === tree.id);
    expect(guessed?.hitsRemaining).toBe(def.hits - 1);
    expect(guessed?.cleared).toBe(false);
    // No Gold moves on the way to owning land.
    expect(patch?.profile).toBeUndefined();
  });

  it("refuses a swing nobody has the energy for", () => {
    const flat = ctx({ energy: { level: 1, updatedAt: NOW.toISOString() } });
    expect(predictStackAcresAction({ action: "work-land", obstacleId: tree.id }, flat)).toBeNull();
  });

  it("refuses a swing at something already down", () => {
    const down = ctx({
      landObstacles: [landObstacleSnapshot(tree, { hitsRemaining: 0, clearedAt: NOW.toISOString() })],
    });
    expect(predictStackAcresAction({ action: "work-land", obstacleId: tree.id }, down)).toBeNull();
  });

  it("refuses an obstacle that is not on the map", () => {
    expect(predictStackAcresAction({ action: "work-land", obstacleId: "nowhere-99" }, ctx())).toBeNull();
  });

  it("opens the sector on the swing that takes the last one down, for no Gold", () => {
    const last = LAND_OBSTACLES.wallow[0];
    const patch = predictStackAcresAction(
      { action: "work-land", obstacleId: last.id },
      ctx({ landObstacles: foldAllButOne(last.id) }),
    );
    expect(patch?.sectors).toContain("wallow");
    expect(patch?.profile).toBeUndefined();
  });

  it("leaves the sector shut while anything is still standing", () => {
    const patch = predictStackAcresAction({ action: "work-land", obstacleId: tree.id }, ctx());
    expect(patch?.sectors).toBeUndefined();
  });
});

describe("predictStackAcresAction: fences", () => {
  // Open yard grass (./homestead-ground.ts): hoeable, not out in the wild land.
  const grass = (() => {
    for (let ty = 0; ty < HOMESTEAD_MAP_HEIGHT; ty++) {
      for (let tx = 0; tx < HOMESTEAD_MAP_WIDTH; tx++) {
        if (isFenceableMapTile(tx, ty) && !isWildMapTile(tx, ty)) return { tx, ty };
      }
    }
    throw new Error("no yard grass on the Homestead");
  })();

  it("puts the piece up and takes its Wood under the finger", () => {
    const patch = predictStackAcresAction({ action: "place-fence", ...grass }, ctx({ inventory: { wood: 5 } }));
    expect(patch?.fences).toEqual([grass]);
    expect(patch?.inventory?.wood).toBe(3);
  });

  it("guesses nothing it cannot pay for", () => {
    expect(predictStackAcresAction({ action: "place-fence", ...grass }, ctx({ inventory: { wood: 1 } }))).toBeNull();
  });

  it("gives the Wood back as the piece comes down", () => {
    const patch = predictStackAcresAction({ action: "remove-fence", ...grass }, ctx({ fences: [grass], inventory: { wood: 0 } }));
    expect(patch?.fences).toEqual([]);
    expect(patch?.inventory?.wood).toBe(2);
  });
});
