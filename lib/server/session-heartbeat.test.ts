import { beforeEach, describe, expect, it } from "vitest";
import {
  dueForHeartbeat,
  markHeartbeatWritten,
  resetHeartbeatTracking,
} from "./session-heartbeat";

const MINUTE = 60 * 1000;
const T0 = Date.UTC(2026, 8, 12, 12, 0, 0);

/**
 * The throttle only. `touchSession`'s write needs a Supabase client, which is
 * absent here by design (blanked env), and the decision of WHETHER to write is
 * the part with rules worth pinning.
 */
describe("the session heartbeat throttle", () => {
  beforeEach(() => resetHeartbeatTracking());

  it("writes the first time a token is seen", () => {
    expect(dueForHeartbeat("tok", T0)).toBe(true);
  });

  it("does not write again inside the window", () => {
    expect(dueForHeartbeat("tok", T0)).toBe(true);
    expect(dueForHeartbeat("tok", T0)).toBe(false);
    expect(dueForHeartbeat("tok", T0 + 4 * MINUTE)).toBe(false);
    // A busy player makes far more than three requests in five minutes; the
    // point is that all of them after the first cost nothing.
    expect(dueForHeartbeat("tok", T0 + 5 * MINUTE - 1)).toBe(false);
  });

  it("writes again once the window has passed", () => {
    expect(dueForHeartbeat("tok", T0)).toBe(true);
    expect(dueForHeartbeat("tok", T0 + 5 * MINUTE)).toBe(true);
  });

  it("keeps a token fresh well inside the thirty minute staleness cutoff", () => {
    // The contract that matters: game-store.ts retires a table when every
    // human seat's last_seen_at is older than staleTableMs() (30 minutes).
    // Writing every 5 means an active player is never more than 5 minutes
    // stale, so an active table is never a sweep candidate.
    let lastWrite = T0;
    for (let minute = 0; minute <= 120; minute += 1) {
      const now = T0 + minute * MINUTE;
      if (dueForHeartbeat("tok", now)) lastWrite = now;
      expect(now - lastWrite).toBeLessThan(30 * MINUTE);
    }
  });

  it("tracks tokens independently", () => {
    expect(dueForHeartbeat("a", T0)).toBe(true);
    expect(dueForHeartbeat("b", T0)).toBe(true);
    expect(dueForHeartbeat("a", T0)).toBe(false);
    expect(dueForHeartbeat("b", T0)).toBe(false);
  });

  it("treats a freshly created row as already written", () => {
    markHeartbeatWritten("tok", T0);
    expect(dueForHeartbeat("tok", T0 + MINUTE)).toBe(false);
    expect(dueForHeartbeat("tok", T0 + 5 * MINUTE)).toBe(true);
  });

  it("sheds stale entries instead of growing without bound", () => {
    // Fill past the cap with tokens that will all be expired by the sweep.
    for (let i = 0; i < 10_000; i += 1) dueForHeartbeat(`old-${i}`, T0);

    // An hour later a new token arrives: the sweep runs and drops the
    // expired entries rather than letting the map keep climbing.
    const later = T0 + 60 * MINUTE;
    expect(dueForHeartbeat("fresh", later)).toBe(true);

    // Evicted, so this reads as a first sighting again -- which costs one
    // extra write and never a missed one.
    expect(dueForHeartbeat("old-0", later)).toBe(true);
  });
});
