import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A budget, not a style rule.
 *
 * `view()` is what /api/stackacres returns and what nearly every action
 * returns when it settles, so this count is paid on every farm load and on
 * every tap. Each read is its own PostgREST round trip, not a join.
 *
 * It only ever went up, because adding a farm table and adding a read here
 * are the same commit, and each diff adds exactly one line -- nothing in
 * review shows the total. This is where the total shows. The queries are
 * individually cheap (~0.33ms, all indexed on profile_id), so if this gets
 * tight the answer is to batch them, not to tune them.
 */
describe("the StackAcres read budget", () => {
  const SERVICE = readFileSync(join(process.cwd(), "lib/server/stackacres-service.ts"), "utf8");

  /** The per-profile fan-out `view()` awaits before it composes its answer. */
  const fanOut = () => {
    const start = SERVICE.indexOf("async function view(");
    expect(start).toBeGreaterThan(-1);
    const end = SERVICE.indexOf("const secretDonations = secretItemDonations", start);
    expect(end).toBeGreaterThan(start);
    return SERVICE.slice(start, end);
  };

  it("reads a player's farm in 36 per-profile round trips", () => {
    // One line per read, so this counts the reads rather than the tables --
    // two of them (the secret ledger, friendship) are nested Promise.all's
    // over a list that is length 1 today and will not stay that way.
    expect(fanOut().split("(profile.id").length - 1).toBe(36);
  });

  it("still issues them in parallel", () => {
    // The count above is round trips, not latency, and that is only true
    // while they are awaited together. A `for` loop over these would turn 36
    // parallel round trips into 36 serial ones and multiply the wall-clock
    // cost of every farm load by roughly the same factor.
    expect(fanOut()).toContain("await Promise.all([");
  });

  it("returns the whole farm from the actions route too", () => {
    // Not a complaint, a reminder of the multiplier: this is why the budget
    // above is per TAP and not merely per page load. If actions ever answer
    // with a delta instead, this is the assertion that should change first.
    const settlements = SERVICE.split("view(").length - 1;
    expect(settlements).toBeGreaterThan(15);
  });
});
