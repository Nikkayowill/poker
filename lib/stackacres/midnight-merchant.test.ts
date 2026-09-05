import { describe, expect, it } from "vitest";
import {
  MIDNIGHT_MERCHANT_CATALOG,
  MIDNIGHT_MERCHANT_TRANSITION_MS,
  MIDNIGHT_MERCHANT_URGENT_MS,
  MidnightMerchantManager,
  catalogEntry,
  isMidnightMerchantItemId,
  priceForNextPurchase,
  priceLadder,
  shouldSpawnMidnightMerchantOnCriticalHarvest,
  type MidnightMerchantSnapshot,
} from "./midnight-merchant";

function visit(overrides: Partial<MidnightMerchantSnapshot> = {}): MidnightMerchantSnapshot {
  return {
    trigger: "critical_harvest",
    spawnedAtIso: "2026-09-05T00:00:00.000Z",
    expiresAtIso: "2026-09-05T00:20:00.000Z",
    purchaseStreak: 0,
    stock: [{ itemId: "moonlit_lantern", basePrice: 1_200, remaining: 3 }],
    ...overrides,
  };
}

describe("priceForNextPurchase", () => {
  it("charges exactly the base price for the first item of a visit", () => {
    expect(priceForNextPurchase(1_200, 0)).toBe(1_200);
  });

  it("grows by exactly 20% per already-sold item, rounded up", () => {
    expect(priceForNextPurchase(1_200, 1)).toBe(1_440);
    expect(priceForNextPurchase(1_200, 2)).toBe(1_728);
    expect(priceForNextPurchase(1_200, 3)).toBe(2_074); // 2073.6 rounds up
  });

  it("never rounds a fractional Gold cost down", () => {
    // 1000 * 1.2^1 = 1200 exactly, but 1000 * 1.2^2 = 1440 exactly too --
    // pick a base price whose ladder actually lands on a fraction.
    expect(priceForNextPurchase(999, 1)).toBe(Math.ceil(999 * 1.2));
    expect(priceForNextPurchase(999, 1)).toBeGreaterThanOrEqual(999 * 1.2);
  });

  it("rejects a non-positive or non-integer base price", () => {
    expect(() => priceForNextPurchase(0, 0)).toThrow();
    expect(() => priceForNextPurchase(-5, 0)).toThrow();
    expect(() => priceForNextPurchase(1.5, 0)).toThrow();
  });

  it("rejects a negative or non-integer streak", () => {
    expect(() => priceForNextPurchase(100, -1)).toThrow();
    expect(() => priceForNextPurchase(100, 1.5)).toThrow();
  });
});

describe("priceLadder", () => {
  it("matches priceForNextPurchase at every rung, starting from streak 0", () => {
    const ladder = priceLadder(1_200, 4);
    expect(ladder).toEqual([
      priceForNextPurchase(1_200, 0),
      priceForNextPurchase(1_200, 1),
      priceForNextPurchase(1_200, 2),
      priceForNextPurchase(1_200, 3),
    ]);
  });

  it("is strictly increasing", () => {
    const ladder = priceLadder(500, 5);
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    }
  });
});

describe("the catalog", () => {
  it("has a lookup entry for every listed item id", () => {
    for (const entry of MIDNIGHT_MERCHANT_CATALOG) {
      expect(catalogEntry(entry.itemId)).toEqual(entry);
    }
  });

  it("rejects an id that is not on the catalog", () => {
    expect(isMidnightMerchantItemId("not_a_real_item")).toBe(false);
    // @ts-expect-error -- deliberately an invalid id, exercising the runtime guard.
    expect(() => catalogEntry("not_a_real_item")).toThrow();
  });
});

describe("shouldSpawnMidnightMerchantOnCriticalHarvest", () => {
  it("is a pure function of the injected RNG, not of global Math.random", () => {
    expect(shouldSpawnMidnightMerchantOnCriticalHarvest(() => 0)).toBe(true);
    expect(shouldSpawnMidnightMerchantOnCriticalHarvest(() => 0.999)).toBe(false);
  });
});

