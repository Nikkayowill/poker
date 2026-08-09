import "server-only";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const LEGACY_COOKIE_NAME = "river_session";
const HOST_COOKIE_NAME = "__Host-river_session";
const LEGACY_REMEMBER_COOKIE_NAME = "river_remember";
const HOST_REMEMBER_COOKIE_NAME = "__Host-river_remember";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? HOST_COOKIE_NAME : LEGACY_COOKIE_NAME;
}

export function rememberCookieName(): string {
  return process.env.NODE_ENV === "production" ? HOST_REMEMBER_COOKIE_NAME : LEGACY_REMEMBER_COOKIE_NAME;
}

function cookieOptions(persistent: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(persistent ? { maxAge: COOKIE_MAX_AGE } : {}),
  };
}

function expireCookie(response: NextResponse, name: string): void {
  response.cookies.set(name, "", { ...cookieOptions(false), maxAge: 0 });
}

export function readSessionToken(request: NextRequest): string | null {
  const token = request.cookies.get(HOST_COOKIE_NAME)?.value
    ?? request.cookies.get(LEGACY_COOKIE_NAME)?.value
    ?? null;
  // Reject malformed bearer values before they reach a UUID comparison in
  // Postgres. This turns garbage-cookie probes into a cheap local miss rather
  // than a database error and keeps every session consumer on one contract.
  return token && UUID_PATTERN.test(token) ? token : null;
}

export function readOrCreateSessionToken(request: NextRequest): string {
  return readSessionToken(request) ?? randomUUID();
}

export function readSessionPersistence(request: NextRequest): boolean {
  const value = request.cookies.get(HOST_REMEMBER_COOKIE_NAME)?.value
    ?? request.cookies.get(LEGACY_REMEMBER_COOKIE_NAME)?.value;
  return value !== "false";
}

export function withSessionCookie<T extends NextResponse>(
  response: T,
  token: string,
  options: { persistent?: boolean } = {},
): T {
  const persistent = options.persistent ?? true;
  response.cookies.set(sessionCookieName(), token, cookieOptions(persistent));
  if (sessionCookieName() !== LEGACY_COOKIE_NAME) expireCookie(response, LEGACY_COOKIE_NAME);
  return response;
}

export function withRequestSessionCookie<T extends NextResponse>(
  request: NextRequest,
  response: T,
  token: string,
): T {
  return withSessionCookie(response, token, { persistent: readSessionPersistence(request) });
}

export function withSessionPreferenceCookie<T extends NextResponse>(
  response: T,
  persistent: boolean,
): T {
  response.cookies.set(rememberCookieName(), String(persistent), cookieOptions(persistent));
  if (rememberCookieName() !== LEGACY_REMEMBER_COOKIE_NAME) {
    expireCookie(response, LEGACY_REMEMBER_COOKIE_NAME);
  }
  return response;
}

/**
 * Drops the session cookie, which is what actually ends a sign-in: this
 * cookie is the credential every gameplay route trusts, so clearing the
 * provider's session alone would leave the next person at this browser
 * holding the previous player's profile.
 */
export function withoutSessionCookie<T extends NextResponse>(response: T): T {
  for (const name of new Set([
    HOST_COOKIE_NAME,
    LEGACY_COOKIE_NAME,
    HOST_REMEMBER_COOKIE_NAME,
    LEGACY_REMEMBER_COOKIE_NAME,
  ])) {
    expireCookie(response, name);
  }
  return response;
}
