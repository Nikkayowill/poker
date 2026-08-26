import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const LEGACY_COOKIE_NAME = "river_session";
const HOST_COOKIE_NAME = "__Host-river_session";
const LEGACY_REMEMBER_COOKIE_NAME = "river_remember";
const HOST_REMEMBER_COOKIE_NAME = "__Host-river_remember";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeTextEqual(first: string, second: string): boolean {
  // Hash both to a fixed length first: timingSafeEqual throws on a length
  // mismatch, and comparing raw attacker-controlled strings would make that
  // throw itself an oracle. Duplicated from admin-auth.ts's helper, same
  // reasoning CLAUDE.md gives for not sharing the Gold RPCs' bodies: this is
  // a live security primitive, not something to couple two modules over
  // saving four lines.
  const firstHash = createHash("sha256").update(first).digest();
  const secondHash = createHash("sha256").update(second).digest();
  return timingSafeEqual(firstHash, secondHash);
}

function sessionSignature(uuid: string, secret: string): string {
  return createHmac("sha256", secret).update(`stackchips-session:${uuid}`).digest("base64url");
}

/**
 * Signs a bearer session token against SESSION_SECRET, so a client-supplied
 * cookie value can round-trip a previously server-issued identity but never
 * mint one. Optional: unset, every function here behaves exactly as it
 * always has (a bare UUID, unsigned). This is additive hardening against a
 * future injection primitive (nothing today reflects request input into a
 * Set-Cookie header, so there is currently no way to plant a chosen value in
 * a victim's cookie jar), not a fix for a reachable exploit. It must never
 * become a second way for guest play to go dark the way credit_gold's
 * missing migration did (see CLAUDE.md's deploy checklist): an unset secret
 * has to mean "no signing," never "no session."
 */
function signToken(uuid: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return uuid;
  return `${uuid}.${sessionSignature(uuid, secret)}`;
}

/**
 * Verifies a raw cookie value and returns the bare UUID identity it names,
 * or null. Accepts three shapes: a correctly-signed token; a bare UUID with
 * no SESSION_SECRET configured (signing is off); and, for as long as any
 * session minted before signing shipped is still alive, a bare UUID with no
 * signature even though a secret is configured now. Rejecting that last
 * shape the moment signing turns on would sign out, and for a guest orphan
 * the Gold balance of, every existing session in one deploy; accepting it
 * costs nothing signing itself was meant to close, since it is exactly
 * today's behavior for that one shape. New cookies are always signed (see
 * withSessionCookie), so this transition window closes itself as old
 * cookies expire or get overwritten, same as the __Host- cookie-name
 * migration above.
 */
function verifyToken(value: string): string | null {
  if (UUID_PATTERN.test(value)) return value;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const [uuid, signature, ...extra] = value.split(".");
  if (!uuid || !signature || extra.length > 0 || !UUID_PATTERN.test(uuid)) return null;
  return safeTextEqual(signature, sessionSignature(uuid, secret)) ? uuid : null;
}

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
  const raw = request.cookies.get(HOST_COOKIE_NAME)?.value
    ?? request.cookies.get(LEGACY_COOKIE_NAME)?.value
    ?? null;
  // Reject malformed bearer values before they reach a UUID comparison in
  // Postgres. This turns garbage-cookie probes into a cheap local miss rather
  // than a database error and keeps every session consumer on one contract.
  // verifyToken also checks a signature when one is present/configured (see
  // its own doc comment) but always returns a bare UUID or null, so every
  // caller downstream of this function is unchanged.
  return raw ? verifyToken(raw) : null;
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
  // `token` is always the bare identity UUID; every other caller in the
  // app (game-store, profile-store, ...) reads/writes that value directly
  // and none of it changes. Only the cookie's stored bytes gain a signature.
  response.cookies.set(sessionCookieName(), signToken(token), cookieOptions(persistent));
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
