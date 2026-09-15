import { describe, expect, it } from "vitest";
import type { StackAcresUnitSnapshot } from "./units";
import { mergeIncomingStackAcresUnits, touchedUnitIds } from "./unit-merge";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function unit(overrides: Partial<StackAcresUnitSnapshot> = {}): StackAcresUnitSnapshot {
  return {
    id: "unit-1",
    state: "working",
    stock: "lettuce",
    stake: 25,
    yieldQuantity: 4,
    startedAt: NOW.toISOString(),
    readyAt: new Date(NOW.getTime() + 60_000).toISOString(),
    progress: 0,
    hungryAt: null,
    thirstyAt: new Date(NOW.getTime() + 30_000).toISOString(),
    isWatered: true,
    seed: false,
    muckFee: null,
    permanent: false,
    housedIn: null,
    soilSlot: null,
    ...overrides,
  };
}

describe("touchedUnitIds", () => {
  it("reports only ids whose object changed against the snapshot", () => {
    const a = unit({ id: "a" });
    const b = unit({ id: "b" });
    const before = [a, b];
    // Same shape as predictStackAcresAction's own convention: an unchanged
    // unit is the SAME object, a changed one is a new one.
    const bWatered = unit({ id: "b", isWatered: true, thirstyAt: null });
    const after = [a, bWatered];

    expect(touchedUnitIds(before, after)).toEqual(["b"]);
  });

  it("reports a brand new id as touched", () => {
    const a = unit({ id: "a" });
    const created = unit({ id: "sa-optimistic-1" });
    expect(touchedUnitIds([a], [a, created])).toEqual(["sa-optimistic-1"]);
  });

  it("reports a removed id as touched too", () => {
    const a = unit({ id: "a" });
    const harvested = unit({ id: "b" });
    expect(touchedUnitIds([a, harvested], [a])).toEqual(["b"]);
  });
});

describe("mergeIncomingStackAcresUnits", () => {
  it("passes an incoming response through untouched when nothing is pending", () => {
    const incoming = [unit({ id: "a" })];
    expect(mergeIncomingStackAcresUnits([], incoming, [])).toEqual(incoming);
  });

  /**
   * The exact repro: plant 4 crops in a burst (4 separate `stock` requests).
   * Crop #1's response lands first, built off a server read that ran before
   * crops #2-4 had committed -- so its `units` list has no idea they exist
   * yet. Without the merge, applying it wipes crops #2-4's still-good,
   * still-pending optimistic units off the screen until their OWN responses
   * land a moment later. That vanish-then-reappear is the reported flicker.
   */
  it("keeps a sibling's still-pending optimistic crop alive through an earlier response that has never heard of it", () => {
    const real1 = unit({ id: "real-1" });
    const opt2 = unit({ id: "sa-optimistic-2" });
    const opt3 = unit({ id: "sa-optimistic-3" });
    const opt4 = unit({ id: "sa-optimistic-4" });
    // The screen right before crop #1's response lands: all four guesses on
    // screen, three of them still under a made-up client id.
    const onScreen = [real1, opt2, opt3, opt4];
    // Crop #1's own response: the server has only ever heard of crop #1.
    const incoming = [real1];
    const pendingElsewhere = [opt2.id, opt3.id, opt4.id];

    const merged = mergeIncomingStackAcresUnits(onScreen, incoming, pendingElsewhere);

    expect(merged.map((u) => u.id).sort()).toEqual(["real-1", "sa-optimistic-2", "sa-optimistic-3", "sa-optimistic-4"]);
  });

  /**
   * The original water/feed repro: two crops tapped close together. The
   * first tap's response lands, built off a server read taken before the
   * second tap's write committed -- so it still shows the second crop dry.
   * Without the merge, that stale field overwrites the second crop's
   * already-correct optimistic "watered" state until its own response
   * lands and corrects it back a moment later.
   */
  it("keeps a sibling's still-pending field guess over a response that predates it", () => {
    const wateredLocally = unit({ id: "b", isWatered: true, thirstyAt: null });
    const onScreen = [unit({ id: "a", isWatered: true, thirstyAt: null }), wateredLocally];
    // Action A's response: crop "b" as the server saw it BEFORE action B's
    // water landed -- still dry.
    const incoming = [unit({ id: "a", isWatered: true, thirstyAt: null }), unit({ id: "b", isWatered: false })];

    const merged = mergeIncomingStackAcresUnits(onScreen, incoming, ["b"]);
    const b = merged.find((u) => u.id === "b");

    expect(b).toBe(wateredLocally);
  });

  it("lets an incoming response win once nothing else claims that id", () => {
    const onScreen = [unit({ id: "a", isWatered: true, thirstyAt: null })];
    const incoming = [unit({ id: "a", isWatered: false })];

    // No pending ids at all -- e.g. the claiming action has already
    // released once its own response was about to be painted.
    expect(mergeIncomingStackAcresUnits(onScreen, incoming, [])).toEqual(incoming);
  });

  it("drops a pending id the incoming response never mentions and the screen no longer has either", () => {
    // A pending id that isn't on screen (already reconciled away some other
    // way) contributes nothing -- the overlay only ever pulls from `prev`.
    const incoming = [unit({ id: "a" })];
    expect(mergeIncomingStackAcresUnits([], incoming, ["ghost-id"])).toEqual(incoming);
  });

  /**
   * Regression: harvest a crop (an optimistic REMOVAL, not just a field
   * change) while a sibling action is still in flight. The sibling's
   * response was built off a server read taken before the harvest
   * committed, so it still lists the harvested crop. Without treating a
   * removed id as "pending" too, that stale entry would pass straight
   * through the merge and bring the just-harvested crop back on screen.
   */
  it("keeps a sibling's optimistic harvest from being undone by a response that predates it", () => {
    const harvested = unit({ id: "gone", state: "ready" });
    const onScreen = [unit({ id: "a" })]; // "gone" already removed locally
    // Sibling action B's own response: server hasn't processed A's harvest
    // of "gone" yet, so it still lists it.
    const incoming = [unit({ id: "a" }), harvested];

    const merged = mergeIncomingStackAcresUnits(onScreen, incoming, ["gone"]);

    expect(merged.map((u) => u.id)).toEqual(["a"]);
  });
});
