import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Shared gate for every /api/admin/* route. Comparing SHA-256 digests
 * (always 32 bytes) rather than the raw strings keeps timingSafeEqual valid
 * regardless of either string's length, without leaking length via an early
 * mismatch. Unset ADMIN_SECRET disables every admin route outright.
 */
export function isAdminAuthorized(request: NextRequest): boolean {
  const configured = process.env.ADMIN_SECRET;
  if (!configured) return false;
  const provided = request.headers.get("x-admin-secret") ?? "";
  const providedHash = createHash("sha256").update(provided).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  return timingSafeEqual(providedHash, configuredHash);
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
