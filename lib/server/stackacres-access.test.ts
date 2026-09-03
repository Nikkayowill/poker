import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { tokenHasStackAcresAccess } from "./stackacres-access";
import { ensureProfile, setStackAcresAccess } from "./profile-store";

/**
 * The StackAcres is on the arcade floor and open only to profiles an admin has
 * let in, so the tile being visible is doing none of the work -- the routes
 * are. lib/arcade/retired.ts records the same lesson from the retired casino
 * games: a catalog edit changes a link, a still-mounted handler is still
 * reachable by anyone with the URL.
 *
 * The file walk below is deliberate. The property worth protecting is not
 * "today's routes are gated" (a reader can see that) but "a route added
 * tomorrow cannot quietly skip it". A test that imported the handlers by name
 * would pass happily while a third, ungated route sat beside them.
 */

const API_DIR = join(process.cwd(), "app/api/stackacres");
const PAGE = join(process.cwd(), "app/(lobby)/games/stackacres/page.tsx");

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (entry === "route.ts" || entry === "route.tsx") found.push(path);
  }
  return found;
}

const gatedRoutes = routeFiles(API_DIR);

/** A handler's body with comments stripped, for asking what runs before what. */
function handlerBody(path: string): string {
  // Comments are stripped first, and names are matched as CALLS rather than
  // bare words. An earlier version of this test did neither and failed on the
  // route it was policing, because the comment above that route's gate
  // explains the ordering by naming the very function whose position it was
  // measuring.
  const whole = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  return whole.slice(whole.search(/^export async function/m));
}

describe("the StackAcres's access gate", () => {
  it("finds the routes it is supposed to be checking", () => {
    // Guards the guard: if the directory moves or is renamed, the loop below
    // would vacuously pass over an empty list.
    expect(gatedRoutes.length).toBeGreaterThanOrEqual(2);
  });

  it.each(gatedRoutes.map((path) => [path.slice(process.cwd().length + 1), path]))(
    "gates %s",
    (_label, path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("tokenHasStackAcresAccess");
      expect(source).toContain("stackacresLocked");
    },
  );

  it("gates the page too", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("tokenHasStackAcresAccess");
  });

  it("rate limits before the gate, on every route", () => {
    // The gate costs a database read now that the guest list lives in the
    // profiles table. A check that costs work in front of the limiter hands an
    // unauthenticated flood a query amplifier -- the same ordering rule the
    // account-allowlist version of this gate established.
    for (const path of gatedRoutes) {
      const source = handlerBody(path);
      const limiter = source.indexOf("enforceRateLimit(");
      const gate = source.indexOf("tokenHasStackAcresAccess(");
      expect(limiter, `${path} must rate limit`).toBeGreaterThanOrEqual(0);
      expect(gate, `${path} must call the gate`).toBeGreaterThanOrEqual(0);
      expect(limiter).toBeLessThan(gate);
    }
  });

  it("never mints a session on any route", () => {
    // A session minted for a caller who is not on the list is an identity a
    // prober never asked for, handed out by a refusal. It is also useless: a
    // fresh token has no profile behind it, so it could never be on the list.
    for (const path of gatedRoutes) {
      expect(handlerBody(path)).not.toContain("readOrCreateSessionToken(");
    }
  });
});

describe("who the gate lets in", () => {
  it("refuses a caller with no session at all", async () => {
    expect(await tokenHasStackAcresAccess(null)).toBe(false);
    expect(await tokenHasStackAcresAccess("")).toBe(false);
  });

  it("refuses a real player who has not been granted access", async () => {
    // Fail closed: the column defaults to false, so shipping the gate admits
    // nobody until somebody is named in the admin dashboard.
    const token = `stackacres-gate-fresh-${Math.random()}`;
    const profile = await ensureProfile(token);
    expect(profile.id).toBeTruthy();
    expect(await tokenHasStackAcresAccess(token)).toBe(false);
  });

  it("opens for a granted profile and shuts again when it is revoked", async () => {
    const token = `stackacres-gate-granted-${Math.random()}`;
    const profile = await ensureProfile(token);

    await setStackAcresAccess(profile.id, true);
    expect(await tokenHasStackAcresAccess(token)).toBe(true);

    // Revocation is the same switch thrown back, with no cookie left holding a
    // pass -- which is the thing a shared code could not do for one person.
    await setStackAcresAccess(profile.id, false);
    expect(await tokenHasStackAcresAccess(token)).toBe(false);
  });

  it("grants access to one profile without opening it for another", async () => {
    const granted = `stackacres-gate-one-${Math.random()}`;
    const other = `stackacres-gate-two-${Math.random()}`;
    const grantedProfile = await ensureProfile(granted);
    await ensureProfile(other);

    await setStackAcresAccess(grantedProfile.id, true);
    expect(await tokenHasStackAcresAccess(granted)).toBe(true);
    expect(await tokenHasStackAcresAccess(other)).toBe(false);
  });

  it("refuses to grant access to a profile that does not exist", async () => {
    await expect(
      setStackAcresAccess("00000000-0000-4000-8000-000000000000", true),
    ).rejects.toThrow(/not found/i);
  });
});
