import { describe, expect, it } from "vitest";
import {
  hungryAtFor,
  isStackAcresUnitHungry,
  isStackAcresUnitReady,
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
    const r = row({ stock: "sprout", lastFedAt: null, readyAt: new Date(NOW.getTime() - 1000).toISOString() });
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
