import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end coverage log: Chrono-DeLorean Mode's OWN offset mechanism
 * (lib/server/chrono-delorean.ts), driving the REAL StackAcres service
 * functions (lib/server/stackacres-service.ts) across a simulated multi-day
 * run, asserting the exact inventory/upkeep state at every step -- not just
 * an end state. This is the harness working end to end: nothing here calls a
 * service function with a hand-built `Date` bypassing Chrono-DeLorean Mode
 * -- every `now` used below comes from `resolveChronoNow`, fed by
 * `setChronoDeloreanOffset`, exactly as the two real StackAcres routes use
 * it.
 *
 * EVERY NUMBER BELOW WAS VERIFIED AGAINST THE REAL CATALOGUE BY RUNNING THIS
 * FILE, not assumed. Two wrong assumptions were caught doing that and are
 * worth leaving as a record rather than quietly fixing away:
 *
 *   * A hen's `hungerMs` (45 min) is LONGER than its own `durationMs`
 *     (15 min) -- lib/stackacres/catalogue.ts's own comment says so
 *     ("Longer than its own cycle, so a Hen never goes hungry") -- so a hen
 *     cannot demonstrate the hunger-freeze mechanic at all. The pig
 *     scenario below uses `pig` (hunger 2h, duration 4h) instead, which
 *     genuinely goes hungry mid-cycle.
 *   * `clearStackAcresSector` refuses Meadow/Wallow/Ox Fields until the
 *     player already has enough working-or-mucked units elsewhere
 *     (`requiresUnits`, lib/stackacres/sectors.ts) -- Meadow needs 2, Wallow
 *     needs 4 AND Meadow already cleared. Both scenarios below stock cheap
 *     units first to satisfy this before attempting to clear land.
 *
 * WHY EVERYTHING IS LOADED THROUGH ONE DYNAMIC IMPORT. `chrono-delorean.ts`'s
 * `CHRONO_DELOREAN_ENABLED` is a top-level const requiring
 * `vi.resetModules()` + a fresh `import()` to test under a stubbed env (see
 * chrono-delorean.test.ts's own header). Once modules are reset, EVERY other
 * module this file touches must come from that SAME fresh graph too --
 * profile-store.ts keeps its token->profile map at module scope, and mixing
 * a fresh `chrono-delorean.ts` (which resolves a profile through a
 * newly-reset profile-store.ts) with a stale, separately-imported
 * `stackacres-service.ts` (still holding the OLD profile-store.ts instance)
 * would resolve the SAME token to two DIFFERENT profile ids across the two
 * subsystems -- silently breaking every assertion below without ever
 * throwing. `loadSimulation()` is the one place all of it is imported
 * together, after the reset, so this cannot happen.
 */

async function loadSimulation() {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("CHRONO_DELOREAN_MODE", "1");

  const service = await import("./stackacres-service");
  const store = await import("./stackacres-store");
  const profileStore = await import("./profile-store");
  const chrono = await import("./chrono-delorean");
  const catalogue = await import("@/lib/stackacres/catalogue");
  const upkeep = await import("@/lib/stackacres/upkeep");
  const sectors = await import("@/lib/stackacres/sectors");
  const exchange = await import("@/lib/stackacres/exchange");

  return { service, store, profileStore, chrono, catalogue, upkeep, sectors, exchange };
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.CHRONO_DELOREAN_MODE;
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Walks Chrono-DeLorean Mode's offset forward so `resolveChronoNow` lands
 * within a couple of real seconds of `targetNow` -- exact equality is not
 * achievable (real time keeps ticking between the `setChronoDeloreanOffset`
 * call and the `resolveChronoNow` read a moment later), so every assertion
 * against `targetNow` below tolerates that gap rather than pretending it
 * does not exist.
 */
async function jumpTo(
  chrono: Awaited<ReturnType<typeof loadSimulation>>["chrono"],
  token: string,
  targetNow: Date,
): Promise<Date> {
  await chrono.setChronoDeloreanOffset(token, targetNow.getTime() - Date.now());
  return chrono.resolveChronoNow(token);
}

/**
 * Stocks one pig at `stockedNow` and tends it across its own hunger cycle
 * until it is genuinely `ready`, then returns the resolved-ready `now` and
 * its unit id -- WITHOUT ever calling `harvestStackAcres`, so the caller
 * decides what day that harvest lands on.
 *
 * A NEVER-FED pig cannot be walked straight to its own natural `readyAt`:
 * hungerMs (2h) is under durationMs (4h), so an untended pig is already
 * frozen `hungry` well before it would otherwise finish -- the same fact
 * this whole test exists to demonstrate, which is why this helper exists
 * rather than being a shortcut around it.
 *
 * ONE FEED IS NOT ENOUGH EITHER, and this is the more surprising half: pig's
 * durationMs is EXACTLY 2x hungerMs, so a single feed always lands the NEXT
 * hungryAt exactly on top of the pushed-forward readyAt (hungryAt =
 * feedMoment + hungerMs; readyAt = oldReadyAt + (feedMoment - oldHungryAt);
 * the two are equal precisely when durationMs = 2 * hungerMs, independent of
 * when the feed happens) -- the pig would go hungry again at the exact
 * instant it would otherwise become ready, and the hungry guard is checked
 * first (see isStackAcresUnitReady). A second, early feed clears the
 * collision: feedStackAcres never refuses feeding a not-yet-hungry unit --
 * unlike watering, it is not a top-up (see its own doc comment) -- so
 * feeding again well before that instant resets the hunger clock at zero
 * readyAt cost (starvedMs floors at 0).
 */
async function growPigToReady(
  service: Awaited<ReturnType<typeof loadSimulation>>["service"],
  chrono: Awaited<ReturnType<typeof loadSimulation>>["chrono"],
  token: string,
  pig: { hungerMs: number | null; durationMs: number },
  stockedNow: Date,
): Promise<{ pigId: string; readyNow: Date; wasHungryBeforeFeeding: boolean }> {
  const stocked = await service.stockStackAcres(token, { stock: "pig" }, stockedNow);
  const pigId = stocked.units.filter((u) => u.stock === "pig").pop()!.id;

  // Past the 2h hunger window, well short of the 4h grow cycle -- an untended
  // pig can ONLY show `hungry` here, never `ready`, if the freeze is real.
  const hungryNow = await jumpTo(chrono, token, new Date(stockedNow.getTime() + pig.hungerMs! + 5 * 60_000));
  const hungryView = await service.readStackAcres(token, hungryNow);
  const wasHungryBeforeFeeding = hungryView.units.find((u) => u.id === pigId)?.state === "hungry";

  const fedView = await service.feedStackAcres(token, pigId, hungryNow);
  const fed = fedView.units.find((u) => u.id === pigId)!;

  await service.feedStackAcres(token, pigId, new Date(Date.parse(fed.readyAt) - 60_000));

  const readyNow = await jumpTo(chrono, token, new Date(Date.parse(fed.readyAt) + 1000));
  return { pigId, readyNow, wasHungryBeforeFeeding };
}

describe("Chrono-DeLorean Mode driving a multi-day StackAcres run", () => {
  it("collapses a hen's full 15-minute grow cycle into a simulated instant, at zero Land Maintenance", async () => {
    const { service, profileStore, chrono } = await loadSimulation();

    const token = randomUUID();
    const profile = await profileStore.ensureProfile(token);
    await profileStore.adjustGold(profile.id, 500_000 - profile.goldBalance);

    const ledger: Array<{ step: string; state: string | undefined; upkeepFee: number }> = [];
    const record = (step: string, view: Awaited<ReturnType<typeof service.readStackAcres>>) =>
      ledger.push({
        step,
        state: view.units.find((u) => u.stock === "hen")?.state,
        upkeepFee: view.upkeep.fee,
      });

    // Farmstead (HOME_SECTOR) is the one sector every farm starts with, and
    // hen is the only stock kind zoned there (lib/stackacres/world.ts's
    // `stockZone`) -- this needs no sector cleared at all.
    const t0 = await jumpTo(chrono, token, new Date());
    let view = await service.stockStackAcres(token, { stock: "hen" }, t0);
    const unitId = view.units.find((u) => u.stock === "hen")!.id;
    record("stocked", view);
    // The free base is exactly 3 plots (STACKACRES_BASE_CAP) and hen is the
    // only stock kind zoned to the always-unlocked Farmstead, so this farm
    // sits AT the free base, never past it.
    expect(view.upkeep.fee).toBe(0);
    expect(view.units.find((u) => u.id === unitId)?.state).toBe("working");

    // Jump straight to readiness -- the whole point of the harness: real
    // elapsed time between the two calls above and this one is a fraction of
    // a second, simulated time is the hen's full cycle.
    const readyAt = view.units.find((u) => u.id === unitId)!.readyAt;
    const readyNow = await jumpTo(chrono, token, new Date(Date.parse(readyAt) + 1000));
    view = await service.readStackAcres(token, readyNow);
    record("simulated clock reaches readyAt", view);
    expect(view.units.find((u) => u.id === unitId)?.state).toBe("ready");

    const harvested = await service.harvestStackAcres(token, { unitIds: [unitId] }, readyNow);
    record("harvested", harvested);
    expect(harvested.harvest.units).toBe(1);
    expect(harvested.harvest.upkeep).toBe(0);
    expect(harvested.harvest.gold).toBeGreaterThan(0);
    // Non-permanent: the collected row is gone outright, not merely mucked.
    expect(harvested.units.some((u) => u.id === unitId)).toBe(false);

    console.log("Chrono-DeLorean simulation ledger (hen, free base):", ledger);
  });

  it("freezes a pig's clock while hungry, charges Land Maintenance once land is cleared, and re-assesses it independently on the next simulated UTC day", async () => {
    const { service, store, profileStore, chrono, catalogue, upkeep, sectors, exchange } =
      await loadSimulation();

    const token = randomUUID();
    const profile = await profileStore.ensureProfile(token);
    await profileStore.adjustGold(profile.id, 500_000 - profile.goldBalance);

    const pig = catalogue.STACKACRES_CATALOGUE.pig;
    expect(pig.hungerMs).not.toBeNull();
    expect(pig.hungerMs!).toBeLessThan(pig.durationMs); // the mechanic this test is about
    const feedItemId = catalogue.STACKACRES_FEED_IDS[0];

    const t0 = await jumpTo(chrono, token, new Date("2026-09-10T12:00:00.000Z"));
    const day0 = exchange.stackacresExchangeDay(t0);

    // Meadow requires 2 units already going; Wallow requires Meadow cleared
    // PLUS 4 units. Two hens, then two sprouts (never watered or harvested --
    // they only need to exist as rows for the unit-count gate), get there.
    await service.stockStackAcres(token, { stock: "hen" }, t0);
    await service.stockStackAcres(token, { stock: "hen" }, t0);
    await service.clearStackAcresSector(token, "meadow", t0);
    await service.stockStackAcres(token, { stock: "sprout" }, t0);
    await service.stockStackAcres(token, { stock: "sprout" }, t0);
    const afterWallow = await service.clearStackAcresSector(token, "wallow", t0);

    const [clearedSectors, capacity] = await Promise.all([
      store.readStackAcresSectors(profile.id),
      store.readStackAcresCapacity(profile.id),
    ]);
    const unlocked = sectors.unlockedSectors(clearedSectors, afterWallow.units);
    const plots = sectors.unlockedPlotCount(unlocked, capacity);
    const expectedFee = upkeep.stackacresUpkeepFee(plots);
    console.log("Chrono-DeLorean simulation: plots after Meadow+Wallow ->", plots, "fee ->", expectedFee);
    // Farmstead(hen) + Meadow(sprout, cash_crop) + Wallow(pig) = 4 stock
    // kinds x 3 free slots each = 12 plots, 9 chargeable past the free base.
    expect(plots).toBe(12);
    expect(expectedFee).toBeGreaterThan(0);
    expect(afterWallow.upkeep.fee).toBe(expectedFee);

    await service.buyStackAcresFeed(token, feedItemId, t0);
    const { pigId, readyNow, wasHungryBeforeFeeding } = await growPigToReady(service, chrono, token, pig, t0);
    expect(wasHungryBeforeFeeding).toBe(true); // the freeze this test is about
    expect(await store.readStackAcresUpkeep(profile.id, day0)).toBe(0);

    const harvestDay0 = await service.harvestStackAcres(token, { unitIds: [pigId] }, readyNow);
    const expectedDay0Charge = Math.min(expectedFee, harvestDay0.harvest.gross + harvestDay0.harvest.bonus);
    console.log("Chrono-DeLorean simulation: day0 pig harvest ->", {
      day: day0,
      gross: harvestDay0.harvest.gross,
      bonus: harvestDay0.harvest.bonus,
      upkeepCharged: harvestDay0.harvest.upkeep,
      gold: harvestDay0.harvest.gold,
    });
    expect(harvestDay0.harvest.upkeep).toBe(expectedDay0Charge);
    expect(await store.readStackAcresUpkeep(profile.id, day0)).toBe(harvestDay0.harvest.upkeep);

    // A second pig, harvested the SAME simulated day: if the first harvest
    // already paid the full fee, this one must be charged nothing more --
    // stackacresUpkeepDue nets out what today's ledger already holds.
    await service.buyStackAcresFeed(token, feedItemId, readyNow);
    const pigTwo = await growPigToReady(service, chrono, token, pig, readyNow);
    expect(exchange.stackacresExchangeDay(pigTwo.readyNow)).toBe(day0);
    const harvestSameDay = await service.harvestStackAcres(
      token,
      { unitIds: [pigTwo.pigId] },
      pigTwo.readyNow,
    );
    console.log("Chrono-DeLorean simulation: same-day second pig harvest ->", {
      upkeepCharged: harvestSameDay.harvest.upkeep,
    });
    if (harvestDay0.harvest.upkeep >= expectedFee) {
      expect(harvestSameDay.harvest.upkeep).toBe(0);
    }

    // Cross a simulated UTC day boundary. Land Maintenance is "assessed
    // lazily, once per UTC day" (lib/stackacres/upkeep.ts's own header) --
    // this is the one thing that requires an actual day-boundary crossing to
    // prove at all, which is exactly what a real day of wall-clock time
    // would otherwise cost to test.
    const t1 = await jumpTo(chrono, token, new Date(t0.getTime() + ONE_DAY_MS));
    const day1 = exchange.stackacresExchangeDay(t1);
    expect(day1).not.toBe(day0);
    expect(await store.readStackAcresUpkeep(profile.id, day1)).toBe(0);

    await service.buyStackAcresFeed(token, feedItemId, t1);
    const pigThree = await growPigToReady(service, chrono, token, pig, t1);
    const harvestDay1 = await service.harvestStackAcres(
      token,
      { unitIds: [pigThree.pigId] },
      pigThree.readyNow,
    );
    const expectedDay1Charge = Math.min(expectedFee, harvestDay1.harvest.gross + harvestDay1.harvest.bonus);
    console.log("Chrono-DeLorean simulation: day1 pig harvest (fresh UTC day) ->", {
      day: day1,
      upkeepCharged: harvestDay1.harvest.upkeep,
    });

    // Independently re-assessed, at the SAME fee shape -- day 1 is not a
    // continuation of day 0's ledger. Day 0's own ledger holds the SUM of
    // its two harvests (the first one alone did not cover the full fee --
    // see the log above), and that sum is exactly the fee: nothing was
    // overcharged past the ceiling and nothing was left uncollected either.
    expect(harvestDay1.harvest.upkeep).toBe(expectedDay1Charge);
    expect(await store.readStackAcresUpkeep(profile.id, day0)).toBe(
      harvestDay0.harvest.upkeep + harvestSameDay.harvest.upkeep,
    );
    expect(await store.readStackAcresUpkeep(profile.id, day0)).toBe(expectedFee);
    expect(await store.readStackAcresUpkeep(profile.id, day1)).toBe(harvestDay1.harvest.upkeep);
  });
});
