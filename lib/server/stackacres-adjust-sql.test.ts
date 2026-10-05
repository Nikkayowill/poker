import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * The adjust_homestead_* functions spend by passing a negative delta. One
 * that upserts greatest(p_delta, 0) with no p_delta < 0 branch reports a
 * spend of something the player never held as a success in production,
 * while memory mode refuses it. Seed, feed and the secret ledger shipped that
 * way until 2026-10-05.
 */
const GUARDED = [
  "adjust_homestead_seed_stock",
  "adjust_homestead_feed",
  "adjust_homestead_secret_ledger",
  "adjust_homestead_processing_inventory",
];

function newestBody(fn: string): string {
  const dir = join(process.cwd(), "supabase/migrations");
  const sql = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse()
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .find((text) => text.includes(`create or replace function public.${fn}(`));
  expect(sql, fn).toBeDefined();
  const start = sql!.indexOf(`create or replace function public.${fn}(`);
  return sql!.slice(start, sql!.indexOf("$$;", start));
}

describe("spends in the database", () => {
  it.each(GUARDED)("%s refuses a spend of more than is held", (fn) => {
    const body = newestBody(fn);
    expect(body).toContain("if p_delta < 0 then");
    expect(body).toContain("check_violation");
    expect(body).not.toContain("greatest(p_delta, 0)");
  });
});
