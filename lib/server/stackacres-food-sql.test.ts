import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { FOOD_ITEMS } from "@/lib/stackacres/energy";

/**
 * `eat_homestead_food` keeps its own list of what counts as food, and refuses
 * anything else. Sauerkraut was added to FOOD_ITEMS on 2026-10-02 without the
 * SQL, so eating it failed in production while memory mode allowed it.
 */
describe("the database's food list", () => {
  it("matches FOOD_ITEMS in the newest migration that defines eat_homestead_food", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const newest = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .reverse()
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .find((sql) => sql.includes("create or replace function public.eat_homestead_food("));
    expect(newest).toBeDefined();
    const list = /p_item not in \(([^)]*)\)/.exec(newest!)?.[1];
    expect(list).toBeDefined();
    const foods = [...list!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
    expect(foods).toEqual([...FOOD_ITEMS].sort());
  });
});
