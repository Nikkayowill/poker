import { describe, expect, it } from "vitest";
import { STACKACRES_CATALOGUE } from "./catalogue";
import {
  hungryAtFor,
  isStackAcresUnitDry,
  isStackAcresUnitHungry,
  isStackAcresUnitReady,
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
    lastFedAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
    lastWateredAt: null,
    muckFee: null,
    permanent: false,
    version: 1,
    ...overrides,
  };
}

describe("hungryAtFor", () => {
  it("is null for crops, which never eat", () => {
    expect(hungryAtFor(row({ stock: "sprout", lastFedAt: NOW.toISOString() }))).toBeNull();
  });

  it("is null for livestock never fed", () => {
    expect(hungryAtFor(row({ stock: "cattle", lastFedAt: null }))).toBeNull();
  });

  it("is lastFedAt plus the kind's hungerMs for livestock", () => {
    const fedAt = new Date(NOW.getTime() - 60 * 1000).toISOString();
    // hen hungerMs is 45 minutes
    expect(hungryAtFor(row({ stock: "hen", lastFedAt: fedAt }))).toBe(
      new Date(Date.parse(fedAt) + 45 * 60 * 1000).toISOString(),
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
      stock: "sprout",
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

const SPROUT = STACKACRES_CATALOGUE.sprout;
const THIRST = SPROUT.thirstMs ?? 0;

/** A Sprout Row sown `agoMs` before NOW and watered at sowing, unless
 *  `lastWateredAt` says otherwise. Its whole cycle fits inside the window
 *  these tests move NOW around in. */
function crop(agoMs: number, overrides: Partial<StackAcresUnitRow> = {}): StackAcresUnitRow {
  const sown = NOW.getTime() - agoMs;
  return row({
    stock: "sprout",
    stake: SPROUT.seedCost,
    yieldQuantity: 3,
    startedAt: new Date(sown).toISOString(),
    readyAt: new Date(sown + SPROUT.durationMs).toISOString(),
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

  it("falls back to sowing for a row written before the column existed", () => {
    const sown = NOW.getTime() - 60_000;
    expect(Date.parse(thirstyAtFor(crop(60_000, { lastWateredAt: null })) ?? "")).toBe(sown + THIRST);
  });

  it("has no answer for livestock, which is tended by feeding instead", () => {
    expect(thirstyAtFor(row({ stock: "cattle" }))).toBeNull();
    expect(thirstyAtFor(row({ stock: "hen" }))).toBeNull();
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
  // Watered late in the cycle, so it ripens at durationMs and the ground only
  // dries afterwards.
  const lateWatered = () =>
    crop(0, {
      startedAt: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
      readyAt: new Date(NOW.getTime() - 15 * 60 * 1000).toISOString(),
      lastWateredAt: new Date(NOW.getTime() - 20 * 60 * 1000).toISOString(),
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
      startedAt: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
      readyAt: new Date(NOW.getTime() - 15 * 60 * 1000).toISOString(),
      lastWateredAt: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
    });
    expect(isStackAcresUnitDry(row, NOW)).toBe(true);
    expect(isStackAcresUnitReady(row, NOW)).toBe(false);
  });
});

describe("growth pauses while a crop goes unwatered", () => {
  // Sown long enough ago that the timer alone would have finished the cycle.
  const wellPastReady = SPROUT.durationMs + 60 * 60 * 1000;

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
    expect(frozen.progress).toBeCloseTo(THIRST / SPROUT.durationMs, 6);
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
