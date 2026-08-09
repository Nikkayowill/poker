import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSessionToken,
  readSessionPersistence,
  rememberCookieName,
  sessionCookieName,
  withRequestSessionCookie,
  withSessionPreferenceCookie,
  withoutSessionCookie,
} from "./session";

describe("session persistence preference", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to a persistent StackChips identity", () => {
    const request = new NextRequest("https://stackchips.test/");
    const response = withRequestSessionCookie(request, NextResponse.json({ ok: true }), "player-token");

    expect(readSessionPersistence(request)).toBe(true);
    expect(response.cookies.get("river_session")?.maxAge).toBeGreaterThan(0);
  });

  it("keeps subsequent gameplay cookies session-only when remember is off", () => {
    const request = new NextRequest("https://stackchips.test/", {
      headers: { cookie: "river_remember=false" },
    });
    const response = withRequestSessionCookie(request, NextResponse.json({ ok: true }), "player-token");

    expect(readSessionPersistence(request)).toBe(false);
    expect(response.cookies.get("river_session")?.maxAge).toBeUndefined();
  });

  it("clears both the identity and its persistence preference on sign-out", () => {
    const preferred = withSessionPreferenceCookie(NextResponse.json({ ok: true }), true);
    expect(preferred.cookies.get("river_remember")?.value).toBe("true");

    const signedOut = withoutSessionCookie(NextResponse.json({ ok: true }));
    expect(signedOut.cookies.get("river_session")?.maxAge).toBe(0);
    expect(signedOut.cookies.get("river_remember")?.maxAge).toBe(0);
  });

  it("rejects malformed session cookies before they reach a store", () => {
    const malformed = new NextRequest("https://stackchips.test/", {
      headers: { cookie: "river_session=not-a-uuid" },
    });
    const valid = new NextRequest("https://stackchips.test/", {
      headers: { cookie: "river_session=123e4567-e89b-42d3-a456-426614174000" },
    });

    expect(readSessionToken(malformed)).toBeNull();
    expect(readSessionToken(valid)).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("uses __Host cookies in production while accepting the migration cookie", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieName()).toBe("__Host-river_session");
    expect(rememberCookieName()).toBe("__Host-river_remember");

    const legacy = new NextRequest("https://stackchips.test/", {
      headers: { cookie: "river_session=123e4567-e89b-42d3-a456-426614174000" },
    });
    expect(readSessionToken(legacy)).toBe("123e4567-e89b-42d3-a456-426614174000");

    const response = withRequestSessionCookie(
      legacy,
      NextResponse.json({ ok: true }),
      "123e4567-e89b-42d3-a456-426614174000",
    );
    expect(response.cookies.get("__Host-river_session")?.secure).toBe(true);
    expect(response.cookies.get("__Host-river_session")?.path).toBe("/");
    expect(response.cookies.get("river_session")?.maxAge).toBe(0);
  });
});
