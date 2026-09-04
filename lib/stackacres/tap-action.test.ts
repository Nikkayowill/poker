import { describe, expect, it } from "vitest";
import type { StackAcresStock } from "./catalogue";
import { collectFloat, tapActionFor, timeLeftLabel } from "./tap-action";
import type { StackAcresUnitSnapshot, StackAcresUnitState } from "./units";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

function unit(
  state: StackAcresUnitState,
  overrides: Partial<StackAcresUnitSnapshot> = {},
): StackAcresUnitSnapshot {
  const stock: StackAcresStock = overrides.stock ?? "hen";
  return {
    id: "u1",
    state,
    stock,
    stake: 25,
    yieldQuantity: 4,
    startedAt: new Date(NOW - 60_000).toISOString(),
    readyAt: new Date(NOW + 15 * 60_000).toISOString(),
    progress: state === "mucked" ? null : 0.5,
    hungryAt: null,
    thirstyAt: null,
    isWatered: true,
    muckFee: state === "mucked" ? 22 : null,
    permanent: false,
    ...overrides,
  };
}

describe("tapActionFor", () => {
  it("waters a dry crop, with no barn stock to check first", () => {
    expect(
      tapActionFor(unit("dry", { stock: "sprout" }), { feed: 0, gold: 0, nowMs: NOW }),
    ).toEqual({ kind: "water", unitId: "u1" });
  });

  it("collects a ready unit", () => {
    expect(tapActionFor(unit("ready"), { feed: 0, gold: 0, nowMs: NOW })).toEqual({
      kind: "collect",
      unitId: "u1",
    });
  });

  it("feeds a hungry unit when there is feed in the barn", () => {
    expect(tapActionFor(unit("hungry"), { feed: 2, gold: 0, nowMs: NOW })).toEqual({
      kind: "feed",
      unitId: "u1",
    });
  });

  // The whole reason a refusal is a shape of its own: there is nowhere on a
  // canvas to put a disabled button with a title attribute, so the reason has
  // to travel with the answer.
  it("refuses to feed with an empty barn, and says why", () => {
    const action = tapActionFor(unit("hungry"), { feed: 0, gold: 0, nowMs: NOW });
    expect(action.kind).toBe("refused");
    expect(action.kind === "refused" && action.reason).toMatch(/feed/i);
  });

  it("clears a mucked unit when the fee is affordable", () => {
    expect(tapActionFor(unit("mucked"), { feed: 0, gold: 100, nowMs: NOW })).toEqual({
      kind: "clear",
      unitId: "u1",
    });
  });

  it("refuses to clear when the fee is not affordable", () => {
    const action = tapActionFor(unit("mucked"), { feed: 0, gold: 5, nowMs: NOW });
    expect(action.kind).toBe("refused");
    expect(action.kind === "refused" && action.reason).toContain("22");
  });

  it("answers a working unit with its countdown rather than nothing", () => {
    const action = tapActionFor(unit("working"), { feed: 9, gold: 9_999, nowMs: NOW });
    expect(action).toEqual({ kind: "refused", reason: "Ready in 15m", why: "waiting" });
  });

  // The split the farm's refusal SOUND hangs off: a real no knocks on wood, a
  // unit that is only still growing says nothing. Getting these the wrong way
  // round makes idle poking around the map into a stream of error noises.
  it("marks an unaffordable action blocked and a growing one waiting", () => {
    const empty = tapActionFor(unit("hungry"), { feed: 0, gold: 0, nowMs: NOW });
    expect(empty.kind === "refused" && empty.why).toBe("blocked");

    const poor = tapActionFor(unit("mucked"), { feed: 0, gold: 5, nowMs: NOW });
    expect(poor.kind === "refused" && poor.why).toBe("blocked");

    const growing = tapActionFor(unit("working"), { feed: 9, gold: 9_999, nowMs: NOW });
    expect(growing.kind === "refused" && growing.why).toBe("waiting");
  });

  // Retiring refunds nothing. It stays two deliberate presses behind the
  // sidebar's own confirmation and must never ride on a stray tap.
  it("never retires from a tap, even on a permanent unit", () => {
    const action = tapActionFor(unit("working", { permanent: true }), {
      feed: 9,
      gold: 9_999,
      nowMs: NOW,
    });
    expect(action.kind).toBe("refused");
  });
});

describe("timeLeftLabel", () => {
  it("counts minutes under an hour", () => {
    expect(timeLeftLabel(new Date(NOW + 12 * 60_000).toISOString(), NOW)).toBe("12m");
  });

  it("counts hours and minutes over one", () => {
    expect(timeLeftLabel(new Date(NOW + 3 * 3_600_000 + 20 * 60_000).toISOString(), NOW)).toBe(
      "3h 20m",
    );
  });

  it("drops the minutes on a whole hour", () => {
    expect(timeLeftLabel(new Date(NOW + 2 * 3_600_000).toISOString(), NOW)).toBe("2h");
  });

  it("says 'any moment' once due, and for an unparseable date", () => {
    expect(timeLeftLabel(new Date(NOW - 1).toISOString(), NOW)).toBe("any moment");
    expect(timeLeftLabel("not a date", NOW)).toBe("any moment");
  });
});

describe("collectFloat", () => {
  it("names the produce and hands back its own painter", () => {
    expect(collectFloat("eggs", 4)).toEqual({ text: "+4 Eggs", icon: "ico-egg" });
  });

  it("uses the singular for one", () => {
    expect(collectFloat("wool", 1).text).toBe("+1 Fleece");
  });
});
