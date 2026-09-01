import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  homesteadAccessCode,
  isHomesteadCode,
  isHomesteadUnlocked,
  withHomesteadPassCookie,
} from "./homestead-access";
import { NextResponse } from "next/server";

/**
 * The Homestead is on the arcade floor and behind an access code, so the tile
 * being visible is now doing none of the work -- the routes are.
 * lib/arcade/retired.ts records the same lesson from the retired casino games:
 * a catalog edit changes a link, a still-mounted handler is still reachable by
 * anyone with the URL.
 *
 * The file walk below is deliberate. The property worth protecting is not
 * "today's routes are gated" (a reader can see that) but "a route added
 * tomorrow cannot quietly skip it". A test that imported the handlers by name
 * would pass happily while a fourth, ungated route sat beside them.
 */

const API_DIR = join(process.cwd(), "app/api/homestead");
const PAGE = join(process.cwd(), "app/(lobby)/games/homestead/page.tsx");
const UNLOCK = join(API_DIR, "unlock/route.ts");

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (entry === "route.ts" || entry === "route.tsx") found.push(path);
  }
  return found;
}

/** Every route except the one whose whole job is to take the code. */
const gatedRoutes = routeFiles(API_DIR).filter((path) => path !== UNLOCK);

describe("the Homestead's code gate", () => {
  it("finds the routes it is supposed to be checking", () => {
    // Guards the guard: if the directory moves or is renamed, the loop below
    // would vacuously pass over an empty list.
    expect(gatedRoutes.length).toBeGreaterThanOrEqual(2);
  });

  it.each(gatedRoutes.map((path) => [path.slice(process.cwd().length + 1), path]))(
    "gates %s behind the pass",
    (_label, path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("requestHasHomesteadPass");
      expect(source).toContain("homesteadLocked");
    },
  );

  it("gates the page too", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("isHomesteadUnlocked");
  });

  it("never mints a session before deciding, on any route", () => {
    // Order matters on the actions route in particular: the gate has to run
    // before a session is minted, or probing a locked endpoint hands the
    // prober a session cookie.
    for (const path of gatedRoutes) {
      // Comments are stripped first, and the names are matched as CALLS
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
      const gate = source.indexOf("requestHasHomesteadPass(");
      const minting = source.indexOf("readOrCreateSessionToken(");
      expect(gate, `${path} must call the gate`).toBeGreaterThanOrEqual(0);
      if (minting >= 0) expect(gate).toBeLessThan(minting);
    }
  });

  it("rate limits the unlock route before it does anything else", () => {
    // The limiter is the only thing making a short code hard to guess, and
    // these routes move real Gold. It also has to come first: a check that
    // costs work in front of the limiter hands a flood an amplifier.
    const whole = readFileSync(UNLOCK, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const source = whole.slice(whole.search(/^export async function/m));
    expect(source).toContain("enforceRateLimit(");
    expect(source.indexOf("enforceRateLimit(")).toBeLessThan(source.indexOf("isHomesteadCode("));
  });
});

describe("what the code buys", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The cookie jar a response's Set-Cookie would produce on the next request. */
  function jarFrom(response: NextResponse): (name: string) => string | undefined {
    const set = new Map<string, string>();
    for (const cookie of response.cookies.getAll()) set.set(cookie.name, cookie.value);
    return (name) => set.get(name);
  }

  it("admits nobody when no code is configured", () => {
    // Fail closed, the same posture ADMIN_SECRET takes. This repo is public,
    // so there is no committed default to fall back on -- which also means a
    // forgotten variable looks exactly like a broken feature.
    vi.stubEnv("HOMESTEAD_ACCESS_CODE", "");
    expect(homesteadAccessCode()).toBeNull();
    expect(isHomesteadCode("")).toBe(false);
    expect(isHomesteadCode("anything")).toBe(false);
    expect(isHomesteadUnlocked(() => "whatever-was-in-the-jar")).toBe(false);
  });

  it("opens for the code and stays shut for anything else", () => {
    vi.stubEnv("HOMESTEAD_ACCESS_CODE", "back-forty");
    expect(isHomesteadCode("back-forty")).toBe(true);
    expect(isHomesteadCode("back-fort")).toBe(false);
    expect(isHomesteadCode("BACK-FORTY")).toBe(false);
  });

  it("issues a pass the next request accepts", () => {
    vi.stubEnv("HOMESTEAD_ACCESS_CODE", "back-forty");
    const jar = jarFrom(withHomesteadPassCookie(NextResponse.json({ ok: true })));
    expect(isHomesteadUnlocked(jar)).toBe(true);
  });

  it("never puts the code itself in the cookie", () => {
    // A pass that IS the code turns every browser's cookie jar into a copy of
    // the secret, readable by anything that can reach document.cookie on a
    // bad day.
    vi.stubEnv("HOMESTEAD_ACCESS_CODE", "back-forty");
    const response = withHomesteadPassCookie(NextResponse.json({ ok: true }));
    for (const cookie of response.cookies.getAll()) {
      expect(cookie.value).not.toContain("back-forty");
    }
  });

  it("invalidates every pass already issued when the code is rotated", () => {
    // The whole revocation story: there is no list to clear, because the
    // expected value is recomputed from whatever the code is right now.
    vi.stubEnv("HOMESTEAD_ACCESS_CODE", "back-forty");
    const jar = jarFrom(withHomesteadPassCookie(NextResponse.json({ ok: true })));
    expect(isHomesteadUnlocked(jar)).toBe(true);

    vi.stubEnv("HOMESTEAD_ACCESS_CODE", "north-field");
    expect(isHomesteadUnlocked(jar)).toBe(false);
  });

  it("does not accept a pass minted under a different SESSION_SECRET", () => {
    vi.stubEnv("HOMESTEAD_ACCESS_CODE", "back-forty");
    vi.stubEnv("SESSION_SECRET", "one");
    const jar = jarFrom(withHomesteadPassCookie(NextResponse.json({ ok: true })));
    expect(isHomesteadUnlocked(jar)).toBe(true);

    vi.stubEnv("SESSION_SECRET", "two");
    expect(isHomesteadUnlocked(jar)).toBe(false);
  });

  it("still works with no SESSION_SECRET set", () => {
    // Signing is optional app-wide, and an unset secret must never be a
    // second way for a feature to go dark -- the rule session.ts states for
    // its own token signing.
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("HOMESTEAD_ACCESS_CODE", "back-forty");
    const jar = jarFrom(withHomesteadPassCookie(NextResponse.json({ ok: true })));
    expect(isHomesteadUnlocked(jar)).toBe(true);
  });

  it("refuses an empty or absent cookie", () => {
    vi.stubEnv("HOMESTEAD_ACCESS_CODE", "back-forty");
    expect(isHomesteadUnlocked(() => undefined)).toBe(false);
    expect(isHomesteadUnlocked(() => "")).toBe(false);
  });
});
