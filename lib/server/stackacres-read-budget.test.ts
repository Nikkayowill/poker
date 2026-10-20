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
 * `stackacres_read_batch` (migration 20260914011736, widened by
 * 20260928232207), the live-Supabase path collapses nearly all of those into
 * ONE round trip; only Stone's read stays separate, because it's a GLOBAL
 * table, not per-profile (see the migration's own header). Memory mode has
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
  // The NEWEST migration that redefines the batch, not the first one that
  // did. Every later redefinition copies the whole body forward, so the
  // latest file is the live definition -- point this at the new file
  // whenever one of them redefines it again.
  const MIGRATION = readFileSync(
    join(process.cwd(), "supabase/migrations/20261003030350_stackacres_cut_fantasy_systems.sql"),
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

  it("the memory-mode fallback still reads a player's farm in 35 per-profile round trips", () => {
    // One line per read, so this counts the reads rather than the tables --
    // two of them (the secret ledger, friendship) are nested Promise.all's
    // over a list that is length 1 today and will not stay that way.
    // Meaningless for latency in memory mode (no network round trip exists
    // to save), but this is still the list a new farm table's read has to
    // join, or it silently only reads with a live Supabase configured.
    expect(fallbackArray().split("(profile.id").length - 1).toBe(35);
  });

  it("the live-Supabase branch reads the same farm in one batch call plus Stone's global read", () => {
    const body = fanOut();
    // Exactly one call: the whole point is that this replaces the ~37-way
    // fan-out above with a single round trip when Supabase is configured.
    expect(body.split("readStackAcresBatch(").length - 1).toBe(1);
    // Only Stone's read stays outside the batch: it is a GLOBAL table with
    // no profile id to key a batch RPC on. Asserting the count, not just
    // presence, is what catches a new table's read being added here instead
    // of folded into the batch -- the exact drift that let this list grow
    // from three exceptions to eleven unnoticed before the Far Field
    // migration (20260928232207) folded six of them back in.
    // 1: the batch call itself (`readStackAcresBatch(profile.id, ...)`).
    const preFallback = body.slice(0, body.indexOf(": Promise.all([\n"));
    expect(preFallback.split("(profile.id").length - 1).toBe(1);
    expect(preFallback).toContain("readAllStoneNodes(now)");
  });

  it("still issues every branch's reads in parallel", () => {
    // Round-trip counts above are meaningless if a `for` loop turned any of
    // them serial. The outer `Promise.all` covers the batch fetch and
    // Stone's read together; the inner one covers the memory-mode
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
    // The latest definition of the batch function, not the whole file: the
    // Far Field migration that redefines it also creates its own tables.
    const batchFn = MIGRATION.slice(MIGRATION.indexOf("create or replace function public.stackacres_read_batch"));
    const keys = batchFn.match(/^\s{4}'[a-z_]+', /gm) ?? [];
    // 38: the Far Field migration's 42, plus the Daily Farm Board's two
    // period rows (20261001180411), plus the guard dogs (20261001195736)
    // carried forward, plus the farm's acres (20261001204826), minus the
    // eight keys the fantasy systems cut took out (20261003030350).
    // The acres and the dogs ARE in the fallback array above. The board is NOT in the fallback array
    // above, and deliberately: its read is a conditional draw rather than a
    // plain per-table select (it writes a row on the period's first read),
    // so it lives in farmBoardView beside the other exceptions' reasoning.
    // It still belongs in the batch, or a live-Supabase farm would draw a
    // board it then could not see.
    expect(keys.length).toBe(38);
    expect(batchFn).toContain("'guard_dogs'");
    expect(batchFn).toContain("'acres'");
    expect(batchFn).toContain("'farm_board_daily'");
    expect(batchFn).toContain("'farm_board_weekly'");
  });

  it("returns the whole farm from the actions route too", () => {
    // Not a complaint, a reminder of the multiplier: this is why the budget
    // above is per TAP and not merely per page load. If actions ever answer
    // with a delta instead, this is the assertion that should change first.
    const settlements = SERVICE.split("view(").length - 1;
    expect(settlements).toBeGreaterThan(15);
  });
});
