import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { STACKACRES_STOCK } from "@/lib/stackacres/catalogue";

/**
 * Tables that pin stock names in a CHECK constraint refuse anything the
 * constraint does not list. The harvest ledger's list fell behind on
 * 2026-10-02 and every crop harvest's row was refused in production.
 */
function newestListFor(constraint: string): string[] {
  const dir = join(process.cwd(), "supabase/migrations");
  const sql = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse()
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .find((text) => text.includes(`add constraint ${constraint}`));
  expect(sql, constraint).toBeDefined();
  const after = sql!.slice(sql!.indexOf(`add constraint ${constraint}`));
  const list = /array\[([^\]]*)\]/.exec(after)?.[1] ?? "";
  return [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
}

describe("stock names in the database", () => {
  it.each(["homestead_units_stock_check", "homestead_harvests_stock_check"])("%s lists every stock the farm has", (constraint) => {
    expect(newestListFor(constraint)).toEqual([...STACKACRES_STOCK].sort());
  });
});
