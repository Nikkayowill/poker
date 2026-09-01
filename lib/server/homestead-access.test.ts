import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homesteadAllowedUserIds, isHomesteadAllowed } from "./homestead-access";
import { ensureProfile, linkProfileToUser } from "./profile-store";
import { randomUUID } from "crypto";

/**
 * The Homestead is on production but released to nobody except the accounts
 * named in HOMESTEAD_ALLOWED_USER_IDS, and hiding its catalog row is not what
 * keeps it that way -- the routes are. lib/arcade/retired.ts records the same
 * lesson from the retired casino games: a catalog edit hides a link, a
 * still-mounted handler is still reachable by anyone with the URL.
 *
 * The file walk below is deliberate. The property worth protecting is not
 * "today's two routes are gated" (a reader can see that) but "a route added
 * tomorrow cannot quietly skip it". A test that imported the handlers by name
 * would pass happily while a third, ungated route sat beside them.
 */

const API_DIR = join(process.cwd(), "app/api/homestead");
const PAGE = join(process.cwd(), "app/(lobby)/games/homestead/page.tsx");

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (entry === "route.ts" || entry === "route.tsx") found.push(path);
  }
  return found;
}

describe("the Homestead's account gate", () => {
  const routes = routeFiles(API_DIR);

  it("finds the routes it is supposed to be checking", () => {
    // Guards the guard: if the directory moves or is renamed, the loop below
    // would vacuously pass over an empty list.
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  it.each(routes.map((path) => [path.slice(process.cwd().length + 1), path]))(
    "gates %s behind the allowlist",
    (_label, path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("isHomesteadAllowed");
      expect(source).toContain("homesteadNotFound");
    },
  );

  it("gates the page too, which the admin-cookie version could not", () => {
    // ADMIN_SESSION_COOKIE was scoped path=/api/admin so a page never saw it.
    // The player session cookie is path=/, so this one answers a real 404.
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("isHomesteadAllowed");
    expect(source).toContain("notFound");
  });

  it("never mints a session before deciding, on any route", () => {
    // Order matters on the actions route in particular: the gate has to run
    // before a session is minted, or probing a closed endpoint hands the
    // prober a session cookie.
    for (const path of routes) {
      // Comments are stripped first, and both names are matched as CALLS
      // rather than as bare words. The first draft of this test did neither
      // and failed on the route it was policing, because the comment above
      // that route's gate explains the ordering by naming the very function
      // whose position it was measuring.
      const whole = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      // Only the handler body: every one of these names also appears in the
      // import block at the top, where the order means nothing.
      const source = whole.slice(whole.search(/^export async function/m));
      const gate = source.indexOf("isHomesteadAllowed(");
      const minting = source.indexOf("readOrCreateSessionToken(");
      expect(gate, `${path} must call the gate`).toBeGreaterThanOrEqual(0);
      if (minting >= 0) expect(gate).toBeLessThan(minting);
    }
  });
});

describe("who the allowlist lets through", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows nobody when the variable is unset or empty", async () => {
    // Fail closed, the same posture ADMIN_SECRET takes. This repo is public,
    // so there is no committed default to fall back on.
    vi.stubEnv("HOMESTEAD_ALLOWED_USER_IDS", "");
    expect(homesteadAllowedUserIds().size).toBe(0);

    const token = randomUUID();
    await ensureProfile(token);
    await linkProfileToUser(token, randomUUID());
    expect(await isHomesteadAllowed(token)).toBe(false);
  });

  it("allows a listed account and refuses an unlisted one", async () => {
    const mine = randomUUID();
    const theirs = randomUUID();
    vi.stubEnv("HOMESTEAD_ALLOWED_USER_IDS", ` ${mine.toUpperCase()} , `);

    const myToken = randomUUID();
    await ensureProfile(myToken);
    await linkProfileToUser(myToken, mine);
    // Matched case-insensitively and with the padding trimmed, so a value
    // pasted out of a dashboard with a stray space still works.
    expect(await isHomesteadAllowed(myToken)).toBe(true);

    const theirToken = randomUUID();
    await ensureProfile(theirToken);
    await linkProfileToUser(theirToken, theirs);
    expect(await isHomesteadAllowed(theirToken)).toBe(false);
  });

  it("refuses a guest, who has no account to be on the list", async () => {
    vi.stubEnv("HOMESTEAD_ALLOWED_USER_IDS", randomUUID());

    const guest = randomUUID();
    await ensureProfile(guest);
    expect(await isHomesteadAllowed(guest)).toBe(false);
    // And a caller with no session at all.
    expect(await isHomesteadAllowed(null)).toBe(false);
  });
});
