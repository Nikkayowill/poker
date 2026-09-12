import { describe, expect, it } from "vitest";
import { STACKACRES_CATALOGUE } from "./catalogue";
import {
  effectiveStackAcresCycle,
  hungryAtFor,
  isStackAcresUnitDry,
  isStackAcresUnitHungry,
  isStackAcresUnitReady,
  optimisticallyFedUnit,
  optimisticallyRestartedUnit,
  optimisticallyStockedUnit,
  optimisticallyWateredUnit,
  seedClockOnFirstWater,
  thirstyAtFor,
  toStackAcresUnitSnapshots,
  type StackAcresUnitRow,
} from "./units";

const NOW = new Date("2026-09-04T00:00:00.000Z");

function row(overrides: Partial<StackAcresUnitRow> = {}): StackAcresUnitRow {
  return {
    id: "unit-1",
    status: "working",
    stock: "hen",
    stake: 25,
    yieldQuantity: 4,
    startedAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
    readyAt: new Date(NOW.getTime() + 5 * 60 * 1000).toISOString(),
    // Well under the hen's own 8-minute hunger window (catalogue.ts's
    // `spoils` flag), so a default row is genuinely fresh -- not hungry, not
    // spoiled -- unless a test overrides this to ask about hunger directly.
    lastFedAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
    lastWateredAt: null,
    muckFee: null,
    permanent: false,
    version: 1,
    housedIn: null,
    soilSlot: null,
    ...overrides,
  };
}

describe("hungryAtFor", () => {
  it("is null for crops, which never eat", () => {
    expect(hungryAtFor(row({ stock: "carrot", lastFedAt: NOW.toISOString() }))).toBeNull();
  });

  it("is null for livestock never fed", () => {
    expect(hungryAtFor(row({ stock: "cattle", lastFedAt: null }))).toBeNull();
  });

  it("is lastFedAt plus the kind's hungerMs for livestock", () => {
    const fedAt = new Date(NOW.getTime() - 60 * 1000).toISOString();
    // hen hungerMs is 8 minutes
    expect(hungryAtFor(row({ stock: "hen", lastFedAt: fedAt }))).toBe(
      new Date(Date.parse(fedAt) + 8 * 60 * 1000).toISOString(),
    );
  });
});

