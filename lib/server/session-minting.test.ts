import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reading must never create a player.
 *
 * Four read-only routes once called readOrCreateSessionToken, so every
 * cookie-less GET minted a session token and inserted a profile. A first page
 * load fires several of those in parallel, each mints its own token, and only
 * the last Set-Cookie survives -- so a single visit left behind a handful of
 * abandoned profiles named "Player", and browsing repeatedly piled up dozens.
 *
 * These are source-level assertions on purpose: the bug was one import, and it
 * type-checks and passes every behavioural test in both shapes. Only a rule
 * about which routes are allowed to mint identities can catch it coming back.
 */

const API_ROOT = join(process.cwd(), "app", "api");
const MINTING_CALL = "readOrCreateSessionToken";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

const routes = routeFiles(API_ROOT).map((path) => {
  const source = readFileSync(path, "utf8");
  return {
    name: relative(process.cwd(), path),
    source,
    handlers: [...source.matchAll(/export async function ([A-Z]+)/g)].map((match) => match[1]),
    mints: source.includes(MINTING_CALL),
  };
});

describe("session minting", () => {
  it("finds the API routes to check", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it("never mints a session token in a read-only route", () => {
    const offenders = routes
      .filter((route) => route.mints)
      .filter((route) => route.handlers.every((handler) => handler === "GET"))
      .map((route) => route.name);

    expect(offenders).toEqual([]);
  });

  it("keeps the previously-broken read routes free of minting", () => {
    const readRoutes = [
      "app/api/cosmetics/route.ts",
      "app/api/leaderboard/route.ts",
      "app/api/legal/status/route.ts",
      "app/api/stripe/tiers/route.ts",
    ];

    for (const name of readRoutes) {
      const route = routes.find((candidate) => candidate.name === name);
      expect(route, `${name} should exist`).toBeDefined();
      expect(route?.mints, `${name} must not mint a session token`).toBe(false);
    }
  });
});
