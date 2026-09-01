import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * The Homestead is finished but not public, and hiding its catalog row is not
 * what keeps it that way -- the routes are. lib/arcade/retired.ts records the
 * same lesson from the retired casino games: a catalog edit hides a link, a
 * still-mounted handler is still reachable by anyone with the URL.
 *
 * These walk the filesystem rather than importing the routes, because the
 * property worth protecting is not "today's two routes are gated" (a reader
 * can see that) but "a route added tomorrow cannot quietly skip it". A test
 * that imported the handlers by name would pass happily while a third,
 * ungated route sat beside them.
 */

const API_DIR = join(process.cwd(), "app/api/admin/homestead");
const PAGE = join(process.cwd(), "app/admin/homestead/page.tsx");

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (entry === "route.ts" || entry === "route.tsx") found.push(path);
  }
  return found;
}

describe("the Homestead's staff gate", () => {
  const routes = routeFiles(API_DIR);

  it("finds the routes it is supposed to be checking", () => {
    // Guards the guard: if the directory moves or is renamed, the loop below
    // would vacuously pass over an empty list.
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  it.each(routes.map((path) => [path.slice(process.cwd().length + 1), path]))(
    "gates %s behind an admin session",
    (_label, path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("isStaffRequest");
      expect(source).toContain("staffOnlyNotFound");
    },
  );

  it("refuses before doing anything else in every route", () => {
    // Order matters on the actions route in particular: the gate has to run
    // before readOrCreateSessionToken, or probing a staff-only endpoint hands
    // the prober a session cookie.
    for (const path of routes) {
      // Only the handler body: every one of these names also appears in the
      // import block at the top, where the order means nothing.
      const whole = readFileSync(path, "utf8");
      const source = whole.slice(whole.search(/^export async function/m));
      const gate = source.indexOf("isStaffRequest");
      const limiter = source.indexOf("enforceRateLimit");
      const session = source.search(/read(OrCreate)?SessionToken/);
      expect(gate).toBeGreaterThan(-1);
      if (limiter > -1) expect(gate).toBeLessThan(limiter);
      if (session > -1) expect(gate).toBeLessThan(session);
    }
  });

  it("keeps the page under /admin and out of the search index", () => {
    // The page itself is not gated and cannot be: the admin cookie is scoped
    // to /api/admin, so a server component under /admin never receives it.
    // What keeps this closed is the API behind it, asserted above. All the
    // page owes is living in the right place and not being indexed.
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("index: false");
  });

  it("routes the catalog row at the admin path, not a public one", () => {
    // A staff-only row keeps a real href (it was built), and that href has to
    // point somewhere the admin cookie actually reaches.
    const games = readFileSync(join(process.cwd(), "lib/arcade/games.ts"), "utf8");
    expect(games).toContain('href: "/admin/homestead"');
    expect(games).not.toContain('"/games/homestead"');
  });
});