describe("MidnightMerchantManager", () => {
  it("starts absent, with nothing rendered or interactive", () => {
    const manager = new MidnightMerchantManager();
    expect(manager.snapshot()).toEqual({
      state: "absent",
      msRemaining: 0,
      urgent: false,
      visit: null,
    });
    expect(manager.isRendered()).toBe(false);
    expect(manager.isInteractive()).toBe(false);
  });

  it("plays an arrival transition the first time a visit appears", () => {
    const manager = new MidnightMerchantManager();
    const now = new Date("2026-09-05T00:00:00.000Z");
    manager.applySnapshot(visit(), now);

    expect(manager.snapshot().state).toBe("arriving");
    expect(manager.isRendered()).toBe(true);
    // Mid-transition: visible, but not yet tappable.
    expect(manager.isInteractive()).toBe(false);

    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);
    expect(manager.snapshot().state).toBe("present");
    expect(manager.isInteractive()).toBe(true);
  });

  it("ages msRemaining down every tick, clamped at zero", () => {
    const manager = new MidnightMerchantManager();
    const now = new Date("2026-09-05T00:00:00.000Z");
    manager.applySnapshot(visit({ expiresAtIso: "2026-09-05T00:00:05.000Z" }), now);
    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS); // settle into "present" -- also ages the clock
    expect(manager.snapshot().msRemaining).toBe(5_000 - MIDNIGHT_MERCHANT_TRANSITION_MS);

    manager.tick(1_000);
    expect(manager.snapshot().msRemaining).toBe(5_000 - MIDNIGHT_MERCHANT_TRANSITION_MS - 1_000);

    manager.tick(10_000);
    expect(manager.snapshot().msRemaining).toBe(0);
  });

  it("marks urgent only once real time left drops under the urgent threshold", () => {
    const manager = new MidnightMerchantManager();
    const now = new Date("2026-09-05T00:00:00.000Z");
    const expiresAtIso = new Date(now.getTime() + MIDNIGHT_MERCHANT_URGENT_MS + 5_000).toISOString();
    manager.applySnapshot(visit({ expiresAtIso }), now);
    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);

    expect(manager.snapshot().urgent).toBe(false);
    manager.tick(6_000); // now under the urgent threshold
    expect(manager.snapshot().urgent).toBe(true);
  });

  it("re-applying the SAME visit (by spawnedAtIso) updates numbers with no transition replay", () => {
    const manager = new MidnightMerchantManager();
    const now = new Date("2026-09-05T00:00:00.000Z");
    manager.applySnapshot(visit({ purchaseStreak: 0 }), now);
    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);
    expect(manager.snapshot().state).toBe("present");

    manager.applySnapshot(visit({ purchaseStreak: 1 }), now);
    // Same spawnedAtIso as before -- no new arrival animation, and the
    // fresher purchaseStreak is reflected immediately.
    expect(manager.snapshot().state).toBe("present");
    expect(manager.snapshot().visit?.purchaseStreak).toBe(1);
  });

  it("plays a departure transition when the visit goes away", () => {
    const manager = new MidnightMerchantManager();
    const now = new Date("2026-09-05T00:00:00.000Z");
    manager.applySnapshot(visit(), now);
    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);

    manager.applySnapshot(null, now);
    expect(manager.snapshot().state).toBe("departing");
    expect(manager.isInteractive()).toBe(false);
    // Still drawn mid-departure, so the animation has something to animate.
    expect(manager.isRendered()).toBe(true);

    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);
    expect(manager.snapshot().state).toBe("absent");
    expect(manager.isRendered()).toBe(false);
  });

  it("starts its own departure locally once msRemaining hits zero, before the next snapshot confirms it", () => {
    const manager = new MidnightMerchantManager();
    const now = new Date("2026-09-05T00:00:00.000Z");
    manager.applySnapshot(visit({ expiresAtIso: "2026-09-05T00:00:02.000Z" }), now);
    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);
    expect(manager.snapshot().state).toBe("present");

    manager.tick(2_000);
    // Nothing from the server yet, but the local clock already ran out.
    expect(manager.snapshot().state).toBe("departing");
    // Cleared immediately, not merely once the animation finishes -- a
    // storefront still reading this prop must stop offering purchases from
    // a visit this client's own clock has already decided is over.
    expect(manager.snapshot().visit).toBeNull();

    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);
    // Settles at "absent", not a phantom re-arrival of the same expired
    // visit -- see tick()'s own doc comment on why clearing `visit` above
    // (rather than waiting for a server-confirmed applySnapshot(null)) is
    // what keeps this from looping.
    expect(manager.snapshot().state).toBe("absent");
  });

  it("replaces one expired visit with a new one via a full departure-then-arrival, never a snap", () => {
    const manager = new MidnightMerchantManager();
    const now = new Date("2026-09-05T00:00:00.000Z");
    manager.applySnapshot(visit({ spawnedAtIso: "2026-09-04T23:00:00.000Z" }), now);
    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);
    expect(manager.snapshot().state).toBe("present");

    // A different visit lands in the same poll gap -- different spawnedAtIso.
    manager.applySnapshot(visit({ spawnedAtIso: "2026-09-05T00:00:00.000Z" }), now);
    expect(manager.snapshot().state).toBe("departing");
    // The replacement visit is already on file mid-departure -- it is what
    // is rendered once the departure finishes, not thrown away.
    expect(manager.snapshot().visit?.spawnedAtIso).toBe("2026-09-05T00:00:00.000Z");

    // The departure finishing rolls straight into that new visit's own
    // arrival, never settling at "absent" while a visit is actually
    // confirmed live.
    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);
    expect(manager.snapshot().state).toBe("arriving");
    expect(manager.isRendered()).toBe(true);

    manager.tick(MIDNIGHT_MERCHANT_TRANSITION_MS);
    expect(manager.snapshot().state).toBe("present");
    expect(manager.isInteractive()).toBe(true);
  });
});
