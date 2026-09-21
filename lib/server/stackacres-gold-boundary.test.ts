import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Farm SQL that moves Gold inside its own transaction can't follow the farm into a
// separate database. These five predate the rule; new farm Gold goes through
// profile-store's ledgered functions from TypeScript instead.
const KNOWN_FARM_GOLD_FUNCTIONS = [
  "collect_stackacres_drone_forage",
  "deploy_stackacres_drone",
  "forge_stackacres_enchantment",
  "unlock_stackacres_perk",
];

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** The latest definition of every function still defined after all migrations run in order. */
function liveFunctionBodies(): Map<string, string> {
  const bodies = new Map<string, string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const events: { at: number; name: string; body: string | null }[] = [];
    const define = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(.*?\bas\s+\$(\w*)\$(.*?)\$\2\$/gis;
    for (const m of sql.matchAll(define)) events.push({ at: m.index, name: m[1], body: m[3] });
    const drop = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi;
    for (const m of sql.matchAll(drop)) events.push({ at: m.index, name: m[1], body: null });
    for (const event of events.sort((a, b) => a.at - b.at)) {
      if (event.body === null) bodies.delete(event.name);
      else bodies.set(event.name, event.body);
    }
  }
  return bodies;
}

describe("StackAcres Gold boundary", () => {
  it("no farm SQL function moves Gold beyond the five known ones", () => {
    const touchesFarm = /\b(homestead|stackacres)_\w+/i;
    const touchesGold = /spend_gold|credit_gold|adjust_gold|gold_balance/i;
    const offenders = [...liveFunctionBodies()]
      .filter(([, body]) => touchesFarm.test(body) && touchesGold.test(body))
      .map(([name]) => name)
      .sort();
    expect(offenders).toEqual(KNOWN_FARM_GOLD_FUNCTIONS);
  });
});