describe("isStackAcresUnitHungry / isStackAcresUnitReady", () => {
  it("a fresh working animal is neither hungry nor ready", () => {
    const r = row();
    expect(isStackAcresUnitHungry(r, NOW)).toBe(false);
    expect(isStackAcresUnitReady(r, NOW)).toBe(false);
  });

  it("a ready working unit reports ready", () => {
    const r = row({ readyAt: new Date(NOW.getTime() - 1000).toISOString() });
    expect(isStackAcresUnitReady(r, NOW)).toBe(true);
  });

  it("a hungry animal is never ready, even past its own readyAt", () => {
    const r = row({
      stock: "cattle",
      lastFedAt: new Date(NOW.getTime() - 9 * 60 * 60 * 1000).toISOString(), // > 8h hunger window
      readyAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    expect(isStackAcresUnitHungry(r, NOW)).toBe(true);
    expect(isStackAcresUnitReady(r, NOW)).toBe(false);
  });

  it("crops never go hungry regardless of lastFedAt", () => {
    // Watered, so the OTHER freeze condition is not what is being measured
    // here -- a crop is refused readiness by dry soil, never by hunger.
    const r = row({
      stock: "carrot",
      lastFedAt: null,
      lastWateredAt: NOW.toISOString(),
      readyAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    expect(isStackAcresUnitHungry(r, NOW)).toBe(false);
    expect(isStackAcresUnitReady(r, NOW)).toBe(true);
  });

  it("a mucked row is never hungry or ready", () => {
    const r = row({ status: "mucked", muckFee: 22 });
    expect(isStackAcresUnitHungry(r, NOW)).toBe(false);
    expect(isStackAcresUnitReady(r, NOW)).toBe(false);
  });
});

describe("effectiveStackAcresCycle", () => {
  const HEN_DEF = STACKACRES_CATALOGUE.hen;
  const DURATION = HEN_DEF.durationMs;

  it("a hen still hungry at its own readyAt computes a fresh cycle starting exactly there", () => {
    // Started a full cycle before its own readyAt (which lands exactly at
    // NOW), fed only at the start -- hungerMs (8m) is under durationMs (15m),
    // so it is still hungry when NOW reaches readyAt.
    const readyAtMs = NOW.getTime();
    const r = row({
      startedAt: new Date(readyAtMs - DURATION).toISOString(),
      readyAt: new Date(readyAtMs).toISOString(),
      lastFedAt: new Date(readyAtMs - DURATION).toISOString(),
    });
    // Two minutes past its own readyAt, still never fed.
    const at = new Date(readyAtMs + 2 * 60 * 1000);

    const effective = effectiveStackAcresCycle(r, at);
    expect(effective).toEqual({
      startedAt: new Date(readyAtMs).toISOString(),
      readyAt: new Date(readyAtMs + DURATION).toISOString(),
      lastFedAt: new Date(readyAtMs).toISOString(),
    });
    // The voided cycle pays nothing and the fresh one has not finished: not
    // ready, and not hungry either -- it was just "fed" at the spoil moment.
    expect(isStackAcresUnitReady(r, at)).toBe(false);
    expect(isStackAcresUnitHungry(r, at)).toBe(false);
  });

  it("fast-forwards through every cycle spoiled in a row when left unfed for hours", () => {
    // Never fed past its own start, so every cycle after the first spoil
    // repeats on exactly `durationMs` -- see the function's own doc comment.
    const startMs = NOW.getTime();
    const readyAtMs = startMs + DURATION;
    const r = row({
      startedAt: new Date(startMs).toISOString(),
      readyAt: new Date(readyAtMs).toISOString(),
      lastFedAt: new Date(startMs).toISOString(),
    });
    // Offline for just over 3 hours past the first readyAt -- against an 8m
    // hunger / 15m deadline this silently spoils 13 full cycles (the first
    // natural one, plus 12 more) before landing 5 minutes into the 14th.
    const at = new Date(readyAtMs + 3 * 60 * 60 * 1000 + 5 * 60 * 1000);
    const spoiledCycles = 12;
    const effectiveStartMs = readyAtMs + spoiledCycles * DURATION;

    const effective = effectiveStackAcresCycle(r, at);
    expect(effective).toEqual({
      startedAt: new Date(effectiveStartMs).toISOString(),
      readyAt: new Date(effectiveStartMs + DURATION).toISOString(),
      lastFedAt: new Date(effectiveStartMs).toISOString(),
    });
    // 5 minutes into the fresh cycle: not yet hungry (8m window), not ready.
    expect(isStackAcresUnitHungry(r, at)).toBe(false);
    expect(isStackAcresUnitReady(r, at)).toBe(false);

    // toStackAcresUnitSnapshots displays the same fast-forwarded clock, so a
    // long-neglected hen reads as freshly working rather than eternally
    // frozen hungry.
    const [snap] = toStackAcresUnitSnapshots([r], at);
    expect(snap.state).toBe("working");
    expect(snap.startedAt).toBe(new Date(effectiveStartMs).toISOString());
    expect(snap.readyAt).toBe(new Date(effectiveStartMs + DURATION).toISOString());
  });

  it("leaves a non-spoils unit's own fields completely unchanged, however hungry-past-ready it looks", () => {
    // Cattle: hungry for 32 hours straight, long past its own 24h readyAt --
    // exactly the shape that would spoil a hen, but cattle carries
    // `spoils: false`.
    const cattle = row({
      stock: "cattle",
      startedAt: new Date(NOW.getTime() - 40 * 60 * 60 * 1000).toISOString(),
      readyAt: new Date(NOW.getTime() - 16 * 60 * 60 * 1000).toISOString(),
      lastFedAt: new Date(NOW.getTime() - 40 * 60 * 60 * 1000).toISOString(),
    });
    const farFuture = new Date(NOW.getTime() + 100 * 24 * 60 * 60 * 1000);

    const effective = effectiveStackAcresCycle(cattle, farFuture);
    expect(effective).toEqual({
      startedAt: cattle.startedAt,
      readyAt: cattle.readyAt,
      lastFedAt: cattle.lastFedAt,
    });
    // Same before/after result as the raw helpers give today: frozen hungry
    // forever, never fast-forwarded, never silently paid.
    expect(isStackAcresUnitHungry(cattle, farFuture)).toBe(true);
    expect(isStackAcresUnitReady(cattle, farFuture)).toBe(false);
  });
});

describe("toStackAcresUnitSnapshots", () => {
  it("maps a mucked row with no progress and its fee", () => {
    const [snap] = toStackAcresUnitSnapshots([row({ status: "mucked", muckFee: 22 })], NOW);
    expect(snap.state).toBe("mucked");
    expect(snap.progress).toBeNull();
    expect(snap.muckFee).toBe(22);
  });

  it("maps a ready row with progress 1 and no fee", () => {
    const [snap] = toStackAcresUnitSnapshots(
      [row({ readyAt: new Date(NOW.getTime() - 1000).toISOString() })],
      NOW,
    );
    expect(snap.state).toBe("ready");
    expect(snap.progress).toBe(1);
    expect(snap.muckFee).toBeNull();
  });

  it("maps a hungry row as hungry, not working or ready", () => {
    const [snap] = toStackAcresUnitSnapshots(
      [
        row({
          stock: "cattle",
          lastFedAt: new Date(NOW.getTime() - 9 * 60 * 60 * 1000).toISOString(),
        }),
      ],
      NOW,
    );
    expect(snap.state).toBe("hungry");
    expect(snap.hungryAt).not.toBeNull();
  });

  it("carries permanent through untouched", () => {
    const [snap] = toStackAcresUnitSnapshots([row({ permanent: true })], NOW);
    expect(snap.permanent).toBe(true);
  });

  it("preserves row order and count", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c", status: "mucked", muckFee: 1 })];
    const snaps = toStackAcresUnitSnapshots(rows, NOW);
    expect(snaps.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

/* ------------------------------------------------------------------ */
/* Soil watering                                                       */
/* ------------------------------------------------------------------ */

// Tier 2, not tier 1: these tests exercise the thirst-freeze mechanic, which
// needs thirstMs under durationMs. Tier 1's own thirstMs sits OVER its 15s
// durationMs since the 2026-09-11 pacing retune (see catalogue.ts's TIER1
// comment), so it can no longer stand in for "a crop that can go dry".
const THIRSTY_CROP = STACKACRES_CATALOGUE.cucumber;
const THIRST = THIRSTY_CROP.thirstMs ?? 0;

/** A crop sown `agoMs` before NOW and watered at sowing, unless
 *  `lastWateredAt` says otherwise. Its whole cycle fits inside the window
 *  these tests move NOW around in. */
function crop(agoMs: number, overrides: Partial<StackAcresUnitRow> = {}): StackAcresUnitRow {
  const sown = NOW.getTime() - agoMs;
  return row({
    stock: "cucumber",
    stake: THIRSTY_CROP.seedCost,
    yieldQuantity: 3,
    startedAt: new Date(sown).toISOString(),
    readyAt: new Date(sown + THIRSTY_CROP.durationMs).toISOString(),
    lastFedAt: null,
    lastWateredAt: new Date(sown).toISOString(),
    ...overrides,
  });
}

describe("thirstyAtFor", () => {
  it("dates a crop's next drink from its last watering", () => {
    const sown = NOW.getTime() - 60_000;
    const at = thirstyAtFor(crop(60_000));
    expect(Date.parse(at ?? "")).toBe(sown + THIRST);
  });

  it("counts seed that was never watered as dry from the moment it was sown", () => {
    const sown = NOW.getTime() - 60_000;
    expect(Date.parse(thirstyAtFor(crop(60_000, { lastWateredAt: null })) ?? "")).toBe(sown);
  });

  it("has no answer for livestock, which is tended by feeding instead", () => {
    expect(thirstyAtFor(row({ stock: "cattle" }))).toBeNull();
    expect(thirstyAtFor(row({ stock: "hen" }))).toBeNull();
  });
});

describe("sown seed", () => {
  const seed = () => toStackAcresUnitSnapshots([crop(60_000, { lastWateredAt: null })], NOW)[0];

  it("is flagged seed only while it waits for its first water", () => {
    expect(seed().seed).toBe(true);
    // Dried mid-cycle: dry, but it was watered and has grown.
    expect(toStackAcresUnitSnapshots([crop(THIRST + 1000)], NOW)[0].seed).toBe(false);
    expect(toStackAcresUnitSnapshots([row()], NOW)[0].seed).toBe(false);
  });

  it("refuses to start a clock it cannot read", () => {
    expect(() => seedClockOnFirstWater(crop(60_000, { readyAt: "not a date" }), NOW.getTime())).toThrow();
  });

  it("starts the clock at the first water with the cycle it was sown with", () => {
    const at = NOW.getTime() + 5_000;
    const clock = seedClockOnFirstWater(crop(60_000, { lastWateredAt: null }), at);
    expect(clock.startedAt.getTime()).toBe(at);
    expect(clock.readyAt.getTime() - at).toBe(THIRSTY_CROP.durationMs);
  });

  it("predicts a sown crop as seed and an animal as working", () => {
    const base = { id: "n", permanent: false, inGreenhouse: false, nowMs: NOW.getTime() };
    const cropUnit = optimisticallyStockedUnit({ ...base, stock: "cucumber" });
    expect(cropUnit.seed).toBe(true);
    expect(cropUnit.state).toBe("dry");
    expect(cropUnit.isWatered).toBe(false);
    const hen = optimisticallyStockedUnit({ ...base, stock: "hen" });
    expect(hen.state).toBe("working");
    expect(hen.thirstyAt).toBeNull();
  });

  it("predicts watering a seed as a fresh cycle starting now", () => {
    const at = NOW.getTime() + 30_000;
    const watered = optimisticallyWateredUnit(seed(), at);
    expect(watered.state).toBe("working");
    expect(watered.progress).toBe(0);
    expect(Date.parse(watered.startedAt)).toBe(at);
    expect(Date.parse(watered.readyAt) - at).toBe(THIRSTY_CROP.durationMs);
  });

  it("predicts a bought crop restarting as seed", () => {
    const stocked = optimisticallyStockedUnit({
      id: "n",
      stock: "cucumber",
      permanent: true,
      inGreenhouse: false,
      nowMs: NOW.getTime(),
    });
    const restarted = optimisticallyRestartedUnit(
      { ...stocked, state: "ready", progress: 1, isWatered: true },
      NOW.getTime() + 1000,
    );
    expect(restarted.seed).toBe(true);
  });

  it("predicts a bought crop on a piped bed restarting watered", () => {
    const stocked = optimisticallyStockedUnit({
      id: "n",
      stock: "cucumber",
      permanent: true,
      inGreenhouse: false,
      nowMs: NOW.getTime(),
    });
    const restarted = optimisticallyRestartedUnit(
      { ...stocked, state: "ready", progress: 1, isWatered: true, thirstyAt: null, seed: false },
      NOW.getTime() + 1000,
    );
    expect(restarted.seed).toBe(false);
    expect(restarted.state).toBe("working");
    expect(restarted.thirstyAt).toBeNull();
  });

  it("tells the browser a piped crop never dries", () => {
    const piped = toStackAcresUnitSnapshots([crop(60_000, { id: "p" })], NOW, new Set(["p"]))[0];
    expect(piped.thirstyAt).toBeNull();
  });
});

describe("isStackAcresUnitDry", () => {
  it("is dry once past the watering window and not before", () => {
    expect(isStackAcresUnitDry(crop(THIRST - 1000), NOW)).toBe(false);
    expect(isStackAcresUnitDry(crop(THIRST + 1000), NOW)).toBe(true);
  });

  it("is never true for livestock, however long ago it was stocked", () => {
    expect(isStackAcresUnitDry(row({ stock: "cattle", startedAt: new Date(0).toISOString() }), NOW)).toBe(
      false,
    );
  });

  it("is never true for a mucked row, which has stopped anyway", () => {
    expect(isStackAcresUnitDry(crop(THIRST * 10, { status: "mucked", muckFee: 16 }), NOW)).toBe(false);
  });
});

describe("a crop that beat the drought to its own finish line", () => {
  // Sown two cycles ago, so it ripened one cycle ago. Watered late enough in
  // that cycle that the ground only dries half a thirst window after it
  // ripens, which is still well before NOW.
  const CYCLE = THIRSTY_CROP.durationMs;
  const lateWatered = () =>
    crop(0, {
      startedAt: new Date(NOW.getTime() - 2 * CYCLE).toISOString(),
      readyAt: new Date(NOW.getTime() - CYCLE).toISOString(),
      lastWateredAt: new Date(NOW.getTime() - CYCLE - THIRST / 2).toISOString(),
    });

  it("is never dry, however long the ground has been dry since", () => {
    const row = lateWatered();
    // The ground dried well before now...
    expect(Date.parse(thirstyAtFor(row) ?? "")).toBeLessThan(NOW.getTime());
    // ...but the crop was already finished when it did.
    expect(isStackAcresUnitDry(row, NOW)).toBe(false);
    expect(isStackAcresUnitDry(row, new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000))).toBe(false);
  });

  it("stays collectable, so a drought cannot un-ripen finished produce", () => {
    expect(isStackAcresUnitReady(lateWatered(), NOW)).toBe(true);
    const [snap] = toStackAcresUnitSnapshots([lateWatered()], NOW);
    expect(snap.state).toBe("ready");
    expect(snap.isWatered).toBe(true);
    expect(snap.progress).toBe(1);
  });

  it("still freezes the crop that ran dry BEFORE finishing", () => {
    // Same row, but the watering is early enough that the soil gives out
    // first -- this is the case the freeze exists for.
    const row = crop(0, {
      startedAt: new Date(NOW.getTime() - 2 * CYCLE).toISOString(),
      readyAt: new Date(NOW.getTime() - CYCLE).toISOString(),
      lastWateredAt: new Date(NOW.getTime() - 2 * CYCLE).toISOString(),
    });
    expect(isStackAcresUnitDry(row, NOW)).toBe(true);
    expect(isStackAcresUnitReady(row, NOW)).toBe(false);
  });
});

describe("growth pauses while a crop goes unwatered", () => {
  // Sown long enough ago that the timer alone would have finished the cycle.
  const wellPastReady = THIRSTY_CROP.durationMs + 60 * 60 * 1000;

  it("refuses readiness for a dry crop however long its timer says it has run", () => {
    const dry = crop(wellPastReady);
    expect(Date.parse(dry.readyAt)).toBeLessThan(NOW.getTime());
    expect(isStackAcresUnitDry(dry, NOW)).toBe(true);
    expect(isStackAcresUnitReady(dry, NOW)).toBe(false);
  });

  it("lets the same crop finish once it is watered late enough to cover the gap", () => {
    // Watered just now, and readyAt pushed out the way waterStackAcres pushes
    // it -- the cycle resumes rather than completing retroactively.
    const watered = crop(wellPastReady, {
      lastWateredAt: NOW.toISOString(),
      readyAt: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    expect(isStackAcresUnitDry(watered, NOW)).toBe(false);
    expect(isStackAcresUnitReady(watered, NOW)).toBe(false);
    expect(isStackAcresUnitReady(watered, new Date(NOW.getTime() + 120_000))).toBe(true);
  });

  it("freezes the progress bar where the soil dried instead of creeping to full", () => {
    const dry = crop(wellPastReady);
    const [frozen] = toStackAcresUnitSnapshots([dry], NOW);
    // The clock stopped THIRST into a durationMs cycle, so the bar reads the
    // fraction of the cycle that had actually been worked by then.
    expect(frozen.state).toBe("dry");
    expect(frozen.isWatered).toBe(false);
    expect(frozen.progress).toBeCloseTo(THIRST / THIRSTY_CROP.durationMs, 6);
    expect(frozen.progress).toBeLessThan(1);
  });

  it("does not move that frozen bar as more time passes", () => {
    const dry = crop(wellPastReady);
    const [now] = toStackAcresUnitSnapshots([dry], NOW);
    const [muchLater] = toStackAcresUnitSnapshots(
      [dry],
      new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
    );
    expect(muchLater.progress).toBe(now.progress);
    expect(muchLater.state).toBe("dry");
  });

  it("still advances the bar while the ground is wet", () => {
    const early = toStackAcresUnitSnapshots([crop(60_000)], NOW)[0];
    const later = toStackAcresUnitSnapshots([crop(4 * 60_000)], NOW)[0];
    expect(early.state).toBe("working");
    expect(early.isWatered).toBe(true);
    expect(later.progress ?? 0).toBeGreaterThan(early.progress ?? 0);
  });

  it("reports livestock and mucked rows as watered, since neither has soil", () => {
    const [animal] = toStackAcresUnitSnapshots([row({ stock: "hen" })], NOW);
    expect(animal.isWatered).toBe(true);
    expect(animal.thirstyAt).toBeNull();
    const [mucked] = toStackAcresUnitSnapshots([crop(THIRST * 10, { status: "mucked", muckFee: 16 })], NOW);
    expect(mucked.isWatered).toBe(true);
    expect(mucked.state).toBe("mucked");
  });
});

/* ------------------------------------------------------------------ */
/* Optimistic tending -- the client-side twin of a feed/water response */
/* ------------------------------------------------------------------ */

describe("optimisticallyFedUnit", () => {
  const HUNGER = STACKACRES_CATALOGUE.hen.hungerMs ?? 0;

  it("pushes readyAt forward by exactly the time spent starving", () => {
    const readyAt = NOW.getTime() + 5 * 60 * 1000;
    const hungryAt = NOW.getTime() - 2 * 60 * 1000; // starving for 2 minutes
    const [hungry] = toStackAcresUnitSnapshots(
      [
        row({
          stock: "hen",
          readyAt: new Date(readyAt).toISOString(),
          lastFedAt: new Date(hungryAt - HUNGER).toISOString(),
        }),
      ],
      NOW,
    );
    expect(hungry.state).toBe("hungry");

    const fed = optimisticallyFedUnit(hungry, NOW.getTime());
    expect(Date.parse(fed.readyAt)).toBe(readyAt + 2 * 60 * 1000);
  });

  it("restarts the feed window from the moment it was fed", () => {
    const [hungry] = toStackAcresUnitSnapshots(
      [row({ stock: "hen", lastFedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() })],
      NOW,
    );
    const fed = optimisticallyFedUnit(hungry, NOW.getTime());
    expect(Date.parse(fed.hungryAt ?? "")).toBe(NOW.getTime() + HUNGER);
  });

  it("never predicts hunger for a kind that never eats", () => {
    const [ready] = toStackAcresUnitSnapshots(
      [crop(0, { readyAt: new Date(NOW.getTime() - 1000).toISOString() })],
      NOW,
    );
    expect(optimisticallyFedUnit(ready, NOW.getTime()).hungryAt).toBeNull();
  });
});

describe("optimisticallyWateredUnit", () => {
  it("pushes readyAt forward by exactly the time the soil stood dry", () => {
    const dry = crop(THIRST + 3 * 60 * 1000); // 3 minutes past the watering window
    const [snap] = toStackAcresUnitSnapshots([dry], NOW);
    expect(snap.state).toBe("dry");

    const watered = optimisticallyWateredUnit(snap, NOW.getTime());
    expect(Date.parse(watered.readyAt)).toBe(Date.parse(dry.readyAt) + 3 * 60 * 1000);
  });

  it("restarts the thirst window from the moment it was watered", () => {
    const dry = crop(THIRST + 60_000);
    const [snap] = toStackAcresUnitSnapshots([dry], NOW);
    const watered = optimisticallyWateredUnit(snap, NOW.getTime());
    expect(Date.parse(watered.thirstyAt ?? "")).toBe(NOW.getTime() + THIRST);
  });

  it("never predicts thirst for livestock, which drinks from its own trough", () => {
    const [snap] = toStackAcresUnitSnapshots([row({ stock: "cattle" })], NOW);
    expect(optimisticallyWateredUnit(snap, NOW.getTime()).thirstyAt).toBeNull();
  });
});
