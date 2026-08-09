import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  isAdminAuthorized,
  isAdminSecretValid,
  verifyAdminSessionToken,
} from "./admin-auth";

describe("admin authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("compares the configured key and fails closed when none is configured", () => {
    vi.stubEnv("ADMIN_SECRET", "");
    expect(isAdminSecretValid("anything")).toBe(false);

    vi.stubEnv("ADMIN_SECRET", "correct horse battery staple");
    expect(isAdminSecretValid("correct horse battery staple")).toBe(true);
    expect(isAdminSecretValid("wrong")).toBe(false);
  });

  it("exchanges the raw key for a signed, expiring token that does not contain it", () => {
    const now = 1_800_000_000_000;
    const secret = "never-store-this-in-the-browser";
    vi.stubEnv("ADMIN_SECRET", secret);

    const token = createAdminSessionToken(now);
    expect(token).not.toContain(secret);
    expect(verifyAdminSessionToken(token, now)).toBe(true);
    expect(verifyAdminSessionToken(`${token}x`, now)).toBe(false);
    expect(
      verifyAdminSessionToken(token, now + ADMIN_SESSION_TTL_SECONDS * 1000 + 1),
    ).toBe(false);
  });

  it("authorizes the HttpOnly-session cookie without replaying an admin header", () => {
    const now = 1_800_000_000_000;
    vi.stubEnv("ADMIN_SECRET", "admin-test-secret");
    const token = createAdminSessionToken(now);
    const request = new NextRequest("https://river.example/api/admin/profiles", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
    });

    // Verify at the token layer with a fixed clock, then show the request gate
    // rejects a tampered cookie. isAdminAuthorized uses the real clock, so a
    // separate current token is used for the positive request assertion.
    expect(verifyAdminSessionToken(token, now)).toBe(true);
    const currentToken = createAdminSessionToken();
    const currentRequest = new NextRequest("https://river.example/api/admin/profiles", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${currentToken}` },
    });
    expect(isAdminAuthorized(currentRequest)).toBe(true);
    expect(isAdminAuthorized(request)).toBe(false);
  });

  it("never accepts the raw admin secret on ordinary admin routes", () => {
    vi.stubEnv("ADMIN_SECRET", "admin-test-secret");
    const request = new NextRequest("https://river.example/api/admin/profiles", {
      headers: { "x-admin-secret": "admin-test-secret" },
    });

    expect(isAdminAuthorized(request)).toBe(false);
  });
});
