import { describe, expect, it } from "vitest";
import {
  ACTION_BATCH_MAX_UNITS,
  ACTION_BATCH_WINDOW_MS,
  actionForUnits,
  batchWindowRemainingMs,
  coalesceActionTap,
  drainActionBatch,
  isBatchWindowOpen,
  reopenActionBatch,
  type ActionBatchWindow,
} from "./action-batch";
import { intentOf } from "./farm-actions";

const T0 = 1_000;

describe("actionForUnits", () => {
  it("builds a plural collect at any size", () => {
    expect(actionForUnits("collect", ["a"])).toEqual({ action: "collect", unitIds: ["a"] });
    expect(actionForUnits("collect", ["a", "b"])).toEqual({ action: "collect", unitIds: ["a", "b"] });
  });

  it("names an anchor for water, and only sends the array at two or more", () => {
    // The route validates `unitIds` at min(2), so a lone unit must not carry
    // the array at all.
    expect(actionForUnits("water", ["a"])).toEqual({ action: "water", unitId: "a" });
    expect(actionForUnits("water", ["a", "b", "c"])).toEqual({
      action: "water",
      unitId: "a",
      unitIds: ["a", "b", "c"],
    });
  });

  it("is null for an empty set", () => {
    expect(actionForUnits("collect", [])).toBeNull();
    expect(actionForUnits("water", [])).toBeNull();
  });

  it("copies the caller's array rather than aliasing it", () => {
    const ids = ["a", "b"];
    const action = actionForUnits("collect", ids);
    ids.push("c");
    expect(action).toEqual({ action: "collect", unitIds: ["a", "b"] });
  });
});

describe("coalesceActionTap", () => {
  it("sends the first tap immediately, with nothing queued behind it", () => {
    const first = coalesceActionTap(null, "collect", "a", T0);
    expect(first.send).toEqual({ action: "collect", unitIds: ["a"] });
    expect(first.flush).toBeNull();
    expect(first.full).toBe(false);
    expect(first.window).toEqual({ kind: "collect", openedAtMs: T0, sent: ["a"], queued: [] });
  });

  it("queues taps that land inside the window instead of sending them", () => {
    const first = coalesceActionTap(null, "collect", "a", T0);
    const second = coalesceActionTap(first.window, "collect", "b", T0 + 40);
    const third = coalesceActionTap(second.window, "collect", "c", T0 + 90);
    expect(second.send).toBeNull();
    expect(third.send).toBeNull();
    expect(third.window.queued).toEqual(["b", "c"]);
    expect(drainActionBatch(third.window)).toEqual({ action: "collect", unitIds: ["b", "c"] });
  });

  it("collapses a burst of harvest taps into two requests, not eight", () => {
    let window: ActionBatchWindow | null = null;
    const sent: unknown[] = [];
    for (let i = 0; i < 8; i += 1) {
      const tap = coalesceActionTap(window, "collect", `u${i}`, T0 + i * 20);
      if (tap.flush) sent.push(tap.flush);
      if (tap.send) sent.push(tap.send);
      window = tap.window;
    }
    const trailing = drainActionBatch(window!);
    if (trailing) sent.push(trailing);
    expect(sent).toEqual([
      { action: "collect", unitIds: ["u0"] },
      { action: "collect", unitIds: ["u1", "u2", "u3", "u4", "u5", "u6", "u7"] },
    ]);
  });

  it("treats a repeat tap on a unit already in the window as the same gesture", () => {
    const first = coalesceActionTap(null, "collect", "a", T0);
    const repeatLead = coalesceActionTap(first.window, "collect", "a", T0 + 30);
    expect(repeatLead.send).toBeNull();
    expect(repeatLead.window.queued).toEqual([]);

    const queued = coalesceActionTap(repeatLead.window, "collect", "b", T0 + 50);
    const repeatQueued = coalesceActionTap(queued.window, "collect", "b", T0 + 70);
    expect(repeatQueued.send).toBeNull();
    expect(repeatQueued.window.queued).toEqual(["b"]);
  });

  it("opens a fresh window once the old one has closed", () => {
    const first = coalesceActionTap(null, "collect", "a", T0);
    const later = coalesceActionTap(first.window, "collect", "b", T0 + ACTION_BATCH_WINDOW_MS);
    expect(later.send).toEqual({ action: "collect", unitIds: ["b"] });
    expect(later.window.openedAtMs).toBe(T0 + ACTION_BATCH_WINDOW_MS);
    expect(later.window.queued).toEqual([]);
  });

  it("hands back a batch its window never got to flush", () => {
    // A backgrounded tab throttles setTimeout, so the caller's flush timer
    // may not have fired by the time the next tap arrives.
    const first = coalesceActionTap(null, "water", "a", T0);
    const queued = coalesceActionTap(first.window, "water", "b", T0 + 50);
    const afterExpiry = coalesceActionTap(queued.window, "water", "c", T0 + 5_000);
    expect(afterExpiry.flush).toEqual({ action: "water", unitId: "b" });
    expect(afterExpiry.send).toEqual({ action: "water", unitId: "c" });
    expect(afterExpiry.window.queued).toEqual([]);
  });

  it("starts over when the tap is a different kind of action", () => {
    const water = coalesceActionTap(null, "water", "a", T0);
    const collect = coalesceActionTap(water.window, "collect", "b", T0 + 20);
    // Not this window's business, and not this window's batch to drop: the
    // caller keeps one window per kind, so the water batch is untouched.
    expect(collect.flush).toBeNull();
    expect(collect.send).toEqual({ action: "collect", unitIds: ["b"] });
    expect(collect.window.kind).toBe("collect");
  });

  it("reports full at the route's own ceiling", () => {
    // The leading tap is already sent, so the ceiling counts the queue
    // alone -- that queue is what becomes one request's `unitIds`.
    let tap = coalesceActionTap(null, "collect", "lead", T0);
    for (let i = 0; i < ACTION_BATCH_MAX_UNITS; i += 1) {
      expect(tap.full).toBe(false);
      tap = coalesceActionTap(tap.window, "collect", `u${i}`, T0 + 1);
    }
    expect(tap.full).toBe(true);
    expect(tap.window.queued).toHaveLength(ACTION_BATCH_MAX_UNITS);
    const drained = drainActionBatch(tap.window);
    expect(drained).not.toBeNull();
    expect(drained && "unitIds" in drained ? drained.unitIds : []).toHaveLength(ACTION_BATCH_MAX_UNITS);
  });
});

