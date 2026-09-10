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
 *   * `clearStackAcresSector` (Wallow, Ox Fields) and `unlockStackAcresCropFields`
 *     (the Crop Fields' own standalone gate, since the 2026-09-08 merge into
 *     the Farmstead) both refuse until the player already has enough
 *     working-or-mucked units elsewhere (`requiresUnits`,
 *     lib/stackacres/sectors.ts and lib/stackacres/crop-fields.ts) -- the Crop
 *     Fields need 2, Wallow needs 4 of its own (no longer gated on the Crop
 *     Fields being unlocked first). Both scenarios below stock cheap units
 *     first to satisfy this before attempting to clear or unlock land.
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
  const seedStore = await import("./stackacres-seed-store");
  const soilStore = await import("./stackacres-soil-store");
  const profileStore = await import("./profile-store");
  const chrono = await import("./chrono-delorean");
  const catalogue = await import("@/lib/stackacres/catalogue");
  const upkeep = await import("@/lib/stackacres/upkeep");
  const sectors = await import("@/lib/stackacres/sectors");
  const exchange = await import("@/lib/stackacres/exchange");
  const world = await import("@/lib/stackacres/world");
  const soil = await import("@/lib/stackacres/soil");

  return {
    service,
    store,
    seedStore,
    soilStore,
    profileStore,
    chrono,
    catalogue,
    upkeep,
    sectors,
    exchange,
    world,
    soil,
  };
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

    const goldBefore = (await profileStore.getProfileById(profile.id))!.goldBalance;
    const harvested = await service.harvestStackAcres(token, { unitIds: [unitId] }, readyNow);
    record("harvested", harvested);
    expect(harvested.harvest.units).toBe(1);
    // A harvest fills the barn and pays no Gold.
    const eggs = harvested.harvest.tally.find((line) => line.item === "eggs")?.quantity ?? 0;
    expect(eggs).toBeGreaterThan(0);
    expect(harvested.inventory.eggs).toBe(eggs);
    expect(harvested.profile.goldBalance).toBe(goldBefore);
    // Non-permanent: the collected row is gone outright, not merely mucked.
    expect(harvested.units.some((u) => u.id === unitId)).toBe(false);

    console.log("Chrono-DeLorean simulation ledger (hen, free base):", ledger);
  });

  it("freezes a pig's clock while hungry, charges Land Maintenance once land is cleared, and re-assesses it independently on the next simulated UTC day", async () => {
    const {
      service,
      store,
      seedStore,
      soilStore,
      profileStore,
      chrono,
      catalogue,
      upkeep,
      sectors,
      exchange,
      world,
      soil,
    } = await loadSimulation();

    const token = randomUUID();
    const profile = await profileStore.ensureProfile(token);
    await profileStore.adjustGold(profile.id, 500_000 - profile.goldBalance);
    // Ray's seed shelf gates planting a crop now -- see the 2026-09-07 seed
    // inventory pass. The two carrot sowings below (unit-count gates for
    // clearing Wallow) predate that gate.
    await seedStore.adjustStackAcresSeedStock(profile.id, "carrot", 2);
    // And a crop needs a bed under it (2026-09-09) -- two plain beds, straight
    // into the store, so those same two sowings have ground to stand on.
    // Beds are not plots: nothing in the upkeep arithmetic below counts them.
    const bed = soil.soilTileAt(
      world.CROP_FIELD_BEDS.x + soil.SOIL_TILE,
      world.CROP_FIELD_BEDS.y + soil.SOIL_TILE,
    );
    await soilStore.placeStackAcresSoilTile(profile.id, bed.tx, bed.ty);
    await soilStore.placeStackAcresSoilTile(profile.id, bed.tx + 1, bed.ty);

    const pig = catalogue.STACKACRES_CATALOGUE.pig;
    expect(pig.hungerMs).not.toBeNull();
    expect(pig.hungerMs!).toBeLessThan(pig.durationMs); // the mechanic this test is about
    const feedItemId = catalogue.STACKACRES_FEED_IDS[0];

    const t0 = await jumpTo(chrono, token, new Date("2026-09-10T12:00:00.000Z"));
    const day0 = exchange.stackacresExchangeDay(t0);

    // The Crop Fields require 2 units already going, unlocked through their
    // own standalone flag now rather than a sector clear (2026-09-08 merge
    // into the Farmstead -- see lib/stackacres/crop-fields.ts). Wallow needs
    // 4 units of its own but no longer needs the Crop Fields cleared first
    // (see SECTOR_LADDER's own header on why `wallow.requires` is null now).
    // Two hens satisfy the Crop Fields' own unit gate; two carrots (which
    // need the Crop Fields unlocked to sow at all) bring the running total to
    // four for Wallow.
    await service.stockStackAcres(token, { stock: "hen" }, t0);
    await service.stockStackAcres(token, { stock: "hen" }, t0);
    await service.unlockStackAcresCropFields(token, t0);
    await service.stockStackAcres(token, { stock: "carrot" }, t0);
    await service.stockStackAcres(token, { stock: "carrot" }, t0);
    const afterWallow = await service.clearStackAcresSector(token, "wallow", t0);

    const [clearedSectors, capacity, cropFieldsUnlocked] = await Promise.all([
      store.readStackAcresSectors(profile.id),
      store.readStackAcresCapacity(profile.id),
      store.readStackAcresCropFieldsUnlocked(profile.id),
    ]);
    const unlocked = sectors.unlockedSectors(clearedSectors, afterWallow.units);
    const plots = sectors.unlockedPlotCount(unlocked, capacity, cropFieldsUnlocked);
    const expectedFee = upkeep.stackacresUpkeepFee(plots);
    console.log("Chrono-DeLorean simulation: plots after Crop Fields+Wallow ->", plots, "fee ->", expectedFee);
    // Hen Haven(hen) + the Crop Fields(all 22 crops, inside the Farmstead) +
    // Wallow(pig) = 24 stock kinds x 3 free slots each = 72 plots, 69
    // chargeable past the free base.
    expect(plots).toBe(72);
    expect(expectedFee).toBeGreaterThan(0);
    expect(afterWallow.upkeep.fee).toBe(expectedFee);

    await service.buyStackAcresFeed(token, feedItemId, t0);
    const { pigId, readyNow, wasHungryBeforeFeeding } = await growPigToReady(service, chrono, token, pig, t0);
    expect(wasHungryBeforeFeeding).toBe(true); // the freeze this test is about
    expect(await store.readStackAcresUpkeep(profile.id, day0)).toBe(0);

    const balance = async () => (await profileStore.getProfileById(profile.id))!.goldBalance;

    // A harvest charges no upkeep any more; it only fills the barn.
    const beforeHarvest = await balance();
    const harvestDay0 = await service.harvestStackAcres(token, { unitIds: [pigId] }, readyNow);
    expect(harvestDay0.harvest.tally.find((line) => line.item === "wool")?.quantity).toBeGreaterThan(0);
    expect(await balance()).toBe(beforeHarvest);
    expect(await store.readStackAcresUpkeep(profile.id, day0)).toBe(0);

    // Land Maintenance is a standalone wallet debit, assessed once per UTC day.
    const beforeAssess = await balance();
    await service.assessStackAcresUpkeep(profile.id, readyNow);
    console.log("Chrono-DeLorean simulation: day0 upkeep assessed ->", { day: day0, charged: beforeAssess - (await balance()) });
    expect(await store.readStackAcresUpkeep(profile.id, day0)).toBe(expectedFee);
    expect(await balance()).toBe(beforeAssess - expectedFee);

    // A second assessment the SAME simulated day charges nothing more:
    // stackacresUpkeepDue nets out what today's ledger already holds.
    await service.buyStackAcresFeed(token, feedItemId, readyNow);
    const pigTwo = await growPigToReady(service, chrono, token, pig, readyNow);
    expect(exchange.stackacresExchangeDay(pigTwo.readyNow)).toBe(day0);
    await service.harvestStackAcres(token, { unitIds: [pigTwo.pigId] }, pigTwo.readyNow);
    const beforeSecond = await balance();
    await service.assessStackAcresUpkeep(profile.id, pigTwo.readyNow);
    expect(await balance()).toBe(beforeSecond);
    expect(await store.readStackAcresUpkeep(profile.id, day0)).toBe(expectedFee);

    // Cross a simulated UTC day boundary: the bill is re-assessed from zero.
    const t1 = await jumpTo(chrono, token, new Date(t0.getTime() + ONE_DAY_MS));
    const day1 = exchange.stackacresExchangeDay(t1);
    expect(day1).not.toBe(day0);
    expect(await store.readStackAcresUpkeep(profile.id, day1)).toBe(0);

    const beforeDay1 = await balance();
    await service.assessStackAcresUpkeep(profile.id, t1);
    console.log("Chrono-DeLorean simulation: day1 upkeep assessed (fresh UTC day) ->", {
      day: day1,
      charged: beforeDay1 - (await balance()),
    });
    expect(await store.readStackAcresUpkeep(profile.id, day1)).toBe(expectedFee);
    expect(await balance()).toBe(beforeDay1 - expectedFee);
    // Day 0's ledger is untouched by day 1's charge.
    expect(await store.readStackAcresUpkeep(profile.id, day0)).toBe(expectedFee);
  });
});
