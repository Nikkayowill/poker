import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export const ADMIN_SESSION_COOKIE = "river_room_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 4 * 60 * 60;

function safeTextEqual(first: string, second: string): boolean {
  const firstHash = createHash("sha256").update(first).digest();
  const secondHash = createHash("sha256").update(second).digest();
  return timingSafeEqual(firstHash, secondHash);
}

export function isAdminSecretValid(provided: string): boolean {
  const configured = process.env.ADMIN_SECRET;
  return Boolean(configured) && safeTextEqual(provided, configured!);
}

function sessionSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`river-room-admin:${payload}`)
    .digest("base64url");
}

/**
 * Creates a short-lived signed browser session. The cookie contains an
 * expiry, a random nonce and an HMAC — never the ADMIN_SECRET itself.
 */
export function createAdminSessionToken(now = Date.now()): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("Admin access is not configured.");
  const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const payload = `${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${sessionSignature(payload, secret)}`;
}

export function verifyAdminSessionToken(token: string, now = Date.now()): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const [expiresRaw, nonce, providedSignature, ...extra] = token.split(".");
  if (!expiresRaw || !nonce || !providedSignature || extra.length > 0) return false;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  // Reject tokens claiming an implausibly long lifetime even when correctly
  // signed, so changing the configured TTL also constrains old sessions.
  if (expiresAt > Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS) return false;
  const payload = `${expiresRaw}.${nonce}`;
  return safeTextEqual(providedSignature, sessionSignature(payload, secret));
}

/**
 * Shared gate for every /api/admin/* route.
 *
 * The raw ADMIN_SECRET is accepted exactly once by /api/admin/session, which
 * exchanges it for a short-lived signed HttpOnly cookie. Normal admin routes
 * accept only that cookie, so a proxy/debug log containing an arbitrary
 * request header can never become a reusable master credential.
 */
export function isAdminAuthorized(request: NextRequest): boolean {
  const session = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? "";
  return verifyAdminSessionToken(session);
}

/**
 * Gate for /api/cron/* routes. Vercel Cron calls the URL in vercel.json's
 * `crons` list on schedule and, when the project has a CRON_SECRET
 * environment variable set, sends it as `Authorization: Bearer <secret>` --
 * this checks for exactly that. Unset CRON_SECRET disables every cron route,
 * same reasoning as ADMIN_SECRET: no secret configured means no default-open
 * door.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const provided = request.headers.get("authorization") ?? "";
  const providedHash = createHash("sha256").update(provided).digest();
  const configuredHash = createHash("sha256").update(`Bearer ${configured}`).digest();
  return timingSafeEqual(providedHash, configuredHash);
}
