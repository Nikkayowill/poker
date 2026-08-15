import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSessionToken,
  readSessionPersistence,
  rememberCookieName,
  sessionCookieName,
  withRequestSessionCookie,
  withSessionCookie,
  withSessionPreferenceCookie,
  withoutSessionCookie,
} from "./session";

const VALID_UUID = "123e4567-e89b-42d3-a456-426614174000";

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

describe("session token signing (SESSION_SECRET)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores a bare UUID when SESSION_SECRET is unset -- signing is fully optional", () => {
    const response = withSessionCookie(NextResponse.json({ ok: true }), VALID_UUID);
    expect(response.cookies.get("river_session")?.value).toBe(VALID_UUID);
  });

  it("signs the cookie once SESSION_SECRET is set, and reads its own signed value back", () => {
    vi.stubEnv("SESSION_SECRET", "test-secret");

    const written = withSessionCookie(NextResponse.json({ ok: true }), VALID_UUID);
    const storedValue = written.cookies.get("river_session")?.value ?? "";
    expect(storedValue).not.toBe(VALID_UUID);
    expect(storedValue.startsWith(`${VALID_UUID}.`)).toBe(true);

    const request = new NextRequest("https://stackchips.test/", {
      headers: { cookie: `river_session=${storedValue}` },
    });
    expect(readSessionToken(request)).toBe(VALID_UUID);
  });

  it("still accepts a legacy unsigned cookie once SESSION_SECRET is set, so turning on signing cannot sign out an existing session", () => {
    vi.stubEnv("SESSION_SECRET", "test-secret");
    const legacy = new NextRequest("https://stackchips.test/", {
      headers: { cookie: `river_session=${VALID_UUID}` },
    });
    expect(readSessionToken(legacy)).toBe(VALID_UUID);
  });

  it("rejects a tampered signature", () => {
    vi.stubEnv("SESSION_SECRET", "test-secret");
    const written = withSessionCookie(NextResponse.json({ ok: true }), VALID_UUID);
    const storedValue = written.cookies.get("river_session")?.value ?? "";
    const tampered = `${storedValue.split(".")[0]}.not-the-real-signature`;

    const request = new NextRequest("https://stackchips.test/", {
      headers: { cookie: `river_session=${tampered}` },
    });
    expect(readSessionToken(request)).toBeNull();
  });

  it("rejects a signature produced under a different secret", () => {
    vi.stubEnv("SESSION_SECRET", "secret-a");
    const written = withSessionCookie(NextResponse.json({ ok: true }), VALID_UUID);
    const storedValue = written.cookies.get("river_session")?.value ?? "";

    vi.stubEnv("SESSION_SECRET", "secret-b");
    const request = new NextRequest("https://stackchips.test/", {
      headers: { cookie: `river_session=${storedValue}` },
    });
    expect(readSessionToken(request)).toBeNull();
  });

  it("rejects a signed-looking value when no secret is configured to verify it", () => {
    const request = new NextRequest("https://stackchips.test/", {
      headers: { cookie: `river_session=${VALID_UUID}.some-signature` },
    });
    expect(readSessionToken(request)).toBeNull();
  });
});
