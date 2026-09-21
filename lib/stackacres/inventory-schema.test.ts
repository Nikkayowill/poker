import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MACHINE_ITEM_IDS } from "./machine-items";

/**
 * Every item the code can put in `homestead_processing_inventory` has to be
 * in the table's item CHECK, or the credit is rejected and the game never
 * notices. Wood and Stone went missing that way: the chop and mine routes
 * paid out in tests (memory mode has no CHECK) while production rejected
 * every credit.
 *
 * This reads the newest migration that defines the constraint, the same one
 * a fresh database ends up with.
 */

const CONSTRAINT = "homestead_processing_inventory_item_check";
const DEFINITION = new RegExp(
  `add constraint ${CONSTRAINT}\\s+check\\s*\\(\\s*item\\s+in\\s*\\(([\\s\\S]*?)\\)\\s*\\)`,
);

function latestAllowedItems(): { file: string; items: Set<string> } {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  let found: { file: string; items: Set<string> } | null = null;
  for (const file of files) {
    const match = DEFINITION.exec(readFileSync(path.join(dir, file), "utf8"));
    if (!match) continue;
    found = { file, items: new Set([...match[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])) };
  }
  if (!found) throw new Error(`No migration defines ${CONSTRAINT} as "check (item in (...))".`);
  return found;
}

describe("homestead_processing_inventory item check", () => {
  it("allows every item the game can store", () => {
    const { file, items } = latestAllowedItems();
    const missing = ALL_MACHINE_ITEM_IDS.filter((id) => !items.has(id));
    expect(missing, `${file} does not allow: ${missing.join(", ")}`).toEqual([]);
  });

  it("allows Wood and Stone, which the Mill, Loom, Feed Silo and Cellar cost", () => {
    const { items } = latestAllowedItems();
    expect(items.has("wood")).toBe(true);
    expect(items.has("stone")).toBe(true);
  });
});