describe("coalesceActionTap: an intent already in the air", () => {
  it("queues the leading tap instead of spending it on a refusal", () => {
    // What a second harvest press does today: `intentOf` collapses every
    // collect onto one intent, so the in-flight guard refuses it and the
    // press does nothing at all.
    const tap = coalesceActionTap(null, "collect", "a", T0, true);
    expect(tap.send).toBeNull();
    expect(tap.window.sent).toEqual([]);
    expect(tap.window.queued).toEqual(["a"]);
    expect(drainActionBatch(tap.window)).toEqual({ action: "collect", unitIds: ["a"] });
  });

  it("still batches the taps that follow it", () => {
    const first = coalesceActionTap(null, "collect", "a", T0, true);
    const second = coalesceActionTap(first.window, "collect", "b", T0 + 30, true);
    expect(second.send).toBeNull();
    expect(drainActionBatch(second.window)).toEqual({ action: "collect", unitIds: ["a", "b"] });
  });

  it("dedupes a repeat press while busy, same as any other", () => {
    const first = coalesceActionTap(null, "collect", "a", T0, true);
    const repeat = coalesceActionTap(first.window, "collect", "a", T0 + 30, true);
    expect(repeat.window.queued).toEqual(["a"]);
  });
});

describe("reopenActionBatch", () => {
  it("re-arms a flush that could not go out, losing nothing", () => {
    const reopened = reopenActionBatch("collect", ["a", "b"], T0 + 200);
    expect(reopened).toEqual({ kind: "collect", openedAtMs: T0 + 200, sent: [], queued: ["a", "b"] });
    expect(drainActionBatch(reopened)).toEqual({ action: "collect", unitIds: ["a", "b"] });
  });

  it("takes further taps for the rest of its window", () => {
    const reopened = reopenActionBatch("collect", ["a"], T0);
    const joined = coalesceActionTap(reopened, "collect", "b", T0 + 50);
    expect(joined.send).toBeNull();
    expect(drainActionBatch(joined.window)).toEqual({ action: "collect", unitIds: ["a", "b"] });
  });
});

describe("window bookkeeping", () => {
  const window: ActionBatchWindow = { kind: "collect", openedAtMs: T0, sent: ["a"], queued: [] };

  it("is open through the window and closed at its edge", () => {
    expect(isBatchWindowOpen(window, T0)).toBe(true);
    expect(isBatchWindowOpen(window, T0 + ACTION_BATCH_WINDOW_MS - 1)).toBe(true);
    expect(isBatchWindowOpen(window, T0 + ACTION_BATCH_WINDOW_MS)).toBe(false);
  });

  it("counts down the remaining window and never goes negative", () => {
    expect(batchWindowRemainingMs(window, T0)).toBe(ACTION_BATCH_WINDOW_MS);
    expect(batchWindowRemainingMs(window, T0 + 120)).toBe(ACTION_BATCH_WINDOW_MS - 120);
    expect(batchWindowRemainingMs(window, T0 + 9_999)).toBe(0);
  });

  it("drains to null when only the leading tap ever happened", () => {
    expect(drainActionBatch(window)).toBeNull();
  });
});

describe("what batching buys", () => {
  it("gives a batch one intent, which is why the taps in it are not dropped", () => {
    // Every `collect` shares the intent `collect` (see intentOf's fallback),
    // so a second single-unit collect tap inside the first one's round trip
    // is refused as a duplicate today. Batched, those taps ride in one
    // request under one intent instead.
    const a = actionForUnits("collect", ["a"]);
    const b = actionForUnits("collect", ["b"]);
    expect(a && b && intentOf(a) === intentOf(b)).toBe(true);

    const batched = actionForUnits("collect", ["a", "b"]);
    expect(batched && intentOf(batched)).toBe("collect");
  });

  it("keeps a water batch on the anchor's own intent", () => {
    const batched = actionForUnits("water", ["a", "b"]);
    expect(batched && intentOf(batched)).toBe("water:a");
  });
});
