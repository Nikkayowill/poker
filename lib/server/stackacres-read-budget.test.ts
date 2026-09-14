import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A budget, not a style rule.
 *
 * `view()` is what /api/stackacres returns and what nearly every action
 * returns when it settles, so whatever this pins is paid on every farm load
 * and on every tap. Nothing in review shows the total on its own -- this is
 * where it shows.
 *
 * UP TO 2026-09-14, `view()` fired ~35 separate per-profile PostgREST round
 * trips in one flat `Promise.all`, one per table, and this file counted them
 * with a single `"(profile.id"` regex over that array literal. Since
 * `stackacres_read_batch` (migration 20260914000000), the live-Supabase path
 * collapses nearly all of those into ONE round trip; only three reads stay
 * separate because they are already their own aggregate/idle-sweep RPCs, not
 * a plain per-table select (see the migration's own header). Memory mode has
 * no batch to speak of -- there is no network round trip to save there in
 * the first place -- and still runs every original individual read, so THAT
 * list is what a new farm table's read actually has to be added to; the
 * batch RPC is what a new farm table's read *also* has to be added to, on
 * the live-Supabase side, or it silently never shows up outside memory mode.
 * Both budgets are pinned below so adding one without the other fails a test
 * instead of shipping a table that only half-reads.
 */
describe("the StackAcres read budget", () => {
  const SERVICE = readFileSync(join(process.cwd(), "lib/server/stackacres-service.ts"), "utf8");
  const MIGRATION = readFileSync(
    join(process.cwd(), "supabase/migrations/20260914000000_stackacres_read_batch.sql"),
    "utf8",
  );

  /** The per-profile fan-out `view()` awaits before it composes its answer. */
  const fanOut = () => {
    const start = SERVICE.indexOf("async function view(");
    expect(start).toBeGreaterThan(-1);
    const end = SERVICE.indexOf("const secretDonations = secretItemDonations", start);
    expect(end).toBeGreaterThan(start);
    return SERVICE.slice(start, end);
  };

  /** Just the memory-mode fallback array -- the per-table reads `view()`
   *  still runs one at a time when there is no batch to fetch. */
  const fallbackArray = () => {
    const body = fanOut();
    const start = body.indexOf(": Promise.all([\n");
    expect(start).toBeGreaterThan(-1);
    const end = body.indexOf("] as const),", start);
    expect(end).toBeGreaterThan(start);
    return body.slice(start, end);
  };

  it("the memory-mode fallback still reads a player's farm in 33 per-profile round trips", () => {
    // One line per read, so this counts the reads rather than the tables --
    // two of them (the secret ledger, friendship) are nested Promise.all's
    // over a list that is length 1 today and will not stay that way.
    // Meaningless for latency in memory mode (no network round trip exists
    // to save), but this is still the list a new farm table's read has to
    // join, or it silently only reads with a live Supabase configured.
    expect(fallbackArray().split("(profile.id").length - 1).toBe(33);
  });

  it("the live-Supabase branch reads the same farm in one batch call plus three RPC-only exceptions", () => {
    const body = fanOut();
    // Exactly one call: the whole point is that this replaces the ~30-way
    // fan-out above with a single round trip when Supabase is configured.
    expect(body.split("readStackAcresBatch(").length - 1).toBe(1);
    // The three reads the batch migration's own header says it deliberately
    // leaves out (already their own aggregate/idle-sweep RPCs, not a plain
    // per-table select) still have to actually run -- this is what would
    // catch one of them being silently dropped in a future edit rather than
    // properly folded in or left as its own call.
    expect(body).toContain("listActiveSynergyArchetypes(profile.id)");
    expect(body).toContain("readMidnightMerchantVisit(profile.id, now)");
    expect(body).toContain("readStackAcresLifetimeGross(profile.id)");
  });

  it("still issues every branch's reads in parallel", () => {
    // Round-trip counts above are meaningless if a `for` loop turned any of
    // them serial. The outer `Promise.all` covers the batch fetch and the
    // three RPC exceptions together; the inner one covers the memory-mode
    // fallback's own per-table reads.
    const body = fanOut();
    expect(body).toContain("await Promise.all([");
    expect(fallbackArray()).toBeTruthy();
  });

  it("the batch RPC actually covers that same table list, not a stale subset", () => {
    // Counts `'key', (select ...` entries in the migration's jsonb_build_object
    // -- one per table the batch hands back. Pinned for the same reason the
    // fallback count above is: a new farm table added to the fallback list
    // without a matching entry here would silently only read with no
    // Supabase configured, exactly backwards from every other gap this file
    // exists to catch.
    const keys = MIGRATION.match(/^\s{4}'[a-z_]+', /gm) ?? [];
    expect(keys.length).toBe(33);
  });

  it("returns the whole farm from the actions route too", () => {
    // Not a complaint, a reminder of the multiplier: this is why the budget
    // above is per TAP and not merely per page load. If actions ever answer
    // with a delta instead, this is the assertion that should change first.
    const settlements = SERVICE.split("view(").length - 1;
    expect(settlements).toBeGreaterThan(15);
  });
});
